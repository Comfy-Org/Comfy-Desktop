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
  sha256File,
  stagingMetaPathFor,
  stagingPathFor,
  writeStagedMeta,
  type StagedDownloadMeta
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
  onProgress?: (p: ModelTransferProgress) => void
}

export interface ModelTransferHandle {
  done: Promise<ModelTransferOutcome>
  pause(): boolean
  cancel(): boolean
}

const DEFAULT_IDLE_TIMEOUT_MS = 60_000
const MAX_REDIRECTS = 10

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
    sha256,
    idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
    onProgress
  } = opts

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

  const failRetaining = (message: string): void => {
    if (!claim()) return
    clearIdle()
    abortRequest()
    closeStream(() => settle({ outcome: 'error', error: message }))
  }

  const failDiscarding = (message: string): void => {
    if (!claim()) return
    clearIdle()
    abortRequest()
    closeStream(() => {
      removeStagedArtifacts(finalPath)
      settle({ outcome: 'error', error: message })
    })
  }

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

  const maybeTryMirror = (): boolean => {
    if (mirrorTried || !mirror || mirror === url || anyBytesThisTransfer) return false
    mirrorTried = true
    issueAttempt(mirror)
    return true
  }

  let attemptGen = 0

  const issueAttempt = (attemptUrl: string): void => {
    if (phase !== 'active') return
    const gen = ++attemptGen
    const stale = (): boolean => phase !== 'active' || gen !== attemptGen

    let resumeFrom = 0
    let existingMeta: StagedDownloadMeta | null = readStagedMeta(metaPath)
    let resumeValidator: { kind: 'etag' | 'last-modified'; value: string } | null = null
    if (existingMeta && sha256 && existingMeta.sha256 && existingMeta.sha256 !== sha256) {
      removeStagedArtifacts(finalPath)
      existingMeta = null
    }
    const stagedContentMatches =
      existingMeta !== null &&
      (existingMeta.url === url || (sha256 !== undefined && existingMeta.sha256 === sha256))
    if (existingMeta && stagedContentMatches && fs.existsSync(stagingPath)) {
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
        sha256: sha256 ?? undefined
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
          sha256: sha256 ?? existingMeta?.sha256
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
      const expectedSha256 = sha256 ?? readStagedMeta(metaPath)?.sha256
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
    clearIdle()
    abortRequest()
    closeStream(() => {
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
