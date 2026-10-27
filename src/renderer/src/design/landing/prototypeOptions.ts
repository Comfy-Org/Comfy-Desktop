import { computed, type WritableComputedRef } from 'vue'
import { proto } from './useProto'
import { can, MILESTONES } from './milestones'
import { appsProto, type LookVariant } from './appFlow'
import { DIRECTIONS, look as designLook, THEMES, type Direction, type Theme } from './look'

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
const user = computed({
  get: () => (proto.fresh ? 'new' : 'returning'),
  set: (v) => (proto.fresh = v === 'new')
})
const data = computed({
  get: () => (proto.live ? 'mine' : 'mock'),
  set: (v) => (proto.live = v === 'mine')
})

// The visual direction and theme being explored (look.ts, ui/looks/).
const direction = computed({
  get: () => designLook.direction,
  set: (v) => (designLook.direction = v as Direction)
})
const theme = computed({
  get: () => designLook.theme,
  set: (v) => (designLook.theme = v as Theme)
})

// Milestone 10: how the creator customizes the app's look.
const look = computed({
  get: () => appsProto.look,
  set: (v) => (appsProto.look = v as LookVariant)
})

export const prototypeGroups = computed<PrototypeGroup[]>(() =>
  [
    { key: 'milestone', label: 'Milestone', model: milestone, options: MILESTONES },
    { key: 'direction', label: 'Direction', model: direction, options: [...DIRECTIONS] },
    { key: 'theme', label: 'Theme', model: theme, options: [...THEMES] },
    can.value.agent && {
      key: 'look',
      label: 'Customize',
      model: look,
      options: [
        { value: 'panel', label: 'Style panel' },
        { value: 'themes', label: 'Themes' },
        { value: 'brand', label: 'Brand kit' },
        { value: 'describe', label: 'Describe it' }
      ]
    },
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
