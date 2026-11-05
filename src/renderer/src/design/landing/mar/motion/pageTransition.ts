import { nextTick, watch } from 'vue'
import { proto } from '../../useProto'
import { appsProto } from '../../appFlow'
import { playPageIn, type PageTransition } from './pageIn'

/**
 * Page transition: how a page comes in when the sidebar, a breadcrumb, a
 * back link or ⌘K changes `proto.page`. Fade and rise, decided Nov 1. The old
 * page goes at once (no exit, no blank frame); only the new page's content
 * moves. The sidebar, the title bar, the floating panels and the backdrop
 * stay still. Played with the Web Animations API so a new click cancels the
 * running one instead of stacking. Every switch also starts the new page at
 * the top.
 *
 * Values are the --mar-page-* tokens in motion.css; reduced motion turns it
 * into a short fade.
 */

export type { PageTransition }

export const pageTransition: { id: PageTransition } = { id: 'rise' }

document.documentElement.dataset.marPageTx = pageTransition.id

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
    if (!page || page === before) return
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
