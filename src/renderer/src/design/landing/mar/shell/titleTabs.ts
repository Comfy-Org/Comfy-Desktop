import { computed, reactive, watch } from 'vue'
import { can } from '../../milestones'

/**
 * Mar's title bar (Prototype menu › Title bar), Tabs by default; Pablo's
 * breadcrumb stays one pick away. Tabs: the bar holds only tabs, like Figma - Home as
 * an icon, one tab per open workflow and app - plus where things run and
 * the agent on the right. The lens switch keeps Create and Build, both
 * named; the agent leaves it.
 */

export type TitleBarStyle = 'breadcrumb' | 'tabs'

// v2: Tabs became the default (an open workflow stays in view on Home);
// a breadcrumb saved before that doesn't carry over.
const KEY = 'comfy.design.mar.titleBar.v2'

function load(): TitleBarStyle {
  try {
    return localStorage.getItem(KEY) === 'breadcrumb' ? 'breadcrumb' : 'tabs'
  } catch {
    return 'tabs'
  }
}

export const titleTabs = reactive<{ style: TitleBarStyle }>({ style: load() })

watch(
  () => titleTabs.style,
  (style) => {
    try {
      localStorage.setItem(KEY, style)
    } catch {
      // Storage blocked: the pick lasts for this window only.
    }
  }
)

/** The tabs title bar is on: picked (the default), in the milestones with
 *  the new design; earlier ones keep the breadcrumb as it ships. */
export const marTabsOn = computed(
  () => can.value.breadcrumb && can.value.design && titleTabs.style === 'tabs'
)
