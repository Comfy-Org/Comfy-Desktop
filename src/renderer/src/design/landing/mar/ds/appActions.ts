import { TEMPLATES } from '../../mock'
import { deployEnv, instances, openDetail } from '../../useProto'
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

const later = (ms: number, fn: () => void): void => void setTimeout(fn, ms)

/** Opens the search, types `text`, then presses ↓ `down` times. */
function searchFor(text = '', down = 0): () => void {
  return () => {
    search.open = true
    later(250, () => {
      const input = document.querySelector<HTMLInputElement>('.mar-search input')
      if (!input || !text) return
      input.value = text
      input.dispatchEvent(new Event('input', { bubbles: true }))
      for (let i = 0; i < down; i++)
        later(150 * (i + 1), () =>
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
        )
    })
  }
}

export const APP_ACTIONS: Record<AppAction, () => void> = {
  template: () => openDetail('template', TEMPLATES[0]!.id),
  deploy: () => {
    const local = instances.value.find((i) => i.kind === 'local' && !i.deployment)
    if (local) deployEnv(local.id)
  },
  search: searchFor(),
  'search-typed': searchFor('product'),
  'search-keys': searchFor('product', 3),
  'search-none': searchFor('zzqx')
}
