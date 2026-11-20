import { ref } from 'vue'
import type { HomeTourAudience } from './homeTourSteps'

const audience = ref<HomeTourAudience>('new')
const done = ref(true)
const loaded = ref(false)
let savedDone = true
let loading: Promise<void> | null = null

async function readSetting(key: 'homeTourAudience' | 'homeTourDone'): Promise<unknown> {
  try {
    return await window.api.getSetting(key)
  } catch {
    return key === 'homeTourDone' ? true : undefined
  }
}

async function readReplayPending(): Promise<boolean> {
  try {
    return (await window.api.getHomeTourReplay()) === true
  } catch {
    return false
  }
}

function listenForReplay(): void {
  try {
    window.api.onHomeTourReplayChanged((pending) => {
      done.value = pending ? false : savedDone
    })
  } catch {}
}

async function load(): Promise<void> {
  listenForReplay()
  const [savedAudience, savedDoneSetting, replayPending] = await Promise.all([
    readSetting('homeTourAudience'),
    readSetting('homeTourDone'),
    readReplayPending()
  ])
  const recorded = savedAudience === 'new' || savedAudience === 'updated'
  audience.value = savedAudience === 'updated' ? 'updated' : 'new'
  savedDone = !recorded || savedDoneSetting === true
  done.value = replayPending ? false : savedDone
  loaded.value = true
}

async function setReplayPending(pending: boolean): Promise<void> {
  try {
    await window.api.setHomeTourReplay(pending)
  } catch (err) {
    console.warn('[home-tour] could not share the replay request:', err)
  }
}

async function finish(): Promise<void> {
  await loading
  savedDone = true
  done.value = true
  try {
    await window.api.setSetting('homeTourDone', true)
  } catch (err) {
    console.warn('[home-tour] could not save the tour state:', err)
  }
  await setReplayPending(false)
}

async function replay(): Promise<void> {
  await loading
  done.value = false
  await setReplayPending(true)
}

export function useHomeTour() {
  loading ??= load()
  return { audience, done, loaded, finish, replay }
}

export function __resetHomeTourForTest(): void {
  audience.value = 'new'
  done.value = true
  loaded.value = false
  savedDone = true
  loading = null
}
