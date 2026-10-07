import { describe, expect, it } from 'vitest'
import {
  ENROL_MAX_AGE_MS,
  HOLD_MAX_AGE_MS,
  appliedPassThrough,
  campaignCandidateGrants,
  parseCampaignAnswer,
  parseCampaignRecords,
  parseCampaignRegistry,
  planCampaignArgs
} from './coreBetaCampaigns'
import type { CampaignAnswer, CampaignFacts } from './coreBetaCampaigns'
import type { ComfyArgsSchema } from './comfy-args'

const KEY = 'desktop_core_beta_agent'
const KEY_W2 = 'desktop_core_beta_agent_w2'
const NOW = Date.UTC(2026, 9, 7)
const HOUR_MS = 60 * 60 * 1000
const SHA = 'a'.repeat(40)

const schemaOf = (...names: string[]): ComfyArgsSchema => ({
  args: names.map((name) => ({
    name,
    flag: `--${name}`,
    help: '',
    type: 'boolean' as const,
    category: 'other'
  })),
  knownFlags: new Set(names)
})

function agentPayload(enrolment: unknown = { epoch: 1, epochs: [1] }, extra: object = {}): object {
  return {
    grants: [
      {
        arg: '--enable-agent',
        min_core_version: '0.3.60',
        requires_args: ['--enable-assets'],
        enrolment,
        ...extra
      }
    ],
    agent_requirements_override: { 'comfy-agent': '0.2.3' }
  }
}

function answer(variant: string | boolean, payload: unknown = agentPayload(), fetchedAt = NOW) {
  return parseCampaignAnswer(variant, payload, fetchedAt)!
}

function facts(overrides: Partial<CampaignFacts> = {}): CampaignFacts {
  return {
    registry: [{ key: KEY, args: ['--enable-agent'] }],
    answers: new Map([[KEY, answer('enrol')]]),
    records: {},
    betaEnabled: true,
    presentArgs: ['--enable-assets'],
    core: { semver: '0.3.61', exact: true, verified: true, current: true },
    commits: { head: null, ancestry: new Map() },
    schema: schemaOf('enable-agent', 'enable-assets'),
    idClass: 'machine_derived',
    now: NOW,
    ...overrides
  }
}

const member = { [KEY]: { '--enable-agent': { epoch: 1, enrolledAt: NOW - 30 * 24 * HOUR_MS } } }

function args(plan: ReturnType<typeof planCampaignArgs>): string[] {
  return plan.applied.map((entry) => entry.grant.arg)
}

describe('parseCampaignRegistry', () => {
  it('keeps well-formed entries in order', () => {
    expect(
      parseCampaignRegistry(true, [
        { key: KEY, args: ['--enable-agent'] },
        { key: KEY_W2, args: ['--enable-agent'] }
      ])
    ).toEqual([
      { key: KEY, args: ['--enable-agent'] },
      { key: KEY_W2, args: ['--enable-agent'] }
    ])
  })

  it('has no answer without a value, so the saved registry holds', () => {
    expect(parseCampaignRegistry(undefined, undefined)).toBeUndefined()
  })

  it.each([
    ['false', false, [{ key: KEY, args: ['--enable-agent'] }]],
    ['a non-array payload', true, { key: KEY }],
    [
      'more than 8 entries',
      true,
      Array.from({ length: 9 }, (_, i) => ({ key: `k${i}`, args: ['--enable-agent'] }))
    ]
  ])('lists nothing for %s', (_label, value, payload) => {
    expect(parseCampaignRegistry(value, payload)).toEqual([])
  })

  it('skips slot #0, the registry itself, repeats, bad keys and non --enable- args', () => {
    expect(
      parseCampaignRegistry(true, [
        { key: 'desktop_core_beta_features', args: ['--enable-agent'] },
        { key: 'desktop_campaigns', args: ['--enable-agent'] },
        { key: 'Bad-Key', args: ['--enable-agent'] },
        { key: KEY, args: ['--disable-assets'] },
        { key: KEY, args: [] },
        { key: KEY, args: ['--enable-agent'] },
        { key: KEY, args: ['--enable-assets'] }
      ])
    ).toEqual([{ key: KEY, args: ['--enable-agent'] }])
  })
})

describe('parseCampaignAnswer', () => {
  it('reads the variant, grant, enrolment, requirement and fetch time', () => {
    const parsed = answer('enrol')
    expect(parsed.enrol).toBe(true)
    expect(parsed.fetchedAt).toBe(NOW)
    expect(parsed.grants).toEqual([
      {
        grant: { arg: '--enable-agent', minCoreVersion: '0.3.60' },
        epoch: 1,
        epochs: [1],
        requiresArgs: ['--enable-assets']
      }
    ])
  })

  it.each([['hold'], [true], ['ENROL']])('only the exact enrol variant enrols: %s', (variant) => {
    expect(answer(variant).enrol).toBe(false)
  })

  it('grants nothing on false, keeping the answer so it overwrites a saved one', () => {
    expect(answer(false)).toMatchObject({ enrol: false, grants: [] })
  })

  it.each([
    ['missing', undefined],
    ['not an object', 1],
    ['a zero epoch', { epoch: 0, epochs: [0] }],
    ['epochs without the epoch', { epoch: 2, epochs: [1] }],
    ['a fractional epoch', { epoch: 1.5, epochs: [1.5] }],
    ['too many epochs', { epoch: 1, epochs: Array.from({ length: 17 }, (_, i) => i + 1) }]
  ])(
    'drops a grant whose enrolment is %s, never degrading it to a plain grant',
    (_l, enrolment) => {
      const payload = agentPayload(enrolment)
      if (enrolment === undefined)
        delete (payload as { grants: Array<{ enrolment?: unknown }> }).grants[0]!.enrolment
      expect(answer('enrol', payload).grants).toEqual([])
    }
  )

  it('drops a non --enable- grant and a malformed requires_args', () => {
    expect(
      answer('enrol', {
        grants: [
          {
            arg: '--disable-assets',
            min_core_version: '0.3.0',
            enrolment: { epoch: 1, epochs: [1] }
          }
        ]
      }).grants
    ).toEqual([])
    expect(
      answer('enrol', agentPayload(undefined, { requires_args: '--enable-assets' })).grants
    ).toEqual([])
    expect(answer('enrol', agentPayload(undefined, { requires_args: [1] })).grants).toEqual([])
  })

  it('grants nothing when the payload names one arg twice', () => {
    const grant = agentPayload() as { grants: unknown[] }
    expect(answer('enrol', { grants: [grant.grants[0], grant.grants[0]] }).grants).toEqual([])
  })

  it('has no answer without a value', () => {
    expect(parseCampaignAnswer(undefined, undefined)).toBeUndefined()
  })
})

describe('campaignCandidateGrants', () => {
  const registry = [{ key: KEY, args: ['--enable-agent'] }]
  const grantOf = (variant: string, payload: unknown = agentPayload()) =>
    new Map([[KEY, answer(variant, payload)]])

  it('lists an enrol draw and a held member, and nothing for a non-member on hold', () => {
    expect(campaignCandidateGrants(registry, grantOf('enrol'), {})).toHaveLength(1)
    expect(campaignCandidateGrants(registry, grantOf('hold'), member)).toHaveLength(1)
    expect(campaignCandidateGrants(registry, grantOf('hold'), {})).toEqual([])
  })

  it('skips a void record, an unlisted arg and an unlisted key', () => {
    const voided = grantOf('hold', agentPayload({ epoch: 2, epochs: [2] }))
    expect(campaignCandidateGrants(registry, voided, member)).toEqual([])
    expect(
      campaignCandidateGrants([{ key: KEY, args: ['--enable-assets'] }], grantOf('enrol'), {})
    ).toEqual([])
    expect(campaignCandidateGrants([], grantOf('enrol'), {})).toEqual([])
  })
})

describe('parseCampaignRecords', () => {
  it('keeps well-formed records only', () => {
    expect(
      parseCampaignRecords({
        [KEY]: {
          '--enable-agent': { epoch: 1, enrolledAt: 5 },
          '--enable-x': { epoch: 0, enrolledAt: 5 }
        },
        broken: 'x'
      })
    ).toEqual({ [KEY]: { '--enable-agent': { epoch: 1, enrolledAt: 5 } } })
  })
})

describe('planCampaignArgs: enrol', () => {
  it('enrols a machine_derived, assets-on machine on a fresh enrol answer', () => {
    const plan = planCampaignArgs(facts())
    expect(plan.applied).toMatchObject([{ key: KEY, epoch: 1, enrolledNow: true, fetchedAt: NOW }])
    expect(args(plan)).toEqual(['--enable-agent'])
    expect(plan.misses).toEqual([])
  })

  it('refuses when assets is off: the requires_args gate', () => {
    const plan = planCampaignArgs(facts({ presentArgs: [] }))
    expect(plan.applied).toEqual([])
    expect(plan.misses).toEqual([
      { key: KEY, arg: '--enable-agent', member: false, reason: 'requires_args' }
    ])
  })

  it('counts a user-passed --enable-assets as assets on', () => {
    expect(args(planCampaignArgs(facts({ presentArgs: ['--enable-assets'] })))).toEqual([
      '--enable-agent'
    ])
  })

  it('a payload WITHOUT requires_args enrols an assets-off machine (the gate is the payload)', () => {
    const payload = agentPayload()
    delete (payload as { grants: Array<{ requires_args?: unknown }> }).grants[0]!.requires_args
    const plan = planCampaignArgs(
      facts({ presentArgs: [], answers: new Map([[KEY, answer('enrol', payload)]]) })
    )
    expect(args(plan)).toEqual(['--enable-agent'])
  })

  it.each([['random_fallback'], ['placeholder_fallback']] as const)(
    'never enrols on a %s id',
    (idClass) => {
      const plan = planCampaignArgs(facts({ idClass }))
      expect(plan.applied).toEqual([])
      expect(plan.misses).toMatchObject([{ member: false, reason: 'id_class' }])
    }
  )

  it.each([
    ['older than 48 h', NOW - ENROL_MAX_AGE_MS - 1],
    ['more than 1 h in the future', NOW + HOUR_MS + 1]
  ])('refuses an enrol answer %s', (_label, fetchedAt) => {
    const plan = planCampaignArgs(
      facts({ answers: new Map([[KEY, answer('enrol', agentPayload(), fetchedAt)]]) })
    )
    expect(plan.misses).toMatchObject([{ reason: 'stale_answer' }])
  })

  it('enrols on an answer exactly 48 h old', () => {
    const fetchedAt = NOW - ENROL_MAX_AGE_MS
    const plan = planCampaignArgs(
      facts({ answers: new Map([[KEY, answer('enrol', agentPayload(), fetchedAt)]]) })
    )
    expect(args(plan)).toEqual(['--enable-agent'])
  })

  it('refuses an enrol answer with no fetch time', () => {
    const plan = planCampaignArgs(
      facts({ answers: new Map([[KEY, parseCampaignAnswer('enrol', agentPayload())!]]) })
    )
    expect(plan.misses).toMatchObject([{ reason: 'stale_answer' }])
  })

  it('does nothing on hold for a machine that never enrolled', () => {
    const plan = planCampaignArgs(facts({ answers: new Map([[KEY, answer('hold')]]) }))
    expect(plan).toEqual({ applied: [], misses: [], trace: [] })
  })

  it('refuses when the user passed the arg or its opposite', () => {
    for (const userArg of ['--enable-agent', '--disable-agent']) {
      const plan = planCampaignArgs(facts({ presentArgs: ['--enable-assets', userArg] }))
      expect(plan.misses).toMatchObject([{ reason: 'present' }])
    }
  })

  it('refuses when the version gate fails, and when the core cannot parse the arg', () => {
    expect(
      planCampaignArgs(
        facts({ core: { semver: '0.3.59', exact: true, verified: true, current: true } })
      ).misses
    ).toMatchObject([{ reason: 'gates' }])
    expect(planCampaignArgs(facts({ schema: schemaOf('enable-assets') })).misses).toMatchObject([
      { reason: 'unsupported' }
    ])
  })

  it('honours a commit-range grant through the shared selection', () => {
    const payload = {
      grants: [
        {
          arg: '--enable-agent',
          commit_ranges: [[SHA, null]],
          enrolment: { epoch: 1, epochs: [1] }
        }
      ]
    }
    const base = facts({ answers: new Map([[KEY, answer('enrol', payload)]]) })
    expect(args(planCampaignArgs(base))).toEqual([])
    const inRange = { ...base, commits: { head: 'b'.repeat(40), ancestry: new Map([[SHA, true]]) } }
    expect(args(planCampaignArgs(inRange))).toEqual(['--enable-agent'])
  })

  it('applies nothing and records nothing when beta is off', () => {
    expect(planCampaignArgs(facts({ betaEnabled: false, records: member }))).toEqual({
      applied: [],
      misses: [],
      trace: []
    })
  })
})

describe('planCampaignArgs: hold', () => {
  const hold = (overrides: Partial<CampaignFacts> = {}): CampaignFacts =>
    facts({ answers: new Map([[KEY, answer('hold')]]), records: member, ...overrides })

  it('applies a recorded arg on hold, whatever the id class and answer age', () => {
    const old = answer('hold', agentPayload(), NOW - 6 * 24 * HOUR_MS)
    const plan = planCampaignArgs(
      hold({ idClass: 'random_fallback', answers: new Map([[KEY, old]]) })
    )
    expect(plan.applied).toMatchObject([{ key: KEY, epoch: 1, enrolledNow: false }])
  })

  it('drops a held grant once its answer is more than 7 days old, in the same process', () => {
    const sixDaysOld = answer('hold', agentPayload(), NOW - 6 * 24 * HOUR_MS)
    const facts6 = hold({ answers: new Map([[KEY, sixDaysOld]]) })
    expect(args(planCampaignArgs(facts6))).toEqual(['--enable-agent'])
    const later = planCampaignArgs({ ...facts6, now: NOW + 2 * 24 * HOUR_MS })
    expect(later.applied).toEqual([])
    expect(later.misses).toEqual([
      { key: KEY, arg: '--enable-agent', member: true, reason: 'stale_answer' }
    ])
  })

  it.each([
    ['exactly 7 days old', NOW - HOLD_MAX_AGE_MS, true],
    ['7 days in the future', NOW + HOLD_MAX_AGE_MS, true],
    ['more than 7 days in the future', NOW + HOLD_MAX_AGE_MS + 1, false]
  ])('holds on an answer %s: %s', (_label, fetchedAt, holds) => {
    const plan = planCampaignArgs(
      hold({ answers: new Map([[KEY, answer('hold', agentPayload(), fetchedAt)]]) })
    )
    expect(plan.applied.length > 0).toBe(holds)
  })

  it('holds on an enrol answer too, without re-enrolling', () => {
    const plan = planCampaignArgs(hold({ answers: new Map([[KEY, answer('enrol')]]) }))
    expect(plan.applied).toMatchObject([{ enrolledNow: false }])
  })

  it('idles a member while assets is off, and holds again once it is back', () => {
    const off = planCampaignArgs(hold({ presentArgs: [] }))
    expect(off.applied).toEqual([])
    expect(off.misses).toEqual([
      { key: KEY, arg: '--enable-agent', member: true, reason: 'requires_args' }
    ])
    expect(args(planCampaignArgs(hold()))).toEqual(['--enable-agent'])
  })

  it('idles a member whose gate fails (the record is not touched here)', () => {
    const plan = planCampaignArgs(
      hold({ core: { semver: '0.3.50', exact: true, verified: true, current: true } })
    )
    expect(plan.misses).toMatchObject([{ member: true, reason: 'gates' }])
  })

  it('voids a record whose epoch is no longer accepted', () => {
    const payload = agentPayload({ epoch: 2, epochs: [2] })
    expect(planCampaignArgs(hold({ answers: new Map([[KEY, answer('hold', payload)]]) }))).toEqual({
      applied: [],
      misses: [],
      trace: []
    })
  })

  it('re-enrols a void record into the new epoch on an enrol answer', () => {
    const payload = agentPayload({ epoch: 2, epochs: [2] })
    const plan = planCampaignArgs(hold({ answers: new Map([[KEY, answer('enrol', payload)]]) }))
    expect(plan.applied).toMatchObject([{ epoch: 2, enrolledNow: true }])
  })

  it('keeps holding wave 1 while epochs lists it alongside the new epoch', () => {
    const payload = agentPayload({ epoch: 2, epochs: [1, 2] })
    const plan = planCampaignArgs(hold({ answers: new Map([[KEY, answer('enrol', payload)]]) }))
    expect(plan.applied).toMatchObject([{ epoch: 1, enrolledNow: false }])
  })

  it('applies nothing once the campaign grants nothing (served false)', () => {
    expect(planCampaignArgs(hold({ answers: new Map([[KEY, answer(false)]]) })).applied).toEqual([])
  })

  it('applies nothing once the key is unlisted from the registry', () => {
    expect(planCampaignArgs(hold({ registry: [] })).applied).toEqual([])
  })
})

describe('planCampaignArgs: members with no answer', () => {
  const noAnswer = [{ key: KEY, arg: '--enable-agent', member: true, reason: 'no_answer' }]

  it.each([
    ['unlisted from the registry', { registry: [] }],
    ['listed, but its answer expired or never arrived', { answers: new Map() }],
    ['killed: the campaign serves false', { answers: new Map([[KEY, answer(false)]]) }],
    [
      'the registry no longer lists its arg for the campaign',
      {
        registry: [{ key: KEY, args: ['--enable-assets'] }],
        answers: new Map([[KEY, answer('hold')]])
      }
    ],
    [
      'the grant was removed from the payload',
      { answers: new Map([[KEY, answer('hold', { grants: [] })]]) }
    ]
  ])('reports an enrolled machine as idle when %s', (_label, overrides) => {
    const plan = planCampaignArgs(facts({ records: member, ...overrides }))
    expect(plan.applied).toEqual([])
    expect(plan.misses).toEqual(noAnswer)
  })

  it('reports nothing extra for a held member or a voided epoch', () => {
    expect(
      planCampaignArgs(facts({ records: member, answers: new Map([[KEY, answer('hold')]]) })).misses
    ).toEqual([])
    const voided = answer('hold', agentPayload({ epoch: 2, epochs: [2] }))
    expect(
      planCampaignArgs(facts({ records: member, answers: new Map([[KEY, voided]]) })).misses
    ).toEqual([])
  })

  it('reports nothing while beta is off', () => {
    expect(
      planCampaignArgs(facts({ records: member, registry: [], betaEnabled: false })).misses
    ).toEqual([])
  })
})

describe('planCampaignArgs: isolation', () => {
  it('refuses a grant its registry entry does not list', () => {
    const plan = planCampaignArgs(facts({ registry: [{ key: KEY, args: ['--enable-assets'] }] }))
    expect(plan.applied).toEqual([])
    expect(plan.trace).toContain(
      `[core-campaign] ${KEY}: --enable-agent refused: not listed for this campaign`
    )
  })

  it('withholds an arg slot #0 already applied, without enrolling', () => {
    const plan = planCampaignArgs(facts({ presentArgs: ['--enable-assets', '--enable-agent'] }))
    expect(plan.applied).toEqual([])
  })

  it('withholds a campaign arg whose opposite slot #0 applied', () => {
    const payload = {
      grants: [
        { arg: '--enable-assets', min_core_version: '0.3.0', enrolment: { epoch: 1, epochs: [1] } }
      ]
    }
    const plan = planCampaignArgs(
      facts({
        registry: [{ key: KEY, args: ['--enable-assets'] }],
        answers: new Map([[KEY, answer('enrol', payload)]]),
        presentArgs: ['--disable-assets']
      })
    )
    expect(plan.misses).toMatchObject([{ reason: 'present' }])
  })

  it('accepts a campaign granting an assets arg (no reservation)', () => {
    const payload = {
      grants: [
        { arg: '--enable-assets', min_core_version: '0.3.0', enrolment: { epoch: 1, epochs: [1] } }
      ]
    }
    const plan = planCampaignArgs(
      facts({
        registry: [{ key: KEY, args: ['--enable-assets'] }],
        answers: new Map([[KEY, answer('enrol', payload)]]),
        presentArgs: []
      })
    )
    expect(args(plan)).toEqual(['--enable-assets'])
  })

  it('decides earlier registry entries first: a wave-1 member never enrols into wave 2', () => {
    const plan = planCampaignArgs(
      facts({
        registry: [
          { key: KEY, args: ['--enable-agent'] },
          { key: KEY_W2, args: ['--enable-agent'] }
        ],
        answers: new Map([
          [KEY, answer('hold')],
          [KEY_W2, answer('enrol')]
        ]),
        records: member
      })
    )
    expect(plan.applied).toMatchObject([{ key: KEY, enrolledNow: false }])
    expect(args(plan)).toEqual(['--enable-agent'])
  })

  it('lets a non-member enrol into wave 2 while wave 1 is still listed', () => {
    const plan = planCampaignArgs(
      facts({
        registry: [
          { key: KEY, args: ['--enable-agent'] },
          { key: KEY_W2, args: ['--enable-agent'] }
        ],
        answers: new Map([
          [KEY, answer('hold')],
          [KEY_W2, answer('enrol')]
        ])
      })
    )
    expect(plan.applied).toMatchObject([{ key: KEY_W2, enrolledNow: true }])
  })
})

describe('appliedPassThrough', () => {
  it('returns the raw override of the campaign that applied the arg', () => {
    const plan = planCampaignArgs(facts())
    expect(appliedPassThrough(plan.applied, '--enable-agent')).toEqual({ 'comfy-agent': '0.2.3' })
  })

  it('is undefined when no campaign applied the arg', () => {
    expect(
      appliedPassThrough(planCampaignArgs(facts({ presentArgs: [] })).applied, '--enable-agent')
    ).toBeUndefined()
  })

  it('is undefined for a payload without the field', () => {
    const payload: CampaignAnswer = { ...answer('enrol'), payload: { grants: [] } }
    const plan = planCampaignArgs(facts({ answers: new Map([[KEY, payload]]) }))
    expect(appliedPassThrough(plan.applied, '--enable-agent')).toBeUndefined()
  })
})
