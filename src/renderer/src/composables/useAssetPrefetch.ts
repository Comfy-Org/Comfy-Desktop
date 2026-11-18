import { onScopeDispose } from 'vue'

export type AssetLoader = (url: string, done: () => void) => () => void

interface AssetPrefetchOptions {
  isBusy?: () => boolean
  concurrency?: number
  idleTimeoutMs?: number
}

type IdleHandle = number
interface IdleWindow {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => IdleHandle
  cancelIdleCallback?: (handle: IdleHandle) => void
}

const FALLBACK_DELAY_MS = 50

function scheduleIdle(fn: () => void, timeoutMs: number): () => void {
  const w = window as unknown as IdleWindow
  if (typeof w.requestIdleCallback === 'function') {
    const handle = w.requestIdleCallback(fn, { timeout: timeoutMs })
    return () => w.cancelIdleCallback?.(handle)
  }
  const id = window.setTimeout(fn, FALLBACK_DELAY_MS)
  return () => window.clearTimeout(id)
}

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

  const BUSY_BACKOFF_MS = 1500

  const queue: string[] = []
  const seen = new Set<string>()
  const cancellers = new Set<() => void>()
  const loaderCancellers = new Set<() => void>()
  let inFlight = 0
  let disposed = false

  function pump(): void {
    if (disposed || queue.length === 0) return
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
    let cancel: () => void = () => {}
    const done = (): void => {
      if (settled) return
      settled = true
      loaderCancellers.delete(cancel)
      inFlight--
      if (!disposed) pump()
    }
    cancel = loader(url, done)
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
    for (const cancel of loaderCancellers) cancel()
    loaderCancellers.clear()
  })

  return { prefetch }
}
