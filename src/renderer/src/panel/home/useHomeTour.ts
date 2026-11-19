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
  audience.value = savedAudience === 'updated' ? 'updated' : 'new'
  done.value = savedDone === true
  loaded.value = true
}

async function saveDone(value: boolean): Promise<void> {
  await loading
  done.value = value
  try {
    await window.api.setSetting('homeTourDone', value)
  } catch (err) {
    console.warn('[home-tour] could not save the tour state:', err)
  }
}

function finish(): Promise<void> {
  return saveDone(true)
}

function replay(): Promise<void> {
  return saveDone(false)
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
