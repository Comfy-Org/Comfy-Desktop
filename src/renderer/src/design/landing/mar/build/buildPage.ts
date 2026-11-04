import { reactive, watch } from 'vue'

/** How a build's page is laid out in the Builds milestone (UI Playground ›
 *  Build page), until one is decided. Production keeps today's Desktop
 *  tabs (About, Update, Snapshots, Settings); Overview is Ben's testing
 *  proposal: About and Update in one tab that leads with being up to date. */
export type BuildPage = 'production' | 'overview'

export const BUILD_PAGES: { value: BuildPage; label: string }[] = [
  { value: 'production', label: 'Production tabs · About, Update, Snapshots, Settings' },
  { value: 'overview', label: 'Overview first · Overview, Snapshots, Settings' }
]

const KEY = 'comfy.design.mar.buildPage'

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
