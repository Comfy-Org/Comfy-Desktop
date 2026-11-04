import { reactive, watch } from 'vue'

/** How a build looks on the Builds grid (UI Playground › Build card), until
 *  one is decided. None but Photos carries a picture; each says where the
 *  build runs in the words of the page's filter: This computer, Cloud. */
export type BuildCard = 'strip' | 'where' | 'mark' | 'grouped' | 'photos'

export const BUILD_CARDS: { value: BuildCard; label: string }[] = [
  { value: 'strip', label: 'Where as a strip · the pick' },
  { value: 'where', label: 'Where on top · the fewest facts' },
  { value: 'mark', label: 'Where as a mark · keeps the specs' },
  { value: 'grouped', label: 'Grouped by where · hardware once' },
  { value: 'photos', label: 'Photos (before)' }
]

// v2: the strip is the pick, so an older stored look doesn't hide it.
const KEY = 'comfy.design.mar.buildCard.v2'

export const buildCard = reactive<{ id: BuildCard }>({
  id: (() => {
    try {
      const v = localStorage.getItem(KEY) as BuildCard | null
      return v && BUILD_CARDS.some((c) => c.value === v) ? v : 'strip'
    } catch {
      return 'strip'
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
