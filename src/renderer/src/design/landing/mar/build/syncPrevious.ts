import { computed, reactive, watch } from 'vue'
import { buildsAsM1 } from './buildsAsM1'

/** UI Playground › Sync with previous versions. Off by default. On, the
 *  versions after Builds keep what the Builds milestone can do: a Settings
 *  page for each build (Desktop's tabs), the list's problem states and
 *  Remote builds. The Builds milestone itself never changes. */
export type SyncPrevious = 'off' | 'on'

const KEY = 'comfy.design.mar.syncPrevious'

export const syncPrevious = reactive<{ id: SyncPrevious }>({
  id: (() => {
    try {
      return localStorage.getItem(KEY) === 'on' ? 'on' : 'off'
    } catch {
      return 'off'
    }
  })()
})

watch(
  () => syncPrevious.id,
  (id) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      // Storage blocked: the pick lasts for this window only.
    }
  }
)

/** On, and past the Builds milestone. */
export const syncing = computed(() => syncPrevious.id === 'on' && !buildsAsM1.value)
