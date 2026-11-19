import { ref } from 'vue'
import type { HomeTourAudience } from './homeTourSteps'

const audience = ref<HomeTourAudience>('new')
const done = ref(true)
const loaded = ref(false)
let loading: Promise<void> | null = null

async function readSetting(key: 'homeTourAudience' | 'homeTourDone'): Promise<unknown> {
  try {
    return await window.api.getSetting(key)
  } catch {
    return key === 'homeTourDone' ? true : undefined
  }
}

async function load(): Promise<void> {
  const [savedAudience, savedDone] = await Promise.all([
    readSetting('homeTourAudience'),
    readSetting('homeTourDone')
  ])
  const recorded = savedAudience === 'new' || savedAudience === 'updated'
  audience.value = savedAudience === 'updated' ? 'updated' : 'new'
  done.value = !recorded || savedDone === true
  loaded.value = true
}

async function finish(): Promise<void> {
  await loading
  done.value = true
  try {
    await window.api.setSetting('homeTourDone', true)
  } catch (err) {
    console.warn('[home-tour] could not save the tour state:', err)
  }
}

async function replay(): Promise<void> {
  await loading
  done.value = false
}

export function useHomeTour() {
  loading ??= load()
  return { audience, done, loaded, finish, replay }
}

export function __resetHomeTourForTest(): void {
  audience.value = 'new'
  done.value = true
  loaded.value = false
  loading = null
}
