import { onScopeDispose } from 'vue'

/**
 * Warms image URLs into the browser HTTP cache during idle time so a later
 * `<img>` renders instantly; defers entirely while `isBusy()` or on a metered
 * link, so it never competes with real work on a low-spec machine.
 */

interface PrefetchOptions {
  /** Returns true when something more important is running; prefetch defers. */
  isBusy?: () => boolean
  /** Max concurrent image fetches. */
  concurrency?: number
  /** Idle-callback deadline (ms) so a never-idle main thread still drains. */
  idleTimeoutMs?: number
}

type IdleHandle = number
interface IdleWindow {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => IdleHandle
  cancelIdleCallback?: (handle: IdleHandle) => void
}

/** Delay (ms) for the `setTimeout` fallback when `requestIdleCallback` is absent.
 *  A few frames — enough to yield to interactive work without forcing the full
 *  idle deadline (which is a max, not a delay). */
const FALLBACK_DELAY_MS = 50

/** Schedule on the idle queue, falling back to a low-priority timeout. Returns a
 *  canceller so callers don't branch on which path ran. */
function scheduleIdle(fn: () => void, timeoutMs: number): () => void {
  const w = window as unknown as IdleWindow
  if (typeof w.requestIdleCallback === 'function') {
    const handle = w.requestIdleCallback(fn, { timeout: timeoutMs })
    return () => w.cancelIdleCallback?.(handle)
  }
  const id = window.setTimeout(fn, FALLBACK_DELAY_MS)
  return () => window.clearTimeout(id)
}

/** True on a metered / very slow connection where speculative fetching would
 *  hurt more than help. Conservative: only bails on explicit data-saver or 2g. */
function shouldSkipForNetwork(): boolean {
  const conn = (navigator as unknown as {
    connection?: { saveData?: boolean; effectiveType?: string }
  }).connection
  if (!conn) return false
  if (conn.saveData) return true
  return conn.effectiveType === '2g' || conn.effectiveType === 'slow-2g'
}

export function useThumbnailPrefetch(options: PrefetchOptions = {}): {
  prefetch: (urls: readonly (string | null | undefined)[]) => void
} {
  const { isBusy = () => false, concurrency = 3, idleTimeoutMs = 3000 } = options

  /** How long to wait before re-checking the busy gate, so a sustained
   *  install/launch doesn't busy-spin the idle queue. */
  const BUSY_BACKOFF_MS = 1500

  const queue: string[] = []
  const seen = new Set<string>()
  const cancellers = new Set<() => void>()
  const inFlightImages = new Set<HTMLImageElement>()
  let inFlight = 0
  let disposed = false

  function pump(): void {
    if (disposed || queue.length === 0) return
    // Important work wins: back off (timer, not idle) and re-check later rather
    // than competing for the network/CPU now.
    if (isBusy()) {
      const id = window.setTimeout(() => { cancellers.delete(cancel); pump() }, BUSY_BACKOFF_MS)
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
    const img = new Image()
    inFlightImages.add(img)
    const done = (): void => {
      img.onload = null
      img.onerror = null
      inFlightImages.delete(img)
      inFlight--
      if (!disposed) pump()
    }
    img.onload = done
    img.onerror = done
    img.src = url
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
    // Detach handlers on still-loading images so their closures can be GC'd
    // without waiting for the request to settle.
    for (const img of inFlightImages) { img.onload = null; img.onerror = null }
    inFlightImages.clear()
  })

  return { prefetch }
}
