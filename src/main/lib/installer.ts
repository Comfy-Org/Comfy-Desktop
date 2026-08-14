import fs from 'fs'
import path from 'path'
import { formatTime } from './util'
import { t } from './i18n'
import type { Cache } from './cache'
import { isDownloadComplete } from './download'
import type { DownloadProgress } from './download'
import type { ExtractProgress } from './extract'
import type { InstallPayloadItem, SendProgress } from '../../types/ipc'
import { BYTES_PER_MB, measuredProgress } from '../../shared/progressMeasurement'

/** Per-phase boundary signal for `comfy.desktop.install.phase` telemetry. The
 *  installer owns the genuine download↔extract seam (the two are one call from
 *  the caller's view but distinct work here), so it reports the boundaries; the
 *  caller in `install.ts` maps them to the consent-gated telemetry pipeline with
 *  the installation_id / variant it holds. Optional + best-effort so a throwing
 *  callback never breaks an install. `info.error` is pre-bucketed by the caller's
 *  emitter — the installer only forwards the raw Error for classification. */
export type InstallPhaseName = 'download' | 'extract'
export type InstallPhaseStatus = 'start' | 'end' | 'error'
export interface InstallerContext {
  sendProgress: SendProgress
  download: (
    url: string,
    dest: string,
    onProgress: ((p: DownloadProgress) => void) | null,
    options?: { signal?: AbortSignal; expectedSize?: number }
  ) => Promise<string>
  cache: Cache
  extract: (
    archivePath: string,
    dest: string,
    onProgress?: ((p: ExtractProgress) => void) | null,
    options?: { signal?: AbortSignal }
  ) => Promise<void>
  signal?: AbortSignal
  /** Optional per-phase boundary tap. See `InstallPhaseName`. */
  onPhase?: (
    phase: InstallPhaseName,
    status: InstallPhaseStatus,
    info?: { durationMs?: number; error?: unknown }
  ) => void
}

/** Run an installer phase, emitting start/end/error boundaries through the
 *  optional `onPhase` tap. Re-throws so existing control flow (cancel, retry)
 *  is unchanged; telemetry is a pure side-channel. */
async function withInstallPhase<T>(
  onPhase: InstallerContext['onPhase'],
  phase: InstallPhaseName,
  fn: () => Promise<T>
): Promise<T> {
  // The phase tap is a pure side-channel; a throwing `onPhase` must never abort
  // or mask the install, so every invocation is isolated.
  const safeOnPhase = (
    status: InstallPhaseStatus,
    info?: { durationMs?: number; error?: unknown }
  ): void => {
    try {
      onPhase?.(phase, status, info)
    } catch {
      // swallow: telemetry failures don't affect install control flow
    }
  }
  safeOnPhase('start')
  const t0 = Date.now()
  try {
    const result = await fn()
    safeOnPhase('end', { durationMs: Date.now() - t0 })
    return result
  } catch (err) {
    safeOnPhase('error', { durationMs: Date.now() - t0, error: err })
    throw err
  }
}

interface DownloadFile {
  url: string
  filename: string
  size: number
}

// Per-cache-path lock so concurrent installs don't write the same file; the
// second caller waits, then hits the cache and skips the download.
const _downloadLocks = new Map<string, Promise<void>>()

interface DownloadLockOptions {
  signal?: AbortSignal
  onWait?: () => void
}

async function withDownloadLock<T>(
  cachePath: string,
  opts: DownloadLockOptions,
  fn: () => Promise<T>
): Promise<T> {
  const { signal, onWait } = opts
  let notified = false
  while (_downloadLocks.has(cachePath)) {
    if (signal?.aborted) throw new Error('Download cancelled')
    if (!notified) {
      onWait?.()
      notified = true
    }
    if (signal) {
      let aborted = false
      await new Promise<void>((resolve) => {
        const onAbort = (): void => {
          aborted = true
          resolve()
        }
        signal.addEventListener('abort', onAbort, { once: true })
        _downloadLocks
          .get(cachePath)!
          .catch(() => {})
          .then(() => {
            signal.removeEventListener('abort', onAbort)
            resolve()
          })
      })
      if (aborted) throw new Error('Download cancelled')
    } else {
      try {
        await _downloadLocks.get(cachePath)
      } catch {}
    }
  }
  if (signal?.aborted) throw new Error('Download cancelled')
  let resolve!: () => void
  const lock = new Promise<void>((r) => (resolve = r))
  _downloadLocks.set(cachePath, lock)
  try {
    return await fn()
  } finally {
    _downloadLocks.delete(cachePath)
    resolve()
  }
}

function isCacheValid(cachePath: string, expectedSize?: number): boolean {
  if (!isDownloadComplete(cachePath)) return false
  if (expectedSize && expectedSize > 0) {
    try {
      return fs.statSync(cachePath).size === expectedSize
    } catch {
      return false
    }
  }
  return true
}

export async function downloadAndExtract(
  url: string,
  dest: string,
  cacheKey: string,
  ctx: InstallerContext,
  expectedSize?: number
): Promise<void> {
  const { sendProgress, download, cache, extract, signal, onPhase } = ctx
  const filename = url.split('/').pop()!
  const cacheBase = cache.getCachePath(cacheKey)
  fs.mkdirSync(cacheBase, { recursive: true })
  const cachePath = path.join(cacheBase, filename)

  await withInstallPhase(onPhase, 'download', () =>
    withDownloadLock(
      cachePath,
      {
        signal,
        onWait: () =>
          sendProgress('download', { percent: 0, status: t('installer.waitingForDownload') })
      },
      async () => {
        if (isCacheValid(cachePath, expectedSize)) {
          sendProgress('download', { percent: 100, status: t('installer.cachedDownload') })
        } else {
          sendProgress('download', { percent: 0, status: t('installer.startingDownload') })
          await download(
            url,
            cachePath,
            (p) => {
              const speed = `${p.speedMBs.toFixed(1)} MB/s`
              const elapsed = formatTime(p.elapsedSecs)
              const eta = p.etaSecs >= 0 ? formatTime(p.etaSecs) : '—'
              sendProgress('download', {
                percent: p.percent,
                status: t('installer.downloading', {
                  progress: `${p.receivedMB} / ${p.totalMB} MB  ·  ${speed}  ·  ${elapsed} elapsed  ·  ${eta} remaining`
                }),
                ...measuredProgress(p.speedMBs, p.etaSecs),
                payload: [
                  {
                    id: filename,
                    label: filename,
                    totalBytes: expectedSize,
                    receivedBytes: p.receivedBytes,
                    state: 'active'
                  }
                ]
              })
            },
            { signal, expectedSize }
          )
          cache.evict()
        }
        cache.touch(cacheKey)
      }
    )
  )

  sendProgress('extract', {
    percent: 0,
    status: t('installer.extracting', { progress: '' }).trim()
  })
  await withInstallPhase(onPhase, 'extract', () =>
    extract(
      cachePath,
      dest,
      (p) => {
        const elapsed = formatTime(p.elapsedSecs)
        const eta = p.etaSecs >= 0 ? formatTime(p.etaSecs) : '—'
        sendProgress('extract', {
          percent: p.percent,
          status: t('installer.extracting', {
            progress: `${p.percent}%  ·  ${elapsed} elapsed  ·  ${eta} remaining`
          }),
          ...measuredProgress(0, p.etaSecs)
        })
      },
      { signal }
    )
  )
}

export async function downloadAndExtractMulti(
  files: DownloadFile[],
  dest: string,
  cacheDir: string,
  ctx: InstallerContext
): Promise<void> {
  const { sendProgress, download, cache, extract, signal, onPhase } = ctx
  const cacheBase = cache.getCachePath(cacheDir)
  fs.mkdirSync(cacheBase, { recursive: true })

  const count = files.length
  const totalBytes = files.reduce((sum, f) => sum + (f.size || 0), 0)
  const totalMB = totalBytes > 0 ? (totalBytes / 1048576).toFixed(0) : null
  let completedBytes = 0
  let allCached = true
  const overallStart = Date.now()

  /** Snapshot every file as a payload row: settled ones before `activeIndex`
   *  are done, the active one carries its live byte count, the rest pend. */
  const payloadAt = (activeIndex: number, activeReceived: number): InstallPayloadItem[] =>
    files.map((f, i) => ({
      id: f.filename,
      label: f.filename,
      ...(f.size > 0 ? { totalBytes: f.size } : {}),
      receivedBytes: i < activeIndex ? f.size : i === activeIndex ? activeReceived : 0,
      state: i < activeIndex ? 'done' : i === activeIndex ? 'active' : 'pending'
    }))

  await withInstallPhase(onPhase, 'download', async () => {
    for (let i = 0; i < count; i++) {
      const file = files[i]!
      const fileCachePath = path.join(cacheBase, file.filename)
      const fileLabel = count > 1 ? ` (${i + 1}/${count})` : ''

      await withDownloadLock(
        fileCachePath,
        {
          signal,
          onWait: () =>
            sendProgress('download', { percent: 0, status: t('installer.waitingForDownload') })
        },
        async () => {
          if (isCacheValid(fileCachePath, file.size)) {
            completedBytes += file.size || 0
            const percent =
              totalBytes > 0
                ? Math.round((completedBytes / totalBytes) * 100)
                : Math.round(((i + 1) / count) * 100)
            sendProgress('download', {
              percent,
              status: `${t('installer.cachedDownload')}${fileLabel}`,
              payload: payloadAt(i + 1, 0)
            })
          } else {
            allCached = false
            const basePercent =
              totalBytes > 0
                ? Math.round((completedBytes / totalBytes) * 100)
                : Math.round((i / count) * 100)
            sendProgress('download', {
              percent: basePercent,
              status: `${t('installer.startingDownload')}${fileLabel}`,
              payload: payloadAt(i, 0)
            })
            await download(
              file.url,
              fileCachePath,
              (p) => {
                const speed = `${p.speedMBs.toFixed(1)} MB/s`
                const overallElapsed = (Date.now() - overallStart) / 1000
                const elapsed = formatTime(overallElapsed)
                const receivedTotal = completedBytes + p.receivedBytes
                const overallSpeed =
                  overallElapsed > 0 ? receivedTotal / 1048576 / overallElapsed : 0
                const remainingBytes = totalBytes - receivedTotal
                // Whole-set projection, not this file's: the user is waiting on
                // every part, so a per-file ETA would understate the wait.
                const etaSecs =
                  overallSpeed > 0 && totalBytes > 0
                    ? remainingBytes / BYTES_PER_MB / overallSpeed
                    : -1
                const eta = etaSecs >= 0 ? formatTime(etaSecs) : '—'
                const sizeDisplay = totalMB
                  ? `${(receivedTotal / 1048576).toFixed(0)} / ${totalMB} MB`
                  : `${p.receivedMB} / ${p.totalMB} MB`
                const percent =
                  totalBytes > 0
                    ? Math.round((receivedTotal / totalBytes) * 100)
                    : Math.round(((i + p.percent / 100) / count) * 100)
                sendProgress('download', {
                  percent,
                  status: t('installer.downloading', {
                    progress: `${fileLabel} ${sizeDisplay}  ·  ${speed}  ·  ${elapsed} elapsed  ·  ${eta} remaining`
                  }),
                  ...measuredProgress(overallSpeed, etaSecs),
                  payload: payloadAt(i, p.receivedBytes)
                })
              },
              { signal, expectedSize: file.size || undefined }
            )
            completedBytes += file.size || 0
          }
        }
      )
    }
  })

  cache.touch(cacheDir)
  if (!allCached) {
    cache.evict()
  }

  const firstFile = files[0]
  const extractFile =
    files.length === 1
      ? firstFile!.filename
      : ([...files]
          .sort((a, b) => a.filename.localeCompare(b.filename))
          .find((f) => /\.001$/.test(f.filename))?.filename ?? firstFile!.filename)
  const extractPath = path.join(cacheBase, extractFile)

  sendProgress('extract', {
    percent: 0,
    status: t('installer.extracting', { progress: '' }).trim()
  })
  await withInstallPhase(onPhase, 'extract', () =>
    extract(
      extractPath,
      dest,
      (p) => {
        const elapsed = formatTime(p.elapsedSecs)
        const eta = p.etaSecs >= 0 ? formatTime(p.etaSecs) : '—'
        sendProgress('extract', {
          percent: p.percent,
          status: t('installer.extracting', {
            progress: `${p.percent}%  ·  ${elapsed} elapsed  ·  ${eta} remaining`
          }),
          ...measuredProgress(0, p.etaSecs)
        })
      },
      { signal }
    )
  )
}
