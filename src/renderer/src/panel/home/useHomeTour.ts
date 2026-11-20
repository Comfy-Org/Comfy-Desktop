import { ref } from 'vue'
import type { HomeTourAudience } from './homeTourSteps'

const audience = ref<HomeTourAudience>('new')
const done = ref(true)
const loaded = ref(false)
const replays = ref(0)
let audienceRecorded = false
let savedDone = true
let replayHeardWhileLoading: boolean | null = null
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

async function rereadSavedDone(): Promise<void> {
  savedDone = !audienceRecorded || (await readSetting('homeTourDone')) === true
  done.value = savedDone
}

function onReplayChanged(pending: boolean): void {
  if (!loaded.value) replayHeardWhileLoading = pending
  if (pending) {
    replays.value += 1
    done.value = false
    return
  }
  void rereadSavedDone()
}

function listenForReplay(): void {
  try {
    window.api.onHomeTourReplayChanged(onReplayChanged)
  } catch (err) {
    console.warn('[home-tour] could not listen for replay requests:', err)
  }
}

async function load(): Promise<void> {
  listenForReplay()
  const [savedAudience, savedDoneSetting, replayPendingAtLoad] = await Promise.all([
    readSetting('homeTourAudience'),
    readSetting('homeTourDone'),
    readReplayPending()
  ])
  audienceRecorded = savedAudience === 'new' || savedAudience === 'updated'
  audience.value = savedAudience === 'updated' ? 'updated' : 'new'
  savedDone = !audienceRecorded || savedDoneSetting === true
  const replayPending = replayHeardWhileLoading ?? replayPendingAtLoad
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
  replays.value += 1
  done.value = false
  await setReplayPending(true)
}

export function useHomeTour() {
  loading ??= load()
  return { audience, done, loaded, replays, finish, replay }
}

export function __resetHomeTourForTest(): void {
  audience.value = 'new'
  done.value = true
  loaded.value = false
  replays.value = 0
  audienceRecorded = false
  savedDone = true
  replayHeardWhileLoading = null
  loading = null
}
