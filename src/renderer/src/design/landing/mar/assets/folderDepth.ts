import { reactive, watch } from 'vue'

/** UI Playground › Folders (ComfyUI's Assets tab): the demo's few folders,
 *  or Deep, a client tree eight levels down with siblings on the way, to
 *  see the sidebar and the title when folders nest a lot. */
export type FolderDepth = 'few' | 'deep'

export const FOLDER_DEPTHS: { value: FolderDepth; label: string }[] = [
  { value: 'few', label: 'Few' },
  { value: 'deep', label: 'Deep' }
]

const KEY = 'comfy.design.mar.folderDepth'

export const folderDepth = reactive<{ id: FolderDepth }>({
  id: (() => {
    try {
      return localStorage.getItem(KEY) === 'deep' ? 'deep' : 'few'
    } catch {
      return 'few'
    }
  })()
})

watch(
  () => folderDepth.id,
  (id) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      // Storage blocked: the pick lasts for this window only.
    }
  }
)
