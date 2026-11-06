import type { ViewKind } from '../viewKind'

export type TargetKind = 'dashboard' | 'instance' | 'cloud' | 'new-instance'

export type TargetRun = 'stopped' | 'running-elsewhere' | 'self'

export type Intent = 'primary' | 'new-window'

export type Verb = 'switch' | 'restart' | 'open-new' | 'focus' | 'no-op' | 'install-wizard'

export const NAV_LABEL = {
  start: 'instancePicker.open',
  restart: 'instancePicker.restart',
  switch: 'instancePicker.switch',
  openDashboard: 'instancePicker.openDashboard',
  openCloud: 'instancePicker.openCloud',
  openInNewWindow: 'instancePicker.openInNewWindow',
  newInstall: 'instancePicker.newInstance'
} as const
export type NavLabelKey = (typeof NAV_LABEL)[keyof typeof NAV_LABEL]

export interface NavDecision {
  readonly window: 'same' | 'new'
  readonly verb: Verb
  readonly primaryLabel: NavLabelKey
  readonly secondary: readonly NavDecision[]
  readonly allowDuplicate?: true
}

export interface NavInput {
  currentView: ViewKind
  target: TargetKind
  targetRun: TargetRun
  intent: Intent
}

type CellKey = `${ViewKind}|${TargetKind}|${TargetRun}`
const cellKey = (view: ViewKind, target: TargetKind, run: TargetRun): CellKey =>
  `${view}|${target}|${run}`

const NO_OP: NavDecision = Object.freeze({
  window: 'same',
  verb: 'no-op',
  primaryLabel: NAV_LABEL.start,
  secondary: []
})

const dec = (
  over: Partial<NavDecision> & Pick<NavDecision, 'window' | 'verb' | 'primaryLabel'>
): NavDecision =>
  Object.freeze({
    ...over,
    secondary: Object.freeze(over.secondary ?? [])
  })

const OPEN_NEW_WINDOW_SECONDARY: NavDecision = dec({
  window: 'new',
  verb: 'open-new',
  primaryLabel: NAV_LABEL.openInNewWindow
})

const TABLE: ReadonlyMap<CellKey, NavDecision> = new Map<CellKey, NavDecision>([
  [cellKey('dashboard', 'dashboard', 'self'), NO_OP],
  [
    cellKey('dashboard', 'instance', 'stopped'),
    dec({ window: 'same', verb: 'switch', primaryLabel: NAV_LABEL.start })
  ],
  [
    cellKey('dashboard', 'instance', 'running-elsewhere'),
    dec({ window: 'same', verb: 'focus', primaryLabel: NAV_LABEL.switch })
  ],
  [
    cellKey('dashboard', 'cloud', 'stopped'),
    dec({
      window: 'same',
      verb: 'switch',
      primaryLabel: NAV_LABEL.openCloud,
      secondary: [OPEN_NEW_WINDOW_SECONDARY]
    })
  ],
  [
    cellKey('dashboard', 'cloud', 'running-elsewhere'),
    dec({
      window: 'same',
      verb: 'focus',
      primaryLabel: NAV_LABEL.switch,
      secondary: [OPEN_NEW_WINDOW_SECONDARY]
    })
  ],
  [
    cellKey('dashboard', 'new-instance', 'stopped'),
    dec({ window: 'same', verb: 'install-wizard', primaryLabel: NAV_LABEL.newInstall })
  ],

  [
    cellKey('instance', 'dashboard', 'self'),
    dec({ window: 'new', verb: 'open-new', primaryLabel: NAV_LABEL.openDashboard })
  ],
  [
    cellKey('instance', 'instance', 'self'),
    dec({ window: 'same', verb: 'restart', primaryLabel: NAV_LABEL.restart })
  ],
  [
    cellKey('instance', 'instance', 'stopped'),
    dec({
      window: 'same',
      verb: 'switch',
      primaryLabel: NAV_LABEL.switch,
      secondary: [OPEN_NEW_WINDOW_SECONDARY]
    })
  ],
  [
    cellKey('instance', 'instance', 'running-elsewhere'),
    dec({ window: 'same', verb: 'focus', primaryLabel: NAV_LABEL.switch })
  ],
  [
    cellKey('instance', 'cloud', 'stopped'),
    dec({ window: 'new', verb: 'open-new', primaryLabel: NAV_LABEL.openCloud })
  ],
  [
    cellKey('instance', 'cloud', 'running-elsewhere'),
    dec({
      window: 'same',
      verb: 'focus',
      primaryLabel: NAV_LABEL.switch,
      secondary: [OPEN_NEW_WINDOW_SECONDARY]
    })
  ],

  [
    cellKey('cloud', 'dashboard', 'self'),
    dec({ window: 'new', verb: 'open-new', primaryLabel: NAV_LABEL.openDashboard })
  ],
  [
    cellKey('cloud', 'instance', 'stopped'),
    dec({ window: 'new', verb: 'open-new', primaryLabel: NAV_LABEL.openInNewWindow })
  ],
  [
    cellKey('cloud', 'instance', 'running-elsewhere'),
    dec({ window: 'same', verb: 'focus', primaryLabel: NAV_LABEL.switch })
  ],
  [
    cellKey('cloud', 'cloud', 'self'),
    dec({ window: 'same', verb: 'restart', primaryLabel: NAV_LABEL.restart })
  ],
  [
    cellKey('cloud', 'cloud', 'running-elsewhere'),
    dec({ window: 'same', verb: 'focus', primaryLabel: NAV_LABEL.switch })
  ],
  [
    cellKey('cloud', 'cloud', 'stopped'),
    dec({ window: 'new', verb: 'open-new', primaryLabel: NAV_LABEL.openInNewWindow })
  ],
  [
    cellKey('cloud', 'new-instance', 'stopped'),
    dec({ window: 'new', verb: 'install-wizard', primaryLabel: NAV_LABEL.newInstall })
  ]
])

export function decideNavigation(input: NavInput): NavDecision {
  const primary = TABLE.get(cellKey(input.currentView, input.target, input.targetRun)) ?? NO_OP

  if (input.intent === 'new-window') {
    const alt = primary.secondary.find((s) => s.window === 'new')
    return alt ?? primary
  }
  return primary
}
