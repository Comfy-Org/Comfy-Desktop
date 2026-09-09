import { useAssetPrefetch, type AssetLoader } from './useAssetPrefetch'

/**
 * Warms media URLs into the browser HTTP cache during idle time so a later
 * `<video>` plays without a cold fetch. Wraps `useAssetPrefetch` with a
 * `<video>` loader: a cross-origin `fetch()` is CSP-blocked here, but a media
 * element load isn't and fills the same cache the modal's `<video>` reuses.
 */

interface MediaPrefetchOptions {
  /** Returns true when something more important is running; prefetch defers. */
  isBusy?: () => boolean
  /** Max concurrent warms. Media files are large; default 1. */
  concurrency?: number
  /** Idle-callback deadline (ms) so a never-idle main thread still drains. */
  idleTimeoutMs?: number
}

/** Warm one URL with a detached `<video preload="auto">`; resolve on
 *  `loadeddata` or `error`, releasing the element either way. */
const loadMedia: AssetLoader = (url, done) => {
  const v = document.createElement('video')
  v.muted = true
  v.preload = 'auto'
  v.src = url
  let settled = false
  const settle = (): void => {
    if (settled) return
    settled = true
    v.removeEventListener('loadeddata', settle)
    v.removeEventListener('error', settle)
    v.removeAttribute('src')
    v.load()
    done()
  }
  v.addEventListener('loadeddata', settle)
  v.addEventListener('error', settle)
  return settle
}

export function useMediaPrefetch(options: MediaPrefetchOptions = {}): {
  prefetch: (urls: readonly (string | null | undefined)[]) => void
} {
  return useAssetPrefetch(loadMedia, { concurrency: 1, ...options })
}
