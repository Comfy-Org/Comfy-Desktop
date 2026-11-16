import type { ViewKind } from '../viewKind'

export type TargetKind = 'dashboard' | 'instance' | 'cloud' | 'new-instance'

export type TargetRun = 'stopped' | 'running-elsewhere' | 'self' | 'starting-unhosted'

export type Verb = 'start' | 'restart' | 'open-new' | 'focus' | 'no-op' | 'install-wizard'

export const NAV_LABEL = {
  start: 'instancePicker.open',
  restart: 'instancePicker.restart',
  switch: 'instancePicker.switch',
  openDashboard: 'instancePicker.openDashboard',
  openCloud: 'instancePicker.openCloud',
  newInstall: 'instancePicker.newInstance'
} as const
export type NavLabelKey = (typeof NAV_LABEL)[keyof typeof NAV_LABEL]

export interface NavDecision {
  readonly verb: Verb
  readonly primaryLabel: NavLabelKey
}

export interface NavInput {
  currentView: ViewKind
  target: TargetKind
  targetRun: TargetRun
}

type CellKey = `${ViewKind}|${TargetKind}|${TargetRun}`
const cellKey = (view: ViewKind, target: TargetKind, run: TargetRun): CellKey =>
  `${view}|${target}|${run}`

const dec = (verb: Verb, primaryLabel: NavLabelKey): NavDecision =>
  Object.freeze({ verb, primaryLabel })

const NO_OP = dec('no-op', NAV_LABEL.start)

const TABLE: ReadonlyMap<CellKey, NavDecision> = new Map<CellKey, NavDecision>([
  [cellKey('dashboard', 'dashboard', 'self'), NO_OP],
  [cellKey('dashboard', 'instance', 'stopped'), dec('start', NAV_LABEL.start)],
  [cellKey('dashboard', 'instance', 'running-elsewhere'), dec('focus', NAV_LABEL.switch)],
  [cellKey('dashboard', 'instance', 'starting-unhosted'), dec('restart', NAV_LABEL.restart)],
  [cellKey('dashboard', 'cloud', 'stopped'), dec('start', NAV_LABEL.openCloud)],
  [cellKey('dashboard', 'cloud', 'running-elsewhere'), dec('focus', NAV_LABEL.switch)],
  [cellKey('dashboard', 'new-instance', 'stopped'), dec('install-wizard', NAV_LABEL.newInstall)],

  [cellKey('instance', 'dashboard', 'self'), dec('open-new', NAV_LABEL.openDashboard)],
  [cellKey('instance', 'instance', 'self'), dec('restart', NAV_LABEL.restart)],
  [cellKey('instance', 'instance', 'stopped'), dec('open-new', NAV_LABEL.start)],
  [cellKey('instance', 'instance', 'running-elsewhere'), dec('focus', NAV_LABEL.switch)],
  [cellKey('instance', 'cloud', 'stopped'), dec('open-new', NAV_LABEL.openCloud)],
  [cellKey('instance', 'cloud', 'running-elsewhere'), dec('focus', NAV_LABEL.switch)],

  [cellKey('cloud', 'dashboard', 'self'), dec('open-new', NAV_LABEL.openDashboard)],
  [cellKey('cloud', 'instance', 'stopped'), dec('open-new', NAV_LABEL.start)],
  [cellKey('cloud', 'instance', 'running-elsewhere'), dec('focus', NAV_LABEL.switch)],
  [cellKey('cloud', 'cloud', 'self'), dec('restart', NAV_LABEL.restart)],
  [cellKey('cloud', 'cloud', 'running-elsewhere'), dec('focus', NAV_LABEL.switch)],
  [cellKey('cloud', 'cloud', 'stopped'), dec('open-new', NAV_LABEL.openCloud)],
  [cellKey('cloud', 'new-instance', 'stopped'), dec('install-wizard', NAV_LABEL.newInstall)]
])

export function decideNavigation(input: NavInput): NavDecision {
  const exact = TABLE.get(cellKey(input.currentView, input.target, input.targetRun))
  if (exact) return exact
  if (input.targetRun === 'starting-unhosted') {
    return TABLE.get(cellKey(input.currentView, input.target, 'running-elsewhere')) ?? NO_OP
  }
  return NO_OP
}
