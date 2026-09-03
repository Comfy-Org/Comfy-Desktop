import { useAssetPrefetch, type AssetLoader } from './useAssetPrefetch'

/**
 * Warms image URLs into the browser HTTP cache during idle time so a later
 * `<img>` renders instantly. Thin wrapper over `useAssetPrefetch` with an
 * `Image()` loader; the queue/idle/busy/network machinery lives in the core.
 */

interface PrefetchOptions {
  /** Returns true when something more important is running; prefetch defers. */
  isBusy?: () => boolean
  /** Max concurrent image fetches. */
  concurrency?: number
  /** Idle-callback deadline (ms) so a never-idle main thread still drains. */
  idleTimeoutMs?: number
}

/** Warm one image; `done` frees the slot on load or error, the canceller
 *  detaches handlers so a still-loading image's closure can be GC'd. */
const loadImage: AssetLoader = (url, done) => {
  const img = new Image()
  const settle = (): void => {
    img.onload = null
    img.onerror = null
    done()
  }
  img.onload = settle
  img.onerror = settle
  img.src = url
  return () => {
    img.onload = null
    img.onerror = null
  }
}

export function useThumbnailPrefetch(options: PrefetchOptions = {}): {
  prefetch: (urls: readonly (string | null | undefined)[]) => void
} {
  return useAssetPrefetch(loadImage, options)
}
