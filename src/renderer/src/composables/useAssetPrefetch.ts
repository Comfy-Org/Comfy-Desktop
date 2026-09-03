import { onScopeDispose } from 'vue'

/**
 * Idle-time URL warmer: pulls URLs into the HTTP cache while idle so a later
 * element renders/plays without a cold fetch, deferring under `isBusy()` or a
 * metered link. The transport is pluggable via `loader`, so the queue/idle/busy
 * machinery is shared by `useThumbnailPrefetch` and `useMediaPrefetch`.
 */

/** Starts one warm for `url`, calls `done` when it settles, returns a canceller. */
export type AssetLoader = (url: string, done: () => void) => () => void

interface AssetPrefetchOptions {
  /** Returns true when something more important is running; prefetch defers. */
  isBusy?: () => boolean
  /** Max concurrent warms. */
  concurrency?: number
  /** Idle-callback deadline (ms) so a never-idle main thread still drains. */
  idleTimeoutMs?: number
}

type IdleHandle = number
interface IdleWindow {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => IdleHandle
  cancelIdleCallback?: (handle: IdleHandle) => void
}

/** `setTimeout` delay when `requestIdleCallback` is absent — yield a few frames. */
const FALLBACK_DELAY_MS = 50

/** Schedule on the idle queue (or a low-priority timeout); returns a canceller. */
function scheduleIdle(fn: () => void, timeoutMs: number): () => void {
  const w = window as unknown as IdleWindow
  if (typeof w.requestIdleCallback === 'function') {
    const handle = w.requestIdleCallback(fn, { timeout: timeoutMs })
    return () => w.cancelIdleCallback?.(handle)
  }
  const id = window.setTimeout(fn, FALLBACK_DELAY_MS)
  return () => window.clearTimeout(id)
}

/** Skip speculative fetching on an explicit data-saver or 2g connection. */
function shouldSkipForNetwork(): boolean {
  const conn = (
    navigator as unknown as {
      connection?: { saveData?: boolean; effectiveType?: string }
    }
  ).connection
  if (!conn) return false
  if (conn.saveData) return true
  return conn.effectiveType === '2g' || conn.effectiveType === 'slow-2g'
}

export function useAssetPrefetch(
  loader: AssetLoader,
  options: AssetPrefetchOptions = {}
): { prefetch: (urls: readonly (string | null | undefined)[]) => void } {
  const { isBusy = () => false, concurrency = 3, idleTimeoutMs = 3000 } = options

  /** Re-check delay for the busy gate, so a sustained install doesn't busy-spin. */
  const BUSY_BACKOFF_MS = 1500

  const queue: string[] = []
  const seen = new Set<string>()
  const cancellers = new Set<() => void>()
  const loaderCancellers = new Set<() => void>()
  // Reserved when work is scheduled, not when it runs, so pump enforces concurrency.
  let inFlight = 0
  let disposed = false

  function pump(): void {
    if (disposed || queue.length === 0) return
    // Defer past important work rather than compete for the network now.
    if (isBusy()) {
      const id = window.setTimeout(() => {
        cancellers.delete(cancel)
        pump()
      }, BUSY_BACKOFF_MS)
      const cancel = (): void => window.clearTimeout(id)
      cancellers.add(cancel)
      return
    }
    while (inFlight < concurrency && queue.length > 0) {
      const url = queue.shift()!
      inFlight++
      const cancel = scheduleIdle(() => {
        cancellers.delete(cancel)
        if (!disposed) load(url)
      }, idleTimeoutMs)
      cancellers.add(cancel)
    }
  }

  function load(url: string): void {
    let settled = false
    // Initialised to a no-op so a loader that calls `done` synchronously (before
    // it returns its real canceller) never hits `cancel` in its temporal dead
    // zone; the real canceller replaces this once `loader` returns.
    let cancel: () => void = () => {}
    const done = (): void => {
      if (settled) return
      settled = true
      loaderCancellers.delete(cancel)
      inFlight--
      if (!disposed) pump()
    }
    cancel = loader(url, done)
    // A synchronous settle already ran `done` above; don't register a stale canceller.
    if (!settled) loaderCancellers.add(cancel)
  }

  function prefetch(urls: readonly (string | null | undefined)[]): void {
    if (disposed || shouldSkipForNetwork()) return
    for (const url of urls) {
      if (!url || seen.has(url)) continue
      seen.add(url)
      queue.push(url)
    }
    pump()
  }

  onScopeDispose(() => {
    disposed = true
    queue.length = 0
    for (const cancel of cancellers) cancel()
    cancellers.clear()
    // Abort in-flight warms so their closures can be GC'd immediately.
    for (const cancel of loaderCancellers) cancel()
    loaderCancellers.clear()
  })

  return { prefetch }
}
