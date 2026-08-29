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

/** Flush a couple of macrotask turns so stream close callbacks run. */
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

    // Mid-transfer: bytes live ONLY under the staging name.
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
    // Fresh 200 with no Content-Length, no caller expectation and no
    // persisted total: the bytes cannot be proven complete, so they must
    // never land under a recognized model extension (issue #1322).
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
    // Staged bytes and sidecar survive so a Range retry can learn the total
    // from a 206 Content-Range and then verify.
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
    // Already settled: a second stop is a no-op.
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
    // Fake timers: the idle timer must fire only when WE advance the clock,
    // after the data chunk landed - otherwise a loaded runner could burn the
    // 25 ms window during the synchronous response setup and abort before
    // any byte was staged.
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
      // The stream close callback that settles `done` is fs I/O, not a
      // timer - real timers must be back before awaiting it.
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
    // RFC 9110 requires Content-Range on every 206. A server that omits it
    // gives no proof its body continues our staged bytes - splicing it in
    // blind could corrupt the file. The staged pair stays for a retry
    // against a compliant response.
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
    // Range says 5 bytes (5-9) but Content-Length says 4: internally
    // inconsistent response - no part of it can be trusted.
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
    // A misbehaving server/proxy answers with a range that does NOT start at
    // our staged byte count - appending its body would corrupt the file.
    const res = makeResponse(206, { 'content-length': '8', 'content-range': 'bytes 2-9/10' })
    req.emit('response', res)
    const outcome = await handle.done
    expect(outcome.outcome).toBe('error')
    expect(req.abort).toHaveBeenCalled()
    await flush()
    // The staged pair is not resumable against this source - discarded so the
    // next attempt restarts clean.
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
    // New content only - the stale staged bytes were discarded, not prepended.
    expect(fs.readFileSync(finalPath, 'utf-8')).toBe('CCCCCCCCCC')
  })

  it('restarts clean when the sidecar has no validator', async () => {
    preStage('AAAAA', stagedMeta({ etag: undefined, lastModified: undefined }))
    const handle = startModelTransfer(baseOpts())
    const headers = headerCalls(requests[0]!)
    expect(headers['Range']).toBeUndefined()
    // The unverifiable pair was discarded; a fresh zero-byte placeholder +
    // sidecar replace it so a crash right here still hydrates a job.
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
    // Corrupt overrun: restart clean instead of finalizing.
    expect(requests).toHaveLength(1)
    const headers = headerCalls(requests[0]!)
    expect(headers['Range']).toBeUndefined()
    expect(fs.statSync(stagingPathFor(finalPath)).size).toBe(0)
    expect(fs.existsSync(finalPath)).toBe(false)
    handle.cancel()
    await handle.done
  })

  it('finalizes on HTTP 416 only with server-confirmed proof of completeness', async () => {
    // Sidecar total unknown (0) so the pre-network completion path is
    // skipped; a resume request goes out from byte 10.
    preStage('0123456789', stagedMeta({ expectedSize: 0 }))
    const handle = startModelTransfer(baseOpts())
    const req = requests[0]!
    expect(headerCalls(req)['Range']).toBe('bytes=10-')
    // RFC 9110 unsatisfied-range response confirms the real total equals our
    // staged byte count - independent proof the file is complete.
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
    // Present but garbage: must NOT fall through to any finalize heuristic.
    requests[0]!.emit('response', makeResponse(416, { 'content-range': 'bytes */banana' }))
    const outcome = await handle.done
    expect(outcome.outcome).toBe('error')
    expect(fs.existsSync(finalPath)).toBe(false)
  })

  it('does not finalize on HTTP 416 when the server reports a different total', async () => {
    preStage('0123456789', stagedMeta({ expectedSize: 0 }))
    const handle = startModelTransfer(baseOpts())
    // RFC 9110 unsatisfied-range response names the REAL total - 12, not our
    // staged 10, so the staged bytes are stale content, not a complete file.
    requests[0]!.emit('response', makeResponse(416, { 'content-range': 'bytes */12' }))
    const outcome = await handle.done
    expect(outcome.outcome).toBe('error')
    expect(fs.existsSync(finalPath)).toBe(false)
    expect(fs.existsSync(stagingPathFor(finalPath))).toBe(false)
  })

  it('does not finalize on HTTP 416 when the caller expects a different total', async () => {
    preStage('0123456789', stagedMeta({ expectedSize: 0 }))
    const handle = startModelTransfer(baseOpts({ expectedSize: 12 }))
    // Server confirms 10 bytes total but the CALLER expects 12: the staged
    // content cannot be the model the caller asked for.
    requests[0]!.emit('response', makeResponse(416, { 'content-range': 'bytes */10' }))
    const outcome = await handle.done
    expect(outcome.outcome).toBe('error')
    expect(fs.existsSync(finalPath)).toBe(false)
  })

  it('rejects a 206 whose Content-Range total contradicts the staged expected size', async () => {
    preStage('AAAAA', stagedMeta({ expectedSize: 10 }))
    const handle = startModelTransfer(baseOpts())
    const req = requests[0]!
    // Right start offset, wrong entity: the server now reports 20 total bytes
    // where our staged pair expects 10 - appending would corrupt the file.
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
    // If-Range compliance forbids a 206 for a changed entity; a broken server
    // that answers 206 with a NEW ETag must not have its bytes spliced in.
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
    // Chunked 206 with a valid Content-Range but no Content-Length. The
    // interrupted short body must NOT finalize as a complete model.
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
    // Retained for resume - 8 of 10 bytes staged.
    expect(fs.readFileSync(stagingPathFor(finalPath), 'utf-8')).toBe('AAAAABBB')
    expect(readStagedMeta(stagingMetaPathFor(finalPath))?.expectedSize).toBe(10)
  })

  it('restarts clean instead of finalizing when the caller expects a different size', async () => {
    preStage('0123456789', stagedMeta({ expectedSize: 10 }))
    const handle = startModelTransfer(baseOpts({ expectedSize: 12 }))
    // Staged bytes match the sidecar but NOT what the caller now expects -
    // stale content; a fresh request goes out with no Range header.
    expect(requests).toHaveLength(1)
    const headers = headerCalls(requests[0]!)
    expect(headers['Range']).toBeUndefined()
    expect(fs.statSync(stagingPathFor(finalPath)).size).toBe(0)
    expect(fs.existsSync(finalPath)).toBe(false)
    handle.cancel()
    await handle.done
  })

  it('uses Last-Modified for If-Range when the staged ETag is weak', () => {
    // RFC 9110: a weak ETag never guarantees byte-for-byte equality, so it
    // must not gate a Range splice.
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
    // The expectation survives a crash: a hydrated resume can still verify.
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
    // Wrong bytes are not short bytes: nothing to resume, so nothing stays.
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
    // Splicing onto bytes for other content could only fail verification.
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
    // Hydrated finalize without a network attempt still runs verification.
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

    // A later resume keys off the original url, not the redirect target.
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
    // No response yet - a quit/crash right now must still leave a pair the
    // next launch can hydrate into a paused job.
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
  /** Throw only for writes matching `match`; pass every other write through. */
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
    // The failure happened before the request was ever issued.
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
    // The .part placeholder that DID land stays for a later retry.
    expect(fs.existsSync(stagingPathFor(finalPath))).toBe(true)
  })

  it('refuses body bytes when the response-phase sidecar rewrite fails', async () => {
    const handle = startModelTransfer(baseOpts())
    const req = requests[0]!
    // Initial placeholder + sidecar landed fine; the refresh on response fails.
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
    // No byte was accepted without a durable resume identity - even ones the
    // aborted response flushes late.
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
    // A `.part` with no readable sidecar may be quarantined migration data of
    // unknown provenance - never a new transfer's to claim or destroy.
    fs.mkdirSync(path.dirname(finalPath), { recursive: true })
    fs.writeFileSync(stagingPathFor(finalPath), 'foreign bytes')
    const handle = startModelTransfer(baseOpts())
    const req = requests[0]!
    // The new transfer starts fresh - no Range resume into foreign bytes.
    expect(headerCalls(req)['Range']).toBeUndefined()
    const res = makeResponse(200, { 'content-length': '10' })
    req.emit('response', res)
    res.emit('data', Buffer.from('0123456789'))
    res.emit('end')
    const outcome = await handle.done
    expect(outcome).toEqual({ outcome: 'completed', savePath: finalPath, finalBytes: 10 })
    expect(fs.readFileSync(finalPath, 'utf-8')).toBe('0123456789')
    // The orphan bytes were preserved under a parked non-model name.
    expect(fs.readFileSync(stagingPathFor(finalPath) + '.orphan', 'utf-8')).toBe('foreign bytes')
  })

  it('starts no request when the orphan bytes cannot be moved aside', async () => {
    fs.mkdirSync(path.dirname(finalPath), { recursive: true })
    const orphanPath = stagingPathFor(finalPath)
    fs.writeFileSync(orphanPath, 'foreign bytes')
    // Both park primitives (hard link and claim+rename fallback) fail.
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
    // No network activity and no truncation of the unmovable bytes.
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
    // The pre-network placeholder stays hydratable.
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
    // Verification claimed the outcome synchronously on 'end'.
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
    // The aborted request may still flush buffered events.
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
    // The user (or another process) drops a DIFFERENT file at the final name
    // mid-download - the verified staged bytes must not overwrite it.
    fs.writeFileSync(finalPath, 'XXX')
    res.emit('data', Buffer.from('56789'))
    res.emit('end')
    const outcome = await handle.done
    expect(outcome.outcome).toBe('error')
    expect((outcome as { error: string }).error).toMatch(/already exists/)
    expect(fs.readFileSync(finalPath, 'utf-8')).toBe('XXX')
    // Staged bytes survive the conflict for the user to resolve.
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
    // The independently placed identical file stays authoritative.
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
    // Same length as the download but different content - e.g. a different
    // model that happens to match in size. Equal length must never be
    // accepted as proof of identity.
    fs.writeFileSync(finalPath, 'ZZZZZZZZZZ')
    res.emit('data', Buffer.from('56789'))
    res.emit('end')
    const outcome = await handle.done
    expect(outcome.outcome).toBe('error')
    expect((outcome as { error: string }).error).toMatch(/already exists/)
    // Both files are preserved for the user to resolve.
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
    // A genuine I/O failure must surface as the transfer error it is, keeping
    // the staged bytes for retry.
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
      // No zero-byte claim marker was left at the final name; staged bytes
      // and sidecar survive for retry.
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
