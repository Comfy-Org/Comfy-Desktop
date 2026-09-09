import { defineStore } from 'pinia'
import { computed, reactive } from 'vue'
import type { ModelDownloadProgress, Unsubscribe } from '../types/ipc'
import {
  emitTelemetryAction,
  isTerminalModelDownloadStatus,
  toFileExtension,
  toModelDirectoryBucket,
  toSizeBucket
} from '../lib/telemetry'

export const useDownloadStore = defineStore('downloads', () => {
  // Rows keyed by the download's stable job id, falling back to its URL for
  // rows from mains that predate ids.
  const downloads = reactive(new Map<string, ModelDownloadProgress>())
  // Active main-process subscriptions; also gates the idempotent `init()`.
  const unsubs: Unsubscribe[] = []

  function rowKey(progress: ModelDownloadProgress): string {
    return progress.id ?? progress.url
  }

  /** Drop the row addressed by `ref` (job id or URL). Falls back to scanning
   *  for a URL match so removal broadcasts that only carry a URL still drop
   *  id-keyed rows. */
  function removeByRef(ref: string): void {
    if (downloads.delete(ref)) return
    for (const [key, d] of downloads) {
      if (d.url === ref || d.id === ref) {
        downloads.delete(key)
        return
      }
    }
  }

  function upsert(progress: ModelDownloadProgress, opts: { isSeed?: boolean } = {}): void {
    const previous = downloads.get(rowKey(progress))
    downloads.set(rowKey(progress), { ...progress })

    // `isSeed` suppresses telemetry on the initial replay so already-fired events aren't double-counted.
    if (opts.isSeed) return

    // Emit `started` on the first live sighting of a non-terminal download.
    if (!previous && !isTerminalModelDownloadStatus(progress.status)) {
      emitTelemetryAction('comfy.desktop.model_download.started', {
        directory_bucket: toModelDirectoryBucket(progress.directory),
        file_ext: toFileExtension(progress.filename),
        size_bucket: toSizeBucket(progress.totalBytes)
      })
    }

    if (
      isTerminalModelDownloadStatus(progress.status) &&
      (!previous || previous.status !== progress.status)
    ) {
      emitTelemetryAction('comfy.desktop.model_download.result', {
        result: progress.status,
        directory_bucket: toModelDirectoryBucket(progress.directory),
        file_ext: toFileExtension(progress.filename),
        size_bucket: toSizeBucket(progress.totalBytes)
      })
    }
  }

  function init(): void {
    if (unsubs.length > 0) return

    // Seed with in-flight + recently-finished downloads so surfaces are non-empty on first paint. `isSeed` suppresses telemetry.
    window.api.listModelDownloads().then((list) => {
      for (const p of list) upsert(p, { isSeed: true })
    })

    // Source of truth lives in main so dismissals propagate across every surface (popup ↔ Settings tab).
    unsubs.push(
      window.api.onModelDownloadProgress((p) => upsert(p)),
      window.api.onModelDownloadRemoved(({ url, id }) => {
        removeByRef(id ?? url)
      }),
      window.api.onModelDownloadsClearedFinished(({ urls, refs }) => {
        for (const ref of refs ?? urls) removeByRef(ref)
      })
    )
  }

  // Routes through main; local state updates via the `model-download-removed` listener, not here, so surfaces stay in lockstep.
  function dismiss(ref: string): void {
    void window.api.dismissModelDownload(ref)
  }

  function clearFinished(): void {
    void window.api.clearFinishedModelDownloads()
  }

  const activeDownloads = computed(() => {
    const result: ModelDownloadProgress[] = []
    downloads.forEach((d) => {
      if (d.status === 'pending' || d.status === 'downloading' || d.status === 'paused') {
        result.push(d)
      }
    })
    return result
  })

  const finishedDownloads = computed(() => {
    const result: ModelDownloadProgress[] = []
    downloads.forEach((d) => {
      if (d.status === 'completed' || d.status === 'error' || d.status === 'cancelled') {
        result.push(d)
      }
    })
    return result
  })

  const hasDownloads = computed(() => downloads.size > 0)

  return {
    downloads,
    init,
    upsert,
    dismiss,
    clearFinished,
    activeDownloads,
    finishedDownloads,
    hasDownloads
  }
})
