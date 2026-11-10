import { ref } from 'vue'

const firstUseCompleted = ref<boolean>(false)
const loaded = ref(false)
let loadPromise: Promise<void> | null = null

export function seedLauncherPrefsFromUrl(search: string): void {
  const value = new URLSearchParams(search).get('firstUseCompleted')
  if (value !== 'true' && value !== 'false') return
  firstUseCompleted.value = value === 'true'
  loaded.value = true
}

export function useLauncherPrefs() {
  async function loadPrefs(): Promise<void> {
    if (loadPromise) return loadPromise
    loadPromise = (async () => {
      const firstUse = await (window.api.getSetting('firstUseCompleted') as Promise<
        boolean | undefined
      >)
      firstUseCompleted.value = firstUse === true
      loaded.value = true
    })()
    return loadPromise
  }

  async function markFirstUseCompleted(): Promise<void> {
    if (firstUseCompleted.value) return
    firstUseCompleted.value = true
    await window.api.setSetting('firstUseCompleted', true)
  }

  return {
    firstUseCompleted,
    loaded,
    loadPrefs,
    markFirstUseCompleted
  }
}

export function __resetLauncherPrefsForTest(): void {
  loadPromise = null
  loaded.value = false
  firstUseCompleted.value = false
}
