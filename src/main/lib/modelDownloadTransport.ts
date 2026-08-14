import { net } from 'electron'
import fs from 'fs'
import path from 'path'
import * as settings from '../settings'
import { r2MirrorUrl } from './r2Mirror'
import {
  installStagedAtFinal,
  quarantineOrphanStagedBytes,
  readStagedMeta,
  removeStagedArtifacts,
  stagingMetaPathFor,
  stagingPathFor,
  writeStagedMeta,
  type StagedDownloadMeta
} from './modelDownloadStaging'

/**
 * Controllable, resumable transport for managed model downloads.
 *
 * One transfer = one attempt to move `url` into `finalPath`, staged at
 * `<finalPath>.part` with a `<finalPath>.part.dl-meta` sidecar (see
 * `modelDownloadStaging.ts`). Unlike Electron's `DownloadItem` this runs
 * headlessly (no BrowserWindow) via `net.request`, can carry an originating
 * `Session`'s cookies (`useSessionCookies`), and survives app restarts:
 * pause/failure preserve the staged bytes + sidecar, and the next transfer
 * resumes with `Range`/`If-Range`.
 *
 * Control semantics:
 *  - pause():  abort network, flush + keep staged bytes and sidecar -> 'paused'
 *  - cancel(): abort network, delete staged bytes and sidecar     -> 'cancelled'
 *  - network failure / stall: keep staged state                   -> 'error'
 *  - completion: byte count verified against the expected size, then an
 *    atomic no-clobber same-volume install onto the final name, sidecar
 *    removed.
 *
 * Terminal ownership: exactly ONE path (stop, failure, or verification) may
 * claim the transfer; every other late callback becomes a no-op. `done`
 * resolves only after the claiming path has finished closing the stream and
 * cleaning up, so a caller that awaits `done` can safely reuse the staging
 * file. The promise always resolves (never rejects) so fire-and-forget
 * dispatch cannot leak unhandled rejections.
 */

export interface ModelTransferProgress {
  receivedBytes: number
  /** 0 while unknown (no Content-Length and no caller-provided size). */
  totalBytes: number
}

export type ModelTransferOutcome =
  | { outcome: 'completed'; savePath: string; finalBytes: number }
  | { outcome: 'paused' }
  | { outcome: 'cancelled' }
  | { outcome: 'error'; error: string }

export interface ModelTransferOptions {
  /** ORIGINAL source url - the job's stable identity across redirects. */
  url: string
  /** Manager job ID, persisted into the sidecar so restart hydration can
   *  restore the same stable identity. */
  jobId?: string
  finalPath: string
  /** Models subdirectory, persisted into the sidecar for restart hydration. */
  directory: string
  filename: string
  installationId?: string | null
  /** Originating session so gated-repo cookies/auth ride along. */
  session?: Electron.Session
  /** Caller-known total size; conflicts with the server's length fail fast. */
  expectedSize?: number
  /** Abort when no bytes arrive for this long (ms). */
  idleTimeoutMs?: number
  onProgress?: (p: ModelTransferProgress) => void
}

export interface ModelTransferHandle {
  done: Promise<ModelTransferOutcome>
  /** Stop network activity, keep staged bytes + sidecar. Returns false when
   *  another terminal path already claimed the transfer (the stop had no
   *  effect). */
  pause(): boolean
  /** Stop network activity, delete staged bytes + sidecar. Returns false when
   *  another terminal path already claimed the transfer (the caller must
   *  clean up staged state). */
  cancel(): boolean
}

const DEFAULT_IDLE_TIMEOUT_MS = 60_000
const MAX_REDIRECTS = 10

function headerString(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined
  return Array.isArray(value) ? value[0] : value
}

/** Usable as an HTTP header value: printable ASCII (+ tab), bounded length.
 *  Sidecar contents live on disk and must never be able to throw out of
 *  `setHeader` or smuggle header injection. */
function isSafeHeaderValue(value: string | undefined): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 1024 &&
    /^[\t\x20-\x7e]+$/.test(value)
  )
}

/** The validator this transfer may use for byte-identity resume (If-Range).
 *  RFC 9110: a weak ETag (`W/"..."`) never guarantees byte-for-byte equality,
 *  so it must not gate a Range splice - fall back to Last-Modified. */
function resumeValidatorFor(
  meta: StagedDownloadMeta
): { kind: 'etag' | 'last-modified'; value: string } | null {
  if (isSafeHeaderValue(meta.etag) && !meta.etag.startsWith('W/')) {
    return { kind: 'etag', value: meta.etag }
  }
  if (isSafeHeaderValue(meta.lastModified)) {
    return { kind: 'last-modified', value: meta.lastModified }
  }
  return null
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
    idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
    onProgress
  } = opts

  const stagingPath = stagingPathFor(finalPath)
  const metaPath = stagingMetaPathFor(finalPath)

  // Terminal ownership. 'active' -> 'terminating' (one path claimed the
  // outcome and is closing/cleaning up) -> 'settled' (`done` resolved).
  let phase: 'active' | 'terminating' | 'settled' = 'active'
  /** Claim the terminal transition. Only the single caller that gets `true`
   *  may close the stream, mutate staged files, and settle. */
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

  /** Close the open stream (if any), then `cb`. Only the claiming terminal
   *  path may call this - it owns the stream from claim onward. */
  const closeStream = (cb: () => void): void => {
    const stream = fileStream
    fileStream = null
    if (stream && !stream.closed) {
      stream.close(() => cb())
    } else {
      cb()
    }
  }

  /** Terminal failure that KEEPS the staged bytes (resume/retry continues).
   *  No-op unless this call wins the terminal claim. */
  const failRetaining = (message: string): void => {
    if (!claim()) return
    clearIdle()
    abortRequest()
    closeStream(() => settle({ outcome: 'error', error: message }))
  }

  /** Terminal failure that DISCARDS the staged bytes (unresumable state). */
  const failDiscarding = (message: string): void => {
    if (!claim()) return
    clearIdle()
    abortRequest()
    closeStream(() => {
      removeStagedArtifacts(finalPath)
      settle({ outcome: 'error', error: message })
    })
  }

  /** Verified completion: atomically install the staged bytes at the final
   *  name WITHOUT clobbering a file that appeared there independently. */
  const finalize = (finalBytes: number): void => {
    if (!claim()) return
    clearIdle()
    abortRequest()
    closeStream(() => finalizeClaimed(finalBytes))
  }

  const mirrorEnabled = settings.get('useChineseMirrors') === true
  const mirror = mirrorEnabled ? r2MirrorUrl(url) : undefined
  let mirrorTried = false
  let anyBytesThisTransfer = false

  /** Pre-byte connection/HTTP failure: retry once against the R2 mirror
   *  (opted-in users only), preserving the ORIGINAL url as the job identity. */
  const maybeTryMirror = (): boolean => {
    if (mirrorTried || !mirror || mirror === url || anyBytesThisTransfer) return false
    mirrorTried = true
    issueAttempt(mirror)
    return true
  }

  /** Attempt generation: bumped per issueAttempt so a superseded attempt's
   *  late events (e.g. the primary erroring after a mirror retry started)
   *  can't settle or corrupt the live attempt. */
  let attemptGen = 0

  const issueAttempt = (attemptUrl: string): void => {
    if (phase !== 'active') return
    const gen = ++attemptGen
    const stale = (): boolean => phase !== 'active' || gen !== attemptGen

    // Resume bookkeeping: staged bytes + matching sidecar => Range resume.
    let resumeFrom = 0
    let existingMeta: StagedDownloadMeta | null = readStagedMeta(metaPath)
    let resumeValidator: { kind: 'etag' | 'last-modified'; value: string } | null = null
    if (existingMeta && existingMeta.url === url && fs.existsSync(stagingPath)) {
      resumeValidator = resumeValidatorFor(existingMeta)
      if (resumeValidator) {
        try {
          resumeFrom = fs.statSync(stagingPath).size
        } catch {
          resumeFrom = 0
        }
      }
      if (!resumeValidator || resumeFrom === 0) {
        // No validator to guarantee byte identity across attempts - restart.
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
        // Staged bytes EXCEED the expected size, or the caller expects a
        // DIFFERENT total than the staged pair - stale/corrupt; restart clean.
        removeStagedArtifacts(finalPath)
        existingMeta = null
        resumeValidator = null
        resumeFrom = 0
      }
    } else if (existingMeta) {
      // Sidecar for a different url (superseded launcher staging) or a
      // sidecar with no staged bytes (stale bookkeeping) - restart clean.
      removeStagedArtifacts(finalPath)
      existingMeta = null
    } else if (fs.existsSync(stagingPath)) {
      // Orphan `.part` bytes with no sidecar: possibly quarantined migration
      // data of unknown provenance. Park them aside rather than truncating
      // them with this transfer's stream; refuse to proceed if that fails.
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
      // Durable placeholder BEFORE any network activity: a quit/crash from
      // here on leaves a hydratable pair, so the job reappears (paused) on
      // the next launch even if no byte ever arrived. If the pair cannot be
      // durably created (permissions / disk full / a scanner lock), fail NOW:
      // downloading gigabytes with no resume identity would strand the bytes
      // as an unmanaged orphan on the next restart.
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
        installationId: installationId ?? undefined
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
      // e.g. malformed/unsupported URL - staged bytes are still resumable.
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

    // Everything from here through `request.end()` is synchronous setup that
    // may throw (invalid header bytes, a destroyed session, ...). A throw
    // must settle this transfer instead of escaping to the caller.
    try {
      request.setHeader('User-Agent', 'ComfyUI-Desktop-2')
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
        // Follow in place: Electron re-issues the same request (headers
        // intact), while the job identity stays keyed to the ORIGINAL url.
        try {
          request.followRedirect()
        } catch (err) {
          failRetaining(`Download failed: ${(err as Error).message}`)
        }
      })

      request.on('response', (rawResponse) => {
        if (stale()) return // teardown / a newer attempt owns settling
        // Electron's IncomingMessage implements the Readable Stream interface
        // at runtime, but its typings only declare EventEmitter - widen for
        // pause()/resume() backpressure control.
        const response = rawResponse as Electron.IncomingMessage & {
          pause(): void
          resume(): void
        }

        const status = response.statusCode

        if (status === 416) {
          // Server rejected our range. Finalize ONLY on independent proof of
          // completeness: a well-formed `Content-Range: bytes */<total>`
          // whose total matches the staged byte count, the sidecar's
          // recorded size, and (when known) the caller's expected size.
          // Anything less means the partial cannot be trusted against this
          // source - discard so retry restarts clean.
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

        // A 206 body is only appendable if it PROVABLY continues our staged
        // bytes. RFC 9110 requires Content-Range on every 206; a server that
        // omits or malforms it gives us no proof, and splicing unverified
        // bytes would corrupt the file (the staged bytes stay for a retry
        // against a compliant response). The declared range must start at
        // our staged byte count, be internally consistent, carry a numeric
        // total, and that total must agree with BOTH the sidecar's recorded
        // size and the caller's expected size when known.
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
          // If-Range compliance means a 206 is always the SAME entity we
          // staged; a response validator that contradicts the one we sent
          // means a broken server whose bytes must not be mixed into ours.
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

        // Requested a range but got 200: full body incoming (If-Range
        // validator mismatch or no server support) - restart the staged file
        // from zero.
        let baseBytes = 0
        if (isResumed) {
          baseBytes = resumeFrom
        } else if (resumeFrom > 0) {
          try {
            fs.unlinkSync(stagingPath)
          } catch {}
        }

        const totalFromHeaders = isResumed ? rangeTotal : chunkLen > 0 ? chunkLen : 0
        // Never lose a known total: a resumed chunked response must not
        // overwrite the sidecar's expected size with zero, or an interrupted
        // body would later pass verification and finalize incomplete.
        const knownSize = isResumed ? (existingMeta?.expectedSize ?? 0) : 0
        const effectiveSize = expectedSize || totalFromHeaders || knownSize

        if (
          !isResumed &&
          expectedSize &&
          totalFromHeaders > 0 &&
          expectedSize !== totalFromHeaders
        ) {
          clearIdle()
          // The source no longer matches what the caller expects - any
          // staged bytes are for stale content.
          failDiscarding(
            `Download size mismatch: expected ${expectedSize} bytes but server reported ${totalFromHeaders}`
          )
          return
        }

        // Persist/refresh the sidecar BEFORE bytes land so a crash mid-stream
        // leaves a resumable pair. On a fresh 200, capture the new validators.
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
          installationId: installationId ?? undefined
        }
        if (!writeStagedMeta(metaPath, meta)) {
          // Accepting body bytes without a durable resume identity would
          // leave unresumable (or worse, stale-validator) staged data.
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
            // Backpressure: don't let a fast network outrun a slow disk.
            response.pause()
            fileStream.once('drain', () => {
              if (!stale()) response.resume()
            })
          }
          onProgress?.({ receivedBytes, totalBytes: effectiveSize })
        })

        response.on('end', () => {
          if (stale()) return
          // Claim NOW: from here the outcome belongs to verification, and a
          // pause/cancel landing mid-flush must not race the finalize rename
          // (transport.pause()/cancel() return false; the manager handles
          // the already-settling transport).
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
                // Interrupted body - keep the staged bytes; retry resumes.
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
              // No caller expectation, no Content-Length, no persisted total:
              // the bytes cannot be verified complete, and an unverified file
              // must never land under a model extension (issue #1322). Keep
              // the staged bytes - a Range retry learns the real total from
              // the 206 Content-Range and can then verify.
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
        // Pre-response network failure: try the mirror once if no bytes have
        // landed this transfer (mixing two origins' bytes is never attempted).
        if (resumeFrom === 0 && maybeTryMirror()) return
        failRetaining(`Download failed: ${err.message}`)
      })

      armIdleTimer() // covers a connect that never responds
      request.end()
    } catch (err) {
      failRetaining(`Download failed: ${(err as Error).message}`)
    }
  }

  /** `finalize` body for a caller that ALREADY holds the terminal claim and
   *  has closed the stream (the end/verify path). */
  const finalizeClaimed = (finalBytes: number): void => {
    void (async () => {
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
    clearIdle()
    abortRequest()
    closeStream(() => {
      if (mode === 'cancel') {
        if (removeStagedArtifacts(finalPath)) {
          settle({ outcome: 'cancelled' })
        } else {
          // The sidecar survived (locked file / permissions): the job WOULD
          // rehydrate as resumable next launch, so reporting a clean cancel
          // would lie. Surface it instead.
          settle({
            outcome: 'error',
            error: 'Cancel failed: staged download files could not be removed'
          })
        }
      } else {
        settle({ outcome: 'paused' })
      }
    })
    return true
  }

  issueAttempt(url)

  return {
    done,
    pause: () => stop('pause'),
    cancel: () => stop('cancel')
  }
}
