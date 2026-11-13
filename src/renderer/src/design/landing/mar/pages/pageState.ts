import { computed, reactive, watch } from 'vue'
import { proto } from '../../useProto'

/**
 * Page state (UI Playground › Page state): every library page in Mar's
 * proposal can be shown Live (the mock data), Loading (skeletons), Empty
 * (first use, with the one action that fills it) or Error (offline).
 * `?pageState=loading` in the URL opens on one, for screenshots.
 */
export type PageState = 'live' | 'loading' | 'empty' | 'error'

export const PAGE_STATES: { value: PageState; label: string }[] = [
  { value: 'live', label: 'Live' },
  { value: 'loading', label: 'Loading' },
  { value: 'empty', label: 'Empty' },
  { value: 'error', label: 'Error' }
]

const KEY = 'comfy.design.mar.pageState'
const isState = (v: unknown): v is PageState =>
  v === 'live' || v === 'loading' || v === 'empty' || v === 'error'

export const pageState = reactive<{ id: PageState }>({
  id: (() => {
    try {
      const fromUrl = new URLSearchParams(location.search).get('pageState')
      if (isState(fromUrl)) return fromUrl
      const v = sessionStorage.getItem(KEY)
      return isState(v) ? v : 'live'
    } catch {
      return 'live'
    }
  })()
})

// Per window only: an Error picked yesterday shouldn't greet you today.
watch(
  () => pageState.id,
  (id) => {
    try {
      sessionStorage.setItem(KEY, id)
    } catch {
      // Storage blocked: the pick lasts until reload.
    }
  }
)

/** What a page shows. A first-time user (UI Playground › User, or
 *  Pablo's first run) has nothing yet, so every library is empty. */
const newUser = computed(() => (proto as { newUser?: boolean }).newUser ?? proto.fresh)
export const shownState = computed<PageState>(() =>
  pageState.id === 'live' && newUser.value ? 'empty' : pageState.id
)

/** Retry from the error state: a beat of skeletons, then the data. */
export function retry(): void {
  pageState.id = 'loading'
  setTimeout(() => (pageState.id = 'live'), 900)
}
