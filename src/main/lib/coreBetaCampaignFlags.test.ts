import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import * as safeFile from './safe-file'

const getOpsFlagResult = vi.fn()
vi.mock('./telemetry', () => ({
  getOpsFlagResult: (...args: unknown[]) => getOpsFlagResult(...args)
}))

let testConfigDir = ''
vi.mock('./paths', () => ({
  configDir: () => testConfigDir
}))

import {
  _resetForTest,
  campaignRecordSaved,
  getCoreBetaCampaigns,
  initCoreBetaCampaigns,
  initCoreBetaFlags,
  readCampaignRecords,
  writeCampaignRecord
} from './coreBetaCampaignFlags'
import {
  NO_CORE_COMMITS,
  _resetForTest as resetCoreBetaGrants,
  getCoreBetaGrantsAsync
} from './coreBetaGrants'
import { parseCampaignAnswer, planCampaignArgs } from './coreBetaCampaigns'

const KEY = 'desktop_core_beta_agent'
const NOW = Date.UTC(2026, 9, 7)
const DAY_MS = 24 * 60 * 60 * 1000
const REGISTRY = [{ key: KEY, args: ['--enable-agent'] }]
const AGENT = {
  grants: [
    {
      arg: '--enable-agent',
      min_core_version: '0.3.60',
      requires_args: ['--enable-assets'],
      enrolment: { epoch: 1, epochs: [1] }
    }
  ]
}
const ASSETS = { flags: [{ arg: '--enable-assets', min_core_version: '0.3.0' }] }

type Answer = { kind: 'value'; value: unknown; payload?: unknown } | { kind: 'unreachable' }
const value = (v: unknown, payload?: unknown): Answer => ({ kind: 'value', value: v, payload })
const UNREACHABLE: Answer = { kind: 'unreachable' }

function serve(answers: Record<string, Answer>): void {
  getOpsFlagResult.mockImplementation((key: string) => Promise.resolve(answers[key] ?? UNREACHABLE))
}

const file = (name: string): string => path.join(testConfigDir, name)
const readJson = (name: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(file(name), 'utf-8'))
function seed(name: string, entries: object): void {
  fs.writeFileSync(file(name), JSON.stringify(entries))
}
const deadlines = (): Record<string, unknown> =>
  Object.fromEntries(getOpsFlagResult.mock.calls.map((call) => [call[0], call[2]]))
const fetchedKeys = (): string[] => getOpsFlagResult.mock.calls.map((call) => call[0] as string)

function reset(): void {
  _resetForTest()
  resetCoreBetaGrants()
  getOpsFlagResult.mockReset()
}

beforeEach(() => {
  reset()
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-campaign-'))
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(testConfigDir, { recursive: true, force: true })
})

describe('initCoreBetaFlags', () => {
  it('fetches slot #0 and every campaign flag under the RESOLVED id, never before it', async () => {
    seed('campaign-flags.json', {
      desktop_campaigns: { value: true, payload: REGISTRY, fetchedAt: NOW }
    })
    serve({})
    let resolveId!: (id: string) => void
    const id = new Promise<string>((resolve) => (resolveId = resolve))
    const done = initCoreBetaFlags({ distinctId: id, betaEnabled: true })
    await Promise.resolve()
    expect(
      getOpsFlagResult,
      'nothing is drawn on an id that may still change'
    ).not.toHaveBeenCalled()
    resolveId('machine-hash')
    await done
    expect(fetchedKeys().sort()).toEqual(
      ['desktop_campaigns', 'desktop_core_beta_features', KEY].sort()
    )
    for (const call of getOpsFlagResult.mock.calls) expect(call[1]).toBe('machine-hash')
  })

  it('starts the campaigns on first use when beta was turned on after a beta-off boot', async () => {
    seed('campaign-flags.json', {
      desktop_campaigns: { value: true, payload: REGISTRY, fetchedAt: NOW }
    })
    serve({ desktop_campaigns: value(true, REGISTRY), [KEY]: value('hold', AGENT) })
    await initCoreBetaFlags({ distinctId: 'machine-hash', betaEnabled: false })
    expect(fetchedKeys()).toEqual(['desktop_core_beta_features'])
    const { answers } = await getCoreBetaCampaigns()
    expect(answers.get(KEY)?.grants).toHaveLength(1)
    for (const call of getOpsFlagResult.mock.calls)
      expect(call[1], 'the boot id').toBe('machine-hash')
  })

  it('a first-time beta user with no saved registry gets campaigns from the next boot', async () => {
    serve({ desktop_campaigns: value(true, REGISTRY), [KEY]: value('enrol', AGENT) })
    await initCoreBetaFlags({ distinctId: 'id', betaEnabled: false })
    const { registry, answers } = await getCoreBetaCampaigns()
    expect(registry, 'the registry itself arrives this session').toEqual(REGISTRY)
    expect(answers.size, 'its keys are discovered one boot late').toBe(0)
  })

  it('fetches no campaign flag on a beta-off boot', async () => {
    serve({})
    await initCoreBetaFlags({ distinctId: 'id', betaEnabled: false })
    expect(fetchedKeys()).toEqual(['desktop_core_beta_features'])
    expect(await getCoreBetaCampaigns()).toEqual({ registry: [], answers: new Map() })
  })
})

describe('initCoreBetaCampaigns', () => {
  it('starts the registry and the saved registry keys together, so the launch waits one budget', async () => {
    seed('campaign-flags.json', {
      desktop_campaigns: { value: true, payload: REGISTRY, fetchedAt: NOW }
    })
    getOpsFlagResult.mockImplementation(() => new Promise(() => {}))
    void initCoreBetaCampaigns({ distinctId: 'id' })
    await Promise.resolve()
    expect(fetchedKeys().sort()).toEqual(['desktop_campaigns', KEY].sort())
  })

  it('applies saved answers at once and refreshes them in the background', async () => {
    seed('campaign-flags.json', {
      desktop_campaigns: { value: true, payload: REGISTRY, fetchedAt: NOW },
      [KEY]: { value: 'hold', payload: AGENT, fetchedAt: NOW - DAY_MS }
    })
    getOpsFlagResult.mockImplementation(() => new Promise(() => {}))
    await initCoreBetaCampaigns({ distinctId: 'id' })
    const { answers } = await getCoreBetaCampaigns()
    expect(answers.get(KEY), 'no wait on the fetch').toMatchObject({ fetchedAt: NOW - DAY_MS })
    expect(deadlines()).toEqual({ desktop_campaigns: 5000, [KEY]: 5000 })
  })

  it('discovers a newly listed key one launch late', async () => {
    serve({ desktop_campaigns: value(true, REGISTRY), [KEY]: value('enrol', AGENT) })
    await initCoreBetaCampaigns({ distinctId: 'id' })
    expect(fetchedKeys()).toEqual(['desktop_campaigns'])
    expect((await getCoreBetaCampaigns()).answers.size).toBe(0)

    reset()
    serve({ desktop_campaigns: value(true, REGISTRY), [KEY]: value('enrol', AGENT) })
    await initCoreBetaCampaigns({ distinctId: 'id' })
    const { registry, answers } = await getCoreBetaCampaigns()
    expect(registry).toEqual(REGISTRY)
    expect(answers.get(KEY)).toMatchObject({ enrol: true, fetchedAt: NOW })
  })

  it('holds the saved answers on an offline launch, with their saved fetch time', async () => {
    seed('campaign-flags.json', {
      desktop_campaigns: { value: true, payload: REGISTRY, fetchedAt: NOW - DAY_MS },
      [KEY]: { value: 'hold', payload: AGENT, fetchedAt: NOW - 2 * DAY_MS }
    })
    serve({})
    await initCoreBetaCampaigns({ distinctId: 'id' })
    const { answers } = await getCoreBetaCampaigns()
    expect(answers.get(KEY)).toMatchObject({ enrol: false, fetchedAt: NOW - 2 * DAY_MS })
  })

  it('serves an answer saved more than 7 days ago with its age, which the planner drops (decision 2)', async () => {
    seed('campaign-flags.json', {
      desktop_campaigns: { value: true, payload: REGISTRY, fetchedAt: NOW - DAY_MS },
      [KEY]: { value: 'hold', payload: AGENT, fetchedAt: NOW - 8 * DAY_MS }
    })
    writeCampaignRecord(KEY, '--enable-agent', 1, NOW - 9 * DAY_MS)
    serve({})
    await initCoreBetaCampaigns({ distinctId: 'id' })
    const { registry, answers } = await getCoreBetaCampaigns()
    const plan = planCampaignArgs({
      registry,
      answers,
      records: readCampaignRecords(),
      betaEnabled: true,
      presentArgs: ['--enable-assets'],
      core: { semver: '0.3.61', exact: true, verified: true, current: true },
      commits: NO_CORE_COMMITS,
      schema: { args: [], knownFlags: new Set(['enable-agent', 'enable-assets']) },
      idClass: 'machine_derived',
      now: NOW
    })
    expect(plan.applied, 'an 8-day-old answer no longer holds the arg').toEqual([])
    expect(plan.misses).toMatchObject([{ member: true, reason: 'stale_answer' }])
  })

  it.each([[0], [false], ['x'], [null]])(
    'a saved registry entry of %j discovers nothing and does not throw',
    async (entry) => {
      seed('campaign-flags.json', { desktop_campaigns: entry })
      serve({})
      await expect(initCoreBetaCampaigns({ distinctId: 'id' })).resolves.toBeUndefined()
      expect(fetchedKeys()).toEqual(['desktop_campaigns'])
    }
  )

  it('lists and discovers a saved registry of any age, offline', async () => {
    seed('campaign-flags.json', {
      desktop_campaigns: { value: true, payload: REGISTRY, fetchedAt: NOW - 30 * DAY_MS },
      [KEY]: { value: 'hold', payload: AGENT, fetchedAt: NOW - 30 * DAY_MS }
    })
    serve({})
    await initCoreBetaCampaigns({ distinctId: 'id' })
    expect(fetchedKeys().sort()).toEqual(['desktop_campaigns', KEY].sort())
    const { registry, answers } = await getCoreBetaCampaigns()
    expect(registry).toEqual(REGISTRY)
    expect(answers.get(KEY), 'its age is for the planner to judge').toMatchObject({
      fetchedAt: NOW - 30 * DAY_MS
    })
  })

  it('a machine back after more than 7 days gets its campaign answer on the first boot online', async () => {
    seed('campaign-flags.json', {
      desktop_campaigns: { value: true, payload: REGISTRY, fetchedAt: NOW - 30 * DAY_MS },
      [KEY]: { value: 'hold', payload: AGENT, fetchedAt: NOW - 30 * DAY_MS }
    })
    serve({ desktop_campaigns: value(true, REGISTRY), [KEY]: value('hold', AGENT) })
    await initCoreBetaCampaigns({ distinctId: 'id' })
    expect((await getCoreBetaCampaigns()).answers.get(KEY)).toMatchObject({ fetchedAt: NOW })
  })

  it('writes a campaign answer that arrives after the deadline to campaign-flags.json only', async () => {
    seed('ops-flags.json', {
      desktop_core_beta_features: { value: true, payload: ASSETS, fetchedAt: NOW }
    })
    fs.writeFileSync(file('ops-flags.json.bak'), fs.readFileSync(file('ops-flags.json')))
    const before = fs.readFileSync(file('ops-flags.json'))
    seed('campaign-flags.json', {
      desktop_campaigns: { value: true, payload: REGISTRY, fetchedAt: NOW }
    })
    serve({})
    await initCoreBetaCampaigns({ distinctId: 'id' })
    const late = getOpsFlagResult.mock.calls.find((call) => call[0] === KEY)?.[3] as (
      result: unknown
    ) => void
    late(value('enrol', AGENT))
    expect(readJson('campaign-flags.json')[KEY]).toMatchObject({ value: 'enrol', fetchedAt: NOW })
    expect(fs.readFileSync(file('ops-flags.json'))).toEqual(before)
    expect(fs.readFileSync(file('ops-flags.json.bak'))).toEqual(before)
  })

  it('a key absent from the response (a disabled flag) holds the saved answer', async () => {
    seed('campaign-flags.json', {
      desktop_campaigns: { value: true, payload: REGISTRY, fetchedAt: NOW },
      [KEY]: { value: 'hold', payload: AGENT, fetchedAt: NOW }
    })
    serve({ desktop_campaigns: value(true, REGISTRY) })
    await initCoreBetaCampaigns({ distinctId: 'id' })
    expect((await getCoreBetaCampaigns()).answers.get(KEY)?.grants).toHaveLength(1)
  })

  it('a registry served false (flag still enabled) lists no campaign', async () => {
    seed('campaign-flags.json', {
      desktop_campaigns: { value: true, payload: REGISTRY, fetchedAt: NOW },
      [KEY]: { value: 'hold', payload: AGENT, fetchedAt: NOW }
    })
    serve({ desktop_campaigns: value(false), [KEY]: value('hold', AGENT) })
    await initCoreBetaCampaigns({ distinctId: 'id' })
    expect((await getCoreBetaCampaigns()).registry).toEqual([])
  })
})

describe('two cache files', () => {
  it('writes campaign answers to campaign-flags.json and leaves ops-flags.json byte-identical', async () => {
    seed('ops-flags.json', {
      desktop_core_beta_features: { value: true, payload: ASSETS, fetchedAt: NOW }
    })
    fs.writeFileSync(file('ops-flags.json.bak'), fs.readFileSync(file('ops-flags.json')))
    const before = fs.readFileSync(file('ops-flags.json'))
    const beforeBak = fs.readFileSync(file('ops-flags.json.bak'))
    seed('campaign-flags.json', {
      desktop_campaigns: { value: true, payload: REGISTRY, fetchedAt: NOW }
    })
    serve({
      desktop_core_beta_features: UNREACHABLE,
      desktop_campaigns: value(true, REGISTRY),
      [KEY]: value('enrol', AGENT)
    })
    await initCoreBetaFlags({ distinctId: 'id', betaEnabled: true })
    expect(fs.readFileSync(file('ops-flags.json'))).toEqual(before)
    expect(fs.readFileSync(file('ops-flags.json.bak'))).toEqual(beforeBak)
    expect(Object.keys(readJson('campaign-flags.json')).sort()).toEqual(
      ['desktop_campaigns', KEY].sort()
    )
    expect(await getCoreBetaGrantsAsync()).toEqual([
      { arg: '--enable-assets', minCoreVersion: '0.3.0' }
    ])
  })

  it('a failing campaign write leaves ops-flags.json to slot #0 alone', async () => {
    seed('ops-flags.json', {
      desktop_core_beta_features: { value: true, payload: ASSETS, fetchedAt: NOW }
    })
    const before = fs.readFileSync(file('ops-flags.json'))
    seed('campaign-flags.json', {
      desktop_campaigns: { value: true, payload: REGISTRY, fetchedAt: NOW }
    })
    const write = safeFile.writeFileSafe
    vi.spyOn(safeFile, 'writeFileSafe').mockImplementation((target, ...rest) => {
      if (String(target).includes('campaign-flags.json')) throw new Error('EIO')
      return write(target, ...rest)
    })
    serve({
      desktop_core_beta_features: value(true, ASSETS),
      desktop_campaigns: value(true, REGISTRY),
      [KEY]: value('enrol', AGENT)
    })
    await initCoreBetaFlags({ distinctId: 'id', betaEnabled: true })
    const after = JSON.parse(fs.readFileSync(file('ops-flags.json'), 'utf-8'))
    expect(after).toEqual(JSON.parse(before.toString()))
    expect(fs.existsSync(file('campaign-flags.json.bak'))).toBe(false)
    expect(
      (await getCoreBetaCampaigns()).answers.get(KEY)?.enrol,
      'this launch keeps the live answer'
    ).toBe(true)
  })

  it('a missing ops-flags.json is never rebuilt from campaign state', async () => {
    seed('campaign-flags.json', {
      desktop_campaigns: { value: true, payload: REGISTRY, fetchedAt: NOW }
    })
    serve({ desktop_campaigns: value(true, REGISTRY), [KEY]: value('enrol', AGENT) })
    await initCoreBetaFlags({ distinctId: 'id', betaEnabled: true })
    expect(fs.existsSync(file('ops-flags.json'))).toBe(false)
  })
})

describe('enrolment records', () => {
  it('treats __proto__ and constructor in the file as plain keys', () => {
    fs.writeFileSync(
      file('campaign-enrolments.json'),
      '{"__proto__":{"__proto__":{"epoch":1,"enrolledAt":1},"--enable-agent":{"epoch":1,"enrolledAt":1}},' +
        '"constructor":{"--enable-agent":{"epoch":2,"enrolledAt":2}}}'
    )
    const records = readCampaignRecords()
    expect(({} as Record<string, unknown>)['--enable-agent']).toBeUndefined()
    expect(Object.keys(records['__proto__']!)).toEqual(['__proto__', '--enable-agent'])
    expect(records['constructor']).toEqual({ '--enable-agent': { epoch: 2, enrolledAt: 2 } })
    expect(records[KEY]).toBeUndefined()
  })

  it('does not rewrite a record that already exists for the epoch', () => {
    expect(writeCampaignRecord(KEY, '--enable-agent', 1, NOW)).toBe(true)
    expect(writeCampaignRecord(KEY, '--enable-agent', 1, NOW + 5)).toBe(false)
    expect(readCampaignRecords()[KEY]).toEqual({ '--enable-agent': { epoch: 1, enrolledAt: NOW } })
    expect(writeCampaignRecord(KEY, '--enable-agent', 2, NOW + 6), 'a new epoch writes').toBe(true)
  })

  it('round-trips a record and keeps the other campaigns', () => {
    writeCampaignRecord(KEY, '--enable-agent', 1, NOW)
    writeCampaignRecord('desktop_core_beta_other', '--enable-agent', 3, NOW + 1)
    expect(readCampaignRecords()).toEqual({
      [KEY]: { '--enable-agent': { epoch: 1, enrolledAt: NOW } },
      desktop_core_beta_other: { '--enable-agent': { epoch: 3, enrolledAt: NOW + 1 } }
    })
    expect(fs.existsSync(file('campaign-enrolments.json.bak'))).toBe(true)
    writeCampaignRecord(KEY, '--enable-other', 2, NOW + 2)
    expect(readCampaignRecords()[KEY]).toEqual({
      '--enable-agent': { epoch: 1, enrolledAt: NOW },
      '--enable-other': { epoch: 2, enrolledAt: NOW + 2 }
    })
  })

  it('a first enrolment whose primary write fails is still saved, via the backup', () => {
    const write = safeFile.writeFileSafe
    vi.spyOn(safeFile, 'writeFileSafe').mockImplementation((target, ...rest) => {
      if (String(target).endsWith('campaign-enrolments.json')) throw new Error('ENOSPC')
      return write(target, ...rest)
    })
    expect(() => writeCampaignRecord(KEY, '--enable-agent', 1, NOW)).toThrow('ENOSPC')
    vi.mocked(safeFile.writeFileSafe).mockRestore()
    expect(campaignRecordSaved(KEY, '--enable-agent', 1)).toBe(true)
    expect(readCampaignRecords()[KEY]?.['--enable-agent']?.epoch).toBe(1)
  })

  it('a failed write over an intact older primary is not saved', () => {
    writeCampaignRecord(KEY, '--enable-agent', 1, NOW)
    const write = safeFile.writeFileSafe
    vi.spyOn(safeFile, 'writeFileSafe').mockImplementation((target, ...rest) => {
      if (String(target).endsWith('campaign-enrolments.json')) throw new Error('EPERM')
      return write(target, ...rest)
    })
    expect(() => writeCampaignRecord(KEY, '--enable-agent', 2, NOW)).toThrow('EPERM')
    vi.mocked(safeFile.writeFileSafe).mockRestore()
    expect(campaignRecordSaved(KEY, '--enable-agent', 2)).toBe(false)
    expect(campaignRecordSaved(KEY, '--enable-agent', 1), 'the old epoch is no match').toBe(true)
  })

  it('a record behind an unreadable primary is not saved', () => {
    writeCampaignRecord(KEY, '--enable-agent', 1, NOW)
    fs.writeFileSync(
      file('campaign-enrolments.json.bak'),
      fs.readFileSync(file('campaign-enrolments.json'))
    )
    vi.spyOn(safeFile, 'readFileSafe').mockReturnValue({
      kind: 'data',
      data: fs.readFileSync(file('campaign-enrolments.json.bak'), 'utf-8'),
      primaryUnreadable: true
    } as ReturnType<typeof safeFile.readFileSafe>)
    expect(campaignRecordSaved(KEY, '--enable-agent', 1)).toBe(false)
  })

  describe('an unparseable primary next to a valid backup', () => {
    beforeEach(() => {
      writeCampaignRecord(KEY, '--enable-agent', 1, NOW)
      fs.writeFileSync(file('campaign-enrolments.json'), 'not json{')
    })

    it('hold: the backup record still makes the machine a member', () => {
      const plan = planCampaignArgs({
        registry: REGISTRY,
        answers: new Map([[KEY, parseCampaignAnswer('hold', AGENT, NOW)!]]),
        records: readCampaignRecords(),
        betaEnabled: true,
        presentArgs: ['--enable-assets'],
        core: { semver: '0.3.61', exact: true, verified: true, current: true },
        commits: NO_CORE_COMMITS,
        schema: { args: [], knownFlags: new Set(['enable-agent', 'enable-assets']) },
        idClass: 'machine_derived',
        now: NOW
      })
      expect(plan.applied, 'garbage must not read as "no enrolments"').toMatchObject([
        { key: KEY, epoch: 1, enrolledNow: false }
      ])
    })

    it('the read restores the backup over the garbage, so later writes keep the record', () => {
      expect(campaignRecordSaved(KEY, '--enable-agent', 1), 'a member, so no re-enrol').toBe(true)
      expect(readJson('campaign-enrolments.json')[KEY]).toEqual({
        '--enable-agent': { epoch: 1, enrolledAt: NOW }
      })
      writeCampaignRecord(KEY, '--enable-other', 1, NOW + 1)
      expect(readCampaignRecords()[KEY]).toEqual({
        '--enable-agent': { epoch: 1, enrolledAt: NOW },
        '--enable-other': { epoch: 1, enrolledAt: NOW + 1 }
      })
    })
  })

  it('refuses to write over an unparseable primary with no usable backup', () => {
    fs.writeFileSync(file('campaign-enrolments.json'), 'not json{')
    fs.writeFileSync(file('campaign-enrolments.json.bak'), 'also not json')
    expect(() => writeCampaignRecord(KEY, '--enable-agent', 1, NOW)).toThrow(/refusing to modify/)
    expect(campaignRecordSaved(KEY, '--enable-agent', 1)).toBe(false)
    expect(fs.readFileSync(file('campaign-enrolments.json'), 'utf-8')).toBe('not json{')
  })

  it('a corrupt ops-flags.json still reads as an empty cache and is repaired by the next answer', async () => {
    fs.writeFileSync(file('ops-flags.json'), 'not json{')
    serve({ desktop_core_beta_features: value(true, ASSETS) })
    await initCoreBetaFlags({ distinctId: 'id', betaEnabled: false })
    expect(readJson('ops-flags.json')['desktop_core_beta_features']).toMatchObject({ value: true })
  })

  it('reads nothing from a missing or corrupt file', () => {
    expect(readCampaignRecords()).toEqual({})
    fs.writeFileSync(file('campaign-enrolments.json'), '{not json')
    expect(readCampaignRecords()).toEqual({})
  })
})
