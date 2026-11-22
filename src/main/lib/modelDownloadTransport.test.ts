import { EventEmitter } from 'events'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { R2_BASE_URL, R2_MIRROR_BASE_URL } from './r2Mirror'
import {
  readStagedMeta,
  stagingMetaPathFor,
  stagingPathFor,
  writeStagedMeta,
  type StagedDownloadMeta
} from './modelDownloadStaging'

interface FakeRequest extends EventEmitter {
  setHeader: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
  abort: ReturnType<typeof vi.fn>
  followRedirect: ReturnType<typeof vi.fn>
  __url: string
  __options: Record<string, unknown>
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
  session: {
    fromPartition: vi.fn((partition: string) => ({ __partition: partition }))
  },
  net: {
    request: vi.fn((options: { url: string } & Record<string, unknown>) => {
      const req = Object.assign(new EventEmitter(), {
        setHeader: vi.fn(),
        end: vi.fn(),
        abort: vi.fn(),
        followRedirect: vi.fn(),
        __url: options.url,
        __options: options
      }) as FakeRequest
      requests.push(req)
      return req
    })
  }
}))

import { startModelTransfer, type ModelTransferOptions } from './modelDownloadTransport'
import { DEFAULT_SEGMENT_TUNING, planSegments, type SegmentTuning } from './modelDownloadSegments'
import { DISK_SPACE_RESERVE_BYTES } from './modelDownloadSpace'

interface FakeResponse extends EventEmitter {
  statusCode: number
  headers: Record<string, string | string[]>
  pause: ReturnType<typeof vi.fn>
  resume: ReturnType<typeof vi.fn>
}

function makeResponse(
  statusCode: number,
  headers: Record<string, string | string[]> = {}
): FakeResponse {
  return Object.assign(new EventEmitter(), {
    statusCode,
    headers,
    pause: vi.fn(),
    resume: vi.fn()
  }) as FakeResponse
}

async function flush(turns = 4): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await new Promise((r) => setImmediate(r))
  }
}

const URL_MAIN = 'https://example.com/models/model.safetensors'

let tmpDir: string
let finalPath: string

function baseOpts(overrides: Partial<ModelTransferOptions> = {}): ModelTransferOptions {
  return {
    url: URL_MAIN,
    finalPath,
    directory: 'checkpoints',
    filename: 'model.safetensors',
    ...overrides
  }
}

function stagedMeta(overrides: Partial<StagedDownloadMeta> = {}): StagedDownloadMeta {
  return {
    version: 2,
    url: URL_MAIN,
    expectedSize: 10,
    etag: '"v1"',
    directory: 'checkpoints',
    filename: 'model.safetensors',
    ...overrides
  }
}

function headerCalls(req: FakeRequest): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of req.setHeader.mock.calls as [string, string][]) {
    out[name] = value
  }
  return out
}

beforeEach(() => {
  requests.length = 0
  for (const k of Object.keys(settingsState)) delete settingsState[k]
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-transport-test-'))
  finalPath = path.join(tmpDir, 'checkpoints', 'model.safetensors')
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('completion', () => {
  it('stages bytes in .part, then atomically finalizes and removes the sidecar', async () => {
    const handle = startModelTransfer(baseOpts())
    const req = requests[0]!
    expect(req.__url).toBe(URL_MAIN)

    const res = makeResponse(200, { 'content-length': '10' })
    req.emit('response', res)
    res.emit('data', Buffer.from('01234'))
    await flush()

    expect(fs.existsSync(finalPath)).toBe(false)
    expect(fs.existsSync(stagingPathFor(finalPath))).toBe(true)
    expect(readStagedMeta(stagingMetaPathFor(finalPath))?.url).toBe(URL_MAIN)

    res.emit('data', Buffer.from('56789'))
    res.emit('end')
    const outcome = await handle.done
    expect(outcome).toEqual({ outcome: 'completed', savePath: finalPath, finalBytes: 10 })
    expect(fs.readFileSync(finalPath, 'utf-8')).toBe('0123456789')
    expect(fs.existsSync(stagingPathFor(finalPath))).toBe(false)
    expect(fs.existsSync(stagingMetaPathFor(finalPath))).toBe(false)
  })

  it('reports progress with received and total bytes', async () => {
    const progress: { receivedBytes: number; totalBytes: number }[] = []
    const handle = startModelTransfer(baseOpts({ onProgress: (p) => progress.push({ ...p }) }))
    const req = requests[0]!
    const res = makeResponse(200, { 'content-length': '4' })
    req.emit('response', res)
    res.emit('data', Buffer.from('ab'))
    res.emit('data', Buffer.from('cd'))
    res.emit('end')
    await handle.done
    expect(progress).toEqual([
      { receivedBytes: 2, totalBytes: 4 },
      { receivedBytes: 4, totalBytes: 4 }
    ])
  })

  it('carries the originating session with useSessionCookies', () => {
    const session = { __fake: 'session' } as unknown as Electron.Session
    startModelTransfer(baseOpts({ session }))
    const options = requests[0]!.__options
    expect(options['session']).toBe(session)
    expect(options['useSessionCookies']).toBe(true)
  })

  it('validates a caller-expected size against the server and discards staged bytes on mismatch', async () => {
    const handle = startModelTransfer(baseOpts({ expectedSize: 999 }))
    const req = requests[0]!
    const res = makeResponse(200, { 'content-length': '10' })
    req.emit('response', res)
    const outcome = await handle.done
    expect(outcome).toEqual({
      outcome: 'error',
      error: 'Download size mismatch: expected 999 bytes but server reported 10'
    })
    expect(fs.existsSync(stagingPathFor(finalPath))).toBe(false)
    expect(fs.existsSync(finalPath)).toBe(false)
  })

  it('never finalizes a body whose total size cannot be verified', async () => {
    const handle = startModelTransfer(baseOpts())
    const req = requests[0]!
    const res = makeResponse(200, {})
    req.emit('response', res)
    res.emit('data', Buffer.from('0123456789'))
    res.emit('end')
    const outcome = await handle.done
    expect(outcome.outcome).toBe('error')
    expect((outcome as { error: string }).error).toMatch(/did not report a size/)
    expect(fs.existsSync(finalPath)).toBe(false)
    expect(fs.readFileSync(stagingPathFor(finalPath), 'utf-8')).toBe('0123456789')
    expect(readStagedMeta(stagingMetaPathFor(finalPath))?.url).toBe(URL_MAIN)
  })

  it('keeps a short body as staged bytes so retry can resume', async () => {
    const handle = startModelTransfer(baseOpts())
    const req = requests[0]!
    const res = makeResponse(200, {
      'content-length': '10',
      etag: '"v1"'
    })
    req.emit('response', res)
    res.emit('data', Buffer.from('0123'))
    res.emit('end')
    const outcome = await handle.done
    expect(outcome).toEqual({
      outcome: 'error',
      error: 'Download incomplete: expected 10 bytes but got 4'
    })
    expect(fs.existsSync(finalPath)).toBe(false)
    expect(fs.statSync(stagingPathFor(finalPath)).size).toBe(4)
    expect(readStagedMeta(stagingMetaPathFor(finalPath))).toMatchObject({
      url: URL_MAIN,
      expectedSize: 10,
      etag: '"v1"'
    })
  })
})

describe('pause / cancel', () => {
  it('pause aborts the network and keeps staged bytes + sidecar', async () => {
    const handle = startModelTransfer(baseOpts())
    const req = requests[0]!
    const res = makeResponse(200, { 'content-length': '10', etag: '"v1"' })
    req.emit('response', res)
    res.emit('data', Buffer.from('01234'))

    expect(handle.pause()).toBe(true)
    const outcome = await handle.done
    expect(outcome).toEqual({ outcome: 'paused' })
    expect(req.abort).toHaveBeenCalled()
    expect(fs.existsSync(finalPath)).toBe(false)
    expect(fs.statSync(stagingPathFor(finalPath)).size).toBe(5)
    expect(readStagedMeta(stagingMetaPathFor(finalPath))?.etag).toBe('"v1"')
    expect(handle.pause()).toBe(false)
    expect(handle.cancel()).toBe(false)
  })

  it('cancel aborts the network and deletes staged bytes + sidecar', async () => {
    const handle = startModelTransfer(baseOpts())
    const req = requests[0]!
    const res = makeResponse(200, { 'content-length': '10' })
    req.emit('response', res)
    res.emit('data', Buffer.from('01234'))

    expect(handle.cancel()).toBe(true)
    const outcome = await handle.done
    expect(outcome).toEqual({ outcome: 'cancelled' })
    expect(req.abort).toHaveBeenCalled()
    expect(fs.existsSync(finalPath)).toBe(false)
    expect(fs.existsSync(stagingPathFor(finalPath))).toBe(false)
    expect(fs.existsSync(stagingMetaPathFor(finalPath))).toBe(false)
  })
})

describe('network failure', () => {
  it('keeps staged bytes on a mid-body error so retry resumes', async () => {
    const handle = startModelTransfer(baseOpts())
    const req = requests[0]!
    const res = makeResponse(200, { 'content-length': '10', etag: '"v1"' })
    req.emit('response', res)
    res.emit('data', Buffer.from('0123456'))
    res.emit('error', new Error('ECONNRESET'))
    const outcome = await handle.done
    expect(outcome).toEqual({ outcome: 'error', error: 'Download failed: ECONNRESET' })
    expect(fs.existsSync(finalPath)).toBe(false)
    expect(fs.statSync(stagingPathFor(finalPath)).size).toBe(7)
    expect(readStagedMeta(stagingMetaPathFor(finalPath))).not.toBeNull()
  })

  it('fails on a pre-response connection error', async () => {
    const handle = startModelTransfer(baseOpts())
    requests[0]!.emit('error', new Error('ENOTFOUND'))
    const outcome = await handle.done
    expect(outcome).toEqual({ outcome: 'error', error: 'Download failed: ENOTFOUND' })
  })

  it('fails on an HTTP error status', async () => {
    const handle = startModelTransfer(baseOpts())
    requests[0]!.emit('response', makeResponse(503))
    const outcome = await handle.done
    expect(outcome).toEqual({ outcome: 'error', error: 'Download failed: HTTP 503' })
  })

  it('aborts a stalled transfer and keeps staged bytes', async () => {
    vi.useFakeTimers()
    let handle!: ReturnType<typeof startModelTransfer>
    let req!: (typeof requests)[number]
    try {
      handle = startModelTransfer(baseOpts({ idleTimeoutMs: 25 }))
      req = requests[0]!
      const res = makeResponse(200, { 'content-length': '10', etag: '"v1"' })
      req.emit('response', res)
      res.emit('data', Buffer.from('012'))
      await vi.advanceTimersByTimeAsync(30)
    } finally {
      vi.useRealTimers()
    }
    const outcome = await handle.done
    expect(outcome.outcome).toBe('error')
    expect((outcome as { error: string }).error).toMatch(/stalled/)
    expect(req.abort).toHaveBeenCalled()
    expect(fs.statSync(stagingPathFor(finalPath)).size).toBe(3)
  })
})

describe('resume', () => {
  function preStage(bytes: string, meta: StagedDownloadMeta): void {
    fs.mkdirSync(path.dirname(finalPath), { recursive: true })
    fs.writeFileSync(stagingPathFor(finalPath), bytes)
    writeStagedMeta(stagingMetaPathFor(finalPath), meta)
  }

  it('sends Range and If-Range for retained staged bytes and appends on a well-formed 206', async () => {
    preStage('AAAAA', stagedMeta({ expectedSize: 10, etag: '"v1"' }))
    const handle = startModelTransfer(baseOpts())
    const req = requests[0]!
    const headers = headerCalls(req)
    expect(headers['Range']).toBe('bytes=5-')
    expect(headers['If-Range']).toBe('"v1"')

    const res = makeResponse(206, { 'content-length': '5', 'content-range': 'bytes 5-9/10' })
    req.emit('response', res)
    res.emit('data', Buffer.from('BBBBB'))
    res.emit('end')
    const outcome = await handle.done
    expect(outcome).toEqual({ outcome: 'completed', savePath: finalPath, finalBytes: 10 })
    expect(fs.readFileSync(finalPath, 'utf-8')).toBe('AAAAABBBBB')
  })

  it('rejects a resumed 206 that omits Content-Range, keeping staged bytes for retry', async () => {
    preStage('AAAAA', stagedMeta({ expectedSize: 10, etag: '"v1"' }))
    const handle = startModelTransfer(baseOpts())
    const req = requests[0]!
    const res = makeResponse(206, { 'content-length': '5' })
    req.emit('response', res)
    res.emit('data', Buffer.from('BBBBB'))
    res.emit('end')
    const outcome = await handle.done
    expect(outcome.outcome).toBe('error')
    expect((outcome as { error: string }).error).toMatch(/Content-Range/)
    expect(fs.existsSync(finalPath)).toBe(false)
    expect(fs.readFileSync(stagingPathFor(finalPath), 'utf-8')).toBe('AAAAA')
    expect(readStagedMeta(stagingMetaPathFor(finalPath))?.expectedSize).toBe(10)
  })

  it('rejects a 206 whose Content-Length disagrees with its Content-Range span', async () => {
    preStage('AAAAA', stagedMeta({ expectedSize: 10, etag: '"v1"' }))
    const handle = startModelTransfer(baseOpts())
    const req = requests[0]!
    const res = makeResponse(206, { 'content-length': '4', 'content-range': 'bytes 5-9/10' })
    req.emit('response', res)
    const outcome = await handle.done
    expect(outcome.outcome).toBe('error')
    expect(req.abort).toHaveBeenCalled()
    expect(fs.existsSync(finalPath)).toBe(false)
  })

  it('rejects a 206 that resumes at the wrong offset instead of splicing it in', async () => {
    preStage('AAAAA', stagedMeta({ expectedSize: 10, etag: '"v1"' }))
    const handle = startModelTransfer(baseOpts())
    const req = requests[0]!
    const res = makeResponse(206, { 'content-length': '8', 'content-range': 'bytes 2-9/10' })
    req.emit('response', res)
    const outcome = await handle.done
    expect(outcome.outcome).toBe('error')
    expect(req.abort).toHaveBeenCalled()
    await flush()
    expect(fs.existsSync(stagingPathFor(finalPath))).toBe(false)
    expect(fs.existsSync(stagingMetaPathFor(finalPath))).toBe(false)
    expect(fs.existsSync(finalPath)).toBe(false)
  })

  it('prefers the ETag validator but falls back to Last-Modified', () => {
    preStage('AAAAA', stagedMeta({ etag: undefined, lastModified: 'Wed, 01 Jan 2026' }))
    startModelTransfer(baseOpts())
    const headers = headerCalls(requests[0]!)
    expect(headers['Range']).toBe('bytes=5-')
    expect(headers['If-Range']).toBe('Wed, 01 Jan 2026')
  })

  it('restarts from zero when the server answers a Range request with 200', async () => {
    preStage('AAAAA', stagedMeta({ expectedSize: 10, etag: '"v1"' }))
    const handle = startModelTransfer(baseOpts())
    const req = requests[0]!
    const res = makeResponse(200, { 'content-length': '10', etag: '"v2"' })
    req.emit('response', res)
    res.emit('data', Buffer.from('CCCCCCCCCC'))
    res.emit('end')
    const outcome = await handle.done
    expect(outcome).toEqual({ outcome: 'completed', savePath: finalPath, finalBytes: 10 })
    expect(fs.readFileSync(finalPath, 'utf-8')).toBe('CCCCCCCCCC')
  })

  it('restarts clean when the sidecar has no validator', async () => {
    preStage('AAAAA', stagedMeta({ etag: undefined, lastModified: undefined }))
    const handle = startModelTransfer(baseOpts())
    const headers = headerCalls(requests[0]!)
    expect(headers['Range']).toBeUndefined()
    expect(fs.statSync(stagingPathFor(finalPath)).size).toBe(0)
    expect(readStagedMeta(stagingMetaPathFor(finalPath))?.url).toBe(URL_MAIN)
    handle.cancel()
    await handle.done
  })

  it('restarts clean when a different URL owns the staged bytes', async () => {
    preStage('AAAAA', stagedMeta({ url: 'https://other.example.com/model.safetensors' }))
    const handle = startModelTransfer(baseOpts())
    const headers = headerCalls(requests[0]!)
    expect(headers['Range']).toBeUndefined()
    expect(fs.statSync(stagingPathFor(finalPath)).size).toBe(0)
    expect(readStagedMeta(stagingMetaPathFor(finalPath))?.url).toBe(URL_MAIN)
    handle.cancel()
    await handle.done
  })

  it('finalizes without any network when the staged bytes already equal the expected size', async () => {
    preStage('0123456789', stagedMeta({ expectedSize: 10 }))
    const handle = startModelTransfer(baseOpts())
    const outcome = await handle.done
    expect(outcome).toEqual({ outcome: 'completed', savePath: finalPath, finalBytes: 10 })
    expect(requests).toHaveLength(0)
    expect(fs.readFileSync(finalPath, 'utf-8')).toBe('0123456789')
  })

  it('never treats staged bytes EXCEEDING the expected size as complete', async () => {
    preStage('0123456789X', stagedMeta({ expectedSize: 10 }))
    const handle = startModelTransfer(baseOpts())
    expect(requests).toHaveLength(1)
    const headers = headerCalls(requests[0]!)
    expect(headers['Range']).toBeUndefined()
    expect(fs.statSync(stagingPathFor(finalPath)).size).toBe(0)
    expect(fs.existsSync(finalPath)).toBe(false)
    handle.cancel()
    await handle.done
  })

  it('finalizes on HTTP 416 only with server-confirmed proof of completeness', async () => {
    preStage('0123456789', stagedMeta({ expectedSize: 0 }))
    const handle = startModelTransfer(baseOpts())
    const req = requests[0]!
    expect(headerCalls(req)['Range']).toBe('bytes=10-')
    req.emit('response', makeResponse(416, { 'content-range': 'bytes */10' }))
    const outcome = await handle.done
    expect(outcome).toEqual({ outcome: 'completed', savePath: finalPath, finalBytes: 10 })
    expect(fs.readFileSync(finalPath, 'utf-8')).toBe('0123456789')
  })

  it('discards the partial on a bare HTTP 416 without Content-Range proof', async () => {
    preStage('AAAAA', stagedMeta({ expectedSize: 10 }))
    const handle = startModelTransfer(baseOpts())
    requests[0]!.emit('response', makeResponse(416))
    const outcome = await handle.done
    expect(outcome).toEqual({
      outcome: 'error',
      error: 'Download failed: server rejected resume (HTTP 416)'
    })
    expect(fs.existsSync(stagingPathFor(finalPath))).toBe(false)
  })

  it('treats a malformed 416 Content-Range as failure, not as absent', async () => {
    preStage('0123456789', stagedMeta({ expectedSize: 0 }))
    const handle = startModelTransfer(baseOpts())
    requests[0]!.emit('response', makeResponse(416, { 'content-range': 'bytes */banana' }))
    const outcome = await handle.done
    expect(outcome.outcome).toBe('error')
    expect(fs.existsSync(finalPath)).toBe(false)
  })

  it('does not finalize on HTTP 416 when the server reports a different total', async () => {
    preStage('0123456789', stagedMeta({ expectedSize: 0 }))
    const handle = startModelTransfer(baseOpts())
    requests[0]!.emit('response', makeResponse(416, { 'content-range': 'bytes */12' }))
    const outcome = await handle.done
    expect(outcome.outcome).toBe('error')
    expect(fs.existsSync(finalPath)).toBe(false)
    expect(fs.existsSync(stagingPathFor(finalPath))).toBe(false)
  })

  it('does not finalize on HTTP 416 when the caller expects a different total', async () => {
    preStage('0123456789', stagedMeta({ expectedSize: 0 }))
    const handle = startModelTransfer(baseOpts({ expectedSize: 12 }))
    requests[0]!.emit('response', makeResponse(416, { 'content-range': 'bytes */10' }))
    const outcome = await handle.done
    expect(outcome.outcome).toBe('error')
    expect(fs.existsSync(finalPath)).toBe(false)
  })

  it('rejects a 206 whose Content-Range total contradicts the staged expected size', async () => {
    preStage('AAAAA', stagedMeta({ expectedSize: 10 }))
    const handle = startModelTransfer(baseOpts())
    const req = requests[0]!
    const res = makeResponse(206, { 'content-length': '15', 'content-range': 'bytes 5-19/20' })
    req.emit('response', res)
    const outcome = await handle.done
    expect(outcome.outcome).toBe('error')
    expect(req.abort).toHaveBeenCalled()
    await flush()
    expect(fs.existsSync(stagingPathFor(finalPath))).toBe(false)
    expect(fs.existsSync(finalPath)).toBe(false)
  })

  it('rejects a malformed Content-Range instead of trusting the body', async () => {
    preStage('AAAAA', stagedMeta({ expectedSize: 10 }))
    const handle = startModelTransfer(baseOpts())
    const req = requests[0]!
    const res = makeResponse(206, { 'content-length': '5', 'content-range': 'bytes 5-' })
    req.emit('response', res)
    const outcome = await handle.done
    expect(outcome.outcome).toBe('error')
    expect(req.abort).toHaveBeenCalled()
  })

  it('rejects a 206 whose validator contradicts the staged one', async () => {
    preStage('AAAAA', stagedMeta({ expectedSize: 10, etag: '"v1"' }))
    const handle = startModelTransfer(baseOpts())
    const req = requests[0]!
    const res = makeResponse(206, {
      'content-length': '5',
      'content-range': 'bytes 5-9/10',
      etag: '"v2"'
    })
    req.emit('response', res)
    const outcome = await handle.done
    expect(outcome.outcome).toBe('error')
    expect(req.abort).toHaveBeenCalled()
    await flush()
    expect(fs.existsSync(stagingPathFor(finalPath))).toBe(false)
  })

  it('accepts a 206 whose validator matches the staged one', async () => {
    preStage('AAAAA', stagedMeta({ expectedSize: 10, etag: '"v1"' }))
    const handle = startModelTransfer(baseOpts())
    const req = requests[0]!
    const res = makeResponse(206, {
      'content-length': '5',
      'content-range': 'bytes 5-9/10',
      etag: '"v1"'
    })
    req.emit('response', res)
    res.emit('data', Buffer.from('BBBBB'))
    res.emit('end')
    const outcome = await handle.done
    expect(outcome).toEqual({ outcome: 'completed', savePath: finalPath, finalBytes: 10 })
    expect(fs.readFileSync(finalPath, 'utf-8')).toBe('AAAAABBBBB')
  })

  it('keeps the persisted expected size when a resumed response omits Content-Length', async () => {
    preStage('AAAAA', stagedMeta({ expectedSize: 10, etag: '"v1"' }))
    const handle = startModelTransfer(baseOpts())
    const req = requests[0]!
    const res = makeResponse(206, { 'content-range': 'bytes 5-9/10' })
    req.emit('response', res)
    res.emit('data', Buffer.from('BBB'))
    res.emit('end')
    const outcome = await handle.done
    expect(outcome).toEqual({
      outcome: 'error',
      error: 'Download incomplete: expected 10 bytes but got 8'
    })
    expect(fs.existsSync(finalPath)).toBe(false)
    expect(fs.readFileSync(stagingPathFor(finalPath), 'utf-8')).toBe('AAAAABBB')
    expect(readStagedMeta(stagingMetaPathFor(finalPath))?.expectedSize).toBe(10)
  })

  it('restarts clean instead of finalizing when the caller expects a different size', async () => {
    preStage('0123456789', stagedMeta({ expectedSize: 10 }))
    const handle = startModelTransfer(baseOpts({ expectedSize: 12 }))
    expect(requests).toHaveLength(1)
    const headers = headerCalls(requests[0]!)
    expect(headers['Range']).toBeUndefined()
    expect(fs.statSync(stagingPathFor(finalPath)).size).toBe(0)
    expect(fs.existsSync(finalPath)).toBe(false)
    handle.cancel()
    await handle.done
  })

  it('uses Last-Modified for If-Range when the staged ETag is weak', () => {
    preStage('AAAAA', stagedMeta({ etag: 'W/"v1"', lastModified: 'Wed, 01 Jan 2026' }))
    startModelTransfer(baseOpts())
    const headers = headerCalls(requests[0]!)
    expect(headers['Range']).toBe('bytes=5-')
    expect(headers['If-Range']).toBe('Wed, 01 Jan 2026')
  })

  it('restarts clean when the only staged validator is a weak ETag', async () => {
    preStage('AAAAA', stagedMeta({ etag: 'W/"v1"', lastModified: undefined }))
    const handle = startModelTransfer(baseOpts())
    const headers = headerCalls(requests[0]!)
    expect(headers['Range']).toBeUndefined()
    expect(headers['If-Range']).toBeUndefined()
    expect(fs.statSync(stagingPathFor(finalPath)).size).toBe(0)
    handle.cancel()
    await handle.done
  })
})

describe('sha-256 integrity', () => {
  const SHA_0123456789 = '84d89877f0d4041efb6bf91a16f0248f2fd573e6af05c19f96bedb9f882f7882'
  const SHA_AAAAABBBBB = '59158e9f11434e40f5af83230f07877ecf9acd90b9fbeb6002a5e836b6edecee'

  function preStage(bytes: string, meta: StagedDownloadMeta): void {
    fs.mkdirSync(path.dirname(finalPath), { recursive: true })
    fs.writeFileSync(stagingPathFor(finalPath), bytes)
    writeStagedMeta(stagingMetaPathFor(finalPath), meta)
  }

  it('persists the expected hash in the sidecar and finalizes when the bytes match', async () => {
    const handle = startModelTransfer(baseOpts({ sha256: SHA_0123456789 }))
    const req = requests[0]!
    const res = makeResponse(200, { 'content-length': '10' })
    req.emit('response', res)
    res.emit('data', Buffer.from('01234'))
    await flush()
    expect(readStagedMeta(stagingMetaPathFor(finalPath))?.sha256).toBe(SHA_0123456789)

    res.emit('data', Buffer.from('56789'))
    res.emit('end')
    const outcome = await handle.done
    expect(outcome).toEqual({ outcome: 'completed', savePath: finalPath, finalBytes: 10 })
    expect(fs.readFileSync(finalPath, 'utf-8')).toBe('0123456789')
  })

  it('discards staged bytes and reports checksum-mismatch when the download is corrupt', async () => {
    const handle = startModelTransfer(baseOpts({ sha256: SHA_AAAAABBBBB }))
    const req = requests[0]!
    const res = makeResponse(200, { 'content-length': '10' })
    req.emit('response', res)
    res.emit('data', Buffer.from('0123456789'))
    res.emit('end')
    const outcome = await handle.done
    expect(outcome.outcome).toBe('error')
    expect((outcome as { code?: string }).code).toBe('checksum-mismatch')
    expect(fs.existsSync(finalPath)).toBe(false)
    expect(fs.existsSync(stagingPathFor(finalPath))).toBe(false)
    expect(fs.existsSync(stagingMetaPathFor(finalPath))).toBe(false)
  })

  it('resumes staged bytes across a rotated presigned URL when the persisted hash matches', async () => {
    preStage(
      'AAAAA',
      stagedMeta({
        url: 'https://example.com/models/model.safetensors?sig=expired',
        sha256: SHA_AAAAABBBBB,
        expectedSize: 10,
        etag: '"v1"'
      })
    )
    const handle = startModelTransfer(baseOpts({ sha256: SHA_AAAAABBBBB }))
    const req = requests[0]!
    const headers = headerCalls(req)
    expect(headers['Range']).toBe('bytes=5-')
    expect(headers['If-Range']).toBe('"v1"')

    const res = makeResponse(206, { 'content-length': '5', 'content-range': 'bytes 5-9/10' })
    req.emit('response', res)
    res.emit('data', Buffer.from('BBBBB'))
    res.emit('end')
    const outcome = await handle.done
    expect(outcome).toEqual({ outcome: 'completed', savePath: finalPath, finalBytes: 10 })
    expect(fs.readFileSync(finalPath, 'utf-8')).toBe('AAAAABBBBB')
  })

  it('restarts clean when the staged pair was written for different expected content', async () => {
    preStage('AAAAA', stagedMeta({ sha256: SHA_0123456789, expectedSize: 10, etag: '"v1"' }))
    const handle = startModelTransfer(baseOpts({ sha256: SHA_AAAAABBBBB }))
    const headers = headerCalls(requests[0]!)
    expect(headers['Range']).toBeUndefined()
    expect(fs.statSync(stagingPathFor(finalPath)).size).toBe(0)
    expect(readStagedMeta(stagingMetaPathFor(finalPath))?.sha256).toBe(SHA_AAAAABBBBB)
    handle.cancel()
    await handle.done
  })

  it('verifies a complete staged file against the sidecar hash when the caller sends none', async () => {
    preStage('0123456789', stagedMeta({ sha256: SHA_AAAAABBBBB, expectedSize: 10 }))
    const handle = startModelTransfer(baseOpts())
    const outcome = await handle.done
    expect(requests).toHaveLength(0)
    expect(outcome.outcome).toBe('error')
    expect((outcome as { code?: string }).code).toBe('checksum-mismatch')
    expect(fs.existsSync(finalPath)).toBe(false)
    expect(fs.existsSync(stagingPathFor(finalPath))).toBe(false)
  })

  it('finalizes a complete staged file without network when the sidecar hash matches', async () => {
    preStage('0123456789', stagedMeta({ sha256: SHA_0123456789, expectedSize: 10 }))
    const handle = startModelTransfer(baseOpts())
    const outcome = await handle.done
    expect(requests).toHaveLength(0)
    expect(outcome).toEqual({ outcome: 'completed', savePath: finalPath, finalBytes: 10 })
    expect(fs.readFileSync(finalPath, 'utf-8')).toBe('0123456789')
  })
})

describe('redirects', () => {
  it('follows redirects while the sidecar keeps the ORIGINAL url as resume identity', async () => {
    const handle = startModelTransfer(baseOpts())
    const req = requests[0]!
    req.emit('redirect', 302, 'GET', 'https://cdn.example.net/blob/abc')
    expect(req.followRedirect).toHaveBeenCalledTimes(1)

    const res = makeResponse(200, { 'content-length': '10', etag: '"cdn"' })
    req.emit('response', res)
    res.emit('data', Buffer.from('01234'))
    await flush()
    expect(readStagedMeta(stagingMetaPathFor(finalPath))?.url).toBe(URL_MAIN)

    handle.pause()
    await handle.done

    const resumed = startModelTransfer(baseOpts())
    const req2 = requests[1]!
    expect(req2.__url).toBe(URL_MAIN)
    expect(headerCalls(req2)['Range']).toBe('bytes=5-')
    resumed.cancel()
    await resumed.done
  })

  it('fails after too many redirects', async () => {
    const handle = startModelTransfer(baseOpts())
    const req = requests[0]!
    for (let i = 0; i < 11; i++) {
      req.emit('redirect', 302, 'GET', `https://cdn.example.net/hop/${i}`)
    }
    const outcome = await handle.done
    expect(outcome).toEqual({ outcome: 'error', error: 'Download failed: too many redirects' })
    expect(req.abort).toHaveBeenCalled()
  })
})

describe('R2 mirror fallback', () => {
  const PRIMARY = `${R2_BASE_URL}/models/big.safetensors`
  const MIRROR = `${R2_MIRROR_BASE_URL}/models/big.safetensors`

  it('retries once against the mirror pre-bytes for opted-in users, keeping the original identity', async () => {
    settingsState['useChineseMirrors'] = true
    const handle = startModelTransfer(baseOpts({ url: PRIMARY }))
    requests[0]!.emit('error', new Error('ECONNRESET'))
    await flush()
    expect(requests[1]?.__url).toBe(MIRROR)

    const res = makeResponse(200, { 'content-length': '5' })
    requests[1]!.emit('response', res)
    res.emit('data', Buffer.from('ABC'))
    await flush()
    expect(readStagedMeta(stagingMetaPathFor(finalPath))?.url).toBe(PRIMARY)
    res.emit('data', Buffer.from('DE'))
    res.emit('end')
    const outcome = await handle.done
    expect(outcome).toEqual({ outcome: 'completed', savePath: finalPath, finalBytes: 5 })
  })

  it('does not try the mirror when the user has not opted in', async () => {
    const handle = startModelTransfer(baseOpts({ url: PRIMARY }))
    requests[0]!.emit('error', new Error('ECONNRESET'))
    const outcome = await handle.done
    expect(outcome).toEqual({ outcome: 'error', error: 'Download failed: ECONNRESET' })
    expect(requests).toHaveLength(1)
  })
})

describe('durable staging placeholder', () => {
  it('persists a hydratable pair before any network response arrives', async () => {
    const handle = startModelTransfer(baseOpts({ jobId: 'job-1', expectedSize: 10 }))
    expect(fs.statSync(stagingPathFor(finalPath)).size).toBe(0)
    expect(readStagedMeta(stagingMetaPathFor(finalPath))).toMatchObject({
      url: URL_MAIN,
      jobId: 'job-1',
      expectedSize: 10
    })
    handle.cancel()
    await handle.done
  })

  it('aborts a connect that never responds, keeping the hydratable pair', async () => {
    const handle = startModelTransfer(baseOpts({ idleTimeoutMs: 25 }))
    const outcome = await handle.done
    expect(outcome.outcome).toBe('error')
    expect((outcome as { error: string }).error).toMatch(/stalled/)
    expect(requests[0]!.abort).toHaveBeenCalled()
    expect(fs.existsSync(stagingPathFor(finalPath))).toBe(true)
    expect(fs.existsSync(stagingMetaPathFor(finalPath))).toBe(true)
  })
})

describe('staging durability failures', () => {
  function failWritesMatching(match: (file: string) => boolean): ReturnType<typeof vi.spyOn> {
    const realWriteFileSync = fs.writeFileSync.bind(fs)
    return vi.spyOn(fs, 'writeFileSync').mockImplementation(((
      file: Parameters<typeof fs.writeFileSync>[0],
      data: Parameters<typeof fs.writeFileSync>[1],
      options?: Parameters<typeof fs.writeFileSync>[2]
    ) => {
      if (typeof file === 'string' && match(file)) throw new Error('disk full')
      return realWriteFileSync(file, data, options)
    }) as typeof fs.writeFileSync)
  }

  it('fails before any network activity when the staging file cannot be created', async () => {
    const spy = failWritesMatching((file) => file === stagingPathFor(finalPath))
    const handle = startModelTransfer(baseOpts())
    const outcome = await handle.done
    spy.mockRestore()
    expect(outcome.outcome).toBe('error')
    expect((outcome as { error: string }).error).toMatch(/cannot create staging file/)
    expect(requests.length).toBe(0)
    expect(fs.existsSync(finalPath)).toBe(false)
  })

  it('fails before any network activity when the initial sidecar cannot be written', async () => {
    const spy = failWritesMatching((file) => file.endsWith('.dl-meta.tmp'))
    const handle = startModelTransfer(baseOpts())
    const outcome = await handle.done
    spy.mockRestore()
    expect(outcome).toEqual({
      outcome: 'error',
      error: 'Download failed: cannot write staging metadata'
    })
    expect(requests.length).toBe(0)
    expect(fs.existsSync(stagingPathFor(finalPath))).toBe(true)
  })

  it('refuses body bytes when the response-phase sidecar rewrite fails', async () => {
    const handle = startModelTransfer(baseOpts())
    const req = requests[0]!
    const spy = failWritesMatching((file) => file.endsWith('.dl-meta.tmp'))
    const res = makeResponse(200, { 'content-length': '10' })
    req.emit('response', res)
    const outcome = await handle.done
    spy.mockRestore()
    expect(outcome).toEqual({
      outcome: 'error',
      error: 'Download failed: cannot write staging metadata'
    })
    expect(req.abort).toHaveBeenCalled()
    res.emit('data', Buffer.from('0123456789'))
    res.emit('end')
    await flush()
    expect(fs.statSync(stagingPathFor(finalPath)).size).toBe(0)
    expect(fs.existsSync(stagingMetaPathFor(finalPath))).toBe(true)
    expect(fs.existsSync(finalPath)).toBe(false)
  })
})

describe('orphan staged bytes (no sidecar)', () => {
  it('parks orphan .part bytes aside instead of truncating them', async () => {
    fs.mkdirSync(path.dirname(finalPath), { recursive: true })
    fs.writeFileSync(stagingPathFor(finalPath), 'foreign bytes')
    const handle = startModelTransfer(baseOpts())
    const req = requests[0]!
    expect(headerCalls(req)['Range']).toBeUndefined()
    const res = makeResponse(200, { 'content-length': '10' })
    req.emit('response', res)
    res.emit('data', Buffer.from('0123456789'))
    res.emit('end')
    const outcome = await handle.done
    expect(outcome).toEqual({ outcome: 'completed', savePath: finalPath, finalBytes: 10 })
    expect(fs.readFileSync(finalPath, 'utf-8')).toBe('0123456789')
    expect(fs.readFileSync(stagingPathFor(finalPath) + '.orphan', 'utf-8')).toBe('foreign bytes')
  })

  it('starts no request when the orphan bytes cannot be moved aside', async () => {
    fs.mkdirSync(path.dirname(finalPath), { recursive: true })
    const orphanPath = stagingPathFor(finalPath)
    fs.writeFileSync(orphanPath, 'foreign bytes')
    const realLinkSync = fs.linkSync.bind(fs)
    const linkSpy = vi.spyOn(fs, 'linkSync').mockImplementation(((
      from: Parameters<typeof fs.linkSync>[0],
      to: Parameters<typeof fs.linkSync>[1]
    ) => {
      if (from === orphanPath) throw Object.assign(new Error('locked'), { code: 'EPERM' })
      return realLinkSync(from, to)
    }) as typeof fs.linkSync)
    const realRenameSync = fs.renameSync.bind(fs)
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation(((
      from: Parameters<typeof fs.renameSync>[0],
      to: Parameters<typeof fs.renameSync>[1]
    ) => {
      if (from === orphanPath) throw new Error('locked')
      return realRenameSync(from, to)
    }) as typeof fs.renameSync)
    const handle = startModelTransfer(baseOpts())
    const outcome = await handle.done
    linkSpy.mockRestore()
    renameSpy.mockRestore()
    expect(outcome.outcome).toBe('error')
    expect((outcome as { error: string }).error).toMatch(/unidentified staged bytes/)
    expect(requests.length).toBe(0)
    expect(fs.readFileSync(orphanPath, 'utf-8')).toBe('foreign bytes')
    expect(fs.existsSync(finalPath)).toBe(false)
  })
})

describe('setup failures settle the transfer', () => {
  it('settles with a retained error when net.request itself throws', async () => {
    const { net } = await import('electron')
    vi.mocked(net.request).mockImplementationOnce(() => {
      throw new Error('bad url')
    })
    const handle = startModelTransfer(baseOpts())
    const outcome = await handle.done
    expect(outcome).toEqual({ outcome: 'error', error: 'Download failed: bad url' })
    expect(fs.existsSync(stagingMetaPathFor(finalPath))).toBe(true)
  })

  it('settles with a retained error when setHeader throws', async () => {
    const { net } = await import('electron')
    const original = vi.mocked(net.request).getMockImplementation()!
    vi.mocked(net.request).mockImplementationOnce((options) => {
      const req = original(options)
      ;(req as unknown as { setHeader: unknown }).setHeader = vi.fn(() => {
        throw new Error('invalid header value')
      })
      return req
    })
    const handle = startModelTransfer(baseOpts())
    const outcome = await handle.done
    expect(outcome).toEqual({ outcome: 'error', error: 'Download failed: invalid header value' })
  })

  it('settles with a retained error when request.end throws', async () => {
    const { net } = await import('electron')
    const original = vi.mocked(net.request).getMockImplementation()!
    vi.mocked(net.request).mockImplementationOnce((options) => {
      const req = original(options)
      ;(req as unknown as { end: unknown }).end = vi.fn(() => {
        throw new Error('socket gone')
      })
      return req
    })
    const handle = startModelTransfer(baseOpts())
    const outcome = await handle.done
    expect(outcome).toEqual({ outcome: 'error', error: 'Download failed: socket gone' })
  })
})

describe('terminal race safety', () => {
  it('pause after the body ended is a no-op that cannot corrupt the finalize', async () => {
    const handle = startModelTransfer(baseOpts())
    const req = requests[0]!
    const res = makeResponse(200, { 'content-length': '4' })
    req.emit('response', res)
    res.emit('data', Buffer.from('abcd'))
    res.emit('end')
    expect(handle.pause()).toBe(false)
    expect(handle.cancel()).toBe(false)
    const outcome = await handle.done
    expect(outcome).toEqual({ outcome: 'completed', savePath: finalPath, finalBytes: 4 })
    expect(fs.readFileSync(finalPath, 'utf-8')).toBe('abcd')
  })

  it('late response events after cancel cannot resurrect staged files', async () => {
    const handle = startModelTransfer(baseOpts())
    const req = requests[0]!
    const res = makeResponse(200, { 'content-length': '10' })
    req.emit('response', res)
    res.emit('data', Buffer.from('01234'))
    expect(handle.cancel()).toBe(true)
    const outcome = await handle.done
    expect(outcome).toEqual({ outcome: 'cancelled' })
    res.emit('data', Buffer.from('56789'))
    res.emit('end')
    res.emit('error', new Error('aborted'))
    await flush()
    expect(fs.existsSync(stagingPathFor(finalPath))).toBe(false)
    expect(fs.existsSync(stagingMetaPathFor(finalPath))).toBe(false)
    expect(fs.existsSync(finalPath)).toBe(false)
  })
})

describe('final destination conflicts', () => {
  it('does not clobber a different file that appeared at the final path', async () => {
    const handle = startModelTransfer(baseOpts())
    const req = requests[0]!
    const res = makeResponse(200, { 'content-length': '10' })
    req.emit('response', res)
    res.emit('data', Buffer.from('01234'))
    fs.writeFileSync(finalPath, 'XXX')
    res.emit('data', Buffer.from('56789'))
    res.emit('end')
    const outcome = await handle.done
    expect(outcome.outcome).toBe('error')
    expect((outcome as { error: string }).error).toMatch(/already exists/)
    expect(fs.readFileSync(finalPath, 'utf-8')).toBe('XXX')
    expect(fs.readFileSync(stagingPathFor(finalPath), 'utf-8')).toBe('0123456789')
  })

  it('accepts an existing final file with identical bytes as completed (idempotent)', async () => {
    const handle = startModelTransfer(baseOpts())
    const req = requests[0]!
    const res = makeResponse(200, { 'content-length': '10' })
    req.emit('response', res)
    res.emit('data', Buffer.from('01234'))
    fs.writeFileSync(finalPath, '0123456789')
    res.emit('data', Buffer.from('56789'))
    res.emit('end')
    const outcome = await handle.done
    expect(outcome).toEqual({ outcome: 'completed', savePath: finalPath, finalBytes: 10 })
    expect(fs.readFileSync(finalPath, 'utf-8')).toBe('0123456789')
    expect(fs.existsSync(stagingPathFor(finalPath))).toBe(false)
    expect(fs.existsSync(stagingMetaPathFor(finalPath))).toBe(false)
  })

  it('rejects a same-size final file whose bytes differ (size is not integrity proof)', async () => {
    const handle = startModelTransfer(baseOpts())
    const req = requests[0]!
    const res = makeResponse(200, { 'content-length': '10' })
    req.emit('response', res)
    res.emit('data', Buffer.from('01234'))
    fs.writeFileSync(finalPath, 'ZZZZZZZZZZ')
    res.emit('data', Buffer.from('56789'))
    res.emit('end')
    const outcome = await handle.done
    expect(outcome.outcome).toBe('error')
    expect((outcome as { error: string }).error).toMatch(/already exists/)
    expect(fs.readFileSync(finalPath, 'utf-8')).toBe('ZZZZZZZZZZ')
    expect(fs.readFileSync(stagingPathFor(finalPath), 'utf-8')).toBe('0123456789')
  })

  it('fails closed when hard links are unsupported', async () => {
    const linkSpy = vi.spyOn(fs, 'linkSync').mockImplementation(() => {
      const err = new Error('EPERM: operation not permitted') as NodeJS.ErrnoException
      err.code = 'EPERM'
      throw err
    })
    const openSpy = vi.spyOn(fs, 'openSync')
    const renameSpy = vi.spyOn(fs, 'renameSync')
    try {
      const handle = startModelTransfer(baseOpts())
      const req = requests[0]!
      const res = makeResponse(200, { 'content-length': '10' })
      req.emit('response', res)
      res.emit('data', Buffer.from('0123456789'))
      res.emit('end')
      const outcome = await handle.done
      expect(outcome.outcome).toBe('error')
      expect((outcome as { error: string }).error).toMatch(/atomic no-replace/)
      expect(fs.existsSync(finalPath)).toBe(false)
      expect(fs.readFileSync(stagingPathFor(finalPath), 'utf-8')).toBe('0123456789')
      expect(fs.existsSync(stagingMetaPathFor(finalPath))).toBe(true)
      expect(openSpy).not.toHaveBeenCalledWith(finalPath, 'wx')
      expect(renameSpy).not.toHaveBeenCalledWith(stagingPathFor(finalPath), finalPath)
    } finally {
      renameSpy.mockRestore()
      openSpy.mockRestore()
      linkSpy.mockRestore()
    }
  })

  it('fails closed on a real link error instead of degrading to claim+rename', async () => {
    const linkSpy = vi.spyOn(fs, 'linkSync').mockImplementation(() => {
      const err = new Error('EIO: i/o error') as NodeJS.ErrnoException
      err.code = 'EIO'
      throw err
    })
    try {
      const handle = startModelTransfer(baseOpts())
      const req = requests[0]!
      const res = makeResponse(200, { 'content-length': '10' })
      req.emit('response', res)
      res.emit('data', Buffer.from('0123456789'))
      res.emit('end')
      const outcome = await handle.done
      expect(outcome.outcome).toBe('error')
      expect((outcome as { error: string }).error).toMatch(/EIO/)
      expect(fs.existsSync(finalPath)).toBe(false)
      expect(fs.readFileSync(stagingPathFor(finalPath), 'utf-8')).toBe('0123456789')
      expect(fs.existsSync(stagingMetaPathFor(finalPath))).toBe(true)
    } finally {
      linkSpy.mockRestore()
    }
  })

  it('a link-less filesystem still refuses to clobber a file at the final name', async () => {
    const linkSpy = vi.spyOn(fs, 'linkSync').mockImplementation(() => {
      const err = new Error('EPERM: operation not permitted') as NodeJS.ErrnoException
      err.code = 'EPERM'
      throw err
    })
    try {
      const handle = startModelTransfer(baseOpts())
      const req = requests[0]!
      const res = makeResponse(200, { 'content-length': '10' })
      req.emit('response', res)
      res.emit('data', Buffer.from('01234'))
      fs.writeFileSync(finalPath, 'XXX')
      res.emit('data', Buffer.from('56789'))
      res.emit('end')
      const outcome = await handle.done
      expect(outcome.outcome).toBe('error')
      expect((outcome as { error: string }).error).toMatch(/already exists/)
      expect(fs.readFileSync(finalPath, 'utf-8')).toBe('XXX')
      expect(fs.readFileSync(stagingPathFor(finalPath), 'utf-8')).toBe('0123456789')
    } finally {
      linkSpy.mockRestore()
    }
  })

  it('a link-less filesystem never creates a final-name claim marker', async () => {
    const linkSpy = vi.spyOn(fs, 'linkSync').mockImplementation(() => {
      const err = new Error('EPERM: operation not permitted') as NodeJS.ErrnoException
      err.code = 'EPERM'
      throw err
    })
    const openSpy = vi.spyOn(fs, 'openSync')
    try {
      const handle = startModelTransfer(baseOpts())
      const req = requests[0]!
      const res = makeResponse(200, { 'content-length': '10' })
      req.emit('response', res)
      res.emit('data', Buffer.from('0123456789'))
      res.emit('end')
      const outcome = await handle.done
      expect(outcome.outcome).toBe('error')
      expect(fs.existsSync(finalPath)).toBe(false)
      expect(fs.readFileSync(stagingPathFor(finalPath), 'utf-8')).toBe('0123456789')
      expect(openSpy).not.toHaveBeenCalledWith(finalPath, 'wx')
    } finally {
      openSpy.mockRestore()
      linkSpy.mockRestore()
    }
  })
})

describe('segment planning', () => {
  it('splits a large file into equal ranges with the remainder on the last one', () => {
    const tuning: SegmentTuning = {
      ...DEFAULT_SEGMENT_TUNING,
      minBytes: 8,
      minSegmentBytes: 3,
      maxSegments: 3
    }
    expect(planSegments(10, tuning)).toEqual([
      { start: 0, end: 2, done: 0 },
      { start: 3, end: 5, done: 0 },
      { start: 6, end: 9, done: 0 }
    ])
  })

  it('keeps small files and files without room for two segments on one stream', () => {
    expect(planSegments(63 * 1024 * 1024, DEFAULT_SEGMENT_TUNING)).toBeNull()
    expect(
      planSegments(10, { ...DEFAULT_SEGMENT_TUNING, minBytes: 8, minSegmentBytes: 6 })
    ).toBeNull()
  })

  it('caps a 20 GB model at eight segments', () => {
    const segments = planSegments(20_533_762_817, DEFAULT_SEGMENT_TUNING)!
    expect(segments).toHaveLength(8)
    expect(segments[0]!.start).toBe(0)
    expect(segments[7]!.end).toBe(20_533_762_816)
  })
})

describe('segmented download', () => {
  const tuning: Partial<SegmentTuning> = {
    minBytes: 8,
    maxSegments: 2,
    minSegmentBytes: 4,
    persistEveryBytes: 1_000_000,
    maxAttempts: 3
  }

  const CDN_URL = 'https://cdn.example.com/signed?expires=1'
  const callerSession = { __fake: 'caller' } as unknown as Electron.Session

  const probeHeaders = {
    'content-length': '10',
    'accept-ranges': 'bytes',
    etag: '"v1"'
  }

  function rangeResponse(from: number, to: number): FakeResponse {
    return makeResponse(206, {
      'content-range': `bytes ${from}-${to}/10`,
      'content-length': String(to - from + 1),
      etag: '"v1"'
    })
  }

  function startSegmented(overrides: Partial<ModelTransferOptions> = {}) {
    const handle = startModelTransfer(baseOpts({ segmentTuning: tuning, ...overrides }))
    const probe = requests[0]!
    probe.emit('response', makeResponse(200, probeHeaders))
    return { handle, probe }
  }

  function preStageSegments(bytes: Buffer, segments: StagedDownloadMeta['segments']): void {
    fs.mkdirSync(path.dirname(finalPath), { recursive: true })
    fs.writeFileSync(stagingPathFor(finalPath), bytes)
    writeStagedMeta(
      stagingMetaPathFor(finalPath),
      stagedMeta({ version: 3, expectedSize: 10, etag: '"v1"', segments })
    )
  }

  it('drops the probe, fetches each range from the original URL and assembles them in order', async () => {
    const progress: number[] = []
    const { handle, probe } = startSegmented({ onProgress: (p) => progress.push(p.receivedBytes) })

    expect(probe.abort).toHaveBeenCalled()
    expect(requests).toHaveLength(3)
    const [, first, second] = requests
    expect(first!.__url).toBe(URL_MAIN)
    expect(second!.__url).toBe(URL_MAIN)
    expect(headerCalls(first!)).toMatchObject({ Range: 'bytes=0-4', 'If-Range': '"v1"' })
    expect(headerCalls(second!)).toMatchObject({ Range: 'bytes=5-9', 'If-Range': '"v1"' })
    expect(fs.statSync(stagingPathFor(finalPath)).size).toBe(10)
    expect(readStagedMeta(stagingMetaPathFor(finalPath))?.segments).toEqual([
      { start: 0, end: 4, done: 0 },
      { start: 5, end: 9, done: 0 }
    ])

    const tail = rangeResponse(5, 9)
    second!.emit('response', tail)
    tail.emit('data', Buffer.from('56789'))
    tail.emit('end')
    const head = rangeResponse(0, 4)
    first!.emit('response', head)
    head.emit('data', Buffer.from('012'))
    head.emit('data', Buffer.from('34'))
    head.emit('end')

    const outcome = await handle.done
    expect(outcome).toEqual({ outcome: 'completed', savePath: finalPath, finalBytes: 10 })
    expect(fs.readFileSync(finalPath, 'utf-8')).toBe('0123456789')
    expect(fs.existsSync(stagingPathFor(finalPath))).toBe(false)
    expect(fs.existsSync(stagingMetaPathFor(finalPath))).toBe(false)
    expect(progress).toEqual([5, 8, 10])
  })

  it('resumes a partly done segmented download by asking only for the missing bytes', async () => {
    const staged = Buffer.alloc(10)
    staged.write('0123456', 0)
    preStageSegments(staged, [
      { start: 0, end: 4, done: 5 },
      { start: 5, end: 9, done: 2 }
    ])

    const progress: number[] = []
    const handle = startModelTransfer(
      baseOpts({ segmentTuning: tuning, onProgress: (p) => progress.push(p.receivedBytes) })
    )
    expect(requests).toHaveLength(1)
    const req = requests[0]!
    expect(headerCalls(req)).toMatchObject({ Range: 'bytes=7-9', 'If-Range': '"v1"' })

    const res = rangeResponse(7, 9)
    req.emit('response', res)
    res.emit('data', Buffer.from('789'))
    res.emit('end')

    const outcome = await handle.done
    expect(outcome).toEqual({ outcome: 'completed', savePath: finalPath, finalBytes: 10 })
    expect(fs.readFileSync(finalPath, 'utf-8')).toBe('0123456789')
    expect(progress).toEqual([10])
  })

  it('stays on one stream when the server does not advertise byte ranges', async () => {
    const handle = startModelTransfer(baseOpts({ segmentTuning: tuning }))
    const req = requests[0]!
    const res = makeResponse(200, { 'content-length': '10', etag: '"v1"' })
    req.emit('response', res)
    res.emit('data', Buffer.from('0123456789'))
    res.emit('end')

    const outcome = await handle.done
    expect(outcome.outcome).toBe('completed')
    expect(requests).toHaveLength(1)
    expect(req.abort).not.toHaveBeenCalled()
    expect(fs.readFileSync(finalPath, 'utf-8')).toBe('0123456789')
  })

  it('stays on one stream for a file under the size threshold', async () => {
    const handle = startModelTransfer(baseOpts({ segmentTuning: tuning }))
    const req = requests[0]!
    const res = makeResponse(200, { 'content-length': '6', 'accept-ranges': 'bytes', etag: '"v1"' })
    req.emit('response', res)
    res.emit('data', Buffer.from('012345'))
    res.emit('end')

    const outcome = await handle.done
    expect(outcome.outcome).toBe('completed')
    expect(requests).toHaveLength(1)
  })

  it('falls back to one plain stream from byte zero when a range gets a 200', async () => {
    const { handle } = startSegmented()
    const [, first, second] = requests
    first!.emit('response', makeResponse(200, probeHeaders))

    await vi.waitFor(() => expect(requests).toHaveLength(4))
    expect(second!.abort).toHaveBeenCalled()
    const plain = requests[3]!
    expect(plain.__url).toBe(URL_MAIN)
    expect(headerCalls(plain)['Range']).toBeUndefined()
    expect(readStagedMeta(stagingMetaPathFor(finalPath))?.segments).toBeUndefined()

    const res = makeResponse(200, probeHeaders)
    plain.emit('response', res)
    expect(requests).toHaveLength(4)
    res.emit('data', Buffer.from('0123456789'))
    res.emit('end')

    const outcome = await handle.done
    expect(outcome).toEqual({ outcome: 'completed', savePath: finalPath, finalBytes: 10 })
    expect(fs.readFileSync(finalPath, 'utf-8')).toBe('0123456789')
  })

  it('pause keeps every written segment byte and the next request continues from them', async () => {
    const { handle } = startSegmented()
    const [, first, second] = requests
    const head = rangeResponse(0, 4)
    first!.emit('response', head)
    head.emit('data', Buffer.from('012'))
    const tail = rangeResponse(5, 9)
    second!.emit('response', tail)
    tail.emit('data', Buffer.from('56789'))

    expect(handle.pause()).toBe(true)
    expect(await handle.done).toEqual({ outcome: 'paused' })
    expect(first!.abort).toHaveBeenCalled()
    expect(fs.statSync(stagingPathFor(finalPath)).size).toBe(10)
    const meta = readStagedMeta(stagingMetaPathFor(finalPath))
    expect(meta?.version).toBe(3)
    expect(meta?.segments).toEqual([
      { start: 0, end: 4, done: 3 },
      { start: 5, end: 9, done: 5 }
    ])

    const before = requests.length
    const again = startModelTransfer(baseOpts({ segmentTuning: tuning }))
    expect(requests).toHaveLength(before + 1)
    const rest = requests[before]!
    expect(headerCalls(rest)).toMatchObject({ Range: 'bytes=3-4', 'If-Range': '"v1"' })
    const res = rangeResponse(3, 4)
    rest.emit('response', res)
    res.emit('data', Buffer.from('34'))
    res.emit('end')

    const outcome = await again.done
    expect(outcome).toEqual({ outcome: 'completed', savePath: finalPath, finalBytes: 10 })
    expect(fs.readFileSync(finalPath, 'utf-8')).toBe('0123456789')
  })

  it('cancel deletes the staged segments', async () => {
    const { handle } = startSegmented()
    const head = rangeResponse(0, 4)
    requests[1]!.emit('response', head)
    head.emit('data', Buffer.from('012'))

    expect(handle.cancel()).toBe(true)
    expect(await handle.done).toEqual({ outcome: 'cancelled' })
    expect(fs.existsSync(stagingPathFor(finalPath))).toBe(false)
    expect(fs.existsSync(stagingMetaPathFor(finalPath))).toBe(false)
  })

  it('retries a failed range from the original URL so an expired signed redirect is resolved again', async () => {
    const { handle } = startSegmented()
    const [, first, second] = requests
    first!.emit('redirect', 302, 'GET', CDN_URL)
    expect(requests).toHaveLength(4)
    requests[3]!.emit('error', new Error('net::ERR_CONNECTION_RESET'))

    expect(requests).toHaveLength(5)
    const retried = requests[4]!
    expect(retried.__url).toBe(URL_MAIN)
    expect(retried.__options['session']).toBeUndefined()
    expect(headerCalls(retried)).toMatchObject({ Range: 'bytes=0-4', 'If-Range': '"v1"' })

    const head = rangeResponse(0, 4)
    retried.emit('response', head)
    head.emit('data', Buffer.from('01234'))
    const tail = rangeResponse(5, 9)
    second!.emit('response', tail)
    tail.emit('data', Buffer.from('56789'))

    const outcome = await handle.done
    expect(outcome.outcome).toBe('completed')
    expect(fs.readFileSync(finalPath, 'utf-8')).toBe('0123456789')
  })

  it('fetches a part that redirects to another host on its own session without cookies', async () => {
    const { handle } = startSegmented({ session: callerSession })
    const [, first, second] = requests
    expect(first!.__options['session']).toBe(callerSession)
    expect(first!.__options['useSessionCookies']).toBe(true)

    first!.emit('redirect', 302, 'GET', CDN_URL)
    second!.emit('redirect', 302, 'GET', CDN_URL)

    expect(first!.abort).toHaveBeenCalled()
    expect(first!.followRedirect).not.toHaveBeenCalled()
    expect(requests).toHaveLength(5)
    const [, , , headPart, tailPart] = requests
    expect(headPart!.__url).toBe(CDN_URL)
    expect(headPart!.__options['session']).toEqual({ __partition: 'comfy-download-part-0' })
    expect(headPart!.__options['useSessionCookies']).toBeUndefined()
    expect(headPart!.__options['redirect']).toBe('manual')
    expect(headerCalls(headPart!)).toMatchObject({ Range: 'bytes=0-4', 'If-Range': '"v1"' })
    expect(tailPart!.__options['session']).toEqual({ __partition: 'comfy-download-part-1' })
    expect(headerCalls(tailPart!)).toMatchObject({ Range: 'bytes=5-9', 'If-Range': '"v1"' })

    const head = rangeResponse(0, 4)
    headPart!.emit('response', head)
    head.emit('data', Buffer.from('01234'))
    const tail = rangeResponse(5, 9)
    tailPart!.emit('response', tail)
    tail.emit('data', Buffer.from('56789'))

    const outcome = await handle.done
    expect(outcome).toEqual({ outcome: 'completed', savePath: finalPath, finalBytes: 10 })
    expect(fs.readFileSync(finalPath, 'utf-8')).toBe('0123456789')
  })

  it("keeps a part on the caller's session when it is answered by the original host", async () => {
    const { handle } = startSegmented({ session: callerSession })
    const [, first, second] = requests

    first!.emit('redirect', 307, 'GET', 'https://example.com/api/resolve-cache/model.safetensors')
    expect(first!.followRedirect).toHaveBeenCalled()
    expect(requests).toHaveLength(3)

    const head = rangeResponse(0, 4)
    first!.emit('response', head)
    head.emit('data', Buffer.from('01234'))
    const tail = rangeResponse(5, 9)
    second!.emit('response', tail)
    tail.emit('data', Buffer.from('56789'))

    const outcome = await handle.done
    expect(outcome.outcome).toBe('completed')
    expect(requests).toHaveLength(3)
    for (const part of [first!, second!]) {
      expect(part.__options['session']).toBe(callerSession)
      expect(part.__options['useSessionCookies']).toBe(true)
    }
    expect(fs.readFileSync(finalPath, 'utf-8')).toBe('0123456789')
  })

  it.each([401, 403])(
    "falls back once to the caller's session when a part session gets HTTP %i",
    async (status) => {
      const { handle } = startSegmented({ session: callerSession })
      const [, first, second] = requests
      first!.emit('redirect', 302, 'GET', CDN_URL)
      const partRequest = requests[3]!
      partRequest.emit('response', makeResponse(status, {}))

      expect(partRequest.abort).toHaveBeenCalled()
      expect(requests).toHaveLength(5)
      const fallback = requests[4]!
      expect(fallback.__url).toBe(URL_MAIN)
      expect(fallback.__options['session']).toBe(callerSession)
      expect(fallback.__options['useSessionCookies']).toBe(true)
      expect(headerCalls(fallback)).toMatchObject({ Range: 'bytes=0-4', 'If-Range': '"v1"' })

      fallback.emit('redirect', 302, 'GET', CDN_URL)
      expect(fallback.followRedirect).toHaveBeenCalled()
      expect(requests).toHaveLength(5)

      const head = rangeResponse(0, 4)
      fallback.emit('response', head)
      head.emit('data', Buffer.from('01234'))
      second!.emit('redirect', 302, 'GET', CDN_URL)
      expect(second!.followRedirect).toHaveBeenCalled()
      expect(requests).toHaveLength(5)
      const tail = rangeResponse(5, 9)
      second!.emit('response', tail)
      tail.emit('data', Buffer.from('56789'))

      const outcome = await handle.done
      expect(outcome.outcome).toBe('completed')
      expect(fs.readFileSync(finalPath, 'utf-8')).toBe('0123456789')
    }
  )

  it('keeps staged segments after a range fails on every attempt', async () => {
    const { handle } = startSegmented()
    const tail = rangeResponse(5, 9)
    requests[2]!.emit('response', tail)
    tail.emit('data', Buffer.from('56789'))
    requests[1]!.emit('error', new Error('net::ERR_CONNECTION_RESET'))
    requests[3]!.emit('error', new Error('net::ERR_CONNECTION_RESET'))
    requests[4]!.emit('error', new Error('net::ERR_CONNECTION_RESET'))

    const outcome = await handle.done
    expect(outcome).toEqual({
      outcome: 'error',
      error: 'Download failed: net::ERR_CONNECTION_RESET'
    })
    expect(readStagedMeta(stagingMetaPathFor(finalPath))?.segments).toEqual([
      { start: 0, end: 4, done: 0 },
      { start: 5, end: 9, done: 5 }
    ])
  })

  it('discards staged segments when the server says the content changed', async () => {
    const { handle } = startSegmented()
    const res = makeResponse(206, {
      'content-range': 'bytes 0-4/10',
      'content-length': '5',
      etag: '"v2"'
    })
    requests[1]!.emit('response', res)

    const outcome = await handle.done
    expect(outcome).toEqual({
      outcome: 'error',
      error: 'Download failed: content changed on the server during resume'
    })
    expect(fs.existsSync(stagingPathFor(finalPath))).toBe(false)
  })

  it('waits for a running range to finish before asking again for a range answered 429', async () => {
    const { handle } = startSegmented()
    const [, first, second] = requests
    first!.emit('response', makeResponse(429, { 'retry-after': '0' }))

    expect(first!.abort).toHaveBeenCalled()
    expect(requests).toHaveLength(3)

    const tail = rangeResponse(5, 9)
    second!.emit('response', tail)
    tail.emit('data', Buffer.from('56789'))

    expect(requests).toHaveLength(4)
    const again = requests[3]!
    expect(headerCalls(again)).toMatchObject({ Range: 'bytes=0-4', 'If-Range': '"v1"' })
    const head = rangeResponse(0, 4)
    again.emit('response', head)
    head.emit('data', Buffer.from('01234'))

    const outcome = await handle.done
    expect(outcome).toEqual({ outcome: 'completed', savePath: finalPath, finalBytes: 10 })
    expect(fs.readFileSync(finalPath, 'utf-8')).toBe('0123456789')
  })

  it('retries a range answered 503 after Retry-After when it runs alone, and keeps the bytes after the last attempt', async () => {
    const { handle } = startSegmented()
    const [, first, second] = requests
    const tail = rangeResponse(5, 9)
    second!.emit('response', tail)
    tail.emit('data', Buffer.from('56789'))

    first!.emit('response', makeResponse(503, { 'retry-after': '0' }))
    await vi.waitFor(() => expect(requests).toHaveLength(4))
    requests[3]!.emit('response', makeResponse(503, { 'retry-after': '0' }))
    await vi.waitFor(() => expect(requests).toHaveLength(5))
    requests[4]!.emit('response', makeResponse(503, { 'retry-after': '0' }))

    const outcome = await handle.done
    expect(outcome).toEqual({ outcome: 'error', error: 'Download failed: HTTP 503' })
    expect(requests).toHaveLength(5)
    expect(readStagedMeta(stagingMetaPathFor(finalPath))?.segments).toEqual([
      { start: 0, end: 4, done: 0 },
      { start: 5, end: 9, done: 5 }
    ])
  })

  it.each([
    [
      'a Content-Range for other bytes',
      makeResponse(206, { 'content-range': 'bytes 1-4/10', 'content-length': '4', etag: '"v1"' })
    ],
    ['HTTP 416', makeResponse(416, { 'content-range': 'bytes */10' })]
  ])(
    'falls back to one plain stream from byte zero when a range gets %s',
    async (_label, answer) => {
      const { handle } = startSegmented()
      requests[1]!.emit('response', answer)

      await vi.waitFor(() => expect(requests).toHaveLength(4))
      expect(requests[2]!.abort).toHaveBeenCalled()
      const plain = requests[3]!
      expect(headerCalls(plain)['Range']).toBeUndefined()

      const res = makeResponse(200, probeHeaders)
      plain.emit('response', res)
      res.emit('data', Buffer.from('0123456789'))
      res.emit('end')

      const outcome = await handle.done
      expect(outcome).toEqual({ outcome: 'completed', savePath: finalPath, finalBytes: 10 })
      expect(fs.readFileSync(finalPath, 'utf-8')).toBe('0123456789')
    }
  )

  it('does not count a range as stalled while it waits for a connection and another range is receiving', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const { handle } = startSegmented({ idleTimeoutMs: 20 })
      const [, first, second] = requests
      const tail = rangeResponse(5, 9)
      second!.emit('response', tail)
      tail.emit('data', Buffer.from('56'))
      vi.advanceTimersByTime(15)
      tail.emit('data', Buffer.from('7'))
      vi.advanceTimersByTime(15)
      tail.emit('data', Buffer.from('8'))
      vi.advanceTimersByTime(15)

      expect(first!.abort).not.toHaveBeenCalled()
      expect(requests).toHaveLength(3)

      tail.emit('data', Buffer.from('9'))
      const head = rangeResponse(0, 4)
      first!.emit('response', head)
      head.emit('data', Buffer.from('01234'))

      const outcome = await handle.done
      expect(outcome).toEqual({ outcome: 'completed', savePath: finalPath, finalBytes: 10 })
      expect(fs.readFileSync(finalPath, 'utf-8')).toBe('0123456789')
    } finally {
      vi.useRealTimers()
    }
  })

  it('counts a range waiting for a connection as stalled when no other range is receiving', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { handle } = startSegmented({ idleTimeoutMs: 20 })
    try {
      const first = requests[1]!
      vi.advanceTimersByTime(25)

      expect(first.abort).toHaveBeenCalled()
      expect(requests.length).toBeGreaterThan(3)
      expect(headerCalls(requests[requests.length - 1]!)['Range']).toMatch(/^bytes=/)
    } finally {
      handle.cancel()
      await handle.done
      vi.useRealTimers()
    }
  })

  it('waits out Retry-After before asking again for a range parked behind a running one', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const { handle } = startSegmented()
    try {
      const [, first, second] = requests
      first!.emit('response', makeResponse(429, { 'retry-after': '20' }))
      const tail = rangeResponse(5, 9)
      second!.emit('response', tail)
      tail.emit('data', Buffer.from('56789'))

      expect(requests).toHaveLength(3)
      vi.advanceTimersByTime(19_000)
      expect(requests).toHaveLength(3)
      vi.advanceTimersByTime(1_000)
      expect(requests).toHaveLength(4)
      expect(headerCalls(requests[3]!)).toMatchObject({ Range: 'bytes=0-4', 'If-Range': '"v1"' })
    } finally {
      handle.cancel()
      await handle.done
      vi.useRealTimers()
    }
  })

  it('pauses a retried range that refills the write queue and resumes that same range once it drains', async () => {
    const MIB = 1024 * 1024
    const half = 16 * MIB
    const total = 2 * half
    const handle = startModelTransfer(baseOpts({ segmentTuning: tuning }))
    requests[0]!.emit(
      'response',
      makeResponse(200, { 'content-length': String(total), 'accept-ranges': 'bytes', etag: '"v1"' })
    )
    const part = (from: number, to: number): FakeResponse =>
      makeResponse(206, {
        'content-range': `bytes ${from}-${to}/${total}`,
        'content-length': String(to - from + 1),
        etag: '"v1"'
      })

    const dropped = part(0, half - 1)
    requests[1]!.emit('response', dropped)
    dropped.emit('data', Buffer.alloc(9 * MIB, 1))
    expect(dropped.pause).toHaveBeenCalled()
    dropped.emit('error', new Error('net::ERR_CONNECTION_RESET'))

    expect(requests).toHaveLength(4)
    expect(headerCalls(requests[3]!)['Range']).toBe(`bytes=${9 * MIB}-${half - 1}`)
    const replacement = part(9 * MIB, half - 1)
    requests[3]!.emit('response', replacement)
    replacement.emit('data', Buffer.alloc(MIB, 2))
    expect(replacement.pause).toHaveBeenCalled()

    await vi.waitFor(() => expect(replacement.resume).toHaveBeenCalled())
    expect(dropped.resume).not.toHaveBeenCalled()
    handle.cancel()
    await handle.done
  })

  it('keeps the saved SHA-256 when a resumed range falls back to one stream', async () => {
    fs.mkdirSync(path.dirname(finalPath), { recursive: true })
    fs.writeFileSync(stagingPathFor(finalPath), Buffer.alloc(10))
    writeStagedMeta(
      stagingMetaPathFor(finalPath),
      stagedMeta({
        version: 3,
        expectedSize: 10,
        etag: '"v1"',
        sha256: '84d89877f0d4041efb6bf91a16f0248f2fd573e6af05c19f96bedb9f882f7882',
        segments: [
          { start: 0, end: 4, done: 0 },
          { start: 5, end: 9, done: 0 }
        ]
      })
    )
    const handle = startModelTransfer(baseOpts({ segmentTuning: tuning }))
    expect(requests).toHaveLength(2)
    requests[0]!.emit('response', makeResponse(200, probeHeaders))

    await vi.waitFor(() => expect(requests).toHaveLength(3))
    const plain = requests[2]!
    expect(headerCalls(plain)['Range']).toBeUndefined()
    const res = makeResponse(200, probeHeaders)
    plain.emit('response', res)
    res.emit('data', Buffer.from('abcdefghij'))
    res.emit('end')

    const outcome = await handle.done
    expect(outcome).toMatchObject({ outcome: 'error', code: 'checksum-mismatch' })
    expect(fs.existsSync(finalPath)).toBe(false)
  })

  it('starts over rather than send a mirror validator to the original URL once mirrors are off', async () => {
    fs.mkdirSync(path.dirname(finalPath), { recursive: true })
    fs.writeFileSync(stagingPathFor(finalPath), Buffer.alloc(10))
    writeStagedMeta(
      stagingMetaPathFor(finalPath),
      stagedMeta({
        version: 3,
        expectedSize: 10,
        etag: '"v1"',
        segments: [
          { start: 0, end: 4, done: 5 },
          { start: 5, end: 9, done: 0 }
        ],
        segmentsFromMirror: true
      })
    )
    const handle = startModelTransfer(baseOpts({ segmentTuning: tuning }))

    expect(requests).toHaveLength(1)
    expect(requests[0]!.__url).toBe(URL_MAIN)
    expect(headerCalls(requests[0]!)['Range']).toBeUndefined()
    expect(readStagedMeta(stagingMetaPathFor(finalPath))?.segments).toBeUndefined()
    handle.cancel()
    await handle.done
  })
})

describe('disk space', () => {
  const tuning: Partial<SegmentTuning> = {
    minBytes: 8,
    maxSegments: 2,
    minSegmentBytes: 4,
    persistEveryBytes: 1_000_000,
    maxAttempts: 3
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function freeBytes(bytes: number): void {
    vi.spyOn(fs, 'statfsSync').mockReturnValue({ bavail: bytes, bsize: 1 } as never)
  }

  const shortfall = 'Free up 0.6 GB of space, then try again'

  it('stops before writing when the drive cannot hold the file', async () => {
    freeBytes(100)
    const handle = startModelTransfer(baseOpts())
    const req = requests[0]!
    req.emit('response', makeResponse(200, { 'content-length': '10' }))
    expect(await handle.done).toEqual({ outcome: 'error', error: shortfall })
    expect(req.abort).toHaveBeenCalled()
    expect(fs.existsSync(finalPath)).toBe(false)
  })

  it('stops a parallel download before asking for any range', async () => {
    freeBytes(100)
    const handle = startModelTransfer(baseOpts({ segmentTuning: tuning }))
    requests[0]!.emit(
      'response',
      makeResponse(200, { 'content-length': '10', 'accept-ranges': 'bytes', etag: '"v1"' })
    )
    expect(await handle.done).toEqual({ outcome: 'error', error: shortfall })
    expect(requests).toHaveLength(1)
  })

  it('keeps saved ranges and asks for nothing when a resume no longer fits', async () => {
    freeBytes(100)
    fs.mkdirSync(path.dirname(finalPath), { recursive: true })
    fs.writeFileSync(stagingPathFor(finalPath), '')
    fs.truncateSync(stagingPathFor(finalPath), 10)
    const segments = [
      { start: 0, end: 4, done: 0 },
      { start: 5, end: 9, done: 0 }
    ]
    writeStagedMeta(
      stagingMetaPathFor(finalPath),
      stagedMeta({ version: 3, expectedSize: 10, etag: '"v1"', segments })
    )
    const handle = startModelTransfer(baseOpts({ segmentTuning: tuning }))
    const outcome = await handle.done
    expect(outcome).toMatchObject({ outcome: 'error' })
    expect((outcome as { error: string }).error).toBe(shortfall)
    expect(requests).toHaveLength(0)
    expect(fs.statSync(stagingPathFor(finalPath)).size).toBe(10)
    expect(readStagedMeta(stagingMetaPathFor(finalPath))?.segments).toEqual(segments)
  })

  it('downloads when the drive has room', async () => {
    freeBytes(DISK_SPACE_RESERVE_BYTES + 10)
    const handle = startModelTransfer(baseOpts())
    const req = requests[0]!
    const res = makeResponse(200, { 'content-length': '10' })
    req.emit('response', res)
    res.emit('data', Buffer.from('0123456789'))
    res.emit('end')
    expect(await handle.done).toEqual({ outcome: 'completed', savePath: finalPath, finalBytes: 10 })
  })

  it('downloads when free space cannot be read', async () => {
    vi.spyOn(fs, 'statfsSync').mockImplementation(() => {
      throw new Error('ENOSYS')
    })
    const handle = startModelTransfer(baseOpts())
    const req = requests[0]!
    const res = makeResponse(200, { 'content-length': '10' })
    req.emit('response', res)
    res.emit('data', Buffer.from('0123456789'))
    res.emit('end')
    expect(await handle.done).toEqual({ outcome: 'completed', savePath: finalPath, finalBytes: 10 })
  })

  it('does not check a download whose size the server does not give', async () => {
    const statfs = vi.spyOn(fs, 'statfsSync')
    const handle = startModelTransfer(baseOpts())
    const req = requests[0]!
    const res = makeResponse(200, {})
    req.emit('response', res)
    res.emit('data', Buffer.from('0123456789'))
    res.emit('end')
    await handle.done
    expect(statfs).not.toHaveBeenCalled()
  })
})
