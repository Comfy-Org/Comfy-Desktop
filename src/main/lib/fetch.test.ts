import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { R2_BASE_URL, R2_MIRROR_BASE_URL } from './r2Mirror'

vi.mock('./paths', () => ({ cacheDir: () => '/tmp/desktop-test-cache' }))
vi.mock('./safe-file', () => ({ writeFileSafe: vi.fn() }))

interface FakeRequest extends EventEmitter {
  setHeader: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
  abort: ReturnType<typeof vi.fn>
  followRedirect: ReturnType<typeof vi.fn>
  __url: string
  __redirect: string | undefined
  __headers: Record<string, string>
}

const requests: FakeRequest[] = []

vi.mock('electron', () => ({
  net: {
    request: vi.fn((opts: { url: string; redirect?: string }) => {
      const headers: Record<string, string> = {}
      const req = Object.assign(new EventEmitter(), {
        setHeader: vi.fn((k: string, v: string) => {
          headers[k] = v
        }),
        end: vi.fn(),
        abort: vi.fn(),
        followRedirect: vi.fn(),
        __url: opts.url,
        __redirect: opts.redirect,
        __headers: headers
      }) as FakeRequest
      requests.push(req)
      return req
    })
  }
}))

import { _resetCacheForTest, fetchJSON } from './fetch'

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

  it('rejects with the primary HTTP error when the mirror retry also fails, no cached fallback', async () => {
    const p = fetchJSON(PRIMARY)
    requests[0]!.emit('response', makeResponse(500, ''))
    await new Promise((r) => setImmediate(r))
    expect(requests[1]?.__url).toBe(MIRROR)
    requests[1]!.emit('error', new Error('mirror down'))
    await expect(p).rejects.toThrow(/HTTP 500/)
  })

  it('rejects with the primary parse error when the mirror retry also fails, no cached fallback', async () => {
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
    const p1 = fetchJSON(PRIMARY)
    requests[0]!.emit('error', new Error('PRIMARY_DOWN'))
    await new Promise((r) => setImmediate(r))
    requests[1]!.emit('response', makeResponse(200, '{"v":1}', { etag: '"mirror-etag-1"' }))
    await expect(p1).resolves.toEqual({ v: 1 })

    requests.length = 0
    const p2 = fetchJSON(PRIMARY)
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
    expect(requests[0]!.__headers['If-None-Match']).toBe('"primary-etag-1"')
    requests[0]!.emit('response', makeResponse(304, ''))
    await expect(p2).resolves.toEqual({ v: 1 })
  })
})

describe('fetchJSON — URL policy', () => {
  beforeEach(() => {
    requests.length = 0
    _resetCacheForTest()
  })

  it('handles redirects itself instead of letting Chromium follow them', async () => {
    const p = fetchJSON(PRIMARY)
    expect(requests[0]!.__redirect).toBe('manual')
    requests[0]!.emit('response', makeResponse(200, '{}'))
    await p
  })

  it.each(['file:///etc/passwd', 'http://169.254.169.254/latest/meta-data/'])(
    'refuses %s without a request',
    async (url) => {
      await expect(fetchJSON(url)).rejects.toThrow('Request URL is not allowed')
      expect(requests).toHaveLength(0)
    }
  )

  it('follows a permitted redirect on the same request', async () => {
    const p = fetchJSON('https://api.github.com/repos/o/r')
    requests[0]!.emit('redirect', 301, 'GET', 'https://api.github.com/repositories/1')
    expect(requests[0]!.followRedirect).toHaveBeenCalledTimes(1)
    requests[0]!.emit('response', makeResponse(200, '{"ok":true}'))
    await expect(p).resolves.toEqual({ ok: true })
  })

  it.each([
    ['instance metadata', 'http://169.254.169.254/latest/meta-data/'],
    ['embedded credentials', 'https://user:pw@api.github.com/x'],
    ['HTTPS to HTTP downgrade', 'http://api.github.com/x']
  ])('refuses a redirect hop to %s', async (_label, hop) => {
    const p = fetchJSON('https://api.github.com/repos/o/r')
    requests[0]!.emit('redirect', 302, 'GET', hop)
    await expect(p).rejects.toThrow('Request redirected to a URL that is not allowed')
    expect(requests[0]!.followRedirect).not.toHaveBeenCalled()
    expect(requests[0]!.abort).toHaveBeenCalled()
  })

  it('fails after too many redirects', async () => {
    const p = fetchJSON('https://api.github.com/repos/o/r')
    for (let i = 0; i < 6; i++) {
      requests[0]!.emit('redirect', 302, 'GET', `https://api.github.com/hop/${i}`)
    }
    await expect(p).rejects.toThrow('Request failed: too many redirects')
    expect(requests[0]!.followRedirect).toHaveBeenCalledTimes(5)
  })
})

describe('fetchJSON — GITHUB_TOKEN across redirects', () => {
  const saved = process.env.GITHUB_TOKEN

  beforeEach(() => {
    requests.length = 0
    _resetCacheForTest()
    process.env.GITHUB_TOKEN = 'gh-secret'
  })

  afterEach(() => {
    if (saved === undefined) delete process.env.GITHUB_TOKEN
    else process.env.GITHUB_TOKEN = saved
  })

  it('sends the token to api.github.com', async () => {
    const p = fetchJSON('https://api.github.com/repos/o/r')
    expect(requests[0]!.__headers['Authorization']).toBe('token gh-secret')
    requests[0]!.emit('response', makeResponse(200, '{}'))
    await p
  })

  it('keeps the token on a same-origin redirect', async () => {
    const p = fetchJSON('https://api.github.com/repos/o/r')
    requests[0]!.emit('redirect', 301, 'GET', 'https://api.github.com/repositories/1')
    expect(requests[0]!.followRedirect).toHaveBeenCalledTimes(1)
    expect(requests).toHaveLength(1)
    requests[0]!.emit('response', makeResponse(200, '{"ok":1}'))
    await expect(p).resolves.toEqual({ ok: 1 })
  })

  it('re-issues a cross-origin redirect as a new request without the token', async () => {
    const p = fetchJSON('https://api.github.com/repos/o/r/tarball')
    requests[0]!.emit('redirect', 302, 'GET', 'https://codeload.github.com/o/r/tar.gz/main')
    expect(requests[0]!.followRedirect).not.toHaveBeenCalled()
    expect(requests[0]!.abort).toHaveBeenCalled()
    expect(requests[1]!.__url).toBe('https://codeload.github.com/o/r/tar.gz/main')
    expect(requests[1]!.__headers['Authorization']).toBeUndefined()
    requests[1]!.emit('response', makeResponse(200, '{"via":"codeload"}'))
    await expect(p).resolves.toEqual({ via: 'codeload' })
  })

  it('never restores the token after leaving the origin, even back on api.github.com', async () => {
    const p = fetchJSON('https://api.github.com/repos/o/r')
    requests[0]!.emit('redirect', 302, 'GET', 'https://elsewhere.example/x')
    requests[1]!.emit('redirect', 302, 'GET', 'https://api.github.com/repos/o/r2')
    expect(requests[1]!.followRedirect).toHaveBeenCalledTimes(1)
    expect(requests[1]!.__headers['Authorization']).toBeUndefined()
    requests[1]!.emit('response', makeResponse(200, '{}'))
    await p
  })

  it('keeps counting redirects across the re-issued request', async () => {
    const p = fetchJSON('https://api.github.com/repos/o/r')
    requests[0]!.emit('redirect', 302, 'GET', 'https://elsewhere.example/0')
    for (let i = 1; i <= 5; i++) {
      requests[1]!.emit('redirect', 302, 'GET', `https://elsewhere.example/${i}`)
    }
    await expect(p).rejects.toThrow('Request failed: too many redirects')
  })

  it('still refuses a disallowed hop when the token is set', async () => {
    const p = fetchJSON('https://api.github.com/repos/o/r')
    requests[0]!.emit('redirect', 302, 'GET', 'http://169.254.169.254/latest/meta-data/')
    await expect(p).rejects.toThrow('Request redirected to a URL that is not allowed')
    expect(requests).toHaveLength(1)
  })
})
