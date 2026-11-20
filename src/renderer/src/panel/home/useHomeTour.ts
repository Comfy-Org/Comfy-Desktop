import { ref } from 'vue'
import type { HomeTourAudience } from './homeTourSteps'
import type { HomeTourReplayState } from '../../types/ipc'

const audience = ref<HomeTourAudience>('new')
const done = ref(true)
const loaded = ref(false)
const replays = ref(0)
let savedDone = true
let pendingReplayId: number | null = null
let shownReplayId: number | null = null
let heardWhileLoading: HomeTourReplayState | null = null
let loading: Promise<void> | null = null

async function readSetting(key: 'homeTourAudience' | 'homeTourDone'): Promise<unknown> {
  try {
    return await window.api.getSetting(key)
  } catch {
    return key === 'homeTourDone' ? true : undefined
  }
}

async function readReplay(): Promise<HomeTourReplayState> {
  try {
    return { ...(await window.api.getHomeTourReplay()), finished: false }
  } catch {
    return { id: 0, pending: false, finished: false }
  }
}

function applyReplay(state: HomeTourReplayState): void {
  if (state.pending && state.id !== pendingReplayId) replays.value += 1
  pendingReplayId = state.pending ? state.id : null
  if (state.finished) savedDone = true
  done.value = state.pending ? false : savedDone
}

function onReplayChanged(state: HomeTourReplayState): void {
  if (!loaded.value) {
    heardWhileLoading = state
    return
  }
  applyReplay(state)
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
  const [savedAudience, savedDoneSetting, replayAtLoad] = await Promise.all([
    readSetting('homeTourAudience'),
    readSetting('homeTourDone'),
    readReplay()
  ])
  const audienceRecorded = savedAudience === 'new' || savedAudience === 'updated'
  audience.value = savedAudience === 'updated' ? 'updated' : 'new'
  savedDone = !audienceRecorded || savedDoneSetting === true
  pendingReplayId = replayAtLoad.pending ? replayAtLoad.id : null
  done.value = replayAtLoad.pending ? false : savedDone
  loaded.value = true
  if (heardWhileLoading) applyReplay(heardWhileLoading)
  heardWhileLoading = null
}

function markShown(): void {
  shownReplayId = pendingReplayId
}

async function finish(): Promise<void> {
  await loading
  const replayId = shownReplayId
  shownReplayId = null
  savedDone = true
  done.value = true
  try {
    await window.api.setSetting('homeTourDone', true)
  } catch (err) {
    console.warn('[home-tour] could not save the tour state:', err)
  }
  try {
    await window.api.finishHomeTour(replayId)
  } catch (err) {
    console.warn('[home-tour] could not share the finished tour:', err)
  }
}

async function replay(): Promise<void> {
  await loading
  replays.value += 1
  done.value = false
  try {
    pendingReplayId = await window.api.requestHomeTourReplay()
  } catch (err) {
    console.warn('[home-tour] could not share the replay request:', err)
  }
}

export function useHomeTour() {
  loading ??= load()
  return { audience, done, loaded, replays, finish, replay, markShown }
}

export function __resetHomeTourForTest(): void {
  audience.value = 'new'
  done.value = true
  loaded.value = false
  replays.value = 0
  savedDone = true
  pendingReplayId = null
  shownReplayId = null
  heardWhileLoading = null
  loading = null
}
