import { watch } from 'vue'
import { can } from '../../milestones'

/**
 * Sliding tab indicator for Mar's proposal: in every tab group (reka
 * toggle groups, and `.mar-seg` button rows), one pill sits behind the
 * picked option and slides to the next one instead of the background
 * jumping. Milestone 0 is left alone.
 *
 * Groups are found as they appear (MutationObserver), so pages and panels
 * that mount later get the indicator too.
 */

// Every segmented control, whatever it's built from, with no opt-in: reka
// toggle groups, `.mar-seg` / `.mar-pseg` rows, role=tablist rows (page
// tabs, Explore, Favorites, template and deploy modals) and role=radiogroup
// rows (the Create / Build switch, Grid / List views). Not the ones that
// aren't segmented: the banner and carousel dots (`data-no-pill`) and
// underline tabs (`.mar-proj-tabs`), which have their own indicator.
const GROUPS = [
  "[role='group']:has(> button[data-state])",
  '.mar-seg',
  '.mar-pseg',
  "[role='tablist']:has(> button[aria-selected])",
  "[role='radiogroup']:has(> button[aria-checked])"
]
  .map((g) => `:is(${g}):not([data-no-pill], .mar-proj-tabs)`)
  .join(', ')
const PICKED =
  "button[data-state='on'], button[aria-pressed='true'], button[aria-selected='true'], button[aria-checked='true']"

function place(group: HTMLElement): void {
  let pill = group.querySelector<HTMLElement>(':scope > .mar-tab-pill')
  const all = group.querySelectorAll<HTMLElement>(`:scope > :is(${PICKED})`)
  // None picked, or several (a multi-select row): no pill to slide.
  const picked = all.length === 1 ? all[0] : null
  if (!picked) {
    pill?.remove()
    return
  }
  if (!pill) {
    pill = document.createElement('span')
    pill.className = 'mar-tab-pill'
    pill.setAttribute('aria-hidden', 'true')
    group.prepend(pill)
    // First placement: no slide from the corner.
    pill.style.transition = 'none'
  }
  pill.style.width = `${picked.offsetWidth}px`
  pill.style.height = `${picked.offsetHeight}px`
  // The pill takes the picked option's own corners: round in a round
  // track, soft in a soft one, so it never sits square in a pill.
  const own = getComputedStyle(picked).borderRadius
  const track = getComputedStyle(pill.parentElement!).borderRadius
  pill.style.borderRadius = parseFloat(own) > 0 ? own : parseFloat(track) >= 99 ? '999px' : ''
  pill.style.transform = `translate(${picked.offsetLeft}px, ${picked.offsetTop}px)`
  if (pill.style.transition === 'none') {
    void pill.offsetWidth
    pill.style.transition = ''
  }
}

function scan(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>(GROUPS).forEach((g) => {
    g.dataset.marTabs = 'on'
    place(g)
  })
}

let observer: MutationObserver | undefined
const onResize = (): void => scan()

// Off at Milestone 0: Desktop as it ships keeps its own tabs.
watch(
  () => can.value.design,
  (on) => {
    if (on && !observer) {
      observer = new MutationObserver(() => requestAnimationFrame(() => scan()))
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['data-state', 'aria-pressed', 'aria-selected', 'aria-checked']
      })
      window.addEventListener('resize', onResize)
      requestAnimationFrame(() => scan())
    } else if (!on && observer) {
      observer.disconnect()
      observer = undefined
      window.removeEventListener('resize', onResize)
      document.querySelectorAll('.mar-tab-pill').forEach((p) => p.remove())
      document.querySelectorAll<HTMLElement>('[data-mar-tabs]').forEach((g) => {
        delete g.dataset.marTabs
      })
    }
  },
  { immediate: true }
)
