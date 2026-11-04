import { reactive, watch } from 'vue'

/** How a build looks on the Builds grid (UI Playground › Build card), until
 *  one is decided. None but Photos carries a picture; each says where the
 *  build runs in the words of the page's filter: This computer, Cloud. */
export type BuildCard = 'split' | 'tile' | 'strip' | 'where' | 'mark' | 'grouped' | 'photos'

export const BUILD_CARDS: { value: BuildCard; label: string }[] = [
  { value: 'tile', label: 'Where as a tile' },
  { value: 'split', label: 'One action, where in its words' },
  { value: 'strip', label: 'Where as a strip' },
  { value: 'where', label: 'Where on top · the fewest facts' },
  { value: 'mark', label: 'Where as a mark · keeps the specs' },
  { value: 'grouped', label: 'Grouped by where · hardware once' },
  { value: 'photos', label: 'Photos · the default' }
]

// v4: past milestone 1 the cards keep their photos until decided, so an
// older stored look doesn't hide them.
const KEY = 'comfy.design.mar.buildCard.v4'

export const buildCard = reactive<{ id: BuildCard }>({
  id: (() => {
    try {
      const v = localStorage.getItem(KEY) as BuildCard | null
      return v && BUILD_CARDS.some((c) => c.value === v) ? v : 'photos'
    } catch {
      return 'photos'
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
