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

const later = (ms: number, fn: () => void): void => void setTimeout(fn, ms)

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
  // A local build's tab, which shows Mar's graph editor.
  graph: () => {
    const local = instances.value.find((i) => i.kind === 'local')
    if (local) hostActions.launch(local, 'Portrait relight')
  }
}
