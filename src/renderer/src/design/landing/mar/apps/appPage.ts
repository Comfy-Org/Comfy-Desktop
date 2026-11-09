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

/** Where an app's examples sit on its page (UI Playground › App examples):
 *  as the Gallery, a tab beside your Creations over the stage; on the top
 *  line of the stage, over the picture's room; or at the top of the panel,
 *  before what you give it. */
export type AppExamplesAt = 'tabs' | 'stage' | 'panel'

export const APP_EXAMPLES_AT: { value: AppExamplesAt; label: string }[] = [
  { value: 'tabs', label: 'Tabs · Creations and Gallery over the stage' },
  { value: 'stage', label: 'Stage · on the top line of the picture' },
  { value: 'panel', label: 'Panel · at the top, before the fields' }
]

const AT_KEY = 'comfy.design.mar.appExamplesAt'

export const appExamplesAt = reactive<{ id: AppExamplesAt }>({
  id: (() => {
    try {
      const v = localStorage.getItem(AT_KEY)
      return APP_EXAMPLES_AT.some((l) => l.value === v) ? (v as AppExamplesAt) : 'tabs'
    } catch {
      return 'tabs'
    }
  })()
})

watch(
  () => appExamplesAt.id,
  (id) => {
    try {
      localStorage.setItem(AT_KEY, id)
    } catch {
      // Storage blocked: the pick lasts for this window only.
    }
  }
)
