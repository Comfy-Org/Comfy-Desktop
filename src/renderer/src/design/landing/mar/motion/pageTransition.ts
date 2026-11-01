import { nextTick, reactive, watch } from 'vue'
import { proto } from '../../useProto'
import { appsProto } from '../../appFlow'
import { isMariana } from '../proposal'
import { playPageIn, type PageTransition } from './pageIn'

/**
 * Page transition (UI Playground › Global › Page transition): how a page
 * comes in when the sidebar, a breadcrumb, a back link or ⌘K changes
 * `proto.page`. The old page goes at once (no exit, no blank frame); only
 * the new page's content moves. The sidebar, the title bar, the floating
 * panels and the backdrop stay still. Played with the Web Animations API so
 * a new click cancels the running one instead of stacking. Every switch
 * also starts the new page at the top. Mar's proposal only.
 *
 *   Off      the page swaps in place (the old behaviour)
 *   Fade     opacity only
 *   Rise     fade and a short rise of the whole page
 *   Stagger  the header first, then each section a beat later
 *
 * Values are the --mar-page-* tokens in motion.css; reduced motion turns
 * every option into a short fade.
 */

export const PAGE_TRANSITIONS: { value: PageTransition; label: string }[] = [
  { value: 'off', label: 'Off · swaps in place' },
  { value: 'fade', label: 'Fade' },
  { value: 'rise', label: 'Fade and rise' },
  { value: 'stagger', label: 'Stagger · header, then sections' }
]

export type { PageTransition }

const KEY = 'comfy.design.mar.pageTransition'

export const pageTransition = reactive<{ id: PageTransition }>({
  id: (() => {
    try {
      const v = localStorage.getItem(KEY)
      return PAGE_TRANSITIONS.some((t) => t.value === v) ? (v as PageTransition) : 'off'
    } catch {
      return 'off'
    }
  })()
})

watch(
  () => pageTransition.id,
  (id) => {
    // Set only while a transition is on: Home's own entry steps aside.
    if (id === 'off') delete document.documentElement.dataset.marPageTx
    else document.documentElement.dataset.marPageTx = id
    try {
      localStorage.setItem(KEY, id)
    } catch {
      // Storage blocked: the pick lasts for this window only.
    }
  },
  { immediate: true }
)

/** The new page's own elements in the content area: not the backdrop or
 *  the panels drawn over it (absolute, fixed or sticky). */
function pageElements(main: HTMLElement): HTMLElement[] {
  return [...main.children].filter(
    (c): c is HTMLElement =>
      c instanceof HTMLElement &&
      !c.classList.contains('mar-backdrop') &&
      ['static', 'relative'].includes(getComputedStyle(c).position)
  )
}

// What's on view in the app shell: a page, or nothing (a graph or an app
// in front). Coming back to the shell counts as a page change.
const onView = (): string | undefined =>
  proto.activeTab === 'home' && !appsProto.front ? proto.page : undefined

let running: Animation[] = []
let turn = 0
watch(
  onView,
  async (page, before) => {
    if (!isMariana.value || !page || page === before) return
    // A click while the last page is still coming in: stop it where it is.
    running.forEach((a) => a.cancel())
    running = []
    const mine = ++turn
    await nextTick()
    if (mine !== turn) return
    const main = document.querySelector<HTMLElement>('.proto-shell > .proto-main')
    if (!main) return
    main.scrollTop = 0
    running = playPageIn(pageElements(main), pageTransition.id)
  },
  { flush: 'post' }
)
