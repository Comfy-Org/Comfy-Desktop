import { reactive, watch } from 'vue'

/** How a first-time Home offers the node editor, under the examples
 *  (UI Playground › Node editor entry): today's two rows, two cards with a
 *  node graph, one split card with Cloud recommended, compact cards with a
 *  mini canvas, or one wide card with a where-to-run switch. */
export type EditorEntry = 'rows' | 'graph' | 'split' | 'canvas' | 'banner'

export const EDITOR_ENTRIES: { value: EditorEntry; label: string }[] = [
  { value: 'rows', label: 'Rows · two flat rows (today)' },
  { value: 'graph', label: 'Graph · two cards with a node graph' },
  { value: 'split', label: 'Split · Cloud recommended, this computer beside' },
  { value: 'canvas', label: 'Canvas · compact cards with a mini canvas' },
  { value: 'banner', label: 'Banner · one card, pick where it runs' }
]

const KEY = 'comfy.design.mar.editorEntry'

export const editorEntry = reactive<{ id: EditorEntry }>({
  id: (() => {
    try {
      const v = localStorage.getItem(KEY)
      return EDITOR_ENTRIES.some((e) => e.value === v) ? (v as EditorEntry) : 'rows'
    } catch {
      return 'rows'
    }
  })()
})

watch(
  () => editorEntry.id,
  (id) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      // Storage blocked: the pick lasts for this window only.
    }
  }
)
