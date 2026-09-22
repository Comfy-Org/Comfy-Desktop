import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The module persists through `settings`, so the store is faked rather than written: these
 * tests are about the once-per-feature rule, and a real `settings.json` would put the
 * developer's own config dir in the blast radius.
 */
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

/** A grant as `buildLaunchArgs` hands it over: the version window is already spent by then,
 *  so only the arg and the payload's notice wording matter here. */
function grant(arg: string, notice?: CoreBetaGrant['notice']): CoreBetaGrant {
  return { arg, minCoreVersion: '0.3.80', ...(notice ? { notice } : {}) }
}

/** The args a set of applied grants would announce. */
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
    // `--disable-assets` is the remote force-OFF. The generic copy says a feature is on and
    // points at the opt-out, so with no payload-supplied name there is nothing truthful to
    // put on a card.
    expect(announcedArgsFor([grant('--disable-assets')])).toEqual([])
    expect(announcedArgsFor([grant('--disable-assets'), grant('--enable-agent')])).toEqual([
      '--enable-agent'
    ])
  })

  it('stays silent for an arg with neither prefix, rather than calling it a force-off', () => {
    // The allowlist is documented as growing ahead of Core. A future entry with neither prefix
    // plus a description would otherwise render "The X beta is off" for something switched ON
    // — a degradation from silence to a false statement.
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
    // Not every granted flag is user-visible; ops can grant one without training people to
    // dismiss cards.
    expect(announcedArgsFor([grant('--enable-assets', { silent: true })])).toEqual([])
  })

  it('honours a silent first occurrence over a duplicate that omits it', () => {
    // De-duplication has to claim the arg before the silent skip, or the second entry
    // announces the very thing the first asked to keep quiet.
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
    // The whole reason the store is a list rather than a boolean: a second beta feature
    // months from now still owes the user a heads-up.
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
    // `selectNewlyActiveBetaArgs` announces only `--enable-*` and treats everything else as a
    // force-off to stay silent about. An allowlist entry with neither prefix would therefore
    // ship a grant the user is never told about — the exact failure this module exists to
    // prevent, reintroduced silently. Asserted here because `coreBetaGrants.ts` has no reason
    // to know about the coupling.
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
    // A launch can both enable and withdraw. One card cannot honestly describe both, so it
    // takes the enables and leaves the withdrawal queued for its own card.
    const notice = resolveBetaActivationNotice([
      { arg: '--enable-agent', direction: 'enabled', description: null },
      { arg: '--disable-assets', direction: 'disabled', description: 'Asset library' }
    ])
    expect(notice).toEqual({ args: ['--enable-agent'], direction: 'enabled', description: null })
  })

  it('drops the name when the card covers two grants', () => {
    // Two features at once have no single honest name, so the card falls back to generic
    // rather than naming one of them and implying it is the whole story.
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
    // "A beta feature is on" is true of a launch that turned one on, whatever else it
    // withdrew; the reverse claim would not be.
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
    // settings.json is user-writable, so every malformed shape has to degrade to "tell them"
    // rather than throwing on the launch path.
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
    // Persisting on show rather than on retire would spend a card the user may never have
    // seen — window closed, app quit, bell not rendered.
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
    // The list is append-only, so a grant taken back and handed out again does not read as
    // news the second time.
    armBetaActivationNotice('inst-1', [grant('--enable-assets')])
    acknowledgeBetaActivationNotice('inst-1')
    armBetaActivationNotice('inst-1', []) // revoked: nothing applied
    armBetaActivationNotice('inst-1', [grant('--enable-assets')]) // re-granted
    expect(peekBetaActivationNotice('inst-1')).toBeNull()
  })

  it('announces a named force-off of a feature it already announced turning on', () => {
    // Distinct arg tokens, so `--disable-assets` gets its own once-ever: being told a beta
    // arrived does not cover being told it was withdrawn.
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
    // The bug this guards: the card said "a beta feature is on", then acknowledgement consumed
    // the undescribed withdrawal too — and because the list is append-only, that withdrawal
    // could never be announced again on any install.
    armBetaActivationNotice('inst-1', [
      grant('--enable-agent'),
      grant('--disable-assets', { description: 'Asset library' })
    ])
    expect(peekBetaActivationNotice('inst-1')?.args).toEqual(['--enable-agent'])

    acknowledgeBetaActivationNotice('inst-1', ['--enable-agent'])
    expect(announced()).toEqual(['--enable-agent'])
    // The withdrawal survives and gets its own, correctly worded card.
    expect(peekBetaActivationNotice('inst-1')).toEqual({
      args: ['--disable-assets'],
      direction: 'disabled',
      description: 'Asset library'
    })
  })

  it('retires the args the card displayed, not whatever is queued at retire time', () => {
    // A relaunch can re-arm while the sticky card floats. Acknowledging the queue would then
    // persist a grant the user was never shown.
    armBetaActivationNotice('inst-1', [grant('--enable-assets')])
    armBetaActivationNotice('inst-1', [grant('--enable-assets'), grant('--enable-agent')])

    acknowledgeBetaActivationNotice('inst-1', ['--enable-assets'])

    expect(announced()).toEqual(['--enable-assets'])
    expect(peekBetaActivationNotice('inst-1')?.args).toEqual(['--enable-agent'])
  })

  it('an empty shownArgs falls back to the queue, which is why the handler refuses one', () => {
    // Documents the contract the IPC handler depends on: `[]` is indistinguishable from
    // "the renderer named nothing", so the handler must reject a malformed array rather than
    // filter it down to one — otherwise junk input retires the whole queue permanently.
    armBetaActivationNotice('inst-1', [grant('--enable-assets'), grant('--enable-agent')])
    acknowledgeBetaActivationNotice('inst-1', [])
    expect(announced()).toEqual(['--enable-assets', '--enable-agent'])
  })

  it('acknowledging an install with nothing pending writes nothing', () => {
    acknowledgeBetaActivationNotice('inst-1')
    expect(announced()).toBeUndefined()
  })

  it("re-arming replaces the install's pending set with the latest launch's grants", () => {
    // Each launch is the authority on what is on its own command line.
    armBetaActivationNotice('inst-1', [grant('--enable-assets')])
    armBetaActivationNotice('inst-1', [grant('--enable-assets'), grant('--enable-agent')])
    expect(pendingArgs('inst-1')).toEqual(['--enable-assets', '--enable-agent'])
  })

  it('acknowledges a silenced grant is never queued, so it never reaches the store', () => {
    armBetaActivationNotice('inst-1', [grant('--enable-assets', { silent: true })])
    acknowledgeBetaActivationNotice('inst-1')
    expect(announced()).toBeUndefined()
    // And a later payload that drops `silent` still owes the user the card.
    armBetaActivationNotice('inst-1', [grant('--enable-assets')])
    expect(pendingArgs('inst-1')).toEqual(['--enable-assets'])
  })

  it('gives every install its own card, and lets the announced list do the silencing', () => {
    // Queues are per-install. Two instances really do both have the feature on, and each has
    // its own title bar, so each gets told. Suppressing the second permanently silenced an
    // install whose user might never see the other window at all.
    armBetaActivationNotice('inst-1', [grant('--enable-assets')])
    armBetaActivationNotice('inst-2', [grant('--enable-assets')])
    expect(pendingArgs('inst-1')).toEqual(['--enable-assets'])
    expect(pendingArgs('inst-2')).toEqual(['--enable-assets'])
  })

  // The ordering the arm-time filter misses: BOTH queues are populated first, and only then
  // does one install acknowledge. It clears its own queue and persists the arg, so the other
  // install's copy is already sitting in memory when its title bar asks.
  it('does not serve a queued card for an arg another install acknowledged first', () => {
    armBetaActivationNotice('inst-1', [grant('--enable-assets')])
    armBetaActivationNotice('inst-2', [grant('--enable-assets')])
    expect(pendingArgs('inst-2')).toEqual(['--enable-assets'])

    // inst-2 is still booting; inst-1's user dismisses theirs.
    acknowledgeBetaActivationNotice('inst-1', ['--enable-assets'])

    expect(peekBetaActivationNotice('inst-2')).toBeNull()
  })

  it('keeps an unseen grant queued when only the other one was acknowledged', () => {
    // Filtered, not dropped: inst-2 still has something worth saying.
    armBetaActivationNotice('inst-1', [grant('--enable-assets')])
    armBetaActivationNotice('inst-2', [grant('--enable-assets'), grant('--enable-agent')])
    acknowledgeBetaActivationNotice('inst-1', ['--enable-assets'])

    expect(pendingArgs('inst-2')).toEqual(['--enable-agent'])
  })

  it('stays silent everywhere once any install has acknowledged the arg', () => {
    // This is what "once" means, and it is the only mechanism that survives a restart.
    armBetaActivationNotice('inst-1', [grant('--enable-assets')])
    acknowledgeBetaActivationNotice('inst-1', ['--enable-assets'])
    expect(readAnnouncedBetaArgs()).toEqual(['--enable-assets'])

    armBetaActivationNotice('inst-2', [grant('--enable-assets')])
    expect(peekBetaActivationNotice('inst-2')).toBeNull()
  })

  it('clears a stale claim when the next launch applies no grants', () => {
    // A beta launch that failed to boot leaves a claim behind. If the user then turns beta off
    // and relaunches, the card must not still say a beta feature is on.
    armBetaActivationNotice('inst-1', [grant('--enable-assets')])
    armBetaActivationNotice('inst-1', [])
    expect(peekBetaActivationNotice('inst-1')).toBeNull()
  })

  // Arming already repairs this on the install's NEXT launch. These cover the window in
  // between, which the relaunch cannot: the failed launch's progress takeover ends first.
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
    // Announced means spent: a later launch of the same arg stays silent.
    armBetaActivationNotice('inst-1', [grant('--enable-assets')])
    expect(peekBetaActivationNotice('inst-1')).toBeNull()
  })
})
