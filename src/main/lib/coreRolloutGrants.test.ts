import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const getOpsFlagResult = vi.fn()
vi.mock('./telemetry', () => ({
  getOpsFlagResult: (...args: unknown[]) => getOpsFlagResult(...args)
}))

let testConfigDir = ''
vi.mock('./paths', () => ({
  configDir: () => testConfigDir
}))

import { NO_CORE_COMMITS } from './coreBetaGrants'
import type { CoreCommitState, CoreVersionState } from './coreBetaGrants'
import {
  CORE_ROLLOUT_FLAG_KEY,
  _resetForTest,
  blockerShortfall,
  coreRolloutEligibility,
  coreRolloutRecord,
  coreRolloutShas,
  getCoreRolloutAsync,
  initCoreRollout,
  parseCoreRollout,
  selectCoreRolloutArg
} from './coreRolloutGrants'
import type {
  CoreRollout,
  CoreRolloutBlocker,
  CoreRolloutLaunchFacts,
  CoreRolloutState
} from './coreRolloutGrants'

const sha = (c: string): string => c.repeat(40)
const FIX = sha('f')
const INTRO = sha('e')
const LOWER = sha('a')
const UPPER = sha('b')

/** A payload every gate accepts; each test breaks exactly one thing. */
function validPayload(): Record<string, unknown> {
  return {
    grants: [{ arg: '--enable-assets', min_core_version: '0.39.0' }],
    blockers: [{ id: 'core-16646', fix_commits: [FIX], fixed_in: '0.38.0' }],
    epoch: 1,
    min_desktop_version: '1.1.6',
    include_telemetry_off: true,
    include_beta_off_with_telemetry: true
  }
}

function parsedOn(payload: unknown = validPayload(), value: unknown = true): CoreRollout {
  const state = parseCoreRollout(value as boolean, payload)
  if (state.kind !== 'on') throw new Error(`expected on, got: ${state.reason}`)
  return state.rollout
}

function core(over: Partial<CoreVersionState> = {}): CoreVersionState {
  return { semver: '0.39.0', exact: true, verified: true, current: true, ...over }
}

function commits(relations: Record<string, boolean>, head: string | null = sha('c')) {
  return { head, ancestry: new Map(Object.entries(relations)) } satisfies CoreCommitState
}

function facts(over: Partial<CoreRolloutLaunchFacts> = {}): CoreRolloutLaunchFacts {
  return {
    appVersion: '1.1.6',
    sourceId: 'standalone',
    beta: false,
    consent: 'denied',
    userArgs: [],
    ...over
  }
}

describe('parseCoreRollout flag value', () => {
  it.each([true, 'rollout', 'rollout-a', 'rollout-phase2'])('accepts %j', (value) => {
    expect(parseCoreRollout(value, validPayload()).kind).toBe('on')
  })

  it.each([
    [undefined, 'no flag value'],
    [false, 'flag served false'],
    ['control', 'not a rollout variant'],
    ['on', 'not a rollout variant'],
    ['Rollout', 'not a rollout variant'],
    ['rollout-', 'not a rollout variant'],
    ['rollout-A', 'not a rollout variant'],
    ['rolloutx', 'not a rollout variant']
  ])('refuses %j', (value, reason) => {
    const state = parseCoreRollout(value as string | boolean | undefined, validPayload())
    expect(state).toEqual({ kind: 'off', reason: expect.stringContaining(reason) })
  })
})

describe('parseCoreRollout payload', () => {
  it('parses a complete payload', () => {
    const payload = validPayload()
    payload.grants = [
      { arg: '--enable-assets', min_core_version: 'v0.39.0', max_core_version: '0.40.0' },
      { arg: '--enable-assets', commit_ranges: [[LOWER, null]] }
    ]
    payload.blockers = [
      { id: 'a', fix_commits: [FIX], introduced_commits: [INTRO], introduced_in: '0.37.0' },
      { id: 'b' }
    ]
    expect(parsedOn(payload)).toEqual({
      grants: [
        { arg: '--enable-assets', minCoreVersion: '0.39.0', maxCoreVersion: '0.40.0' },
        { arg: '--enable-assets', commitRanges: [[LOWER, null]] }
      ],
      blockers: [
        {
          id: 'a',
          fixCommits: [FIX],
          introducedCommits: [INTRO],
          introducedIn: '0.37.0'
        },
        { id: 'b', fixCommits: [], introducedCommits: [] }
      ],
      epoch: 1,
      minDesktopVersion: '1.1.6',
      includeTelemetryOff: true,
      includeBetaOffWithTelemetry: true
    })
  })

  it('accepts an open upper bound and ignores unknown keys', () => {
    const payload: Record<string, unknown> = { ...validPayload(), future_field: 1 }
    ;(payload.grants as object[])[0] = {
      arg: '--enable-assets',
      min_core_version: '0.39.0',
      notice: 'silent'
    }
    expect(parsedOn(payload).grants).toEqual([{ arg: '--enable-assets', minCoreVersion: '0.39.0' }])
  })

  // Each row breaks one field; ONE bad field must refuse the whole payload, never just the entry.
  const breaks: [string, (p: Record<string, unknown>) => void, string][] = [
    ['grants missing', (p) => delete p.grants, 'grants must list'],
    ['grants empty', (p) => (p.grants = []), 'grants must list'],
    [
      'nine grants',
      (p) => (p.grants = Array(9).fill({ arg: '--enable-assets', min_core_version: '0.39.0' })),
      'grants must list'
    ],
    ['a grant that is not an object', (p) => (p.grants = ['--enable-assets']), 'not an object'],
    ...['--enable-asset-hashing', '--disable-assets', '--enable-agent', '--enable-assets '].map(
      (arg): [string, (p: Record<string, unknown>) => void, string] => [
        `a grant of ${arg}`,
        (p) => (p.grants = [{ arg, min_core_version: '0.39.0' }]),
        'arg is not --enable-assets'
      ]
    ),
    [
      'a second, bad grant beside a good one',
      (p) =>
        (p.grants = [
          { arg: '--enable-assets', min_core_version: '0.39.0' },
          { arg: '--enable-assets', min_core_version: 'latest' }
        ]),
      'grants[1] min_core_version'
    ],
    [
      'a grant with no bound',
      (p) => (p.grants = [{ arg: '--enable-assets' }]),
      'min_core_version missing'
    ],
    [
      'max equal to min',
      (p) =>
        (p.grants = [
          { arg: '--enable-assets', min_core_version: '0.39.0', max_core_version: '0.39.0' }
        ]),
      'not above'
    ],
    [
      'max below min',
      (p) =>
        (p.grants = [
          { arg: '--enable-assets', min_core_version: '0.39.0', max_core_version: '0.38.0' }
        ]),
      'not above'
    ],
    [
      'commit ranges mixed with a version',
      (p) =>
        (p.grants = [
          { arg: '--enable-assets', commit_ranges: [[LOWER, null]], min_core_version: '0.39.0' }
        ]),
      'mixes'
    ],
    [
      'a short commit in a range',
      (p) => (p.grants = [{ arg: '--enable-assets', commit_ranges: [['abc1234', null]] }]),
      'bad commit_ranges'
    ],
    ['blockers missing', (p) => delete p.blockers, 'blockers must list'],
    ['blockers empty', (p) => (p.blockers = []), 'blockers must list'],
    [
      'nine blockers',
      (p) => (p.blockers = Array.from({ length: 9 }, (_, i) => ({ id: `b${i}` }))),
      'blockers must list'
    ],
    ['a blocker id with spaces', (p) => (p.blockers = [{ id: 'core 1' }]), 'id is missing'],
    ['a blocker with no id', (p) => (p.blockers = [{ fixed_in: '0.38.0' }]), 'id is missing'],
    ['duplicate blocker ids', (p) => (p.blockers = [{ id: 'x' }, { id: 'x' }]), 'duplicate'],
    ['fix_commits not a list', (p) => (p.blockers = [{ id: 'x', fix_commits: FIX }]), 'not a list'],
    [
      'five fix commits',
      (p) => (p.blockers = [{ id: 'x', fix_commits: Array(5).fill(FIX) }]),
      'not a list'
    ],
    [
      'an abbreviated fix commit',
      (p) => (p.blockers = [{ id: 'x', fix_commits: ['f'.repeat(12)] }]),
      'bad commit'
    ],
    [
      'an abbreviated introduced commit',
      (p) => (p.blockers = [{ id: 'x', introduced_commits: ['e'.repeat(39)] }]),
      'bad commit'
    ],
    ['a bad fixed_in', (p) => (p.blockers = [{ id: 'x', fixed_in: 'soon' }]), 'fixed_in'],
    [
      'a bad introduced_in',
      (p) => (p.blockers = [{ id: 'x', introduced_in: 39 }]),
      'introduced_in'
    ],
    ['epoch missing', (p) => delete p.epoch, 'epoch'],
    ['a negative epoch', (p) => (p.epoch = -1), 'epoch'],
    ['a fractional epoch', (p) => (p.epoch = 1.5), 'epoch'],
    ['a string epoch', (p) => (p.epoch = '1'), 'epoch'],
    ['min_desktop_version missing', (p) => delete p.min_desktop_version, 'min_desktop_version'],
    ['a bad min_desktop_version', (p) => (p.min_desktop_version = '1.1'), 'min_desktop_version'],
    ['include_telemetry_off missing', (p) => delete p.include_telemetry_off, 'include_telemetry'],
    [
      'include_beta_off_with_telemetry as a string',
      (p) => (p.include_beta_off_with_telemetry = 'true'),
      'include_beta_off'
    ],
    [
      'twenty commits in all',
      (p) =>
        (p.blockers = Array.from({ length: 5 }, (_, i) => ({
          id: `b${i}`,
          fix_commits: [0, 1, 2, 3].map((j) => (i * 4 + j).toString(16).padStart(40, '0'))
        }))),
      'more than 16 commits'
    ]
  ]
  it.each(breaks)('refuses the whole payload with %s', (_, mutate, reason) => {
    const payload = validPayload()
    mutate(payload)
    expect(parseCoreRollout(true, payload)).toEqual({
      kind: 'off',
      reason: expect.stringContaining(reason)
    })
  })

  it('accepts exactly sixteen commits', () => {
    const payload = validPayload()
    payload.blockers = Array.from({ length: 4 }, (_, i) => ({
      id: `b${i}`,
      fix_commits: [0, 1, 2, 3].map((j) => (i * 4 + j).toString(16).padStart(40, '0'))
    }))
    expect(coreRolloutShas(parsedOn(payload))).toHaveLength(16)
  })

  it('refuses a beta payload pasted into the rollout key', () => {
    const beta = { flags: [{ arg: '--enable-assets', min_core_version: '0.39.0' }] }
    expect(parseCoreRollout(true, beta)).toEqual({
      kind: 'off',
      reason: expect.stringContaining('grants must list')
    })
  })

  it.each([null, [], 'grants', 7])('refuses a payload of %j', (payload) => {
    expect(parseCoreRollout(true, payload).kind).toBe('off')
  })
})

describe('coreRolloutShas', () => {
  it('collects range bounds, fix and introduced commits once each', () => {
    const payload = validPayload()
    payload.grants = [
      { arg: '--enable-assets', commit_ranges: [[LOWER, UPPER]] },
      { arg: '--enable-assets', commit_ranges: [[LOWER, null]] }
    ]
    payload.blockers = [{ id: 'x', fix_commits: [FIX, UPPER], introduced_commits: [INTRO] }]
    expect(coreRolloutShas(parsedOn(payload)).sort()).toEqual([LOWER, UPPER, INTRO, FIX].sort())
  })
})

describe('coreRolloutEligibility', () => {
  const on = (): CoreRolloutState => ({ kind: 'on', rollout: parsedOn() })
  const withIncludes = (telemetryOff: boolean, betaOff: boolean): CoreRolloutState => ({
    kind: 'on',
    rollout: {
      ...parsedOn(),
      includeTelemetryOff: telemetryOff,
      includeBetaOffWithTelemetry: betaOff
    }
  })

  it('refuses at the payload gate with the parse reason', () => {
    expect(coreRolloutEligibility({ kind: 'off', reason: 'flag served false' }, facts())).toEqual({
      eligible: false,
      gate: 'payload',
      reason: 'flag served false'
    })
  })

  it.each([
    ['1.1.6', true],
    ['v1.1.6', true],
    ['1.2.0', true],
    ['1.1.5', false],
    ['1.1.6-rc.1', false],
    ['1.1.5-12-gabcdef0', false],
    ['dev', false]
  ])('desktop %s against min 1.1.6: eligible=%s', (appVersion, want) => {
    const result = coreRolloutEligibility(on(), facts({ appVersion }))
    expect(result.eligible ? 'eligible' : result.gate).toBe(want ? 'eligible' : 'desktop')
  })

  it.each([
    ['standalone', true],
    ['git', false],
    ['portable', false],
    ['desktop', false],
    ['comfybuilder', false],
    ['remote', false]
  ])('source %s: eligible=%s', (sourceId, want) => {
    const result = coreRolloutEligibility(on(), facts({ sourceId }))
    expect(result.eligible ? 'eligible' : result.gate).toBe(want ? 'eligible' : 'install')
  })

  // beta × consent × the payload's two audience switches.
  const cohortRows: [
    boolean | 'unknown',
    'granted' | 'denied' | 'undecided',
    boolean,
    boolean,
    string
  ][] = [
    [true, 'granted', true, true, 'beta features are on'],
    [true, 'denied', true, true, 'beta features are on'],
    ['unknown', 'denied', true, true, 'could not be read'],
    ['unknown', 'granted', true, true, 'could not be read'],
    [false, 'granted', false, true, 'beta-off-with-telemetry'],
    [false, 'granted', true, false, 'excludes beta-off users'],
    [false, 'denied', true, false, 'telemetry-off'],
    [false, 'denied', false, true, 'excludes telemetry-off'],
    [false, 'undecided', true, true, 'not decided']
  ]
  it.each(cohortRows)(
    'beta=%j consent=%s include_telemetry_off=%s include_beta_off_with_telemetry=%s: %s',
    (beta, consent, telemetryOff, betaOff, want) => {
      const result = coreRolloutEligibility(
        withIncludes(telemetryOff, betaOff),
        facts({ beta, consent })
      )
      if (result.eligible) expect(result.cohort).toBe(want)
      else {
        expect(result.gate).toBe('cohort')
        expect(result.reason).toContain(want)
      }
    }
  )

  it.each([
    [['--enable-assets'], 'already in the launch args'],
    [['--disable-assets'], 'the launch args contain --disable-assets']
  ])('yields to the user arg %j', (userArgs, reason) => {
    expect(coreRolloutEligibility(on(), facts({ userArgs }))).toEqual({
      eligible: false,
      gate: 'launch-args',
      reason
    })
  })
})

describe('blockerShortfall', () => {
  const blocker = (over: Partial<CoreRolloutBlocker> = {}): CoreRolloutBlocker => ({
    id: 'x',
    fixCommits: [],
    introducedCommits: [],
    ...over
  })

  const rows: [string, Partial<CoreRolloutBlocker>, CoreVersionState, CoreCommitState, string][] = [
    ['fix commit contained', { fixCommits: [FIX] }, core(), commits({ [FIX]: true }), 'clear'],
    ['fix commit absent', { fixCommits: [FIX] }, core(), commits({ [FIX]: false }), 'applies'],
    ['fix commit unresolved', { fixCommits: [FIX] }, core(), commits({}), 'applies'],
    [
      'fixed_in met by a verified floor (not exact)',
      { fixedIn: '0.38.0' },
      core({ exact: false }),
      NO_CORE_COMMITS,
      'clear'
    ],
    ['fixed_in above the version', { fixedIn: '0.40.0' }, core(), NO_CORE_COMMITS, 'applies'],
    [
      'fixed_in on an unverified version',
      { fixedIn: '0.38.0' },
      core({ verified: false }),
      NO_CORE_COMMITS,
      'applies'
    ],
    [
      'fixed_in on a stale record',
      { fixedIn: '0.38.0' },
      core({ current: false }),
      NO_CORE_COMMITS,
      'applies'
    ],
    [
      'fixed_in with no version',
      { fixedIn: '0.38.0' },
      core({ semver: null }),
      NO_CORE_COMMITS,
      'applies'
    ],
    ['no fix and no scope (global off)', {}, core(), NO_CORE_COMMITS, 'applies'],
    [
      'introduced commit proven absent',
      { introducedCommits: [INTRO] },
      core(),
      commits({ [INTRO]: false }),
      'clear'
    ],
    [
      'introduced commits: one absent, one unresolved',
      { introducedCommits: [INTRO, UPPER] },
      core(),
      commits({ [INTRO]: false }),
      'may apply'
    ],
    [
      'introduced commit contained, no fix',
      { introducedCommits: [INTRO] },
      core(),
      commits({ [INTRO]: true }),
      'applies'
    ],
    [
      'introduced commit contained, fix contained',
      { introducedCommits: [INTRO], fixCommits: [FIX] },
      core(),
      commits({ [INTRO]: true, [FIX]: true }),
      'clear'
    ],
    [
      'introduced_in above an exact release',
      { introducedIn: '0.40.0' },
      core(),
      NO_CORE_COMMITS,
      'clear'
    ],
    [
      'introduced_in above a non-exact release',
      { introducedIn: '0.40.0' },
      core({ exact: false }),
      NO_CORE_COMMITS,
      'may apply'
    ],
    [
      'introduced_in above an unverified release',
      { introducedIn: '0.40.0' },
      core({ verified: false }),
      NO_CORE_COMMITS,
      'may apply'
    ],
    [
      'introduced_in at the release',
      { introducedIn: '0.39.0' },
      core(),
      NO_CORE_COMMITS,
      'applies'
    ],
    [
      'introduced_in at the release, fixed_in met',
      { introducedIn: '0.39.0', fixedIn: '0.39.0' },
      core(),
      NO_CORE_COMMITS,
      'clear'
    ],
    [
      'introduced commit absent but introduced_in reached: in scope wins',
      { introducedCommits: [INTRO], introducedIn: '0.38.0' },
      core(),
      commits({ [INTRO]: false }),
      'applies'
    ],
    [
      'no readable HEAD, scoped by commit only',
      { introducedCommits: [INTRO] },
      core(),
      commits({}, null),
      'may apply'
    ]
  ]
  it.each(rows)('%s', (_, over, coreState, commitState, want) => {
    const result = blockerShortfall(blocker(over), coreState, commitState)
    if (want === 'clear') expect(result).toBeNull()
    else expect(result).toContain(want)
  })
})

describe('selectCoreRolloutArg', () => {
  const eligible = (rollout: CoreRollout = parsedOn()) =>
    coreRolloutEligibility({ kind: 'on', rollout }, facts())

  it('grants with the epoch and cohort when an entry matches and every blocker clears', () => {
    expect(selectCoreRolloutArg(eligible(), core(), commits({ [FIX]: true }), [])).toMatchObject({
      granted: true,
      epoch: 1,
      cohort: 'telemetry-off'
    })
  })

  it('lets one unmet blocker veto, however loose the entries (the OR-union leak)', () => {
    const payload = validPayload()
    payload.grants = [
      { arg: '--enable-assets', min_core_version: '0.39.0', max_core_version: '0.40.0' },
      { arg: '--enable-assets', min_core_version: '0.0.1' }
    ]
    payload.blockers = [
      { id: 'met', fixed_in: '0.30.0' },
      { id: 'unmet', fix_commits: [FIX] }
    ]
    expect(selectCoreRolloutArg(eligible(parsedOn(payload)), core(), commits({}), [])).toEqual({
      granted: false,
      gate: 'blocker',
      reason: expect.stringContaining('blocker unmet applies')
    })
  })

  it('refuses at the core gate, naming every entry, when no entry matches', () => {
    const payload = validPayload()
    payload.grants = [
      { arg: '--enable-assets', min_core_version: '0.40.0' },
      { arg: '--enable-assets', commit_ranges: [[LOWER, null]] }
    ]
    expect(
      selectCoreRolloutArg(eligible(parsedOn(payload)), core(), commits({ [FIX]: true }), [])
    ).toEqual({
      granted: false,
      gate: 'core',
      reason: expect.stringMatching(/entry 1: version 0.39.0 < min 0.40.0; entry 2: commit range/)
    })
  })

  it('refuses a max bound on a non-exact release', () => {
    const payload = validPayload()
    payload.grants = [
      { arg: '--enable-assets', min_core_version: '0.39.0', max_core_version: '0.40.0' }
    ]
    const decision = selectCoreRolloutArg(
      eligible(parsedOn(payload)),
      core({ exact: false }),
      commits({ [FIX]: true }),
      []
    )
    expect(decision).toMatchObject({ granted: false, gate: 'core' })
  })

  it('yields to an arg the beta key selected', () => {
    expect(
      selectCoreRolloutArg(eligible(), core(), commits({ [FIX]: true }), ['--disable-assets'])
    ).toEqual({
      granted: false,
      gate: 'launch-args',
      reason: 'the launch args contain --disable-assets'
    })
  })

  it('passes a refusal from eligibility straight through', () => {
    const refused = coreRolloutEligibility(
      { kind: 'on', rollout: parsedOn() },
      facts({ beta: true })
    )
    expect(selectCoreRolloutArg(refused, core(), commits({ [FIX]: true }), [])).toMatchObject({
      granted: false,
      gate: 'cohort'
    })
  })
})

describe('coreRolloutRecord', () => {
  it('names the cohort and epoch of a grant', () => {
    expect(
      coreRolloutRecord({
        granted: true,
        grant: { arg: '--enable-assets', minCoreVersion: '0.39.0' },
        epoch: 3,
        cohort: 'telemetry-off'
      })
    ).toBe(
      '[core-rollout] --enable-assets granted (cohort telemetry-off, epoch 3, blockers clear)\n'
    )
  })

  it('names the first refusing gate and its reason', () => {
    expect(coreRolloutRecord({ granted: false, gate: 'install', reason: 'source git' })).toBe(
      '[core-rollout] --enable-assets withheld at install: source git\n'
    )
  })
})

describe('the desktop_core_rollout flag', () => {
  beforeEach(() => {
    getOpsFlagResult.mockReset()
    testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-rollout-'))
    _resetForTest()
  })
  afterEach(() => {
    _resetForTest()
    fs.rmSync(testConfigDir, { recursive: true, force: true })
  })

  it('fetches its own key and parses the payload', async () => {
    getOpsFlagResult.mockResolvedValue({ kind: 'value', value: true, payload: validPayload() })
    await initCoreRollout({ distinctId: 'install-id' })
    expect(getOpsFlagResult.mock.calls[0]?.[0]).toBe(CORE_ROLLOUT_FLAG_KEY)
    expect((await getCoreRolloutAsync()).kind).toBe('on')
  })

  it('holds a stored payload offline, and drops one older than the window', async () => {
    getOpsFlagResult.mockResolvedValue({ kind: 'value', value: true, payload: validPayload() })
    await initCoreRollout({ distinctId: 'install-id' })

    _resetForTest()
    getOpsFlagResult.mockResolvedValue({ kind: 'unreachable' })
    await initCoreRollout({ distinctId: 'install-id' })
    expect((await getCoreRolloutAsync()).kind).toBe('on')

    const file = path.join(testConfigDir, 'ops-flags.json')
    const stored = JSON.parse(fs.readFileSync(file, 'utf-8'))
    stored[CORE_ROLLOUT_FLAG_KEY].fetchedAt -= 15 * 24 * 60 * 60 * 1000
    fs.writeFileSync(file, JSON.stringify(stored))
    _resetForTest()
    await initCoreRollout({ distinctId: 'install-id' })
    expect(await getCoreRolloutAsync()).toEqual({
      kind: 'off',
      reason: expect.stringContaining('no flag value')
    })
  })
})
