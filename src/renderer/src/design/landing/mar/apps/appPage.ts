import { reactive, watch } from 'vue'
import { can } from '../../milestones'
import type { LibApp } from '../../appFlow'

/** How an app's page looks once it opens (UI Playground › App page): the
 *  Hub's full-screen editor (a panel with what you give it and Run, the
 *  result on the stage, Compare), or today's pages (the themed app in its
 *  tab, the app's page in Explore). */
export type AppPageLook = 'hub' | 'themed'

export const APP_PAGE_LOOKS: { value: AppPageLook; label: string }[] = [
  { value: 'hub', label: 'Hub editor · panel, stage and Compare' },
  { value: 'themed', label: "Today's · the themed app, Explore's app page" }
]

const KEY = 'comfy.design.mar.appPage'

export const appPage = reactive<{ id: AppPageLook }>({
  id: (() => {
    try {
      const v = localStorage.getItem(KEY)
      return APP_PAGE_LOOKS.some((l) => l.value === v) ? (v as AppPageLook) : 'hub'
    } catch {
      return 'hub'
    }
  })()
})

watch(
  () => appPage.id,
  (id) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      // Storage blocked: the pick lasts for this window only.
    }
  }
)

/** Explore opens an app that isn't yours in the Hub's editor, inside the
 *  shell. Your own apps keep their page with Access, Versions and API. */
export const onHubPage = (a: LibApp): boolean =>
  can.value.design && appPage.id === 'hub' && a.group !== 'yours'
