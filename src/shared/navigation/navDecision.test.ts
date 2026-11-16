import { describe, expect, it } from 'vitest'
import {
  decideNavigation,
  NAV_LABEL,
  type NavInput,
  type TargetKind,
  type TargetRun
} from './navDecision'
import type { ViewKind } from '../viewKind'
import en from '../../../locales/en.json'

const VIEWS: ViewKind[] = ['dashboard', 'instance', 'cloud']
const TARGETS: TargetKind[] = ['dashboard', 'instance', 'cloud', 'new-instance']
const RUNS: TargetRun[] = ['stopped', 'running-elsewhere', 'self', 'starting-unhosted']

function input(over: Partial<NavInput>): NavInput {
  return {
    currentView: 'dashboard',
    target: 'instance',
    targetRun: 'stopped',
    ...over
  }
}

describe('decideNavigation — totality', () => {
  it('returns a valid decision for the entire input cross-product', () => {
    for (const currentView of VIEWS)
      for (const target of TARGETS)
        for (const targetRun of RUNS) {
          const d = decideNavigation(input({ currentView, target, targetRun }))
          expect(d).toBeDefined()
          expect(d.verb).toBeTruthy()
          expect(Object.values(NAV_LABEL)).toContain(d.primaryLabel)
        }
  })

  it('never puts a different build into a build or Cloud window', () => {
    for (const currentView of ['instance', 'cloud'] as const)
      for (const target of ['instance', 'cloud'] as const)
        for (const targetRun of RUNS) {
          if (targetRun === 'self') continue
          const d = decideNavigation(input({ currentView, target, targetRun }))
          expect(['open-new', 'focus'], `${currentView} → ${target} (${targetRun})`).toContain(
            d.verb
          )
        }
  })

  it('never produces a dead no-op CTA for a reachable (host, install-target, run) combo', () => {
    const reachable: Array<[ViewKind, TargetKind, TargetRun]> = [
      ['dashboard', 'instance', 'stopped'],
      ['dashboard', 'instance', 'running-elsewhere'],
      ['dashboard', 'instance', 'starting-unhosted'],
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
      ['cloud', 'cloud', 'self']
    ]
    const dead = reachable.filter(
      ([currentView, target, targetRun]) =>
        decideNavigation(input({ currentView, target, targetRun })).verb === 'no-op'
    )
    expect(dead).toEqual([])
  })
})

describe('decideNavigation — every build opens in its own window', () => {
  const decisionFor = (currentView: ViewKind, target: TargetKind, targetRun: TargetRun) =>
    decideNavigation(input({ currentView, target, targetRun }))

  it('Dashboard → Dashboard: no-op', () => {
    expect(decisionFor('dashboard', 'dashboard', 'self').verb).toBe('no-op')
  })
  it('Dashboard → stopped build: Start from this Desktop window', () => {
    expect(decisionFor('dashboard', 'instance', 'stopped')).toEqual({
      verb: 'start',
      primaryLabel: NAV_LABEL.start
    })
  })
  it('Dashboard → closed Cloud: Open Cloud from this Desktop window', () => {
    expect(decisionFor('dashboard', 'cloud', 'stopped')).toEqual({
      verb: 'start',
      primaryLabel: NAV_LABEL.openCloud
    })
  })
  it('Dashboard → build running elsewhere: focus its window, label Switch', () => {
    expect(decisionFor('dashboard', 'instance', 'running-elsewhere')).toEqual({
      verb: 'focus',
      primaryLabel: NAV_LABEL.switch
    })
    expect(decisionFor('dashboard', 'cloud', 'running-elsewhere').verb).toBe('focus')
  })
  it('Dashboard → build starting with no window: Restart', () => {
    expect(decisionFor('dashboard', 'instance', 'starting-unhosted')).toEqual({
      verb: 'restart',
      primaryLabel: NAV_LABEL.restart
    })
  })
  it('a build starting with no window reads as running elsewhere outside Dashboard → Instance', () => {
    const elsewhere: Array<[ViewKind, TargetKind]> = [
      ['dashboard', 'cloud'],
      ['instance', 'instance'],
      ['instance', 'cloud'],
      ['cloud', 'instance'],
      ['cloud', 'cloud']
    ]
    for (const [view, target] of elsewhere) {
      expect(decisionFor(view, target, 'starting-unhosted')).toBe(
        decisionFor(view, target, 'running-elsewhere')
      )
    }
  })
  it('Dashboard → New Instance: install wizard', () => {
    expect(decisionFor('dashboard', 'new-instance', 'stopped').verb).toBe('install-wizard')
  })

  it('build window → stopped build B: Start opens B in its own window', () => {
    expect(decisionFor('instance', 'instance', 'stopped')).toEqual({
      verb: 'open-new',
      primaryLabel: NAV_LABEL.start
    })
  })
  it('build window → closed Cloud: Open Cloud in its own window', () => {
    expect(decisionFor('instance', 'cloud', 'stopped')).toEqual({
      verb: 'open-new',
      primaryLabel: NAV_LABEL.openCloud
    })
  })
  it('build window → itself: Restart in place', () => {
    expect(decisionFor('instance', 'instance', 'self')).toEqual({
      verb: 'restart',
      primaryLabel: NAV_LABEL.restart
    })
  })
  it('build window → build running elsewhere: focus its window', () => {
    expect(decisionFor('instance', 'instance', 'running-elsewhere').verb).toBe('focus')
    expect(decisionFor('instance', 'cloud', 'running-elsewhere').verb).toBe('focus')
  })
  it('build window → Dashboard: open-new', () => {
    expect(decisionFor('instance', 'dashboard', 'self')).toEqual({
      verb: 'open-new',
      primaryLabel: NAV_LABEL.openDashboard
    })
  })

  it('Cloud window → stopped build: Start opens it in its own window', () => {
    expect(decisionFor('cloud', 'instance', 'stopped')).toEqual({
      verb: 'open-new',
      primaryLabel: NAV_LABEL.start
    })
  })
  it('Cloud window → another closed Cloud or remote build: Open Cloud in its own window', () => {
    expect(decisionFor('cloud', 'cloud', 'stopped')).toEqual({
      verb: 'open-new',
      primaryLabel: NAV_LABEL.openCloud
    })
  })
  it('Cloud window → itself: Restart in place', () => {
    expect(decisionFor('cloud', 'cloud', 'self')).toEqual({
      verb: 'restart',
      primaryLabel: NAV_LABEL.restart
    })
  })
  it('Cloud window → build running elsewhere: focus its window', () => {
    expect(decisionFor('cloud', 'cloud', 'running-elsewhere')).toEqual({
      verb: 'focus',
      primaryLabel: NAV_LABEL.switch
    })
    expect(decisionFor('cloud', 'instance', 'running-elsewhere').verb).toBe('focus')
  })
  it('Cloud window → New Instance: install wizard', () => {
    expect(decisionFor('cloud', 'new-instance', 'stopped').verb).toBe('install-wizard')
  })
  it('Cloud window → Dashboard: open-new', () => {
    expect(decisionFor('cloud', 'dashboard', 'self')).toEqual({
      verb: 'open-new',
      primaryLabel: NAV_LABEL.openDashboard
    })
  })
})

describe('nav/caret i18n keys', () => {
  const catalog: Record<string, unknown> = en
  const resolves = (key: string): boolean => {
    const [ns, leaf] = key.split('.') as [string, string]
    const group = catalog[ns]
    return (
      typeof group === 'object' &&
      group !== null &&
      typeof (group as Record<string, unknown>)[leaf] === 'string'
    )
  }

  it('every NAV_LABEL value resolves in locales/en.json', () => {
    for (const key of Object.values(NAV_LABEL)) {
      expect(resolves(key), `missing i18n key: ${key}`).toBe(true)
    }
  })

  it('component nav/caret keys resolve in locales/en.json', () => {
    const componentKeys = [
      'instancePicker.openRemote',
      'instancePicker.windowOptions',
      'instancePicker.moreWindowOptions'
    ]
    for (const key of componentKeys) {
      expect(resolves(key), `missing i18n key: ${key}`).toBe(true)
    }
  })
})
