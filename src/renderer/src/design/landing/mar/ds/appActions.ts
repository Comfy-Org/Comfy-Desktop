import { TEMPLATES } from '../../mock'
import { deployEnv, hostActions, instances, openDetail } from '../../useProto'
import { search } from '../search/search'

/**
 * What an app shot does once it is up (kit/AppShot.vue): open a modal or
 * the search the way the app would, then type or press keys in it.
 */
export type AppAction =
  | 'template'
  | 'deploy'
  | 'search'
  | 'search-typed'
  | 'search-keys'
  | 'search-none'
  | 'search-scoped'
  | 'search-tab'
  | 'search-empty-keys'
  | 'graph'
  | 'template-graph'
  | 'template-needs'
  | 'asset'
  | 'asset-video'
  | 'asset-zoom'
  | 'asset-zoom-menu'
  | 'asset-more'
  | 'assets-filters'
  | 'assets-layout'
  | 'assets-select'
  | 'explore-filters'
  | 'explore-filter-rows'

const later = (ms: number, fn: () => void): void => void setTimeout(fn, ms)
const $ = <T extends HTMLElement = HTMLElement>(sel: string): T | null =>
  document.querySelector<T>(sel)

/** Opens a menu from its trigger, as a click does (Reka opens on click). */
const press = (el: HTMLElement | null): void => el?.click()
/** Opens the submenu on `row` from the keyboard (→), as Reka allows. */
function openSub(row: HTMLElement | undefined): void {
  row?.focus()
  row?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
}
const rowNamed = (text: string): HTMLElement | undefined =>
  [...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')].find((el) =>
    el.textContent?.includes(text)
  )

/** The page's Filters field (Explore's has no name of its own). */
const filtersButton = (): HTMLElement | null =>
  [...document.querySelectorAll<HTMLElement>('.mar-page button[aria-haspopup="menu"]')].find((b) =>
    b.textContent?.trim().startsWith('Filters')
  ) ?? null

/** Picks one of the page's tabs by its name. */
const exploreTab = (name: string): void =>
  [...document.querySelectorAll<HTMLElement>('.mar-page button')]
    .find((b) => b.textContent?.trim().startsWith(name))
    ?.click()

/** Opens an Assets card the way a click does: the first whose name ends
 *  in `ext` (a picture, a clip). */
function openAsset(ext: string): void {
  const card = [...document.querySelectorAll<HTMLElement>('.mar-item')].find((el) =>
    el.querySelector('.mar-item-name')?.textContent?.trim().endsWith(ext)
  )
  card?.click()
}

/** Opens the search, types each of `texts` in turn (a `\t` presses Tab,
 *  which moves to the next scope), then presses ↓ `down` times. */
function searchFor(texts: string[] = [], down = 0): () => void {
  return () => {
    search.open = true
    const steps: (() => void)[] = []
    const field = (): HTMLInputElement | null =>
      document.querySelector<HTMLInputElement>('.mar-search input')
    const key = (k: string): void =>
      void field()?.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
    for (const text of texts)
      steps.push(() => {
        const input = field()
        if (!input) return
        if (text === '\t') return key('Tab')
        input.value += text
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    for (let i = 0; i < down; i++) steps.push(() => key('ArrowDown'))
    steps.forEach((step, i) => later(250 + 150 * i, step))
  }
}

export const APP_ACTIONS: Record<AppAction, () => void> = {
  template: () => openDetail('template', TEMPLATES[0]!.id),
  deploy: () => {
    const local = instances.value.find((i) => i.kind === 'local' && !i.deployment)
    if (local) deployEnv(local.id)
  },
  search: searchFor(),
  'search-typed': searchFor(['pro']),
  'search-keys': searchFor(['pro'], 2),
  'search-none': searchFor(['zzqx']),
  'search-scoped': searchFor(['\t', '\t', 're']),
  'search-tab': searchFor(['pro', '\t']),
  'search-empty-keys': searchFor([], 6),
  // The workflow modal on its graph, and with What it needs unfolded.
  'template-graph': () => {
    openDetail('template', TEMPLATES[0]!.id)
    later(500, () =>
      $(
        '.mar-tpl-views [role="radio"]:nth-of-type(2), .mar-tpl-views button:nth-of-type(2)'
      )?.click()
    )
  },
  'template-needs': () => {
    openDetail('template', TEMPLATES[0]!.id)
    later(500, () => {
      const box = $<HTMLDetailsElement>('.mar-tpl-needs-box')
      if (box) box.open = true
    })
  },
  // The asset view (on Assets): a picture, a clip, zoomed in to the
  // stage's edges, the zoom's menu, More.
  asset: () => openAsset('.png'),
  'asset-video': () => openAsset('.mp4'),
  'asset-zoom': () => {
    openAsset('.png')
    for (const ms of [500, 650, 800])
      later(ms, () =>
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: '=', metaKey: true, ctrlKey: true })
        )
      )
  },
  'asset-zoom-menu': () => {
    openAsset('.png')
    later(500, () => $('.mad .zc-pct')?.click())
  },
  'asset-more': () => {
    openAsset('.png')
    later(500, () => $('.mad-head-more')?.click())
  },
  // Assets' toolbar: Filters with a type on (the badge, Clear filters
  // last), Layout with Sort by open, two cards picked (the selection bar).
  'assets-filters': () => {
    press($('button[aria-label="Filters"]'))
    later(300, () => openSub(rowNamed('More types')))
    later(600, () => $('[role="menu"] [role="menuitemcheckbox"]')?.click())
  },
  'assets-layout': () => {
    press($('button[aria-label="Layout"]'))
    later(300, () => openSub(rowNamed('Sort by')))
  },
  'assets-select': () => {
    const checks = document.querySelectorAll<HTMLElement>('.mar-item-check')
    checks[0]?.click()
    later(100, () => checks[2]?.click())
  },
  // Explore's Workflows: Filters as rows with values, then one row's list
  // open (Use case, Model, Runs on).
  'explore-filters': () => {
    exploreTab('Workflows')
    later(400, () => press(filtersButton()))
  },
  'explore-filter-rows': () => {
    exploreTab('Workflows')
    later(400, () => press(filtersButton()))
    later(700, () => openSub(rowNamed('Model')))
  },
  // A local build's tab, which shows Mar's graph editor.
  graph: () => {
    const local = instances.value.find((i) => i.kind === 'local')
    if (local) hostActions.launch(local, 'Portrait relight')
  }
}
