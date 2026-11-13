import { reactive, watch } from 'vue'

/** How the Builds page shows a build past the Builds milestone (UI
 *  Playground › Builds view). Milestone 1's one-line rows are the default;
 *  Photos stays for later. */
export type BuildCard = 'rows' | 'photos'

export const BUILD_CARDS: { value: BuildCard; label: string }[] = [
  { value: 'rows', label: 'Rows' },
  { value: 'photos', label: 'Photos' }
]

// v5: rows are the default, so an older stored look doesn't hide them.
const KEY = 'comfy.design.mar.buildCard.v5'

export const buildCard = reactive<{ id: BuildCard }>({
  id: (() => {
    try {
      const v = localStorage.getItem(KEY) as BuildCard | null
      return v && BUILD_CARDS.some((c) => c.value === v) ? v : 'rows'
    } catch {
      return 'rows'
    }
  })()
})

watch(
  () => buildCard.id,
  (id) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      // Storage blocked: the pick lasts for this window only.
    }
  }
)
