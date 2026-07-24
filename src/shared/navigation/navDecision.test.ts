import { describe, expect, it } from 'vitest'
import {
  decideNavigation,
  NAV_LABEL,
  type Intent,
  type NavInput,
  type TargetKind,
  type TargetRun,
} from './navDecision'
import type { ViewKind } from '../viewKind'
import en from '../../../locales/en.json'

const VIEWS: ViewKind[] = ['dashboard', 'instance', 'cloud']
const TARGETS: TargetKind[] = ['dashboard', 'instance', 'cloud', 'new-instance']
const RUNS: TargetRun[] = ['stopped', 'running-elsewhere', 'self']
const INTENTS: Intent[] = ['primary', 'new-window']

function input(over: Partial<NavInput>): NavInput {
  return {
    currentView: 'dashboard',
    target: 'instance',
    targetRun: 'stopped',
    intent: 'primary',
    ...over,
  }
}

describe('decideNavigation — totality', () => {
  // The function must be total: every tuple in the full cross-product resolves
  // to a structurally valid decision, never throws, never returns undefined.
  it('returns a valid decision for the entire input cross-product', () => {
    for (const currentView of VIEWS)
      for (const target of TARGETS)
        for (const targetRun of RUNS)
          for (const intent of INTENTS) {
            const d = decideNavigation(input({ currentView, target, targetRun, intent }))
            expect(d).toBeDefined()
            expect(['same', 'new']).toContain(d.window)
            expect(d.verb).toBeTruthy()
            expect(Object.values(NAV_LABEL)).toContain(d.primaryLabel)
            expect(Array.isArray(d.secondary)).toBe(true)
          }
  })

  // Guards against the "dead Start button" class of bug: a picked install target
  // (instance OR cloud/remote) in a REACHABLE run-state must always produce a
  // live action, never a silent no-op. `self` is only reachable when the target
  // is the host's own running install (cloud→cloud).
  it('never produces a dead no-op CTA for a reachable (host, install-target, run) combo', () => {
    const reachable: Array<[ViewKind, TargetKind, TargetRun]> = [
      ['dashboard', 'instance', 'stopped'],
      ['dashboard', 'instance', 'running-elsewhere'],
      ['dashboard', 'cloud', 'stopped'],
      ['dashboard', 'cloud', 'running-elsewhere'],
      ['instance', 'instance', 'stopped'],
      ['instance', 'instance', 'running-elsewhere'],
      ['instance', 'instance', 'self'],
      ['instance', 'cloud', 'stopped'],
      ['instance', 'cloud', 'running-elsewhere'],
      ['cloud', 'instance', 'stopped'],
      ['cloud', 'instance', 'running-elsewhere'],
      ['cloud', 'cloud', 'stopped'],
      ['cloud', 'cloud', 'running-elsewhere'],
      ['cloud', 'cloud', 'self'],
    ]
    const dead = reachable.filter(
      ([currentView, target, targetRun]) =>
        decideNavigation(input({ currentView, target, targetRun })).verb === 'no-op',
    )
    expect(dead).toEqual([])
  })
})

describe('decideNavigation — the CURRENT-behavior matrix (baseline before #926 deltas)', () => {
  const decisionFor = (currentView: ViewKind, target: TargetKind, targetRun: TargetRun) =>
    decideNavigation(input({ currentView, target, targetRun }))

  // ── Dashboard → X ──
  it('Dashboard → Dashboard: no-op', () => {
    expect(decisionFor('dashboard', 'dashboard', 'self').verb).toBe('no-op')
  })
  it('Dashboard → Instance (stopped): Start in same window, no caret', () => {
    const decision = decisionFor('dashboard', 'instance', 'stopped')
    expect(decision).toMatchObject({ window: 'same', verb: 'switch', primaryLabel: NAV_LABEL.start })
    expect(decision.secondary).toHaveLength(0)
  })
  it('Dashboard → Instance (running elsewhere): focus, label Switch, no caret', () => {
    const decision = decisionFor('dashboard', 'instance', 'running-elsewhere')
    expect(decision).toMatchObject({ window: 'same', verb: 'focus', primaryLabel: NAV_LABEL.switch })
    expect(decision.secondary).toHaveLength(0)
  })
  it('Dashboard → Cloud (closed): Open Cloud same window + new-window caret', () => {
    const decision = decisionFor('dashboard', 'cloud', 'stopped')
    expect(decision).toMatchObject({ window: 'same', verb: 'switch', primaryLabel: NAV_LABEL.openCloud })
    expect(decision.secondary.some((alt) => alt.window === 'new' && alt.verb === 'open-new')).toBe(true)
  })
  it('Dashboard → New Instance: install wizard', () => {
    expect(decisionFor('dashboard', 'new-instance', 'stopped').verb).toBe('install-wizard')
  })

  // ── Instance → X ──
  it('Instance → Dashboard: NEW window (instance keeps running)', () => {
    const decision = decisionFor('instance', 'dashboard', 'self')
    expect(decision).toMatchObject({ window: 'new', verb: 'open-new', primaryLabel: NAV_LABEL.openDashboard })
  })
  it('Instance → self: Restart in place', () => {
    const decision = decisionFor('instance', 'instance', 'self')
    expect(decision).toMatchObject({ window: 'same', verb: 'restart', primaryLabel: NAV_LABEL.restart })
  })
  it('Instance → Instance B (stopped): switch in place + new-window caret (matrix row 9)', () => {
    const decision = decisionFor('instance', 'instance', 'stopped')
    expect(decision).toMatchObject({ window: 'same', verb: 'switch' })
    // The caret offers "Open in new window" so the user can keep A running; the
    // main-side 3-way modal also surfaces this on the primary Switch click.
    expect(decision.secondary.some((alt) => alt.window === 'new' && alt.verb === 'open-new')).toBe(true)
  })
  it('Instance → Instance B (running elsewhere): focus, no caret', () => {
    const decision = decisionFor('instance', 'instance', 'running-elsewhere')
    expect(decision.verb).toBe('focus')
    expect(decision.secondary).toHaveLength(0)
  })
  it('Instance → Cloud (closed): NEW window, keeps the instance running', () => {
    const decision = decisionFor('instance', 'cloud', 'stopped')
    expect(decision).toMatchObject({ window: 'new', verb: 'open-new', primaryLabel: NAV_LABEL.openCloud })
  })

  // ── Cloud → X ──
  // NOTE: documentation cell — the dashboard chip routes through the hardcoded
  // `activate('new-window')` path, so the app opens a new window for all hosts.
  // The matrix asks for same-window; tracked as a known deviation.
  it('Cloud → Dashboard: new window today (chip is not table-driven)', () => {
    const decision = decisionFor('cloud', 'dashboard', 'self')
    expect(decision).toMatchObject({ window: 'new', verb: 'open-new', primaryLabel: NAV_LABEL.openDashboard })
  })
  it('Cloud → Instance (stopped): NEW window, keeps the cloud session running', () => {
    const decision = decisionFor('cloud', 'instance', 'stopped')
    expect(decision).toMatchObject({ window: 'new', verb: 'open-new', primaryLabel: NAV_LABEL.openInNewWindow })
  })
  it('Cloud/Remote → self: Restart in place (second view of one session unsupported)', () => {
    const decision = decisionFor('cloud', 'cloud', 'self')
    expect(decision).toMatchObject({ window: 'same', verb: 'restart', primaryLabel: NAV_LABEL.restart })
  })
  it('Cloud → a DIFFERENT cloud/remote running elsewhere: focus (not a dead Start)', () => {
    const decision = decisionFor('cloud', 'cloud', 'running-elsewhere')
    expect(decision).toMatchObject({ window: 'same', verb: 'focus', primaryLabel: NAV_LABEL.switch })
  })
  it('Cloud → a stopped cloud/remote target: opens in a new window (not a dead Start)', () => {
    const decision = decisionFor('cloud', 'cloud', 'stopped')
    expect(decision).toMatchObject({ window: 'new', verb: 'open-new', primaryLabel: NAV_LABEL.openInNewWindow })
  })
  it('Cloud → New Instance: install wizard in a new window', () => {
    const decision = decisionFor('cloud', 'new-instance', 'stopped')
    expect(decision).toMatchObject({ window: 'new', verb: 'install-wizard' })
  })
})

describe('decideNavigation — boundary rules', () => {
  it('new-window intent selects the new-window secondary when offered', () => {
    const d = decideNavigation(
      input({ currentView: 'dashboard', target: 'cloud', targetRun: 'stopped', intent: 'new-window' }),
    )
    expect(d).toMatchObject({ window: 'new', verb: 'open-new', primaryLabel: NAV_LABEL.openInNewWindow })
  })

  it('new-window intent falls back to the primary when no secondary exists', () => {
    const primary = decideNavigation(
      input({ currentView: 'instance', target: 'instance', targetRun: 'self', intent: 'primary' }),
    )
    const viaCaret = decideNavigation(
      input({ currentView: 'instance', target: 'instance', targetRun: 'self', intent: 'new-window' }),
    )
    expect(viaCaret).toEqual(primary)
  })
})

describe('decideNavigation — caret (new-window intent)', () => {
  it('instance host → stopped instance B: caret selects the new-window alternative', () => {
    const primary = decideNavigation(
      input({ currentView: 'instance', target: 'instance', targetRun: 'stopped', intent: 'primary' }),
    )
    expect(primary).toMatchObject({ window: 'same', verb: 'switch' })
    const caret = decideNavigation(
      input({ currentView: 'instance', target: 'instance', targetRun: 'stopped', intent: 'new-window' }),
    )
    expect(caret).toMatchObject({ window: 'new', verb: 'open-new', primaryLabel: NAV_LABEL.openInNewWindow })
  })

  it('dashboard host → open cloud: caret selects the new-window alternative', () => {
    const caret = decideNavigation(
      input({ currentView: 'dashboard', target: 'cloud', targetRun: 'stopped', intent: 'new-window' }),
    )
    expect(caret).toMatchObject({ window: 'new', verb: 'open-new', primaryLabel: NAV_LABEL.openInNewWindow })
  })
})

describe('nav/caret i18n keys', () => {
  const catalog: Record<string, unknown> = en
  const resolves = (key: string): boolean => {
    const [ns, leaf] = key.split('.') as [string, string]
    const group = catalog[ns]
    return typeof group === 'object' && group !== null && typeof (group as Record<string, unknown>)[leaf] === 'string'
  }

  it('every NAV_LABEL value resolves in locales/en.json', () => {
    for (const key of Object.values(NAV_LABEL)) {
      expect(resolves(key), `missing i18n key: ${key}`).toBe(true)
    }
  })

  // The CTA/caret also resolve keys NOT in NAV_LABEL (remote relabel + the caret
  // split-button chrome). Without this they'd survive only on inline
  // `t(key, 'fallback')` defaults and render English in every other locale.
  it('component nav/caret keys resolve in locales/en.json', () => {
    const componentKeys = [
      'instancePicker.openRemote',
      'instancePicker.windowOptions',
      'instancePicker.moreWindowOptions',
    ]
    for (const key of componentKeys) {
      expect(resolves(key), `missing i18n key: ${key}`).toBe(true)
    }
  })
})
