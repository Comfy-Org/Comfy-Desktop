import { reactive, watch } from 'vue'

/** How a build's page is laid out in the Builds milestone (UI Playground ›
 *  Build page), until one is decided. Production keeps today's Desktop
 *  tabs (About, Update, Snapshots, Settings); Overview, Ben's proposal and
 *  the default: About and Update in one tab that leads with being up to date. */
export type BuildPage = 'production' | 'overview'

export const BUILD_PAGES: { value: BuildPage; label: string }[] = [
  { value: 'production', label: 'Production tabs · About, Update, Snapshots, Settings' },
  { value: 'overview', label: 'Overview first · the default' }
]

const KEY = 'comfy.design.mar.buildPage.v2'

export const buildPage = reactive<{ id: BuildPage }>({
  id: (() => {
    try {
      const v = localStorage.getItem(KEY) as BuildPage | null
      return v && BUILD_PAGES.some((c) => c.value === v) ? v : 'overview'
    } catch {
      return 'overview'
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
