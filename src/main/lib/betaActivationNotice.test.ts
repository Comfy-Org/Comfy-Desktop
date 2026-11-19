import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, unknown>()
vi.mock('../settings', () => ({
  get: (key: string) => store.get(key),
  set: (key: string, value: unknown) => {
    store.set(key, value)
  }
}))

import {
  BETA_NOTICE_ANNOUNCED_ARGS_KEY,
  _resetForTest,
  acknowledgeBetaActivationNotice,
  armBetaActivationNotice,
  clearBetaActivationClaim,
  peekBetaActivationNotice,
  readAnnouncedBetaArgs,
  resolveBetaActivationNotice,
  selectNewlyActiveBetaGrants
} from './betaActivationNotice'
import type { CoreBetaGrant } from './coreBetaGrants'

const announced = (): unknown => store.get(BETA_NOTICE_ANNOUNCED_ARGS_KEY)

function grant(arg: string, notice?: CoreBetaGrant['notice']): CoreBetaGrant {
  return { arg, minCoreVersion: '0.3.80', ...(notice ? { notice } : {}) }
}

function announcedArgsFor(
  applied: readonly CoreBetaGrant[],
  spokenFor: ReadonlySet<string> = new Set()
): string[] {
  return selectNewlyActiveBetaGrants(applied, spokenFor).map((g) => g.arg)
}

const pendingArgs = (installationId: string): string[] =>
  peekBetaActivationNotice(installationId)?.args.slice() ?? []

beforeEach(() => {
  store.clear()
  _resetForTest()
})

describe('selectNewlyActiveBetaGrants', () => {
  it('announces an enable-grant nobody has spoken for yet', () => {
    expect(announcedArgsFor([grant('--enable-assets')])).toEqual(['--enable-assets'])
  })

  it('does not announce an unnamed disable-grant', () => {
    expect(announcedArgsFor([grant('--disable-assets')])).toEqual([])
    expect(announcedArgsFor([grant('--disable-assets'), grant('--enable-agent')])).toEqual([
      '--enable-agent'
    ])
  })

  it('stays silent for an arg with neither prefix, rather than calling it a force-off', () => {
    expect(
      selectNewlyActiveBetaGrants(
        [{ arg: '--use-assets', minCoreVersion: '0.3.80', notice: { description: 'Assets' } }],
        new Set()
      )
    ).toEqual([])
  })

  it('announces a NAMED disable-grant, because the payload supplied what was missing', () => {
    const fresh = selectNewlyActiveBetaGrants(
      [grant('--disable-assets', { description: 'Asset library' })],
      new Set()
    )
    expect(fresh).toEqual([
      { arg: '--disable-assets', direction: 'disabled', description: 'Asset library' }
    ])
  })

  it('honours a payload that asked for no card', () => {
    expect(announcedArgsFor([grant('--enable-assets', { silent: true })])).toEqual([])
  })

  it('honours a silent first occurrence over a duplicate that omits it', () => {
    expect(
      announcedArgsFor([grant('--enable-assets', { silent: true }), grant('--enable-assets')])
    ).toEqual([])
  })

  it('silences only the grant that asked for it', () => {
    expect(
      announcedArgsFor([grant('--enable-assets', { silent: true }), grant('--enable-agent')])
    ).toEqual(['--enable-agent'])
  })

  it('carries a payload-supplied feature name through to the card', () => {
    expect(
      selectNewlyActiveBetaGrants(
        [grant('--enable-assets', { description: 'Asset library' })],
        new Set()
      )
    ).toEqual([{ arg: '--enable-assets', direction: 'enabled', description: 'Asset library' }])
  })

  it('withholds an arg already spoken for', () => {
    expect(announcedArgsFor([grant('--enable-assets')], new Set(['--enable-assets']))).toEqual([])
  })

  it('announces a LATER grant even once an earlier one is spoken for', () => {
    expect(
      announcedArgsFor(
        [grant('--enable-assets'), grant('--enable-agent')],
        new Set(['--enable-assets'])
      )
    ).toEqual(['--enable-agent'])
  })

  it('collapses a repeated arg so one launch cannot double-announce it', () => {
    expect(announcedArgsFor([grant('--enable-assets'), grant('--enable-assets')])).toEqual([
      '--enable-assets'
    ])
  })
})

describe('the allowlist invariant this module depends on', () => {
  it('every grantable arg is --enable-* or --disable-*', async () => {
    const { CORE_BETA_GRANTABLE_ARGS } = await import('./coreBetaGrants')
    for (const arg of CORE_BETA_GRANTABLE_ARGS) {
      expect(arg.startsWith('--enable-') || arg.startsWith('--disable-')).toBe(true)
    }
  })
})

describe('resolveBetaActivationNotice', () => {
  it('has nothing to show when nothing is pending', () => {
    expect(resolveBetaActivationNotice([])).toBeNull()
  })

  it('names the feature when the card covers exactly one named grant', () => {
    expect(
      resolveBetaActivationNotice([
        { arg: '--enable-assets', direction: 'enabled', description: 'Asset library' }
      ])
    ).toEqual({ args: ['--enable-assets'], direction: 'enabled', description: 'Asset library' })
  })

  it('covers only the grants matching the direction it reports', () => {
    const notice = resolveBetaActivationNotice([
      { arg: '--enable-agent', direction: 'enabled', description: null },
      { arg: '--disable-assets', direction: 'disabled', description: 'Asset library' }
    ])
    expect(notice).toEqual({ args: ['--enable-agent'], direction: 'enabled', description: null })
  })

  it('drops the name when the card covers two grants', () => {
    expect(
      resolveBetaActivationNotice([
        { arg: '--enable-assets', direction: 'enabled', description: 'Asset library' },
        { arg: '--enable-agent', direction: 'enabled', description: 'Agent' }
      ])
    ).toEqual({
      args: ['--enable-assets', '--enable-agent'],
      direction: 'enabled',
      description: null
    })
  })

  it('reads as enabled when anything was turned on', () => {
    expect(
      resolveBetaActivationNotice([
        { arg: '--disable-assets', direction: 'disabled', description: 'Asset library' },
        { arg: '--enable-agent', direction: 'enabled', description: null }
      ])?.direction
    ).toBe('enabled')
  })

  it('reads as disabled only when every covered grant was a force-off', () => {
    expect(
      resolveBetaActivationNotice([
        { arg: '--disable-assets', direction: 'disabled', description: 'Asset library' }
      ])?.direction
    ).toBe('disabled')
  })
})

describe('readAnnouncedBetaArgs', () => {
  it('reads the persisted list', () => {
    store.set(BETA_NOTICE_ANNOUNCED_ARGS_KEY, ['--enable-assets'])
    expect(readAnnouncedBetaArgs()).toEqual(['--enable-assets'])
  })

  it.each([
    ['absent', undefined],
    ['a non-array', 'enable-assets'],
    ['an object', { '--enable-assets': true }]
  ])('reads %s as nothing announced yet', (_label, value) => {
    if (value !== undefined) store.set(BETA_NOTICE_ANNOUNCED_ARGS_KEY, value)
    expect(readAnnouncedBetaArgs()).toEqual([])
  })

  it('drops non-string entries rather than the whole list', () => {
    store.set(BETA_NOTICE_ANNOUNCED_ARGS_KEY, ['--enable-assets', 42, null])
    expect(readAnnouncedBetaArgs()).toEqual(['--enable-assets'])
  })
})

describe('arm / peek / acknowledge', () => {
  it('queues a first activation for the install that launched it', () => {
    armBetaActivationNotice('inst-1', [grant('--enable-assets')])
    expect(pendingArgs('inst-1')).toEqual(['--enable-assets'])
    expect(peekBetaActivationNotice('inst-2')).toBeNull()
  })

  it('queues nothing when the launch applied no grants', () => {
    armBetaActivationNotice('inst-1', [])
    expect(peekBetaActivationNotice('inst-1')).toBeNull()
  })

  it('carries the payload wording through to the pending card', () => {
    armBetaActivationNotice('inst-1', [grant('--enable-assets', { description: 'Asset library' })])
    expect(peekBetaActivationNotice('inst-1')).toEqual({
      args: ['--enable-assets'],
      direction: 'enabled',
      description: 'Asset library'
    })
  })

  it('leaves the notice pending across repeated reads', () => {
    armBetaActivationNotice('inst-1', [grant('--enable-assets')])
    expect(pendingArgs('inst-1')).toEqual(['--enable-assets'])
    expect(pendingArgs('inst-1')).toEqual(['--enable-assets'])
    expect(announced()).toBeUndefined()
  })

  it('persists the args and clears the queue on acknowledge', () => {
    armBetaActivationNotice('inst-1', [grant('--enable-assets')])
    acknowledgeBetaActivationNotice('inst-1')
    expect(announced()).toEqual(['--enable-assets'])
    expect(peekBetaActivationNotice('inst-1')).toBeNull()
  })

  it('stays silent on every later launch of the same feature', () => {
    armBetaActivationNotice('inst-1', [grant('--enable-assets')])
    acknowledgeBetaActivationNotice('inst-1')
    armBetaActivationNotice('inst-1', [grant('--enable-assets')])
    expect(peekBetaActivationNotice('inst-1')).toBeNull()
  })

  it('stays silent when the same feature is revoked and later re-granted', () => {
    armBetaActivationNotice('inst-1', [grant('--enable-assets')])
    acknowledgeBetaActivationNotice('inst-1')
    armBetaActivationNotice('inst-1', [])
    armBetaActivationNotice('inst-1', [grant('--enable-assets')])
    expect(peekBetaActivationNotice('inst-1')).toBeNull()
  })

  it('announces a named force-off of a feature it already announced turning on', () => {
    armBetaActivationNotice('inst-1', [grant('--enable-assets')])
    acknowledgeBetaActivationNotice('inst-1')
    armBetaActivationNotice('inst-1', [grant('--disable-assets', { description: 'Asset library' })])
    expect(peekBetaActivationNotice('inst-1')).toEqual({
      args: ['--disable-assets'],
      direction: 'disabled',
      description: 'Asset library'
    })
  })

  it('tells a SECOND install about a feature the first never announced', () => {
    armBetaActivationNotice('inst-1', [grant('--enable-assets')])
    acknowledgeBetaActivationNotice('inst-1')
    armBetaActivationNotice('inst-2', [grant('--enable-assets'), grant('--enable-agent')])
    expect(pendingArgs('inst-2')).toEqual(['--enable-agent'])
  })

  it('merges into what other installs already announced rather than replacing it', () => {
    store.set(BETA_NOTICE_ANNOUNCED_ARGS_KEY, ['--enable-assets'])
    armBetaActivationNotice('inst-2', [grant('--enable-agent')])
    acknowledgeBetaActivationNotice('inst-2')
    expect(announced()).toEqual(['--enable-assets', '--enable-agent'])
  })

  it('acknowledges only the grants the card described, leaving the rest queued', () => {
    armBetaActivationNotice('inst-1', [
      grant('--enable-agent'),
      grant('--disable-assets', { description: 'Asset library' })
    ])
    expect(peekBetaActivationNotice('inst-1')?.args).toEqual(['--enable-agent'])

    acknowledgeBetaActivationNotice('inst-1', ['--enable-agent'])
    expect(announced()).toEqual(['--enable-agent'])
    expect(peekBetaActivationNotice('inst-1')).toEqual({
      args: ['--disable-assets'],
      direction: 'disabled',
      description: 'Asset library'
    })
  })

  it('retires the args the card displayed, not whatever is queued at retire time', () => {
    armBetaActivationNotice('inst-1', [grant('--enable-assets')])
    armBetaActivationNotice('inst-1', [grant('--enable-assets'), grant('--enable-agent')])

    acknowledgeBetaActivationNotice('inst-1', ['--enable-assets'])

    expect(announced()).toEqual(['--enable-assets'])
    expect(peekBetaActivationNotice('inst-1')?.args).toEqual(['--enable-agent'])
  })

  it('an empty shownArgs falls back to the queue, which is why the handler refuses one', () => {
    armBetaActivationNotice('inst-1', [grant('--enable-assets'), grant('--enable-agent')])
    acknowledgeBetaActivationNotice('inst-1', [])
    expect(announced()).toEqual(['--enable-assets', '--enable-agent'])
  })

  it('acknowledging an install with nothing pending writes nothing', () => {
    acknowledgeBetaActivationNotice('inst-1')
    expect(announced()).toBeUndefined()
  })

  it("re-arming replaces the install's pending set with the latest launch's grants", () => {
    armBetaActivationNotice('inst-1', [grant('--enable-assets')])
    armBetaActivationNotice('inst-1', [grant('--enable-assets'), grant('--enable-agent')])
    expect(pendingArgs('inst-1')).toEqual(['--enable-assets', '--enable-agent'])
  })

  it('acknowledges a silenced grant is never queued, so it never reaches the store', () => {
    armBetaActivationNotice('inst-1', [grant('--enable-assets', { silent: true })])
    acknowledgeBetaActivationNotice('inst-1')
    expect(announced()).toBeUndefined()
    armBetaActivationNotice('inst-1', [grant('--enable-assets')])
    expect(pendingArgs('inst-1')).toEqual(['--enable-assets'])
  })

  it('gives every install its own card, and lets the announced list do the silencing', () => {
    armBetaActivationNotice('inst-1', [grant('--enable-assets')])
    armBetaActivationNotice('inst-2', [grant('--enable-assets')])
    expect(pendingArgs('inst-1')).toEqual(['--enable-assets'])
    expect(pendingArgs('inst-2')).toEqual(['--enable-assets'])
  })

  it('does not serve a queued card for an arg another install acknowledged first', () => {
    armBetaActivationNotice('inst-1', [grant('--enable-assets')])
    armBetaActivationNotice('inst-2', [grant('--enable-assets')])
    expect(pendingArgs('inst-2')).toEqual(['--enable-assets'])

    acknowledgeBetaActivationNotice('inst-1', ['--enable-assets'])

    expect(peekBetaActivationNotice('inst-2')).toBeNull()
  })

  it('keeps an unseen grant queued when only the other one was acknowledged', () => {
    armBetaActivationNotice('inst-1', [grant('--enable-assets')])
    armBetaActivationNotice('inst-2', [grant('--enable-assets'), grant('--enable-agent')])
    acknowledgeBetaActivationNotice('inst-1', ['--enable-assets'])

    expect(pendingArgs('inst-2')).toEqual(['--enable-agent'])
  })

  it('stays silent everywhere once any install has acknowledged the arg', () => {
    armBetaActivationNotice('inst-1', [grant('--enable-assets')])
    acknowledgeBetaActivationNotice('inst-1', ['--enable-assets'])
    expect(readAnnouncedBetaArgs()).toEqual(['--enable-assets'])

    armBetaActivationNotice('inst-2', [grant('--enable-assets')])
    expect(peekBetaActivationNotice('inst-2')).toBeNull()
  })

  it('clears a stale claim when the next launch applies no grants', () => {
    armBetaActivationNotice('inst-1', [grant('--enable-assets')])
    armBetaActivationNotice('inst-1', [])
    expect(peekBetaActivationNotice('inst-1')).toBeNull()
  })

  it('drops a claim left by a launch that never started', () => {
    armBetaActivationNotice('inst-1', [grant('--enable-assets')])
    expect(peekBetaActivationNotice('inst-1')?.args).toEqual(['--enable-assets'])

    clearBetaActivationClaim('inst-1')
    expect(peekBetaActivationNotice('inst-1')).toBeNull()
  })

  it('discards only the unannounced claim, never an arg already announced', () => {
    armBetaActivationNotice('inst-1', [grant('--enable-assets')])
    acknowledgeBetaActivationNotice('inst-1', ['--enable-assets'])
    expect(readAnnouncedBetaArgs()).toEqual(['--enable-assets'])

    clearBetaActivationClaim('inst-1')
    expect(readAnnouncedBetaArgs()).toEqual(['--enable-assets'])
    armBetaActivationNotice('inst-1', [grant('--enable-assets')])
    expect(peekBetaActivationNotice('inst-1')).toBeNull()
  })
})
