import { EventEmitter } from 'events'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { R2_BASE_URL, R2_MIRROR_BASE_URL } from './r2Mirror'

interface FakeRequest extends EventEmitter {
  setHeader: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
  abort: ReturnType<typeof vi.fn>
  followRedirect: ReturnType<typeof vi.fn>
  __url: string
  __redirect: string | undefined
}

const requests: FakeRequest[] = []
const settingsState: Record<string, unknown> = {}

vi.mock('../settings', () => ({
  get: (key: string) => settingsState[key],
  set: (key: string, value: unknown) => {
    settingsState[key] = value
  }
}))

vi.mock('electron', () => ({
  net: {
    request: vi.fn((arg: string | { url: string; redirect?: string }) => {
      const req = Object.assign(new EventEmitter(), {
        setHeader: vi.fn(),
        end: vi.fn(),
        abort: vi.fn(),
        followRedirect: vi.fn(),
        __url: typeof arg === 'string' ? arg : arg.url,
        __redirect: typeof arg === 'string' ? undefined : arg.redirect
      }) as FakeRequest
      requests.push(req)
      return req
    })
  }
}))

import { download } from './download'

function makeResponse(
  statusCode: number,
  body: Buffer | string,
  headers: Record<string, string | string[]> = {}
): EventEmitter & { statusCode: number; headers: Record<string, string | string[]> } {
  const res = Object.assign(new EventEmitter(), { statusCode, headers })
  const buf = typeof body === 'string' ? Buffer.from(body) : body
  if (!headers['content-length']) headers['content-length'] = String(buf.length)
  setImmediate(() => {
    res.emit('data', buf)
    res.emit('end')
  })
  return res
}

const PRIMARY_BIN = `${R2_BASE_URL}/linux-nvidia/v0.20.1-env1/bundle.7z`
const MIRROR_BIN = `${R2_MIRROR_BASE_URL}/linux-nvidia/v0.20.1-env1/bundle.7z`

describe('download — R2 mirror fallback for binaries', () => {
  let tmpDir: string

  beforeEach(() => {
    requests.length = 0
    for (const k of Object.keys(settingsState)) delete settingsState[k]
    settingsState['useChineseMirrors'] = true
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'download-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('retries against the mirror when the primary connection errors before any bytes arrive', async () => {
    const dest = path.join(tmpDir, 'bundle.7z')
    const p = download(PRIMARY_BIN, dest, null)
    requests[0]!.emit('error', new Error('ECONNRESET'))
    await new Promise((r) => setImmediate(r))
    expect(requests[1]?.__url).toBe(MIRROR_BIN)
    const body = Buffer.from('mirror-served-bytes')
    requests[1]!.emit('response', makeResponse(200, body))
    await expect(p).resolves.toBe(dest)
    expect(fs.readFileSync(dest, 'utf-8')).toBe('mirror-served-bytes')
  })

  it('retries against the mirror when the primary responds with HTTP error and no bytes have been received', async () => {
    const dest = path.join(tmpDir, 'bundle.7z')
    const p = download(PRIMARY_BIN, dest, null)
    requests[0]!.emit('response', makeResponse(503, ''))
    await new Promise((r) => setImmediate(r))
    expect(requests[1]?.__url).toBe(MIRROR_BIN)
    requests[1]!.emit('response', makeResponse(200, Buffer.from('ok-via-mirror')))
    await expect(p).resolves.toBe(dest)
    expect(fs.readFileSync(dest, 'utf-8')).toBe('ok-via-mirror')
  })

  it('rejects with the primary error when both legs fail', async () => {
    const dest = path.join(tmpDir, 'bundle.7z')
    const p = download(PRIMARY_BIN, dest, null)
    requests[0]!.emit('error', new Error('PRIMARY_DOWN'))
    await new Promise((r) => setImmediate(r))
    requests[1]!.emit('error', new Error('MIRROR_DOWN'))
    await expect(p).rejects.toThrow(/PRIMARY_DOWN/)
  })

  it('does not retry the mirror for URLs outside the R2 namespace', async () => {
    const dest = path.join(tmpDir, 'other.7z')
    const p = download('https://example.com/other.7z', dest, null)
    requests[0]!.emit('error', new Error('NETWORK_DOWN'))
    await expect(p).rejects.toThrow(/NETWORK_DOWN/)
    expect(requests.length).toBe(1)
  })

  it('does NOT retry the mirror when useChineseMirrors is off (avoids thundering-herd on R2 blips)', async () => {
    settingsState['useChineseMirrors'] = false
    const dest = path.join(tmpDir, 'bundle.7z')
    const p = download(PRIMARY_BIN, dest, null)
    requests[0]!.emit('error', new Error('R2_BLIP'))
    await expect(p).rejects.toThrow(/R2_BLIP/)
    expect(requests.length).toBe(1)
  })

  it('does not retry the mirror when the recursive _skipMirror is set (no bounce-back)', async () => {
    const dest = path.join(tmpDir, 'bundle.7z')
    const p = download(MIRROR_BIN, dest, null, { _skipMirror: true } as unknown as {
      _skipMirror: boolean
    })
    requests[0]!.emit('error', new Error('SECOND_DOWN'))
    await expect(p).rejects.toThrow(/SECOND_DOWN/)
    expect(requests.length).toBe(1)
  })
})

describe('download — no-progress watchdog', () => {
  let tmpDir: string
  const URL = 'https://huggingface.co/x/model.safetensors'

  beforeEach(() => {
    requests.length = 0
    for (const k of Object.keys(settingsState)) delete settingsState[k]
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'download-stall-'))
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function openStreaming(req: FakeRequest, totalLen: number): EventEmitter {
    const res = Object.assign(new EventEmitter(), {
      statusCode: 200,
      headers: { 'content-length': String(totalLen) } as Record<string, string>
    })
    req.emit('response', res)
    return res
  }

  it('aborts and rejects when no bytes arrive within idleTimeoutMs', async () => {
    const dest = path.join(tmpDir, 'model.safetensors')
    const p = download(URL, dest, null, { idleTimeoutMs: 1000 })
    const rejection = expect(p).rejects.toThrow(/stalled/i)
    const res = openStreaming(requests[0]!, 100)
    res.emit('data', Buffer.from('ab'))
    await vi.advanceTimersByTimeAsync(1000)
    await rejection
    expect(requests[0]!.abort).toHaveBeenCalled()
  })

  it('preserves idleTimeoutMs across redirects', async () => {
    const dest = path.join(tmpDir, 'redirected.safetensors')
    const p = download(URL, dest, null, { idleTimeoutMs: 150 })
    const rejection = expect(p).rejects.toThrow('Download stalled: no data for 0s')
    requests[0]!.emit('redirect', 302, 'GET', `${URL}?redirected=1`)
    expect(requests[0]!.followRedirect).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(0)
    openStreaming(requests[0]!, 100)
    await vi.advanceTimersByTimeAsync(150)
    await rejection
    expect(requests[0]!.abort).toHaveBeenCalled()
  })

  it('does not fire while bytes keep arriving (timer rearms per chunk)', async () => {
    const dest = path.join(tmpDir, 'model.safetensors')
    const body = Buffer.from('hello world bytes!!!')
    const p = download(URL, dest, null, { idleTimeoutMs: 1000, expectedSize: body.length })
    const res = openStreaming(requests[0]!, body.length)
    for (const ch of [body.subarray(0, 7), body.subarray(7, 14), body.subarray(14)]) {
      res.emit('data', ch)
      await vi.advanceTimersByTimeAsync(800)
    }
    res.emit('end')
    await vi.advanceTimersByTimeAsync(0)
    await expect(p).resolves.toBe(dest)
    expect(requests[0]!.abort).not.toHaveBeenCalled()
  })
})

describe('download URL policy', () => {
  let tmpDir: string

  beforeEach(() => {
    requests.length = 0
    for (const k of Object.keys(settingsState)) delete settingsState[k]
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'download-policy-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('rejects a redirect that violates the caller URL policy', async () => {
    const dest = path.join(tmpDir, 'artifact.tar.gz')
    const validateUrl = (url: string): boolean => new URL(url).protocol === 'https:'
    const result = download('https://storage.example/artifact', dest, null, { validateUrl })
    requests[0]!.emit('redirect', 302, 'GET', 'http://storage.example/artifact')

    await expect(result).rejects.toThrow(/not allowed/i)
    expect(requests).toHaveLength(1)
    expect(requests[0]!.followRedirect).not.toHaveBeenCalled()
    expect(requests[0]!.abort).toHaveBeenCalled()
  })

  it('handles redirects itself instead of letting Chromium follow them', async () => {
    const dest = path.join(tmpDir, 'artifact.bin')
    void download('https://storage.example/artifact', dest, null).catch(() => {})
    expect(requests[0]!.__redirect).toBe('manual')
  })

  it('applies the baseline policy to the first URL when the caller supplies none', async () => {
    const dest = path.join(tmpDir, 'artifact.bin')
    await expect(download('file:///etc/passwd', dest, null)).rejects.toThrow(/not allowed/i)
    await expect(download('http://169.254.169.254/latest/meta-data/', dest, null)).rejects.toThrow(
      /not allowed/i
    )
    expect(requests).toHaveLength(0)
  })

  it.each([
    ['instance metadata', 'http://169.254.169.254/latest/meta-data/'],
    ['embedded credentials', 'https://user:pw@cdn.example/artifact'],
    ['non-http scheme', 'file:///etc/passwd'],
    ['HTTPS to HTTP downgrade', 'http://cdn.example/artifact']
  ])('refuses a redirect hop to %s with the baseline policy', async (_label, hop) => {
    const dest = path.join(tmpDir, 'artifact.bin')
    const result = download('https://storage.example/artifact', dest, null)
    requests[0]!.emit('redirect', 302, 'GET', hop)
    await expect(result).rejects.toThrow('Download failed: redirected to a URL that is not allowed')
    expect(requests[0]!.followRedirect).not.toHaveBeenCalled()
    expect(fs.existsSync(dest)).toBe(false)
  })

  it('checks every hop and keeps the original URL as the resume identity', async () => {
    const dest = path.join(tmpDir, 'artifact.bin')
    const seen: string[] = []
    const validateUrl = (url: string): boolean => {
      seen.push(url)
      return !url.includes('blocked')
    }
    const result = download('https://storage.example/artifact', dest, null, { validateUrl })
    const req = requests[0]!
    req.emit('redirect', 302, 'GET', 'https://cdn.example/hop/1')
    req.emit('redirect', 302, 'GET', 'https://cdn.example/hop/2')
    expect(req.followRedirect).toHaveBeenCalledTimes(2)
    req.emit('redirect', 302, 'GET', 'https://cdn.example/blocked')
    await expect(result).rejects.toThrow(/not allowed/i)
    expect(seen).toEqual([
      'https://storage.example/artifact',
      'https://cdn.example/hop/1',
      'https://cdn.example/hop/2',
      'https://cdn.example/blocked'
    ])
  })

  it('follows a permitted redirect on the same request and completes', async () => {
    const dest = path.join(tmpDir, 'artifact.bin')
    const result = download('https://storage.example/artifact', dest, null)
    const req = requests[0]!
    req.emit('redirect', 302, 'GET', 'https://cdn.example/blob')
    req.emit('response', makeResponse(200, 'payload'))
    await expect(result).resolves.toBe(dest)
    expect(requests).toHaveLength(1)
    expect(fs.readFileSync(dest, 'utf-8')).toBe('payload')
  })

  it('fails after too many redirects', async () => {
    const dest = path.join(tmpDir, 'artifact.bin')
    const result = download('https://storage.example/artifact', dest, null, { _maxRedirects: 2 })
    const req = requests[0]!
    for (let i = 0; i < 3; i++) req.emit('redirect', 302, 'GET', `https://cdn.example/hop/${i}`)
    await expect(result).rejects.toThrow('Download failed: too many redirects')
    expect(req.followRedirect).toHaveBeenCalledTimes(2)
  })
})
