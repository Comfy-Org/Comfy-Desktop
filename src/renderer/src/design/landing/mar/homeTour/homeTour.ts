import { computed, reactive, watch } from 'vue'
import { firstTime } from '../userStates/userState'
import type { HomeTourAudience } from './homeTourSteps'

export type HomeTourMode = 'auto' | 'off'

export const HOME_TOUR_MODES: { value: HomeTourMode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'off', label: 'Off' }
]

const KEY = 'comfy.design.mar.homeTour'

interface Saved {
  id: HomeTourMode
  done: Record<HomeTourAudience, boolean>
}

function load(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return {
      id: v.id === 'off' ? 'off' : 'auto',
      done: { new: v.done?.new === true, updated: v.done?.updated === true }
    }
  } catch {
    return { id: 'auto', done: { new: false, updated: false } }
  }
}

export const homeTour = reactive({ ...load(), replays: 0 })

watch(
  () => ({ id: homeTour.id, done: { ...homeTour.done } }),
  (v) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(v))
    } catch {
      return
    }
  }
)

export const homeTourAudience = computed<HomeTourAudience>(() =>
  firstTime.value ? 'new' : 'updated'
)

export const homeTourDone = computed(
  () => homeTour.id === 'off' || homeTour.done[homeTourAudience.value]
)

export function finishHomeTour(): void {
  homeTour.done[homeTourAudience.value] = true
}

export function replayHomeTour(): void {
  homeTour.id = 'auto'
  homeTour.done[homeTourAudience.value] = false
  homeTour.replays += 1
}
