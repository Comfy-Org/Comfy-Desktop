import { reactive, watch } from 'vue'

/** How a build's page is laid out in the Builds milestone (UI Playground ›
 *  Build page). Desktop's tabs, the default, are the ones Desktop ships
 *  (Update, Startup Args, Snapshots, Storage, Terminal, About); Overview
 *  first, Ben's earlier proposal, puts About and Update in one tab. */
export type BuildPage = 'production' | 'overview'

export const BUILD_PAGES: { value: BuildPage; label: string }[] = [
  { value: 'production', label: 'Desktop’s tabs · the default' },
  { value: 'overview', label: 'Overview first' }
]

const KEY = 'comfy.design.mar.buildPage.v3'

export const buildPage = reactive<{ id: BuildPage }>({
  id: (() => {
    try {
      const v = localStorage.getItem(KEY) as BuildPage | null
      return v && BUILD_PAGES.some((c) => c.value === v) ? v : 'production'
    } catch {
      return 'production'
    }
  })()
})

watch(
  () => buildPage.id,
  (id) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      // Storage blocked: the pick lasts for this window only.
    }
  }
)
