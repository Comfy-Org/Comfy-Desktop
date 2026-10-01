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
  coreRolloutRecords,
  coreRolloutShas,
  eligibleRolloutShas,
  getCoreRolloutAsync,
  initCoreRollout,
  parseCoreRollout,
  selectCoreRolloutArgs
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

type Json = Record<string, unknown>

const assetsGrant = (over: Json = {}): Json => ({
  arg: '--enable-assets',
  epoch: 1,
  windows: [{ min_core_version: '0.39.0' }],
  blockers: [{ id: 'core-16646', fix_commits: [FIX], fixed_in: '0.38.0' }],
  ...over
})

/** A payload every gate accepts; each test breaks exactly one thing. */
function validPayload(grants: Json[] = [assetsGrant()]): Json {
  return {
    grants,
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
  return { appVersion: '1.1.6', sourceId: 'standalone', beta: false, consent: 'denied', ...over }
}

const on = (rollout: CoreRollout = parsedOn()): CoreRolloutState => ({ kind: 'on', rollout })

describe('parseCoreRollout flag value', () => {
  it.each([true, 'rollout', 'rollout-a', 'rollout-phase2'])('accepts %j', (value) => {
    expect(parseCoreRollout(value, validPayload()).kind).toBe('on')
  })

  it.each([
    [undefined, 'key not served, or server unreachable'],
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
  it('parses one grant per arg, each with its own windows, blockers, epoch and sources', () => {
    const payload = validPayload([
      assetsGrant({
        epoch: 3,
        windows: [
          { min_core_version: 'v0.39.0', max_core_version: '0.40.0' },
          { commit_ranges: [[LOWER, null]] }
        ],
        blockers: [
          { id: 'a', fix_commits: [FIX], introduced_commits: [INTRO], introduced_in: '0.37.0' },
          { id: 'b' }
        ]
      }),
      {
        arg: '--enable-agent',
        epoch: 1,
        windows: [{ min_core_version: '0.40.0' }],
        blockers: [{ id: 'agent-floor', fixed_in: '0.40.0' }],
        install_sources: ['standalone', 'git']
      },
      {
        arg: '--enable-asset-hashing',
        epoch: 0,
        windows: [{ min_core_version: '0.39.0' }],
        blockers: [{ id: 'h', fixed_in: '0.39.0' }]
      }
    ])
    expect(parsedOn(payload)).toEqual({
      grants: [
        {
          arg: '--enable-assets',
          epoch: 3,
          windows: [
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
          installSources: ['standalone']
        },
        {
          arg: '--enable-agent',
          epoch: 1,
          windows: [{ arg: '--enable-agent', minCoreVersion: '0.40.0' }],
          blockers: [
            { id: 'agent-floor', fixCommits: [], fixedIn: '0.40.0', introducedCommits: [] }
          ],
          installSources: ['standalone', 'git']
        },
        {
          arg: '--enable-asset-hashing',
          epoch: 0,
          windows: [{ arg: '--enable-asset-hashing', minCoreVersion: '0.39.0' }],
          blockers: [{ id: 'h', fixCommits: [], fixedIn: '0.39.0', introducedCommits: [] }],
          installSources: ['standalone']
        }
      ],
      minDesktopVersion: '1.1.6',
      includeTelemetryOff: true,
      includeBetaOffWithTelemetry: true
    })
  })

  it('lets a force-off grant name no blockers', () => {
    const payload = validPayload([
      { arg: '--disable-assets', epoch: 1, windows: [{ min_core_version: '0.39.0' }], blockers: [] }
    ])
    expect(parsedOn(payload).grants[0]).toMatchObject({ arg: '--disable-assets', blockers: [] })
  })

  it('ignores unknown top-level keys', () => {
    const payload: Json = { ...validPayload(), future_field: 1 }
    expect(parsedOn(payload).grants).toHaveLength(1)
  })

  const window = (w: Json): Json[] => [assetsGrant({ windows: [w] })]
  const grantOf = (over: Json): Json[] => [assetsGrant(over)]
  // Each row breaks one field; ONE bad field must refuse the whole payload, never just the entry.
  const breaks: [string, (p: Json) => void, string][] = [
    ['grants missing', (p) => delete p.grants, 'grants must list'],
    ['grants empty', (p) => (p.grants = []), 'grants must list'],
    [
      'more grants than the allowlist has args',
      (p) => (p.grants = Array(5).fill(assetsGrant())),
      'grants must list'
    ],
    ['a grant that is not an object', (p) => (p.grants = ['--enable-assets']), 'not an object'],
    ...['--listen', '--disable-asset-hashing', '--enable-assets ', '--ENABLE-ASSETS', 7].map(
      (arg): [string, (p: Json) => void, string] => [
        `a grant of ${JSON.stringify(arg)}`,
        (p) => (p.grants = grantOf({ arg })),
        'not an allowlisted arg'
      ]
    ),
    ['the same arg twice', (p) => (p.grants = [assetsGrant(), assetsGrant()]), 'more than once'],
    [
      'an arg and its opposite',
      (p) =>
        (p.grants = [
          assetsGrant(),
          {
            arg: '--disable-assets',
            epoch: 1,
            windows: [{ min_core_version: '0.39.0' }],
            blockers: []
          }
        ]),
      'names both --enable-assets and --disable-assets'
    ],
    [
      'a misspelt key on a grant (would read as the default)',
      (p) => (p.grants = grantOf({ install_source: ['git'] })),
      'unknown key install_source'
    ],
    ...['introduced_comits', 'fixed_in_verison', 'fix_commit', 'note'].map(
      (key): [string, (p: Json) => void, string] => [
        `a blocker with unknown key ${key}`,
        (p) => (p.grants = grantOf({ blockers: [{ id: 'x', fixed_in: '0.38.0', [key]: [FIX] }] })),
        `unknown key ${key}`
      ]
    ),
    [
      'a beta notice field on a grant',
      (p) => (p.grants = grantOf({ notice: 'silent' })),
      'unknown key notice'
    ],
    ['epoch missing', (p) => (p.grants = [{ ...assetsGrant(), epoch: undefined }]), 'epoch'],
    ['a negative epoch', (p) => (p.grants = grantOf({ epoch: -1 })), 'epoch'],
    ['a fractional epoch', (p) => (p.grants = grantOf({ epoch: 1.5 })), 'epoch'],
    ['a string epoch', (p) => (p.grants = grantOf({ epoch: '1' })), 'epoch'],
    ['windows missing', (p) => (p.grants = grantOf({ windows: undefined })), 'windows must list'],
    ['windows empty', (p) => (p.grants = grantOf({ windows: [] })), 'windows must list'],
    [
      'nine windows',
      (p) => (p.grants = grantOf({ windows: Array(9).fill({ min_core_version: '0.39.0' }) })),
      'windows must list'
    ],
    [
      'a misspelt max_core_version (would read as an open bound)',
      (p) => (p.grants = window({ min_core_version: '0.39.0', max_core_verison: '0.40.0' })),
      'unknown key max_core_verison'
    ],
    ['a window with no bound', (p) => (p.grants = window({})), 'min_core_version missing'],
    ['a bad min', (p) => (p.grants = window({ min_core_version: 'latest' })), 'min_core_version'],
    [
      'max equal to min',
      (p) => (p.grants = window({ min_core_version: '0.39.0', max_core_version: '0.39.0' })),
      'not above'
    ],
    [
      'max below min',
      (p) => (p.grants = window({ min_core_version: '0.39.0', max_core_version: '0.38.0' })),
      'not above'
    ],
    [
      'commit ranges mixed with a version',
      (p) => (p.grants = window({ commit_ranges: [[LOWER, null]], min_core_version: '0.39.0' })),
      'mixes'
    ],
    [
      'a short commit in a range',
      (p) => (p.grants = window({ commit_ranges: [['abc1234', null]] })),
      'bad commit_ranges'
    ],
    [
      'blockers missing',
      (p) => (p.grants = grantOf({ blockers: undefined })),
      'blockers must list'
    ],
    [
      'nine blockers',
      (p) =>
        (p.grants = grantOf({ blockers: Array.from({ length: 9 }, (_, i) => ({ id: `b${i}` })) })),
      'blockers must list'
    ],
    ...['--enable-assets', '--enable-asset-hashing', '--enable-agent'].map(
      (arg): [string, (p: Json) => void, string] => [
        `${arg} with no blockers`,
        (p) => (p.grants = grantOf({ arg, blockers: [] })),
        `${arg} needs at least one blocker`
      ]
    ),
    [
      'a blocker id with spaces',
      (p) => (p.grants = grantOf({ blockers: [{ id: 'core 1' }] })),
      'id is missing'
    ],
    [
      'a blocker with no id',
      (p) => (p.grants = grantOf({ blockers: [{ fixed_in: '0.38.0' }] })),
      'id is missing'
    ],
    [
      'duplicate blocker ids',
      (p) => (p.grants = grantOf({ blockers: [{ id: 'x' }, { id: 'x' }] })),
      'duplicate'
    ],
    [
      'fix_commits not a list',
      (p) => (p.grants = grantOf({ blockers: [{ id: 'x', fix_commits: FIX }] })),
      'not a list'
    ],
    [
      'five fix commits',
      (p) => (p.grants = grantOf({ blockers: [{ id: 'x', fix_commits: Array(5).fill(FIX) }] })),
      'not a list'
    ],
    [
      'an abbreviated fix commit',
      (p) => (p.grants = grantOf({ blockers: [{ id: 'x', fix_commits: ['f'.repeat(12)] }] })),
      'bad commit'
    ],
    [
      'an abbreviated introduced commit',
      (p) =>
        (p.grants = grantOf({ blockers: [{ id: 'x', introduced_commits: ['e'.repeat(39)] }] })),
      'bad commit'
    ],
    [
      'a bad fixed_in',
      (p) => (p.grants = grantOf({ blockers: [{ id: 'x', fixed_in: 'soon' }] })),
      'fixed_in'
    ],
    [
      'a bad introduced_in',
      (p) => (p.grants = grantOf({ blockers: [{ id: 'x', introduced_in: 39 }] })),
      'introduced_in'
    ],
    ...[[], 'standalone', ['desktop'], ['remote'], ['cloud'], ['Standalone'], [7]].map(
      (sources): [string, (p: Json) => void, string] => [
        `install_sources ${JSON.stringify(sources)}`,
        (p) => (p.grants = grantOf({ install_sources: sources })),
        'install_sources'
      ]
    ),
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
        (p.grants = grantOf({
          blockers: Array.from({ length: 5 }, (_, i) => ({
            id: `b${i}`,
            fix_commits: [0, 1, 2, 3].map((j) => (i * 4 + j).toString(16).padStart(40, '0'))
          }))
        })),
      'more than 16 commits'
    ]
  ]
  it.each(breaks)('refuses the whole payload with %s', (_, mutate, reason) => {
    const payload = validPayload([
      assetsGrant(),
      {
        arg: '--enable-agent',
        epoch: 1,
        windows: [{ min_core_version: '0.40.0' }],
        blockers: [{ id: 'a', fixed_in: '0.40.0' }]
      }
    ])
    mutate(payload)
    expect(parseCoreRollout(true, payload)).toEqual({
      kind: 'off',
      reason: expect.stringContaining(reason)
    })
  })

  it('counts the commit cap across grants, a shared commit once', () => {
    const fixes = (i: number): string[] =>
      [0, 1, 2, 3].map((j) => (i * 4 + j).toString(16).padStart(40, '0'))
    const payload = validPayload([
      assetsGrant({ blockers: [0, 1].map((i) => ({ id: `b${i}`, fix_commits: fixes(i) })) }),
      {
        arg: '--enable-agent',
        epoch: 1,
        windows: [{ min_core_version: '0.40.0' }],
        blockers: [1, 2, 3].map((i) => ({ id: `b${i}`, fix_commits: fixes(i) }))
      }
    ])
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
  it('collects range bounds, fix and introduced commits once each, across grants', () => {
    const payload = validPayload([
      assetsGrant({
        windows: [{ commit_ranges: [[LOWER, UPPER]] }, { commit_ranges: [[LOWER, null]] }],
        blockers: [{ id: 'x', fix_commits: [FIX, UPPER], introduced_commits: [INTRO] }]
      }),
      {
        arg: '--enable-agent',
        epoch: 1,
        windows: [{ commit_ranges: [[LOWER, null]] }],
        blockers: [{ id: 'y', fix_commits: [FIX] }]
      }
    ])
    expect(coreRolloutShas(parsedOn(payload)).sort()).toEqual([LOWER, UPPER, INTRO, FIX].sort())
  })
})

describe('coreRolloutEligibility', () => {
  const withIncludes = (telemetryOff: boolean, betaOff: boolean): CoreRolloutState =>
    on({ ...parsedOn(), includeTelemetryOff: telemetryOff, includeBetaOffWithTelemetry: betaOff })

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
})

describe('eligibleRolloutShas', () => {
  const payload = validPayload([
    assetsGrant({ blockers: [{ id: 'x', fix_commits: [FIX] }] }),
    {
      arg: '--enable-agent',
      epoch: 1,
      windows: [{ commit_ranges: [[LOWER, null]] }],
      blockers: [{ id: 'y', fix_commits: [INTRO] }],
      install_sources: ['git']
    }
  ])

  it('relates only the commits of grants this install and these args leave open', () => {
    const standalone = coreRolloutEligibility(on(parsedOn(payload)), facts())
    expect(eligibleRolloutShas(standalone, [])).toEqual([FIX])
    expect(eligibleRolloutShas(standalone, ['--disable-assets'])).toEqual([])
    const git = coreRolloutEligibility(on(parsedOn(payload)), facts({ sourceId: 'git' }))
    expect(eligibleRolloutShas(git, []).sort()).toEqual([LOWER, INTRO].sort())
  })

  it('relates nothing for a refused launch', () => {
    expect(
      eligibleRolloutShas(coreRolloutEligibility(on(parsedOn(payload)), facts({ beta: true })), [])
    ).toEqual([])
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
      'below introduced_in on an exact tag, but the named backport commit unresolved',
      { introducedCommits: [INTRO], introducedIn: '0.40.0' },
      core(),
      commits({}),
      'may apply'
    ],
    [
      'introduced commit proven absent, but introduced_in has no trusted version',
      { introducedCommits: [INTRO], introducedIn: '0.40.0' },
      core({ verified: false }),
      commits({ [INTRO]: false }),
      'may apply'
    ],
    [
      'both signals prove absence',
      { introducedCommits: [INTRO], introducedIn: '0.40.0' },
      core(),
      commits({ [INTRO]: false }),
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

describe('selectCoreRolloutArgs', () => {
  const agentGrant = (over: Json = {}): Json => ({
    arg: '--enable-agent',
    epoch: 2,
    windows: [{ min_core_version: '0.39.0' }],
    blockers: [{ id: 'agent-floor', fixed_in: '0.39.0' }],
    ...over
  })
  const select = (
    grants: Json[],
    over: {
      facts?: Partial<CoreRolloutLaunchFacts>
      core?: CoreVersionState
      commits?: CoreCommitState
      present?: string[]
    } = {}
  ) =>
    selectCoreRolloutArgs(
      coreRolloutEligibility(on(parsedOn(validPayload(grants))), facts(over.facts)),
      over.core ?? core(),
      over.commits ?? commits({ [FIX]: true }),
      over.present ?? []
    )

  it('decides each arg on its own, with its own epoch', () => {
    expect(select([assetsGrant(), agentGrant()])).toEqual({
      evaluated: true,
      cohort: 'telemetry-off',
      args: [
        { arg: '--enable-assets', granted: true, epoch: 1 },
        { arg: '--enable-agent', granted: true, epoch: 2 }
      ]
    })
  })

  it("keeps one arg's blocker from holding back another", () => {
    const decision = select(
      [assetsGrant({ blockers: [{ id: 'x', fix_commits: [FIX] }] }), agentGrant()],
      { commits: commits({ [FIX]: false }) }
    )
    expect(decision).toMatchObject({
      args: [
        { arg: '--enable-assets', granted: false, gate: 'blocker' },
        { arg: '--enable-agent', granted: true }
      ]
    })
  })

  it("lets one unmet blocker veto its arg, however loose that arg's windows (the OR-union leak)", () => {
    const loose = assetsGrant({
      windows: [
        { min_core_version: '0.39.0', max_core_version: '0.40.0' },
        { min_core_version: '0.0.1' }
      ],
      blockers: [
        { id: 'met', fixed_in: '0.30.0' },
        { id: 'unmet', fix_commits: [FIX] }
      ]
    })
    expect(select([loose], { commits: commits({}) })).toMatchObject({
      args: [
        {
          arg: '--enable-assets',
          granted: false,
          gate: 'blocker',
          reason: expect.stringContaining('blocker unmet applies')
        }
      ]
    })
  })

  it('withholds a grant on an install source it does not list, standalone by default', () => {
    const decision = select(
      [assetsGrant(), agentGrant({ install_sources: ['git', 'standalone'] })],
      {
        facts: { sourceId: 'git' }
      }
    )
    expect(decision).toMatchObject({
      args: [
        {
          arg: '--enable-assets',
          granted: false,
          gate: 'install',
          reason: 'source git is not in standalone'
        },
        { arg: '--enable-agent', granted: true }
      ]
    })
  })

  it("yields per arg to the user's own args", () => {
    expect(select([assetsGrant(), agentGrant()], { present: ['--disable-assets'] })).toMatchObject({
      args: [
        {
          arg: '--enable-assets',
          granted: false,
          gate: 'launch-args',
          reason: 'the launch args contain --disable-assets'
        },
        { arg: '--enable-agent', granted: true }
      ]
    })
    expect(select([agentGrant()], { present: ['--enable-agent'] })).toMatchObject({
      args: [{ granted: false, gate: 'launch-args', reason: 'already in the launch args' }]
    })
  })

  it('refuses at the core gate, naming every window, when none matches', () => {
    const grant = assetsGrant({
      windows: [{ min_core_version: '0.40.0' }, { commit_ranges: [[LOWER, null]] }]
    })
    expect(select([grant])).toMatchObject({
      args: [
        {
          granted: false,
          gate: 'core',
          reason: expect.stringMatching(
            /window 1: version 0.39.0 < min 0.40.0; window 2: commit range/
          )
        }
      ]
    })
  })

  it('refuses a max bound on a non-exact release', () => {
    const grant = assetsGrant({
      windows: [{ min_core_version: '0.39.0', max_core_version: '0.40.0' }]
    })
    expect(select([grant], { core: core({ exact: false }) })).toMatchObject({
      args: [{ granted: false, gate: 'core' }]
    })
  })

  it('grants a force-off with no blockers', () => {
    const off = {
      arg: '--disable-assets',
      epoch: 5,
      windows: [{ min_core_version: '0.39.0' }],
      blockers: []
    }
    expect(select([off], { commits: NO_CORE_COMMITS })).toMatchObject({
      args: [{ arg: '--disable-assets', granted: true, epoch: 5 }]
    })
  })

  it('passes a payload-wide refusal straight through', () => {
    expect(select([assetsGrant()], { facts: { beta: true } })).toMatchObject({
      evaluated: false,
      gate: 'cohort'
    })
  })
})

describe('coreRolloutRecords', () => {
  it('writes one line for a payload-wide refusal', () => {
    expect(
      coreRolloutRecords({ evaluated: false, gate: 'desktop', reason: 'app 1.1.5 < min 1.1.6' })
    ).toEqual(['[core-rollout] withheld at desktop: app 1.1.5 < min 1.1.6\n'])
  })

  it('writes one line per arg, naming cohort and epoch or the refusing gate', () => {
    expect(
      coreRolloutRecords({
        evaluated: true,
        cohort: 'telemetry-off',
        args: [
          { arg: '--enable-agent', granted: true, epoch: 3 },
          {
            arg: '--enable-assets',
            granted: false,
            gate: 'install',
            reason: 'source git is not in standalone'
          }
        ]
      })
    ).toEqual([
      '[core-rollout] --enable-agent granted (cohort telemetry-off, epoch 3, blockers clear)\n',
      '[core-rollout] --enable-assets withheld at install: source git is not in standalone\n'
    ])
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
