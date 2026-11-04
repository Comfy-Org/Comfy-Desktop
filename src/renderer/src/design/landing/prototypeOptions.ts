import { computed, type WritableComputedRef } from 'vue'
import { proto } from './useProto'
import { can, MILESTONES } from './milestones'
import { DIRECTIONS, look as designLook, THEMES, type Theme } from './look'
import { tuner } from './mar/uiTuner'
import { titleTabs, type TitleBarStyle } from './mar/shell/titleTabs'
import { marUser, setUser } from './mar/userStates/userState'

/**
 * The prototype's switches, shown in the Prototype panel (DevBar, browser
 * preview) and in the title bar's Prototype menu (app): the milestone, then
 * the scenario to look at it in.
 */
export interface PrototypeGroup {
  key: string
  label: string
  model: WritableComputedRef<string>
  options: { value: string; label: string }[]
}

/** Real data needs the app (window.api). */
export const liveAvailable = typeof window.api?.designListWorkflows === 'function'

const milestone = computed({
  get: () => String(proto.milestone),
  set: (v) => (proto.milestone = Number(v))
})
// The same switch as UI Playground › User.
const user = computed({
  get: () => (marUser.user === 'first' ? 'new' : 'returning'),
  set: (v) => setUser(v === 'new' ? 'first' : 'returning')
})
const data = computed({
  get: () => (proto.live ? 'mine' : 'mock'),
  set: (v) => (proto.live = v === 'mine')
})

// The theme being explored (look.ts, ui/looks/); the direction is picked
// in the tuner.
const theme = computed({
  get: () => designLook.theme,
  set: (v) => (designLook.theme = v as Theme)
})

// One row for the UI: it opens the tuner (mar/UiTuner.vue), where it is
// picked; nothing to keep checked.
const tune = computed({
  get: () => (tuner.open ? 'open' : ''),
  set: () => (tuner.open = true)
})
const tuneLabel = computed(
  () => `${DIRECTIONS.find((d) => d.value === designLook.direction)?.label ?? 'Graphite'} · Tune…`
)

// The breadcrumb or tabs (mar/shell/titleTabs.ts).
const titleBar = computed({
  get: () => titleTabs.style,
  set: (v) => (titleTabs.style = v as TitleBarStyle)
})

export const prototypeGroups = computed<PrototypeGroup[]>(() =>
  [
    { key: 'milestone', label: 'Milestone', model: milestone, options: MILESTONES },
    // Milestone 0 is Desktop as it ships: there is nothing to tune.
    can.value.design && {
      key: 'tune',
      label: 'UI Playground',
      model: tune,
      options: [{ value: 'open', label: tuneLabel.value }]
    },
    can.value.breadcrumb && {
      key: 'marTitle',
      label: 'Title bar',
      model: titleBar,
      options: [
        { value: 'breadcrumb', label: 'Breadcrumb' },
        { value: 'tabs', label: 'Tabs' }
      ]
    },
    { key: 'theme', label: 'Theme', model: theme, options: [...THEMES] },
    // First run vs returning only changes Home.
    can.value.home && {
      key: 'user',
      label: 'User',
      model: user,
      options: [
        { value: 'new', label: 'New' },
        { value: 'returning', label: 'Returning' }
      ]
    },
    liveAvailable && {
      key: 'data',
      label: 'Data',
      model: data,
      options: [
        { value: 'mock', label: 'Mock' },
        { value: 'mine', label: 'Mine' }
      ]
    }
  ].filter((g): g is PrototypeGroup => !!g)
)

/** Set one switch, e.g. from the title bar's Prototype menu. */
export function setPrototypeOption(key: string, value: string): void {
  const group = prototypeGroups.value.find((g) => g.key === key)
  if (group?.options.some((o) => o.value === value)) group.model.value = value
}
