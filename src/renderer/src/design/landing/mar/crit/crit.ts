import { computed, reactive, watch, type Directive } from 'vue'
import { isMariana } from '../proposal'
import './crit.css'

/**
 * Crit feedback · Oct 29 (UI Playground): the Weekly Design Crit's notes,
 * all at once, to compare with the proposal as it is. Off changes nothing.
 * On sets `data-mar-crit='on'` on <html>, which scopes crit.css:
 * 1. a scroll fade on Recently used instead of a hard edge,
 * 2. full-row, contained hover on the sidebar groups,
 * 3. solid cards on the page (glass only on floating layers),
 * 4. a check and a hairline for a menu's current pick, not a raised tile,
 * 5. the graph's queue: the running run is not "queued", one spinner.
 */
export type Crit = 'off' | 'on'

export const CRITS: { value: Crit; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'on', label: 'On' }
]

const KEY = 'comfy.design.mar.crit'

export const crit = reactive<{ id: Crit }>({
  id: (() => {
    try {
      return localStorage.getItem(KEY) === 'on' ? 'on' : 'off'
    } catch {
      return 'off'
    }
  })()
})

/** The crit's changes are on screen (Mar's proposal only). */
export const critOn = computed(() => isMariana.value && crit.id === 'on')

watch(
  () => crit.id,
  (id) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      // Storage blocked: the pick lasts for this window only.
    }
  }
)

watch(
  critOn,
  (on) => {
    if (on) document.documentElement.dataset.marCrit = 'on'
    else delete document.documentElement.dataset.marCrit
  },
  { immediate: true }
)

/** Marks which ends of a horizontal scroller have more to see
 *  (`data-fade`: start, end or both), so crit.css can fade only those.
 *  Harmless while the crit is off: nothing reads the attribute. */
const fades = new WeakMap<HTMLElement, () => void>()
function mark(el: HTMLElement): void {
  const start = el.scrollLeft > 1
  const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
  el.dataset.fade = start && end ? 'both' : start ? 'start' : end ? 'end' : 'none'
}
export const vScrollFade: Directive<HTMLElement> = {
  mounted(el) {
    const update = (): void => mark(el)
    const ro = new ResizeObserver(update)
    ro.observe(el)
    el.addEventListener('scroll', update, { passive: true })
    fades.set(el, () => {
      ro.disconnect()
      el.removeEventListener('scroll', update)
    })
    update()
  },
  updated: mark,
  unmounted(el) {
    fades.get(el)?.()
    fades.delete(el)
  }
}
