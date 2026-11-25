import { reactive, watch } from 'vue'

/** UI Playground › Folder picker (Desktop's Assets page). In Filters is
 *  the proposal: the folder sits with the other filters, one menu for
 *  everything that narrows the wall. Its own pill is what the Better
 *  Asset Management review settled on: the folder reads as where you
 *  are, not as a filter, so it stands beside the build picker with a
 *  divider before the type tabs, and leaves Filters. */
export type FolderPicker = 'filters' | 'pill'

export const FOLDER_PICKERS: { value: FolderPicker; label: string }[] = [
  { value: 'filters', label: 'In Filters' },
  { value: 'pill', label: 'Its own pill' }
]

const KEY = 'comfy.design.mar.folderPicker'

export const folderPicker = reactive<{ id: FolderPicker }>({
  id: (() => {
    try {
      return localStorage.getItem(KEY) === 'pill' ? 'pill' : 'filters'
    } catch {
      return 'filters'
    }
  })()
})

watch(
  () => folderPicker.id,
  (id) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      // Storage blocked: the pick lasts for this window only.
    }
  }
)
