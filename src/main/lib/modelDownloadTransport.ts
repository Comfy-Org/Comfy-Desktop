import { net, session as electronSession } from 'electron'
import fs from 'fs'
import path from 'path'
import * as settings from '../settings'
import { r2MirrorUrl } from './r2Mirror'
import { diskSpaceShortfall } from './modelDownloadSpace'
import {
  DEFAULT_SEGMENT_TUNING,
  planSegments,
  segmentsFinished,
  startSegmentedRun,
  type SegmentRequest,
  type SegmentRequestHandlers,
  type SegmentResponse,
  type SegmentTuning,
  type SegmentedRun
} from './modelDownloadSegments'
import {
  installStagedAtFinal,
  quarantineOrphanStagedBytes,
  readStagedMeta,
  removeStagedArtifacts,
  sha256File,
  stagingMetaPathFor,
  stagingPathFor,
  writeStagedMeta,
  type StagedDownloadMeta,
  type StagedSegment
} from './modelDownloadStaging'

export interface ModelTransferProgress {
  receivedBytes: number
  totalBytes: number
}

export type ModelTransferOutcome =
  | { outcome: 'completed'; savePath: string; finalBytes: number }
  | { outcome: 'paused' }
  | { outcome: 'cancelled' }
  | { outcome: 'error'; error: string; code?: 'checksum-mismatch' }

export interface ModelTransferOptions {
  url: string
  jobId?: string
  finalPath: string
  directory: string
  filename: string
  installationId?: string | null
  session?: Electron.Session
  expectedSize?: number
  sha256?: string
  idleTimeoutMs?: number
  segmentTuning?: Partial<SegmentTuning>
  onProgress?: (p: ModelTransferProgress) => void
}

export interface ModelTransferHandle {
  done: Promise<ModelTransferOutcome>
  pause(): boolean
  cancel(): boolean
}

const DEFAULT_IDLE_TIMEOUT_MS = 60_000
const MAX_REDIRECTS = 10
const USER_AGENT = 'ComfyUI-Desktop-2'
const PART_PARTITION_PREFIX = 'comfy-download-part-'

function partSessionFor(slot: number): Electron.Session {
  return electronSession.fromPartition(`${PART_PARTITION_PREFIX}${slot}`, { cache: false })
}

function originOf(value: string): string | null {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

function headerString(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined
  return Array.isArray(value) ? value[0] : value
}

function isSafeHeaderValue(value: string | undefined): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 1024 &&
    /^[\t\x20-\x7e]+$/.test(value)
  )
}

function resumeValidatorFor(
  meta: Pick<StagedDownloadMeta, 'etag' | 'lastModified'>
): { kind: 'etag' | 'last-modified'; value: string } | null {
  if (isSafeHeaderValue(meta.etag) && !meta.etag.startsWith('W/')) {
    return { kind: 'etag', value: meta.etag }
  }
  if (isSafeHeaderValue(meta.lastModified)) {
    return { kind: 'last-modified', value: meta.lastModified }
  }
  return null
}

function acceptsByteRanges(headers: Record<string, string | string[]>): boolean {
  const value = headerString(headers['accept-ranges'])
  if (!value) return false
  return value
    .split(',')
    .map((unit) => unit.trim().toLowerCase())
    .includes('bytes')
}

export function startModelTransfer(opts: ModelTransferOptions): ModelTransferHandle {
  const {
    url,
    jobId,
    finalPath,
    directory,
    filename,
    installationId,
    session,
    expectedSize,
    sha256,
    idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
    onProgress
  } = opts
  const tuning: SegmentTuning = { ...DEFAULT_SEGMENT_TUNING, ...opts.segmentTuning }
  let knownSha256 = sha256

  const stagingPath = stagingPathFor(finalPath)
  const metaPath = stagingMetaPathFor(finalPath)

  let phase: 'active' | 'terminating' | 'settled' = 'active'
  const claim = (): boolean => {
    if (phase !== 'active') return false
    phase = 'terminating'
    return true
  }

  let resolveDone!: (o: ModelTransferOutcome) => void
  const done = new Promise<ModelTransferOutcome>((resolve) => {
    resolveDone = resolve
  })
  const settle = (o: ModelTransferOutcome): void => {
    if (phase === 'settled') return
    phase = 'settled'
    activeRequest = null
    resolveDone(o)
  }

  let activeRequest: Electron.ClientRequest | null = null
  let fileStream: fs.WriteStream | null = null
  let idleTimer: ReturnType<typeof setTimeout> | null = null

  const clearIdle = (): void => {
    if (idleTimer) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
  }

  const abortRequest = (): void => {
    if (activeRequest) {
      try {
        activeRequest.abort()
      } catch {}
    }
  }

  const closeStream = (cb: () => void): void => {
    const stream = fileStream
    fileStream = null
    if (stream && !stream.closed) {
      stream.close(() => cb())
    } else {
      cb()
    }
  }

  let segmentedRun: SegmentedRun | null = null
  let segmentsHalting: Promise<void> | null = null

  const shutdown = (cb: () => void, persistSegments = true): void => {
    clearIdle()
    abortRequest()
    const run = segmentedRun
    segmentedRun = null
    const halting = run ? run.halt({ persist: persistSegments }) : segmentsHalting
    if (!halting) {
      closeStream(cb)
      return
    }
    void halting.then(() => closeStream(cb))
  }

  const failRetaining = (message: string): void => {
    if (!claim()) return
    shutdown(() => settle({ outcome: 'error', error: message }))
  }

  const failDiscarding = (message: string): void => {
    if (!claim()) return
    shutdown(() => {
      removeStagedArtifacts(finalPath)
      settle({ outcome: 'error', error: message })
    }, false)
  }

  const finalize = (finalBytes: number): void => {
    if (!claim()) return
    shutdown(() => finalizeClaimed(finalBytes))
  }

  const mirrorEnabled = settings.get('useChineseMirrors') === true
  const mirror = mirrorEnabled ? r2MirrorUrl(url) : undefined
  let mirrorTried = false
  let anyBytesThisTransfer = false

  const maybeTryMirror = (): boolean => {
    if (mirrorTried || !mirror || mirror === url || anyBytesThisTransfer) return false
    mirrorTried = true
    issueAttempt(mirror)
    return true
  }

  let attemptGen = 0
  let segmentsAllowed = true
  let partSessionsRefused = false

  const openRangeRequest =
    (sourceUrl: string) =>
    (
      range: string,
      ifRange: string,
      handlers: SegmentRequestHandlers,
      slot: number
    ): SegmentRequest => {
      const sourceOrigin = originOf(sourceUrl)
      let redirectsLeft = MAX_REDIRECTS
      let current: Electron.ClientRequest | null = null
      let closed = false

      const drop = (request: Electron.ClientRequest): void => {
        try {
          request.abort()
        } catch {}
      }

      const send = (target: string, onPartSession: boolean): void => {
        const request = net.request({
          url: target,
          ...(onPartSession
            ? { session: partSessionFor(slot) }
            : session
              ? { session, useSessionCookies: true }
              : {}),
          redirect: 'manual'
        })
        current = request
        const live = (): boolean => !closed && current === request
        request.setHeader('User-Agent', USER_AGENT)
        request.setHeader('Range', range)
        request.setHeader('If-Range', ifRange)
        request.on('redirect', (_status, _method, redirectUrl) => {
          if (!live()) return
          redirectsLeft--
          if (redirectsLeft < 0) {
            handlers.onError(new Error('too many redirects'))
            return
          }
          if (!redirectUrl) {
            handlers.onError(new Error('empty redirect location'))
            return
          }
          const nextOrigin = originOf(redirectUrl)
          if (
            !onPartSession &&
            !partSessionsRefused &&
            sourceOrigin &&
            nextOrigin &&
            nextOrigin !== sourceOrigin
          ) {
            drop(request)
            send(redirectUrl, true)
            return
          }
          try {
            request.followRedirect()
          } catch (err) {
            handlers.onError(err as Error)
          }
        })
        request.on('response', (response) => {
          if (!live()) return
          if (onPartSession && (response.statusCode === 401 || response.statusCode === 403)) {
            partSessionsRefused = true
            drop(request)
            redirectsLeft = MAX_REDIRECTS
            send(sourceUrl, false)
            return
          }
          handlers.onResponse(response as unknown as SegmentResponse)
        })
        request.on('error', (err: Error) => {
          if (!live()) return
          handlers.onError(err)
        })
        request.end()
      }

      send(sourceUrl, false)
      return {
        abort: () => {
          closed = true
          if (current) drop(current)
        }
      }
    }

  const fallBackToSingleStream = (sourceUrl: string): void => {
    if (phase !== 'active') return
    segmentsAllowed = false
    const run = segmentedRun
    segmentedRun = null
    if (!run) return
    const halting = run.halt({ persist: false })
    segmentsHalting = halting
    void halting.then(() => {
      if (segmentsHalting === halting) segmentsHalting = null
      if (phase !== 'active') return
      knownSha256 = knownSha256 ?? readStagedMeta(metaPath)?.sha256
      removeStagedArtifacts(finalPath)
      issueAttempt(sourceUrl)
    })
  }

  const runSegments = (
    fd: number,
    meta: StagedDownloadMeta & { segments: StagedSegment[] },
    validator: { kind: 'etag' | 'last-modified'; value: string },
    sourceUrl: string
  ): void => {
    const run = startSegmentedRun({
      fd,
      totalBytes: meta.expectedSize,
      segments: meta.segments,
      validator,
      idleTimeoutMs,
      tuning,
      openRange: openRangeRequest(sourceUrl),
      persist: (segments) => {
        writeStagedMeta(metaPath, { ...meta, segments })
      },
      onProgress: (receivedBytes) => {
        anyBytesThisTransfer = true
        onProgress?.({ receivedBytes, totalBytes: meta.expectedSize })
      },
      onComplete: () => {
        if (!claim()) return
        shutdown(() => {
          let actualSize = -1
          try {
            actualSize = fs.statSync(stagingPath).size
          } catch {}
          if (actualSize !== meta.expectedSize) {
            settle({
              outcome: 'error',
              error: `Download incomplete: expected ${meta.expectedSize} bytes but got ${actualSize}`
            })
            return
          }
          finalizeClaimed(actualSize)
        })
      },
      onFailure: (failure) => {
        if (failure.kind === 'ranges-ignored') fallBackToSingleStream(sourceUrl)
        else if (failure.kind === 'discard') failDiscarding(failure.message)
        else failRetaining(failure.message)
      }
    })
    segmentedRun = run
    run.start()
  }

  const openStagingAt = (size: number, truncate: boolean): number | null => {
    let fd: number
    try {
      fd = fs.openSync(stagingPath, truncate ? 'w' : 'r+')
    } catch (err) {
      failRetaining(`Download failed: cannot open staging file: ${(err as Error).message}`)
      return null
    }
    if (truncate) {
      try {
        fs.ftruncateSync(fd, size)
      } catch (err) {
        try {
          fs.closeSync(fd)
        } catch {}
        failRetaining(`Download failed: cannot size staging file: ${(err as Error).message}`)
        return null
      }
    }
    return fd
  }

  const segmentedMeta = (
    base: Omit<StagedDownloadMeta, 'version' | 'segments'>,
    segments: StagedSegment[],
    fromMirror: boolean
  ): StagedDownloadMeta & { segments: StagedSegment[] } => ({
    ...base,
    version: 3,
    jobId,
    directory,
    filename,
    installationId: installationId ?? undefined,
    sha256: knownSha256 ?? base.sha256,
    segments,
    segmentsFromMirror: fromMirror ? true : undefined
  })

  const beginSegments = (
    sourceUrl: string,
    totalBytes: number,
    segments: StagedSegment[],
    validatorHeaders: { etag?: string; lastModified?: string },
    validator: { kind: 'etag' | 'last-modified'; value: string },
    priorSha256: string | undefined
  ): void => {
    const meta = segmentedMeta(
      {
        url,
        expectedSize: totalBytes,
        etag: validatorHeaders.etag,
        lastModified: validatorHeaders.lastModified,
        directory,
        filename,
        sha256: priorSha256
      },
      segments,
      sourceUrl !== url
    )
    if (!writeStagedMeta(metaPath, meta)) {
      failRetaining('Download failed: cannot write staging metadata')
      return
    }
    const fd = openStagingAt(totalBytes, true)
    if (fd === null) return
    runSegments(fd, meta, validator, sourceUrl)
  }

  const resumeSegments = (meta: StagedDownloadMeta): boolean => {
    const segments = meta.segments
    const validator = resumeValidatorFor(meta)
    if (!segments || !validator) return false
    if (meta.segmentsFromMirror && !mirror && !(knownSha256 ?? meta.sha256)) return false
    if (expectedSize && expectedSize !== meta.expectedSize) return false
    let stagedSize = -1
    try {
      stagedSize = fs.statSync(stagingPath).size
    } catch {}
    if (stagedSize !== meta.expectedSize) return false
    if (segmentsFinished(segments)) {
      finalize(meta.expectedSize)
      return true
    }
    const shortfall = diskSpaceShortfall(stagingPath, meta.expectedSize)
    if (shortfall) {
      failRetaining(shortfall)
      return true
    }
    const sourceUrl = meta.segmentsFromMirror && mirror ? mirror : url
    const fd = openStagingAt(meta.expectedSize, false)
    if (fd === null) return true
    runSegments(fd, segmentedMeta(meta, segments, sourceUrl !== url), validator, sourceUrl)
    return true
  }

  const issueAttempt = (attemptUrl: string): void => {
    if (phase !== 'active') return
    const gen = ++attemptGen
    const stale = (): boolean => phase !== 'active' || gen !== attemptGen

    let resumeFrom = 0
    let existingMeta: StagedDownloadMeta | null = readStagedMeta(metaPath)
    let resumeValidator: { kind: 'etag' | 'last-modified'; value: string } | null = null
    if (existingMeta && knownSha256 && existingMeta.sha256 && existingMeta.sha256 !== knownSha256) {
      removeStagedArtifacts(finalPath)
      existingMeta = null
    }
    const stagedContentMatches =
      existingMeta !== null &&
      (existingMeta.url === url ||
        (knownSha256 !== undefined && existingMeta.sha256 === knownSha256))
    if (existingMeta && stagedContentMatches && fs.existsSync(stagingPath)) {
      if (existingMeta.segments) {
        if (segmentsAllowed && resumeSegments(existingMeta)) return
        removeStagedArtifacts(finalPath)
        existingMeta = null
      } else {
        resumeValidator = resumeValidatorFor(existingMeta)
        if (resumeValidator) {
          try {
            resumeFrom = fs.statSync(stagingPath).size
          } catch {
            resumeFrom = 0
          }
        }
        if (!resumeValidator || resumeFrom === 0) {
          removeStagedArtifacts(finalPath)
          existingMeta = null
          resumeValidator = null
          resumeFrom = 0
        } else if (existingMeta.expectedSize > 0 && resumeFrom >= existingMeta.expectedSize) {
          if (
            resumeFrom === existingMeta.expectedSize &&
            (!expectedSize || expectedSize === existingMeta.expectedSize)
          ) {
            finalize(resumeFrom)
            return
          }
          removeStagedArtifacts(finalPath)
          existingMeta = null
          resumeValidator = null
          resumeFrom = 0
        }
      }
    } else if (existingMeta) {
      removeStagedArtifacts(finalPath)
      existingMeta = null
    } else if (fs.existsSync(stagingPath)) {
      if (!quarantineOrphanStagedBytes(finalPath)) {
        failRetaining('Download failed: cannot move unidentified staged bytes aside')
        return
      }
    }

    try {
      fs.mkdirSync(path.dirname(finalPath), { recursive: true })
    } catch (err) {
      failRetaining(`Download failed: ${(err as Error).message}`)
      return
    }

    if (resumeFrom === 0) {
      try {
        if (!fs.existsSync(stagingPath)) fs.writeFileSync(stagingPath, '')
      } catch (err) {
        failRetaining(`Download failed: cannot create staging file: ${(err as Error).message}`)
        return
      }
      const durable = writeStagedMeta(metaPath, {
        version: 2,
        jobId,
        url,
        expectedSize: expectedSize && expectedSize > 0 ? expectedSize : 0,
        directory,
        filename,
        installationId: installationId ?? undefined,
        sha256: knownSha256 ?? undefined
      })
      if (!durable) {
        failRetaining('Download failed: cannot write staging metadata')
        return
      }
    }

    let redirectsLeft = MAX_REDIRECTS
    let request: Electron.ClientRequest
    try {
      request = net.request({
        url: attemptUrl,
        ...(session ? { session, useSessionCookies: true } : {}),
        redirect: 'manual'
      })
    } catch (err) {
      failRetaining(`Download failed: ${(err as Error).message}`)
      return
    }
    activeRequest = request

    const armIdleTimer = (): void => {
      clearIdle()
      idleTimer = setTimeout(() => {
        if (stale()) return
        failRetaining(`Download stalled: no data for ${Math.round(idleTimeoutMs / 1000)}s`)
      }, idleTimeoutMs)
    }

    try {
      request.setHeader('User-Agent', USER_AGENT)
      if (resumeFrom > 0 && resumeValidator) {
        request.setHeader('Range', `bytes=${resumeFrom}-`)
        request.setHeader('If-Range', resumeValidator.value)
      }

      request.on('redirect', (_status, _method, redirectUrl) => {
        if (stale()) return
        redirectsLeft--
        if (redirectsLeft < 0) {
          failRetaining('Download failed: too many redirects')
          return
        }
        if (!redirectUrl) {
          failRetaining('Download failed: empty redirect location')
          return
        }
        try {
          request.followRedirect()
        } catch (err) {
          failRetaining(`Download failed: ${(err as Error).message}`)
        }
      })

      request.on('response', (rawResponse) => {
        if (stale()) return
        const response = rawResponse as Electron.IncomingMessage & {
          pause(): void
          resume(): void
        }

        const status = response.statusCode

        if (status === 416) {
          clearIdle()
          let stagedSize = -1
          try {
            stagedSize = fs.statSync(stagingPath).size
          } catch {}
          const unsatisfied = /^bytes \*\/(\d+)$/.exec(
            headerString(response.headers['content-range'])?.trim() ?? ''
          )
          const serverTotal = unsatisfied ? Number(unsatisfied[1]) : 0
          const persisted = existingMeta?.expectedSize ?? 0
          const consistent =
            serverTotal > 0 &&
            Number.isSafeInteger(serverTotal) &&
            stagedSize === serverTotal &&
            (persisted === 0 || persisted === serverTotal) &&
            (!expectedSize || expectedSize === serverTotal)
          if (consistent) {
            finalize(serverTotal)
          } else {
            failDiscarding('Download failed: server rejected resume (HTTP 416)')
          }
          return
        }

        const isResumed = status === 206 && resumeFrom > 0
        if (!isResumed && status !== 200) {
          clearIdle()
          const message = `Download failed: HTTP ${status}`
          if (resumeFrom === 0 && maybeTryMirror()) {
            try {
              request.abort()
            } catch {}
            return
          }
          failRetaining(message)
          return
        }

        const chunkLenHeader = headerString(response.headers['content-length'])
        const chunkLen = chunkLenHeader !== undefined ? parseInt(chunkLenHeader, 10) : 0
        let rangeTotal = 0
        if (isResumed) {
          const contentRange = headerString(response.headers['content-range'])?.trim()
          const parsed = contentRange ? /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange) : null
          if (!parsed) {
            failRetaining(
              `Download failed: resumed response lacks a valid Content-Range (got "${contentRange ?? 'none'}")`
            )
            return
          }
          const start = Number(parsed[1])
          const end = Number(parsed[2])
          rangeTotal = Number(parsed[3])
          const spanOk =
            Number.isSafeInteger(start) &&
            Number.isSafeInteger(end) &&
            Number.isSafeInteger(rangeTotal) &&
            start === resumeFrom &&
            end >= start &&
            end < rangeTotal &&
            (chunkLen <= 0 || chunkLen === end - start + 1)
          if (!spanOk) {
            failDiscarding(
              `Download failed: server resumed at "${contentRange}" instead of byte ${resumeFrom}`
            )
            return
          }
          const persisted = existingMeta?.expectedSize ?? 0
          if (persisted > 0 && persisted !== rangeTotal) {
            failDiscarding(
              `Download size mismatch: staged bytes expect ${persisted} bytes but server reported ${rangeTotal}`
            )
            return
          }
          if (expectedSize && expectedSize !== rangeTotal) {
            failDiscarding(
              `Download size mismatch: expected ${expectedSize} bytes but server reported ${rangeTotal}`
            )
            return
          }
          const respEtag = headerString(response.headers['etag'])
          const respLastModified = headerString(response.headers['last-modified'])
          if (
            (resumeValidator?.kind === 'etag' && respEtag && respEtag !== resumeValidator.value) ||
            (resumeValidator?.kind === 'last-modified' &&
              respLastModified &&
              respLastModified !== resumeValidator.value)
          ) {
            failDiscarding('Download failed: content changed on the server during resume')
            return
          }
        }

        let baseBytes = 0
        if (isResumed) {
          baseBytes = resumeFrom
        } else if (resumeFrom > 0) {
          try {
            fs.unlinkSync(stagingPath)
          } catch {}
        }

        const totalFromHeaders = isResumed ? rangeTotal : chunkLen > 0 ? chunkLen : 0
        const knownSize = isResumed ? (existingMeta?.expectedSize ?? 0) : 0
        const effectiveSize = expectedSize || totalFromHeaders || knownSize

        if (
          !isResumed &&
          expectedSize &&
          totalFromHeaders > 0 &&
          expectedSize !== totalFromHeaders
        ) {
          clearIdle()
          failDiscarding(
            `Download size mismatch: expected ${expectedSize} bytes but server reported ${totalFromHeaders}`
          )
          return
        }

        const shortfall = diskSpaceShortfall(stagingPath, effectiveSize)
        if (shortfall) {
          clearIdle()
          failRetaining(shortfall)
          return
        }

        if (!isResumed && segmentsAllowed && acceptsByteRanges(response.headers)) {
          const segments = planSegments(totalFromHeaders, tuning)
          const validatorHeaders = {
            etag: headerString(response.headers['etag']),
            lastModified: headerString(response.headers['last-modified'])
          }
          const validator = resumeValidatorFor(validatorHeaders)
          if (segments && validator) {
            clearIdle()
            attemptGen++
            abortRequest()
            activeRequest = null
            beginSegments(
              attemptUrl,
              totalFromHeaders,
              segments,
              validatorHeaders,
              validator,
              existingMeta?.sha256
            )
            return
          }
        }

        const meta: StagedDownloadMeta = {
          version: 2,
          jobId,
          url,
          expectedSize: effectiveSize,
          etag: isResumed ? existingMeta?.etag : headerString(response.headers['etag']),
          lastModified: isResumed
            ? existingMeta?.lastModified
            : headerString(response.headers['last-modified']),
          directory,
          filename,
          installationId: installationId ?? undefined,
          sha256: knownSha256 ?? existingMeta?.sha256
        }
        if (!writeStagedMeta(metaPath, meta)) {
          failRetaining('Download failed: cannot write staging metadata')
          return
        }

        let receivedBytes = baseBytes
        fileStream = fs.createWriteStream(stagingPath, isResumed ? { flags: 'a' } : undefined)
        fileStream.on('error', (err: Error) => {
          if (stale()) return
          failRetaining(`Write failed: ${err.message}`)
        })

        response.on('data', (chunk: Buffer) => {
          if (stale() || !fileStream) return
          armIdleTimer()
          anyBytesThisTransfer = true
          receivedBytes += chunk.length
          const ok = fileStream.write(chunk)
          if (!ok) {
            response.pause()
            fileStream.once('drain', () => {
              if (!stale()) response.resume()
            })
          }
          onProgress?.({ receivedBytes, totalBytes: effectiveSize })
        })

        response.on('end', () => {
          if (stale()) return
          if (!claim()) return
          clearIdle()
          const stream = fileStream
          fileStream = null
          const verify = (): void => {
            let actualSize = -1
            try {
              actualSize = fs.statSync(stagingPath).size
            } catch {}
            if (effectiveSize > 0 && actualSize !== effectiveSize) {
              if (actualSize >= 0 && actualSize < effectiveSize) {
                settle({
                  outcome: 'error',
                  error: `Download incomplete: expected ${effectiveSize} bytes but got ${actualSize}`
                })
              } else {
                removeStagedArtifacts(finalPath)
                settle({
                  outcome: 'error',
                  error: `Download corrupt: expected ${effectiveSize} bytes but got ${actualSize}`
                })
              }
              return
            }
            if (actualSize < 0) {
              settle({ outcome: 'error', error: 'Download failed: staged file disappeared' })
              return
            }
            if (effectiveSize <= 0) {
              settle({
                outcome: 'error',
                error: 'Download failed: server did not report a size to verify the file'
              })
              return
            }
            finalizeClaimed(actualSize)
          }
          if (stream && !stream.closed) {
            stream.end(() => stream.close(() => verify()))
          } else {
            verify()
          }
        })

        response.on('error', (err: Error) => {
          if (stale()) return
          failRetaining(`Download failed: ${err.message}`)
        })
      })

      request.on('error', (err: Error) => {
        if (stale()) return
        clearIdle()
        if (resumeFrom === 0 && maybeTryMirror()) return
        failRetaining(`Download failed: ${err.message}`)
      })

      armIdleTimer()
      request.end()
    } catch (err) {
      failRetaining(`Download failed: ${(err as Error).message}`)
    }
  }

  const finalizeClaimed = (finalBytes: number): void => {
    void (async () => {
      const expectedSha256 = knownSha256 ?? readStagedMeta(metaPath)?.sha256
      if (expectedSha256) {
        let actualSha256: string
        try {
          actualSha256 = await sha256File(stagingPath)
        } catch (err) {
          settle({
            outcome: 'error',
            error: `Download failed: cannot verify checksum: ${(err as Error).message}`
          })
          return
        }
        if (actualSha256 !== expectedSha256) {
          removeStagedArtifacts(finalPath)
          settle({
            outcome: 'error',
            error: `Download corrupt: checksum mismatch: expected ${expectedSha256}, got ${actualSha256}`,
            code: 'checksum-mismatch'
          })
          return
        }
      }
      try {
        await installStagedAtFinal(stagingPath, finalPath, finalBytes)
      } catch (err) {
        settle({
          outcome: 'error',
          error: `Failed to move download to final location: ${(err as Error).message}`
        })
        return
      }
      removeStagedArtifacts(finalPath)
      settle({ outcome: 'completed', savePath: finalPath, finalBytes })
    })()
  }

  const stop = (mode: 'pause' | 'cancel'): boolean => {
    if (!claim()) return false
    shutdown(() => {
      if (mode === 'cancel') {
        if (removeStagedArtifacts(finalPath)) {
          settle({ outcome: 'cancelled' })
        } else {
          settle({
            outcome: 'error',
            error: 'Cancel failed: staged download files could not be removed'
          })
        }
      } else {
        settle({ outcome: 'paused' })
      }
    }, mode === 'pause')
    return true
  }

  issueAttempt(url)

  return {
    done,
    pause: () => stop('pause'),
    cancel: () => stop('cancel')
  }
}
