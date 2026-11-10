import { net } from 'electron'
import fs from 'fs'
import path from 'path'
import * as settings from '../settings'
import { r2MirrorUrl } from './r2Mirror'

export interface DownloadProgress {
  percent: number
  receivedBytes: number
  receivedMB: string
  totalMB: string
  speedMBs: number
  elapsedSecs: number
  etaSecs: number
}

export interface DownloadMeta {
  url: string
  expectedSize: number
  etag?: string
  lastModified?: string
}

export interface DownloadOptions {
  signal?: AbortSignal
  expectedSize?: number
  idleTimeoutMs?: number
  validateUrl?: (url: string) => boolean
  _skipMirror?: boolean
  _maxRedirects?: number
}

export const META_SUFFIX = '.dl-meta'

const DEFAULT_IDLE_TIMEOUT_MS = 60_000

export function downloadMetaPath(filePath: string): string {
  return filePath + META_SUFFIX
}

export function isDownloadComplete(filePath: string): boolean {
  return fs.existsSync(filePath) && !fs.existsSync(downloadMetaPath(filePath))
}

function readMeta(metaPath: string): DownloadMeta | null {
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as DownloadMeta
  } catch {
    return null
  }
}

function writeMeta(metaPath: string, meta: DownloadMeta): void {
  try {
    fs.writeFileSync(metaPath, JSON.stringify(meta))
  } catch {}
}

function headerString(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined
  return Array.isArray(value) ? value[0] : value
}

export function download(
  url: string,
  destPath: string,
  onProgress: ((progress: DownloadProgress) => void) | null,
  options?: DownloadOptions | number
): Promise<string> {
  const opts: DownloadOptions =
    typeof options === 'number' ? { _maxRedirects: options } : (options ?? {})
  const {
    signal,
    expectedSize,
    idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
    validateUrl,
    _maxRedirects = 5,
    _skipMirror = false
  } = opts

  if (validateUrl && !validateUrl(url)) {
    return Promise.reject(new Error(`Download URL is not allowed: ${url}`))
  }

  const mirrorEnabled = !_skipMirror && settings.get('useChineseMirrors') === true
  const mirror = mirrorEnabled ? r2MirrorUrl(url) : undefined
  const tryMirror = async (primaryErr: Error): Promise<string> => {
    if (!mirror || mirror === url) throw primaryErr
    try {
      fs.unlinkSync(destPath)
    } catch {}
    try {
      fs.unlinkSync(downloadMetaPath(destPath))
    } catch {}
    try {
      return await download(mirror, destPath, onProgress, {
        signal,
        expectedSize,
        idleTimeoutMs,
        validateUrl,
        _maxRedirects,
        _skipMirror: true
      })
    } catch {
      throw primaryErr
    }
  }

  const metaPath = downloadMetaPath(destPath)

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Download cancelled'))
      return
    }

    fs.mkdirSync(path.dirname(destPath), { recursive: true })

    let resumeFrom = 0
    const existingMeta = readMeta(metaPath)
    if (existingMeta && fs.existsSync(destPath)) {
      if (existingMeta.url === url) {
        try {
          resumeFrom = fs.statSync(destPath).size
        } catch {
          resumeFrom = 0
        }
      }
      if (resumeFrom === 0) {
        try {
          fs.unlinkSync(destPath)
        } catch {}
        try {
          fs.unlinkSync(metaPath)
        } catch {}
      } else if (existingMeta.expectedSize > 0 && resumeFrom >= existingMeta.expectedSize) {
        try {
          fs.unlinkSync(metaPath)
        } catch {}
        resolve(destPath)
        return
      }
    } else if (fs.existsSync(metaPath)) {
      try {
        fs.unlinkSync(metaPath)
      } catch {}
    }

    const request = net.request(url)
    request.setHeader('User-Agent', 'ComfyUI-Desktop-2')
    if (resumeFrom > 0 && existingMeta?.etag) {
      request.setHeader('Range', `bytes=${resumeFrom}-`)
      request.setHeader('If-Range', existingMeta.etag)
    }

    let aborted = false
    let stalled = false
    let settled = false
    let fileStream: fs.WriteStream | null = null
    const safeResolve = (v: string): void => {
      if (!settled) {
        settled = true
        resolve(v)
      }
    }
    const safeReject = (e: Error): void => {
      if (!settled) {
        settled = true
        reject(e)
      }
    }

    let idleTimer: ReturnType<typeof setTimeout> | null = null
    const onStall = (): void => {
      stalled = true
      cleanup()
      request.abort()
      const err = new Error(`Download stalled: no data for ${Math.round(idleTimeoutMs / 1000)}s`)
      if (fileStream) {
        fileStream.close(() => safeReject(err))
      } else {
        safeReject(err)
      }
    }
    const armIdleTimer = (): void => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(onStall, idleTimeoutMs)
    }

    const rejectCancelled = (): void => {
      const err = new Error('Download cancelled')
      if (fileStream) {
        fileStream.close(() => safeReject(err))
      } else {
        safeReject(err)
      }
    }

    const onAbort = (): void => {
      aborted = true
      request.abort()
      rejectCancelled()
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true })

    const cleanup = (): void => {
      if (idleTimer) {
        clearTimeout(idleTimer)
        idleTimer = null
      }
      if (signal) signal.removeEventListener('abort', onAbort)
    }

    request.on('response', (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        cleanup()
        if (_maxRedirects <= 0) {
          safeReject(new Error('Download failed: too many redirects'))
          return
        }
        const rawLocation = response.headers.location
        const loc = Array.isArray(rawLocation) ? rawLocation[0] : rawLocation
        if (!loc) {
          safeReject(new Error('Download failed: empty redirect location'))
          return
        }
        let redirectUrl: string
        try {
          redirectUrl = new URL(loc, url).toString()
        } catch {
          safeReject(new Error(`Download failed: invalid redirect location ${loc}`))
          return
        }
        download(redirectUrl, destPath, onProgress, {
          signal,
          expectedSize,
          idleTimeoutMs,
          validateUrl,
          _maxRedirects: _maxRedirects - 1
        }).then(safeResolve, safeReject)
        return
      }

      const isResumed = response.statusCode === 206 && resumeFrom > 0
      if (!isResumed && response.statusCode !== 200) {
        cleanup()
        const err = new Error(`Download failed: HTTP ${response.statusCode}`)
        if (resumeFrom === 0 && !_skipMirror) {
          tryMirror(err).then(safeResolve, safeReject)
        } else {
          safeReject(err)
        }
        return
      }

      let baseBytes = 0
      if (isResumed) {
        baseBytes = resumeFrom
      } else if (resumeFrom > 0) {
        try {
          fs.unlinkSync(destPath)
        } catch {}
      }

      const rawContentLength = response.headers['content-length']
      const contentLength = Array.isArray(rawContentLength) ? rawContentLength[0] : rawContentLength
      const chunkTotalBytes = parseInt(contentLength ?? '0', 10)
      const totalBytes = isResumed ? baseBytes + chunkTotalBytes : chunkTotalBytes

      const sizeFromHeaders = chunkTotalBytes > 0 ? totalBytes : 0
      const effectiveSize = expectedSize || sizeFromHeaders

      if (expectedSize && sizeFromHeaders > 0 && expectedSize !== sizeFromHeaders) {
        cleanup()
        safeReject(
          new Error(
            `Download size mismatch: expected ${expectedSize} bytes but server reported ${sizeFromHeaders}`
          )
        )
        return
      }

      const etag = headerString(response.headers['etag'])
      const lastModified = headerString(response.headers['last-modified'])
      writeMeta(metaPath, { url, expectedSize: effectiveSize, etag, lastModified })

      let receivedBytes = baseBytes
      const startTime = Date.now()

      fileStream = fs.createWriteStream(destPath, isResumed ? { flags: 'a' } : undefined)
      fileStream.on('error', (err: Error) => {
        cleanup()
        try {
          fs.unlinkSync(destPath)
        } catch {}
        try {
          fs.unlinkSync(metaPath)
        } catch {}
        safeReject(err)
      })

      response.on('data', (chunk: Buffer) => {
        armIdleTimer()
        receivedBytes += chunk.length
        fileStream!.write(chunk)
        if (onProgress) {
          const elapsedSecs = (Date.now() - startTime) / 1000
          const newBytes = receivedBytes - baseBytes
          const speedMBs = elapsedSecs > 0 ? newBytes / 1048576 / elapsedSecs : 0
          const effectiveTotal = effectiveSize || totalBytes
          const percent =
            effectiveTotal > 0 ? Math.round((receivedBytes / effectiveTotal) * 100) : 0
          const remainingBytes = effectiveTotal - receivedBytes
          const etaSecs =
            speedMBs > 0 && effectiveTotal > 0 ? remainingBytes / 1048576 / speedMBs : -1
          onProgress({
            percent,
            receivedBytes,
            receivedMB: (receivedBytes / 1048576).toFixed(1),
            totalMB: effectiveTotal > 0 ? (effectiveTotal / 1048576).toFixed(1) : '?',
            speedMBs,
            elapsedSecs,
            etaSecs
          })
        }
      })

      response.on('end', () => {
        cleanup()
        if (aborted) {
          return
        }
        fileStream!.end()
        fileStream!.on('close', () => {
          if (effectiveSize > 0) {
            try {
              const actualSize = fs.statSync(destPath).size
              if (actualSize !== effectiveSize) {
                try {
                  fs.unlinkSync(destPath)
                } catch {}
                try {
                  fs.unlinkSync(metaPath)
                } catch {}
                safeReject(
                  new Error(
                    `Download incomplete: expected ${effectiveSize} bytes but got ${actualSize}`
                  )
                )
                return
              }
            } catch (err) {
              try {
                fs.unlinkSync(destPath)
              } catch {}
              try {
                fs.unlinkSync(metaPath)
              } catch {}
              safeReject(err as Error)
              return
            }
          }

          try {
            fs.unlinkSync(metaPath)
          } catch {}
          safeResolve(destPath)
        })
      })

      response.on('error', (err: Error) => {
        cleanup()
        if (aborted || stalled) return
        fileStream!.close(() => safeReject(err))
      })
    })

    request.on('error', (err: Error) => {
      cleanup()
      if (aborted || stalled) return
      if (resumeFrom === 0 && !_skipMirror) {
        tryMirror(err).then(safeResolve, safeReject)
      } else {
        safeReject(err)
      }
    })
    armIdleTimer()
    request.end()
  })
}
