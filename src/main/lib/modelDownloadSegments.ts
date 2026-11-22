import fs from 'fs'
import type { StagedSegment } from './modelDownloadStaging'

const MIB = 1024 * 1024

export interface SegmentTuning {
  minBytes: number
  maxSegments: number
  minSegmentBytes: number
  persistEveryBytes: number
  maxAttempts: number
}

export const DEFAULT_SEGMENT_TUNING: SegmentTuning = {
  minBytes: 64 * MIB,
  maxSegments: 8,
  minSegmentBytes: 16 * MIB,
  persistEveryBytes: 64 * MIB,
  maxAttempts: 3
}

const WRITE_HIGH_WATER_BYTES = 8 * MIB
const WRITE_LOW_WATER_BYTES = 2 * MIB

export function planSegments(totalBytes: number, tuning: SegmentTuning): StagedSegment[] | null {
  if (!Number.isSafeInteger(totalBytes) || totalBytes < tuning.minBytes) return null
  const count = Math.min(
    tuning.maxSegments,
    Math.floor(totalBytes / Math.max(1, tuning.minSegmentBytes))
  )
  if (count < 2) return null
  const base = Math.floor(totalBytes / count)
  const segments: StagedSegment[] = []
  for (let i = 0; i < count; i++) {
    const start = i * base
    const end = i === count - 1 ? totalBytes - 1 : start + base - 1
    segments.push({ start, end, done: 0 })
  }
  return segments
}

export function segmentLength(segment: StagedSegment): number {
  return segment.end - segment.start + 1
}

export function segmentsFinished(segments: readonly StagedSegment[]): boolean {
  return segments.every((segment) => segment.done === segmentLength(segment))
}

export interface SegmentResponse {
  statusCode: number
  headers: Record<string, string | string[]>
  on(event: 'data', listener: (chunk: Buffer) => void): unknown
  on(event: 'end', listener: () => void): unknown
  on(event: 'error', listener: (err: Error) => void): unknown
  pause(): void
  resume(): void
}

export interface SegmentRequestHandlers {
  onResponse(response: SegmentResponse): void
  onError(err: Error): void
}

export interface SegmentRequest {
  abort(): void
}

export type SegmentFailure =
  | { kind: 'retain'; message: string }
  | { kind: 'discard'; message: string }
  | { kind: 'ranges-ignored' }

export interface SegmentValidator {
  kind: 'etag' | 'last-modified'
  value: string
}

export interface SegmentedRunOptions {
  fd: number
  totalBytes: number
  segments: readonly StagedSegment[]
  validator: SegmentValidator
  idleTimeoutMs: number
  tuning: SegmentTuning
  openRange(
    range: string,
    ifRange: string,
    handlers: SegmentRequestHandlers,
    slot: number
  ): SegmentRequest
  persist(segments: StagedSegment[]): void
  onProgress(receivedBytes: number): void
  onComplete(): void
  onFailure(failure: SegmentFailure): void
}

export interface SegmentedRun {
  start(): void
  halt(opts: { persist: boolean }): Promise<void>
}

interface SegmentState {
  slot: number
  segment: StagedSegment
  received: number
  queued: number
  tail: Promise<void>
  request: SegmentRequest | null
  idle: ReturnType<typeof setTimeout> | null
  failures: number
  gen: number
  networkDone: boolean
  backpressured: boolean
}

function headerString(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined
  return Array.isArray(value) ? value[0] : value
}

function writeAt(fd: number, chunk: Buffer, position: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const step = (offset: number): void => {
      fs.write(fd, chunk, offset, chunk.length - offset, position + offset, (err, written) => {
        if (err) {
          reject(err)
          return
        }
        if (written <= 0) {
          reject(new Error('disk accepted no bytes'))
          return
        }
        if (offset + written < chunk.length) step(offset + written)
        else resolve()
      })
    }
    step(0)
  })
}

function syncData(fd: number): Promise<void> {
  return new Promise((resolve) => fs.fdatasync(fd, () => resolve()))
}

export function startSegmentedRun(opts: SegmentedRunOptions): SegmentedRun {
  const { fd, totalBytes, validator, idleTimeoutMs, tuning } = opts
  const states: SegmentState[] = opts.segments.map((segment, slot) => ({
    slot,
    segment: { ...segment },
    received: segment.done,
    queued: 0,
    tail: Promise.resolve(),
    request: null,
    idle: null,
    failures: 0,
    gen: 0,
    networkDone: false,
    backpressured: false
  }))

  let stopped = false
  let reported = false
  let writeFailed = false
  let bytesSincePersist = 0
  let persistTail: Promise<void> = Promise.resolve()
  let haltPromise: Promise<void> | null = null

  const report = (failure: SegmentFailure): void => {
    if (reported || stopped) return
    reported = true
    opts.onFailure(failure)
  }

  const totalReceived = (): number => states.reduce((sum, state) => sum + state.received, 0)

  const snapshot = (): StagedSegment[] => states.map((state) => ({ ...state.segment }))

  const persistNow = async (): Promise<void> => {
    const segments = snapshot()
    await syncData(fd)
    try {
      opts.persist(segments)
    } catch {}
  }

  const maybePersist = (): void => {
    if (stopped || bytesSincePersist < tuning.persistEveryBytes) return
    bytesSincePersist = 0
    persistTail = persistTail.then(persistNow)
  }

  const clearIdle = (state: SegmentState): void => {
    if (state.idle) {
      clearTimeout(state.idle)
      state.idle = null
    }
  }

  const dropRequest = (state: SegmentState): void => {
    clearIdle(state)
    const request = state.request
    state.request = null
    if (request) {
      try {
        request.abort()
      } catch {}
    }
  }

  const checkComplete = (): void => {
    if (reported || stopped || writeFailed) return
    const finished = states.every(
      (state) =>
        state.networkDone &&
        state.queued === 0 &&
        state.segment.done === segmentLength(state.segment)
    )
    if (!finished) return
    reported = true
    opts.onComplete()
  }

  const retry = (state: SegmentState, message: string): void => {
    if (stopped || reported) return
    dropRequest(state)
    state.gen++
    state.failures++
    if (state.failures >= tuning.maxAttempts) {
      report({ kind: 'retain', message })
      return
    }
    startSegment(state)
  }

  const armIdle = (state: SegmentState, gen: number): void => {
    clearIdle(state)
    state.idle = setTimeout(() => {
      if (stopped || gen !== state.gen) return
      retry(state, `Download stalled: no data for ${Math.round(idleTimeoutMs / 1000)}s`)
    }, idleTimeoutMs)
  }

  const enqueueWrite = (
    state: SegmentState,
    gen: number,
    response: SegmentResponse,
    chunk: Buffer,
    position: number
  ): void => {
    state.queued += chunk.length
    if (!state.backpressured && state.queued >= WRITE_HIGH_WATER_BYTES) {
      state.backpressured = true
      clearIdle(state)
      response.pause()
    }
    state.tail = state.tail
      .then(async () => {
        if (writeFailed) return
        await writeAt(fd, chunk, position)
        state.segment.done += chunk.length
        state.queued -= chunk.length
        bytesSincePersist += chunk.length
        if (state.backpressured && state.queued <= WRITE_LOW_WATER_BYTES) {
          state.backpressured = false
          if (!stopped && gen === state.gen && !state.networkDone) {
            response.resume()
            armIdle(state, gen)
          }
        }
        maybePersist()
        if (state.networkDone && state.queued === 0) checkComplete()
      })
      .catch((err: Error) => {
        writeFailed = true
        report({ kind: 'retain', message: `Write failed: ${err.message}` })
      })
  }

  const acceptResponse = (
    state: SegmentState,
    gen: number,
    from: number,
    response: SegmentResponse
  ): void => {
    const stale = (): boolean => stopped || gen !== state.gen
    const status = response.statusCode
    if (status === 200) {
      report({ kind: 'ranges-ignored' })
      return
    }
    if (status === 416) {
      report({
        kind: 'discard',
        message: 'Download failed: server rejected a byte range (HTTP 416)'
      })
      return
    }
    if (status !== 206) {
      retry(state, `Download failed: HTTP ${status}`)
      return
    }
    const contentRange = headerString(response.headers['content-range'])?.trim()
    const parsed = contentRange ? /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange) : null
    const lengthHeader = headerString(response.headers['content-length'])
    const length = lengthHeader !== undefined ? parseInt(lengthHeader, 10) : 0
    const end = state.segment.end
    if (
      !parsed ||
      Number(parsed[1]) !== from ||
      Number(parsed[2]) !== end ||
      Number(parsed[3]) !== totalBytes ||
      (length > 0 && length !== end - from + 1)
    ) {
      report({
        kind: 'discard',
        message: `Download failed: server answered "${contentRange ?? 'none'}" for bytes ${from}-${end}/${totalBytes}`
      })
      return
    }
    const etag = headerString(response.headers['etag'])
    const lastModified = headerString(response.headers['last-modified'])
    if (
      (validator.kind === 'etag' && etag && etag !== validator.value) ||
      (validator.kind === 'last-modified' && lastModified && lastModified !== validator.value)
    ) {
      report({
        kind: 'discard',
        message: 'Download failed: content changed on the server during resume'
      })
      return
    }

    response.on('data', (chunk: Buffer) => {
      if (stale() || state.networkDone) {
        if (!stale() && chunk.length > 0) {
          report({
            kind: 'retain',
            message: 'Download failed: server sent more bytes than requested'
          })
        }
        return
      }
      const room = end + 1 - (state.segment.start + state.received)
      if (chunk.length > room) {
        report({
          kind: 'retain',
          message: 'Download failed: server sent more bytes than requested'
        })
        return
      }
      if (chunk.length === 0) return
      state.failures = 0
      const position = state.segment.start + state.received
      state.received += chunk.length
      enqueueWrite(state, gen, response, chunk, position)
      opts.onProgress(totalReceived())
      if (state.segment.start + state.received > end) {
        state.networkDone = true
        clearIdle(state)
        state.request = null
        if (state.queued === 0) checkComplete()
      } else if (!state.backpressured) {
        armIdle(state, gen)
      }
    })
    response.on('end', () => {
      if (stale() || state.networkDone) return
      retry(state, 'Download failed: connection closed before the byte range finished')
    })
    response.on('error', (err: Error) => {
      if (stale() || state.networkDone) return
      retry(state, `Download failed: ${err.message}`)
    })
    armIdle(state, gen)
  }

  const startSegment = (state: SegmentState): void => {
    if (stopped || reported) return
    const from = state.segment.start + state.received
    const end = state.segment.end
    if (from > end) {
      state.networkDone = true
      if (state.queued === 0) checkComplete()
      return
    }
    const gen = ++state.gen
    const stale = (): boolean => stopped || gen !== state.gen
    let request: SegmentRequest
    try {
      request = opts.openRange(
        `bytes=${from}-${end}`,
        validator.value,
        {
          onResponse: (response) => {
            if (stale()) return
            acceptResponse(state, gen, from, response)
          },
          onError: (err) => {
            if (stale() || state.networkDone) return
            retry(state, `Download failed: ${err.message}`)
          }
        },
        state.slot
      )
    } catch (err) {
      report({ kind: 'retain', message: `Download failed: ${(err as Error).message}` })
      return
    }
    if (stale()) {
      try {
        request.abort()
      } catch {}
      return
    }
    state.request = request
    armIdle(state, gen)
  }

  return {
    start: () => {
      for (const state of states) startSegment(state)
    },
    halt: ({ persist }) => {
      if (haltPromise) return haltPromise
      stopped = true
      for (const state of states) {
        dropRequest(state)
        state.gen++
      }
      haltPromise = (async () => {
        await Promise.all(states.map((state) => state.tail))
        await persistTail
        if (persist) await persistNow()
        try {
          fs.closeSync(fd)
        } catch {}
      })()
      return haltPromise
    }
  }
}
