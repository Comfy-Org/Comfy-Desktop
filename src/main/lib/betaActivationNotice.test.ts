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
  selectNewlyActiveBetaArgs
} from './betaActivationNotice'

const announced = (): unknown => store.get(BETA_NOTICE_ANNOUNCED_ARGS_KEY)

beforeEach(() => {
  store.clear()
  _resetForTest()
})

describe('selectNewlyActiveBetaArgs', () => {
  it('announces an enable-grant nobody has spoken for yet', () => {
    expect(selectNewlyActiveBetaArgs(['--enable-assets'], new Set())).toEqual(['--enable-assets'])
  })

  it('never announces a disable-grant', () => {
    // `--disable-assets` is the remote force-OFF. The card says "a beta feature is on" and
    // points at the opt-out switch, so announcing one would state the opposite of what
    // happened and offer an action that does not apply.
    expect(selectNewlyActiveBetaArgs(['--disable-assets'], new Set())).toEqual([])
    expect(selectNewlyActiveBetaArgs(['--disable-assets', '--enable-agent'], new Set())).toEqual([
      '--enable-agent'
    ])
  })

  it('withholds an arg already spoken for', () => {
    expect(selectNewlyActiveBetaArgs(['--enable-assets'], new Set(['--enable-assets']))).toEqual([])
  })

  it('announces a LATER grant even once an earlier one is spoken for', () => {
    // The whole reason the store is a list rather than a boolean: a second beta feature
    // months from now still owes the user a heads-up.
    expect(
      selectNewlyActiveBetaArgs(['--enable-assets', '--enable-agent'], new Set(['--enable-assets']))
    ).toEqual(['--enable-agent'])
  })

  it('collapses a repeated arg so one launch cannot double-announce it', () => {
    expect(selectNewlyActiveBetaArgs(['--enable-assets', '--enable-assets'], new Set())).toEqual([
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
    armBetaActivationNotice('inst-1', ['--enable-assets'])
    expect(peekBetaActivationNotice('inst-1')).toEqual(['--enable-assets'])
    expect(peekBetaActivationNotice('inst-2')).toEqual([])
  })

  it('queues nothing when the launch applied no grants', () => {
    armBetaActivationNotice('inst-1', [])
    expect(peekBetaActivationNotice('inst-1')).toEqual([])
  })

  it('leaves the notice pending across repeated reads', () => {
    // Persisting on show rather than on retire would spend a card the user may never have
    // seen — window closed, app quit, bell not rendered.
    armBetaActivationNotice('inst-1', ['--enable-assets'])
    expect(peekBetaActivationNotice('inst-1')).toEqual(['--enable-assets'])
    expect(peekBetaActivationNotice('inst-1')).toEqual(['--enable-assets'])
    expect(announced()).toBeUndefined()
  })

  it('persists the args and clears the queue on acknowledge', () => {
    armBetaActivationNotice('inst-1', ['--enable-assets'])
    acknowledgeBetaActivationNotice('inst-1')
    expect(announced()).toEqual(['--enable-assets'])
    expect(peekBetaActivationNotice('inst-1')).toEqual([])
  })

  it('stays silent on every later launch of the same feature', () => {
    armBetaActivationNotice('inst-1', ['--enable-assets'])
    acknowledgeBetaActivationNotice('inst-1')
    armBetaActivationNotice('inst-1', ['--enable-assets'])
    expect(peekBetaActivationNotice('inst-1')).toEqual([])
  })

  it('stays silent when the same feature is revoked and later re-granted', () => {
    // The list is append-only, so a grant taken back and handed out again does not read as
    // news the second time.
    armBetaActivationNotice('inst-1', ['--enable-assets'])
    acknowledgeBetaActivationNotice('inst-1')
    armBetaActivationNotice('inst-1', []) // revoked: nothing applied
    armBetaActivationNotice('inst-1', ['--enable-assets']) // re-granted
    expect(peekBetaActivationNotice('inst-1')).toEqual([])
  })

  it('tells a SECOND install about a feature the first never announced', () => {
    armBetaActivationNotice('inst-1', ['--enable-assets'])
    acknowledgeBetaActivationNotice('inst-1')
    armBetaActivationNotice('inst-2', ['--enable-assets', '--enable-agent'])
    expect(peekBetaActivationNotice('inst-2')).toEqual(['--enable-agent'])
  })

  it('merges into what other installs already announced rather than replacing it', () => {
    store.set(BETA_NOTICE_ANNOUNCED_ARGS_KEY, ['--enable-assets'])
    armBetaActivationNotice('inst-2', ['--enable-agent'])
    acknowledgeBetaActivationNotice('inst-2')
    expect(announced()).toEqual(['--enable-assets', '--enable-agent'])
  })

  it('retires the args the card displayed, not whatever is queued at retire time', () => {
    // A relaunch can re-arm while the sticky card floats. Acknowledging the queue would then
    // persist a grant the user was never shown — and the list is append-only, so it could
    // never be announced again on any install.
    armBetaActivationNotice('inst-1', ['--enable-assets'])
    armBetaActivationNotice('inst-1', ['--enable-assets', '--enable-agent'])

    acknowledgeBetaActivationNotice('inst-1', ['--enable-assets'])

    expect(announced()).toEqual(['--enable-assets'])
    // The grant that was never on the card is still owed one.
    expect(peekBetaActivationNotice('inst-1')).toEqual(['--enable-agent'])
  })

  it('an empty shownArgs falls back to the queue, which is why the handler refuses one', () => {
    // Documents the contract the IPC handler depends on: `[]` is indistinguishable from
    // "the renderer named nothing", so the handler must reject a malformed array rather than
    // filter it down to one — otherwise junk input retires the whole queue permanently.
    armBetaActivationNotice('inst-1', ['--enable-assets', '--enable-agent'])
    acknowledgeBetaActivationNotice('inst-1', [])
    expect(announced()).toEqual(['--enable-assets', '--enable-agent'])
  })

  it('acknowledging an install with nothing pending writes nothing', () => {
    acknowledgeBetaActivationNotice('inst-1')
    expect(announced()).toBeUndefined()
  })

  it("re-arming replaces the install's pending set with the latest launch's grants", () => {
    // Each launch is the authority on what is on its own command line.
    armBetaActivationNotice('inst-1', ['--enable-assets'])
    armBetaActivationNotice('inst-1', ['--enable-assets', '--enable-agent'])
    expect(peekBetaActivationNotice('inst-1')).toEqual(['--enable-assets', '--enable-agent'])
  })

  it('gives every install its own card, and lets the announced list do the silencing', () => {
    // Queues are per-install. Two instances really do both have the feature on, and each has
    // its own title bar, so each gets told. Suppressing the second permanently silenced an
    // install whose user might never see the other window at all.
    armBetaActivationNotice('inst-1', ['--enable-assets'])
    armBetaActivationNotice('inst-2', ['--enable-assets'])
    expect(peekBetaActivationNotice('inst-1')).toEqual(['--enable-assets'])
    expect(peekBetaActivationNotice('inst-2')).toEqual(['--enable-assets'])
  })

  // The ordering the arm-time filter misses: BOTH queues are populated first, and only then
  // does one install acknowledge. It clears its own queue and persists the arg, so the other
  // install's copy is already sitting in memory when its title bar asks.
  it('does not serve a queued card for an arg another install acknowledged first', () => {
    armBetaActivationNotice('inst-1', ['--enable-assets'])
    armBetaActivationNotice('inst-2', ['--enable-assets'])
    expect(peekBetaActivationNotice('inst-2')).toEqual(['--enable-assets'])

    // inst-2 is still booting; inst-1's user dismisses theirs.
    acknowledgeBetaActivationNotice('inst-1', ['--enable-assets'])

    expect(peekBetaActivationNotice('inst-2')).toEqual([])
  })

  it('keeps an unseen grant queued when only the other one was acknowledged', () => {
    // Filtered, not dropped: inst-2 still has something worth saying.
    armBetaActivationNotice('inst-1', ['--enable-assets'])
    armBetaActivationNotice('inst-2', ['--enable-assets', '--enable-agent'])
    acknowledgeBetaActivationNotice('inst-1', ['--enable-assets'])

    expect(peekBetaActivationNotice('inst-2')).toEqual(['--enable-agent'])
  })

  it('stays silent everywhere once any install has acknowledged the arg', () => {
    // This is what "once" means, and it is the only mechanism that survives a restart.
    armBetaActivationNotice('inst-1', ['--enable-assets'])
    acknowledgeBetaActivationNotice('inst-1', ['--enable-assets'])
    expect(readAnnouncedBetaArgs()).toEqual(['--enable-assets'])

    armBetaActivationNotice('inst-2', ['--enable-assets'])
    expect(peekBetaActivationNotice('inst-2')).toEqual([])
  })

  it('clears a stale claim when the next launch applies no grants', () => {
    // A beta launch that failed to boot leaves a claim behind. If the user then turns beta off
    // and relaunches, the card must not still say a beta feature is on.
    armBetaActivationNotice('inst-1', ['--enable-assets'])
    armBetaActivationNotice('inst-1', [])
    expect(peekBetaActivationNotice('inst-1')).toEqual([])
  })

  // Arming already repairs this on the install's NEXT launch. These cover the window in
  // between, which the relaunch cannot: the failed launch's progress takeover ends first.
  it('drops a claim left by a launch that never started', () => {
    armBetaActivationNotice('inst-1', ['--enable-assets'])
    expect(peekBetaActivationNotice('inst-1')).toEqual(['--enable-assets'])

    clearBetaActivationClaim('inst-1')
    expect(peekBetaActivationNotice('inst-1')).toEqual([])
  })

  it('discards only the unannounced claim, never an arg already announced', () => {
    armBetaActivationNotice('inst-1', ['--enable-assets'])
    acknowledgeBetaActivationNotice('inst-1', ['--enable-assets'])
    expect(readAnnouncedBetaArgs()).toEqual(['--enable-assets'])

    clearBetaActivationClaim('inst-1')
    expect(readAnnouncedBetaArgs()).toEqual(['--enable-assets'])
    // Announced means spent: a later launch of the same arg stays silent.
    armBetaActivationNotice('inst-1', ['--enable-assets'])
    expect(peekBetaActivationNotice('inst-1')).toEqual([])
  })
})
