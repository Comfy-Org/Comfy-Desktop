/**
 * Pure, total decision table for the #926 navigation matrix — single source of
 * truth, run identically in renderer and main. Keyed by `ViewKind × TargetKind ×
 * TargetRun`; a missing cell falls through to `NO_OP`. `remote` is folded into
 * `cloud` upstream (see `navClass`), so there are no `remote` cells.
 */
import type { ViewKind } from '../viewKind'

/** What the user clicked toward. `'new-instance'` is the "+ New Instance" row;
 *  everything else is an install/dashboard target. */
export type TargetKind = 'dashboard' | 'instance' | 'cloud' | 'new-instance'

/** Runtime state of the target relative to the current host. `'self'` = the
 *  target IS the current host's own running install. (No `running-here`: that
 *  collapses into `self`, since "running in this window" ⟺ "is the host install".) */
export type TargetRun = 'stopped' | 'running-elsewhere' | 'self'

/** Which affordance the user used: the primary CTA, or a caret/dropdown item. */
export type Intent = 'primary' | 'new-window'

/**
 * The action to perform. Maps 1:1 onto a main-process primitive (the renderer
 * dispatcher / the handlers in `src/main/index.ts`):
 *   - `switch` — detach the current install, attach the target into THIS window
 *   - `restart` — restart the current install in place
 *   - `open-new` — land the target in its own window, leaving the current alone
 *   - `focus` — bring the target's existing window to front
 *   - `no-op` — nothing to do
 *   - `install-wizard` — open the new-install flow
 */
export type Verb = 'switch' | 'restart' | 'open-new' | 'focus' | 'no-op' | 'install-wizard'

/** i18n KEYS (not resolved text) for the primary CTA label, by cell. The
 *  renderer resolves these via `t(...)`. */
export const NAV_LABEL = {
  start: 'instancePicker.open',
  restart: 'instancePicker.restart',
  switch: 'instancePicker.switch',
  openDashboard: 'instancePicker.openDashboard',
  openCloud: 'instancePicker.openCloud',
  openInNewWindow: 'instancePicker.openInNewWindow',
  newInstall: 'instancePicker.newInstance',
} as const
export type NavLabelKey = (typeof NAV_LABEL)[keyof typeof NAV_LABEL]

export interface NavDecision {
  readonly window: 'same' | 'new'
  readonly verb: Verb
  /** i18n key for the primary CTA label (resolved by the renderer). */
  readonly primaryLabel: NavLabelKey
  /** Caret/dropdown alternatives — fully-formed decisions the dropdown renders
   *  directly. Empty when the cell has none. */
  readonly secondary: readonly NavDecision[]
  /** Reserved: spawn a second window for an install that already owns one,
   *  bypassing the focus-existing guard. Unset by every cell today. */
  readonly allowDuplicate?: true
}

export interface NavInput {
  /** Current host view-kind — `remote` already folded into `cloud`. */
  currentView: ViewKind
  target: TargetKind
  targetRun: TargetRun
  intent: Intent
}

/** Canonical, collision-free table key. Only the three table dimensions; class
 *  is not a key (cloud/remote already folded, and verb deltas key on view). */
type CellKey = `${ViewKind}|${TargetKind}|${TargetRun}`
const cellKey = (view: ViewKind, target: TargetKind, run: TargetRun): CellKey =>
  `${view}|${target}|${run}`

// ── decision constructors ───────────────────────────────────────────────────
const NO_OP: NavDecision = Object.freeze({
  window: 'same',
  verb: 'no-op',
  primaryLabel: NAV_LABEL.start,
  secondary: [],
})

/** Build a decision with sane defaults (no secondary). Frozen — incl. the
 *  `secondary` array — so a consumer can't mutate a shared `TABLE` singleton and
 *  poison later calls. */
const dec = (
  over: Partial<NavDecision> & Pick<NavDecision, 'window' | 'verb' | 'primaryLabel'>,
): NavDecision => Object.freeze({
  ...over,
  secondary: Object.freeze(over.secondary ?? []),
})

/** The "Open in new window" caret alternative shared by several cells. */
const OPEN_NEW_WINDOW_SECONDARY: NavDecision = dec({
  window: 'new',
  verb: 'open-new',
  primaryLabel: NAV_LABEL.openInNewWindow,
})

/**
 * The transition table. Rows mirror the CTO matrix grouping; only reachable
 * cells are listed (unreachable tuples fall through to `NO_OP`). Every "cloud"
 * row also covers remote (folded upstream).
 */
const TABLE: ReadonlyMap<CellKey, NavDecision> = new Map<CellKey, NavDecision>([
  // Dashboard → X. `dashboard`/`new-instance` targets are unreachable (a picker row is always an install); kept to encode the full matrix.
  [cellKey('dashboard', 'dashboard', 'self'), NO_OP],
  [
    cellKey('dashboard', 'instance', 'stopped'),
    dec({ window: 'same', verb: 'switch', primaryLabel: NAV_LABEL.start }),
  ],
  [
    cellKey('dashboard', 'instance', 'running-elsewhere'),
    dec({ window: 'same', verb: 'focus', primaryLabel: NAV_LABEL.switch }),
  ],
  [
    cellKey('dashboard', 'cloud', 'stopped'),
    dec({
      window: 'same',
      verb: 'switch',
      primaryLabel: NAV_LABEL.openCloud,
      secondary: [OPEN_NEW_WINDOW_SECONDARY],
    }),
  ],
  [
    cellKey('dashboard', 'cloud', 'running-elsewhere'),
    dec({
      window: 'same',
      verb: 'focus',
      primaryLabel: NAV_LABEL.switch,
      secondary: [OPEN_NEW_WINDOW_SECONDARY],
    }),
  ],
  [
    // Documentation-only (see header above): `new-instance` is not a picker row.
    cellKey('dashboard', 'new-instance', 'stopped'),
    dec({ window: 'same', verb: 'install-wizard', primaryLabel: NAV_LABEL.newInstall }),
  ],

  // Instance A → X
  [
    // Dashboard opens in a NEW window so the instance keeps running.
    cellKey('instance', 'dashboard', 'self'),
    dec({ window: 'new', verb: 'open-new', primaryLabel: NAV_LABEL.openDashboard }),
  ],
  [
    cellKey('instance', 'instance', 'self'),
    dec({ window: 'same', verb: 'restart', primaryLabel: NAV_LABEL.restart }),
  ],
  [
    // Primary swaps B in place; caret keeps A running in a new window. Confirm is the 3-way modal in `pickInstallFromPicker`.
    cellKey('instance', 'instance', 'stopped'),
    dec({
      window: 'same',
      verb: 'switch',
      primaryLabel: NAV_LABEL.switch,
      secondary: [OPEN_NEW_WINDOW_SECONDARY],
    }),
  ],
  [
    cellKey('instance', 'instance', 'running-elsewhere'),
    dec({ window: 'same', verb: 'focus', primaryLabel: NAV_LABEL.switch }),
  ],
  [
    // Cloud opens in a new window so the local instance keeps running.
    cellKey('instance', 'cloud', 'stopped'),
    dec({ window: 'new', verb: 'open-new', primaryLabel: NAV_LABEL.openCloud }),
  ],
  [
    cellKey('instance', 'cloud', 'running-elsewhere'),
    dec({
      window: 'same',
      verb: 'focus',
      primaryLabel: NAV_LABEL.switch,
      secondary: [OPEN_NEW_WINDOW_SECONDARY],
    }),
  ],

  // Cloud → X
  [
    // Documentation-only: the Open Dashboard chip routes through `activate('new-window')`, not this cell. Tracked deviation from the matrix's same-window spec.
    cellKey('cloud', 'dashboard', 'self'),
    dec({ window: 'new', verb: 'open-new', primaryLabel: NAV_LABEL.openDashboard }),
  ],
  [
    // New window so the cloud session keeps running.
    cellKey('cloud', 'instance', 'stopped'),
    dec({ window: 'new', verb: 'open-new', primaryLabel: NAV_LABEL.openInNewWindow }),
  ],
  [
    cellKey('cloud', 'instance', 'running-elsewhere'),
    dec({ window: 'same', verb: 'focus', primaryLabel: NAV_LABEL.switch }),
  ],
  [
    // A second view of one cloud/remote session isn't supported (single-window auth), so restart in place rather than no-op.
    cellKey('cloud', 'cloud', 'self'),
    dec({ window: 'same', verb: 'restart', primaryLabel: NAV_LABEL.restart }),
  ],
  [
    // A DIFFERENT cloud/remote target that's already open elsewhere → focus it.
    cellKey('cloud', 'cloud', 'running-elsewhere'),
    dec({ window: 'same', verb: 'focus', primaryLabel: NAV_LABEL.switch }),
  ],
  [
    // New window so the current cloud/remote session keeps running.
    cellKey('cloud', 'cloud', 'stopped'),
    dec({ window: 'new', verb: 'open-new', primaryLabel: NAV_LABEL.openInNewWindow }),
  ],
  [
    // Documentation-only (see header above): `new-instance` is not a picker row.
    cellKey('cloud', 'new-instance', 'stopped'),
    dec({ window: 'new', verb: 'install-wizard', primaryLabel: NAV_LABEL.newInstall }),
  ],
])

/** Resolve a decision for a (host, target, intent) tuple. `'new-window'` intent
 *  returns the cell's new-window `secondary`, falling back to the primary. */
export function decideNavigation(input: NavInput): NavDecision {
  const primary = TABLE.get(cellKey(input.currentView, input.target, input.targetRun)) ?? NO_OP

  if (input.intent === 'new-window') {
    const alt = primary.secondary.find((s) => s.window === 'new')
    return alt ?? primary
  }
  return primary
}
