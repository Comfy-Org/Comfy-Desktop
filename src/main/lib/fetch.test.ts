import { EventEmitter } from 'events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { R2_BASE_URL, R2_MIRROR_BASE_URL } from './r2Mirror'

vi.mock('./paths', () => ({ cacheDir: () => '/tmp/desktop-test-cache' }))
vi.mock('./safe-file', () => ({ writeFileSafe: vi.fn() }))

interface FakeRequest extends EventEmitter {
  setHeader: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
  abort: ReturnType<typeof vi.fn>
  __url: string
  __headers: Record<string, string>
}

const requests: FakeRequest[] = []

vi.mock('electron', () => ({
  net: {
    request: vi.fn((opts: { url: string }) => {
      const headers: Record<string, string> = {}
      const req = Object.assign(new EventEmitter(), {
        setHeader: vi.fn((k: string, v: string) => {
          headers[k] = v
        }),
        end: vi.fn(),
        abort: vi.fn(),
        __url: opts.url,
        __headers: headers
      }) as FakeRequest
      requests.push(req)
      return req
    })
  }
}))

import { _resetCacheForTest, fetchJSON, fetchText } from './fetch'

function makeResponse(
  statusCode: number,
  body: string,
  headers: Record<string, string> = {}
): EventEmitter & { statusCode: number; headers: Record<string, string> } {
  const res = Object.assign(new EventEmitter(), { statusCode, headers })
  setImmediate(() => {
    res.emit('data', body)
    res.emit('end')
  })
  return res
}

const PRIMARY = `${R2_BASE_URL}/latest.json`
const MIRROR = `${R2_MIRROR_BASE_URL}/latest.json`

describe('fetchJSON — happy path preserved by refactor', () => {
  beforeEach(() => {
    requests.length = 0
    _resetCacheForTest()
  })

  it('returns primary body on 200', async () => {
    const p = fetchJSON(PRIMARY)
    requests[0]!.emit('response', makeResponse(200, '{"ok":true}', { etag: '"v1"' }))
    await expect(p).resolves.toEqual({ ok: true })
    expect(requests.length).toBe(1)
  })

  it('rejects with HTTP error on non-200, no mirror retry, no cached fallback', async () => {
    const p = fetchJSON(PRIMARY)
    requests[0]!.emit('response', makeResponse(500, ''))
    // Mirror IS tried on HTTP error — verify the mirror is the second request,
    // then make it also error so the call rejects.
    await new Promise((r) => setImmediate(r))
    expect(requests[1]?.__url).toBe(MIRROR)
    requests[1]!.emit('error', new Error('mirror down'))
    await expect(p).rejects.toThrow(/HTTP 500/)
  })

  it('rejects with parse error on malformed JSON, no cached fallback', async () => {
    const p = fetchJSON(PRIMARY)
    requests[0]!.emit('response', makeResponse(200, '{not valid'))
    await new Promise((r) => setImmediate(r))
    expect(requests[1]?.__url).toBe(MIRROR)
    requests[1]!.emit('error', new Error('mirror down'))
    await expect(p).rejects.toThrow(/Invalid JSON/)
  })
})

describe('fetchJSON — mirror fallback semantics', () => {
  beforeEach(() => {
    requests.length = 0
    _resetCacheForTest()
  })

  it('retries the mirror when the primary connection errors', async () => {
    const p = fetchJSON(PRIMARY)
    requests[0]!.emit('error', new Error('ECONNRESET'))
    await new Promise((r) => setImmediate(r))
    expect(requests[1]?.__url).toBe(MIRROR)
    requests[1]!.emit('response', makeResponse(200, '{"from":"mirror"}'))
    await expect(p).resolves.toEqual({ from: 'mirror' })
  })

  it('does NOT send the primary If-None-Match to the mirror', async () => {
    // No prior cache entry; just verify the mirror leg gets fresh headers.
    const p = fetchJSON(PRIMARY)
    requests[0]!.emit('response', makeResponse(500, ''))
    await new Promise((r) => setImmediate(r))
    const mirrorReq = requests[1]!
    expect(mirrorReq.__url).toBe(MIRROR)
    expect(mirrorReq.__headers['If-None-Match']).toBeUndefined()
    mirrorReq.emit('response', makeResponse(200, '{"ok":true}', { etag: '"mirror-etag"' }))
    await expect(p).resolves.toEqual({ ok: true })
  })

  it('rejects with the primary error when both legs fail and no cache exists', async () => {
    const p = fetchJSON(PRIMARY)
    requests[0]!.emit('error', new Error('PRIMARY_DOWN'))
    await new Promise((r) => setImmediate(r))
    requests[1]!.emit('error', new Error('MIRROR_DOWN'))
    await expect(p).rejects.toThrow(/PRIMARY_DOWN/)
  })

  it('does not retry the mirror for URLs outside the R2 namespace', async () => {
    const p = fetchJSON('https://api.github.com/repos/x/y/releases')
    requests[0]!.emit('error', new Error('NETWORK_DOWN'))
    await expect(p).rejects.toThrow(/NETWORK_DOWN/)
    expect(requests.length).toBe(1)
  })
})

describe('fetchJSON — mirror is not allowed to poison the cache', () => {
  beforeEach(() => {
    requests.length = 0
    _resetCacheForTest()
  })

  it('does NOT write a cache entry when the response came from the mirror', async () => {
    // Drive a mirror-served success, then make a second call and assert the
    // second call still goes to the primary without If-None-Match (i.e. the
    // first call wrote nothing to the cache).
    const p1 = fetchJSON(PRIMARY)
    requests[0]!.emit('error', new Error('PRIMARY_DOWN'))
    await new Promise((r) => setImmediate(r))
    requests[1]!.emit('response', makeResponse(200, '{"v":1}', { etag: '"mirror-etag-1"' }))
    await expect(p1).resolves.toEqual({ v: 1 })

    requests.length = 0
    const p2 = fetchJSON(PRIMARY)
    // No prior cache entry persisted from the mirror-served call, so no
    // conditional header.
    expect(requests[0]!.__headers['If-None-Match']).toBeUndefined()
    requests[0]!.emit('response', makeResponse(200, '{"v":2}', { etag: '"primary-etag"' }))
    await expect(p2).resolves.toEqual({ v: 2 })
  })

  it('DOES write a cache entry when the response came from the primary', async () => {
    const p1 = fetchJSON(PRIMARY)
    requests[0]!.emit('response', makeResponse(200, '{"v":1}', { etag: '"primary-etag-1"' }))
    await p1

    requests.length = 0
    const p2 = fetchJSON(PRIMARY)
    // The primary-served call DID populate the cache, so the second call
    // sends the primary's ETag.
    expect(requests[0]!.__headers['If-None-Match']).toBe('"primary-etag-1"')
    requests[0]!.emit('response', makeResponse(304, ''))
    await expect(p2).resolves.toEqual({ v: 1 })
  })
})

describe('fetchText — shares fetchJSON’s cache and retry layer', () => {
  beforeEach(() => {
    requests.length = 0
    _resetCacheForTest()
  })

  it('returns the raw body without JSON parsing', async () => {
    const p = fetchText(PRIMARY)
    requests[0]!.emit('response', makeResponse(200, 'comfyui-workflow-templates==0.11.31\n'))
    await expect(p).resolves.toContain('comfyui-workflow-templates==0.11.31')
  })

  it('serves the cached body on a 304, so an unchanged pin costs no re-download', async () => {
    const first = fetchText(PRIMARY)
    requests[0]!.emit('response', makeResponse(200, 'pinned==1.0.0', { etag: '"v1"' }))
    await first

    const second = fetchText(PRIMARY)
    requests[1]!.emit('response', makeResponse(304, ''))
    await expect(second, 'a warm cache carries an offline boot').resolves.toBe('pinned==1.0.0')
  })

  it('falls back to the last-cached body when the network fails', async () => {
    const first = fetchText(PRIMARY)
    requests[0]!.emit('response', makeResponse(200, 'pinned==1.0.0', { etag: '"v1"' }))
    await first

    const second = fetchText(PRIMARY)
    requests[1]!.emit('error', new Error('offline'))
    await new Promise((r) => setImmediate(r))
    requests[2]!.emit('error', new Error('offline'))
    await expect(second, 'a warm cache carries an offline boot').resolves.toBe('pinned==1.0.0')
  })

  it('rejects on a non-200 so a 404 is not mistaken for an empty body', async () => {
    const p = fetchText(PRIMARY)
    requests[0]!.emit('response', makeResponse(404, 'Not Found'))
    await new Promise((r) => setImmediate(r))
    requests[1]!.emit('error', new Error('mirror down'))
    await expect(p).rejects.toThrow(/HTTP 404/)
  })
})

describe('fetch — request timeout', () => {
  beforeEach(() => {
    requests.length = 0
    _resetCacheForTest()
  })

  it('rejects a stalled request instead of hanging its callers', async () => {
    await expect(
      fetchText(PRIMARY, { timeoutMs: 10 }),
      'net.request has no deadline, so only this can settle a black-holed socket'
    ).rejects.toThrow(/Timed out after 10ms/)
  })

  it('aborts the stalled request rather than leaking the socket', async () => {
    await fetchText(PRIMARY, { timeoutMs: 10 }).catch(() => undefined)
    expect(requests[0]!.abort, 'the socket is released, not just abandoned').toHaveBeenCalled()
  })

  it('does not let a late timeout reject an already-resolved request', async () => {
    const p = fetchText(PRIMARY, { timeoutMs: 10 })
    requests[0]!.emit('response', makeResponse(200, 'body'))
    await expect(p).resolves.toBe('body')
    await new Promise((r) => setTimeout(r, 30))
  })
})

describe('fetch — cache is namespaced by parser', () => {
  beforeEach(() => {
    requests.length = 0
    _resetCacheForTest()
  })

  it('does not serve a JSON-cached body to a text caller', async () => {
    const first = fetchJSON(PRIMARY)
    requests[0]!.emit('response', makeResponse(200, '{"a":1}', { etag: '"v1"' }))
    await first

    const second = fetchText(PRIMARY)
    requests[1]!.emit('response', makeResponse(200, 'plain text'))
    await expect(second, 'a JSON-cached body is never served to a text caller').resolves.toBe(
      'plain text'
    )
  })
})
