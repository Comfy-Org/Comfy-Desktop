import { getCurrentInstance, onMounted, readonly, ref } from 'vue'

// Boot-time distributions-visibility switch for the Comfy Builder distribution
// UI. Loaded once per process (shared `loadPromise`), no mid-session refresh.
// Fails OPEN to `true`: the distributions UI shipped unflagged before this
// switch existed, so a missing preload bridge or a fetch miss must never
// accidentally hide it.
const enabled = ref(true)
let loadPromise: Promise<void> | null = null

// Resolves the flag bridge from `window.api`. Returns null when it's absent
// (e.g. the title-bar popup preload, which never exposes distribution UI) so
// the caller fails open instead of throwing.
interface DistributionsEnabledSource {
  getDistributionsEnabled: () => Promise<unknown>
}
function resolveSource(): DistributionsEnabledSource | null {
  const w = window as unknown as {
    api?: { getDistributionsEnabled?: () => Promise<unknown> }
  }
  if (w.api && typeof w.api.getDistributionsEnabled === 'function') {
    return w.api as DistributionsEnabledSource
  }
  return null
}

function ensureLoaded(): Promise<void> {
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    const source = resolveSource()
    if (!source) return
    const result = await source.getDistributionsEnabled().catch(() => undefined)
    if (typeof result === 'boolean') enabled.value = result
  })()
  return loadPromise
}

export function useDistributionsEnabled(): {
  enabled: Readonly<typeof enabled>
  isEnabled: () => boolean
  /** Resolves once the boot fetch settles; never rejects. */
  whenReady: () => Promise<void>
} {
  if (getCurrentInstance()) {
    onMounted(() => {
      void ensureLoaded()
    })
  } else {
    void ensureLoaded()
  }

  return {
    enabled: readonly(enabled) as Readonly<typeof enabled>,
    isEnabled: () => enabled.value,
    whenReady: ensureLoaded,
  }
}
