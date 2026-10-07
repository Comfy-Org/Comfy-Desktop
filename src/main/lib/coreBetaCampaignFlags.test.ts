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
  getCoreBetaCampaigns,
  initCoreBetaCampaigns,
  initCoreBetaFlags,
  readCampaignRecords,
  writeCampaignRecord
} from './coreBetaCampaignFlags'
import { _resetForTest as resetCoreBetaGrants, getCoreBetaGrantsAsync } from './coreBetaGrants'

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

/** Answers by flag key; anything unlisted is unreachable. */
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

  it('waits 3 s for every campaign flag on a machine that holds nothing', async () => {
    seed('campaign-flags.json', {
      desktop_campaigns: { value: true, payload: REGISTRY, fetchedAt: NOW },
      [KEY]: { value: 'hold', payload: AGENT, fetchedAt: NOW }
    })
    serve({})
    await initCoreBetaCampaigns({ distinctId: 'id' })
    expect(deadlines()).toEqual({ desktop_campaigns: 3000, [KEY]: 3000 })
  })

  it('waits 5 s for the registry and the campaign this machine is enrolled in', async () => {
    seed('campaign-flags.json', {
      desktop_campaigns: {
        value: true,
        payload: [...REGISTRY, { key: 'desktop_core_beta_other', args: ['--enable-agent'] }],
        fetchedAt: NOW
      }
    })
    writeCampaignRecord(KEY, '--enable-agent', 1, NOW)
    serve({})
    await initCoreBetaCampaigns({ distinctId: 'id' })
    expect(deadlines()).toEqual({
      desktop_campaigns: 5000,
      [KEY]: 5000,
      desktop_core_beta_other: 3000
    })
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

  it('drops a campaign answer saved more than 7 days ago (decision 2)', async () => {
    seed('campaign-flags.json', {
      desktop_campaigns: { value: true, payload: REGISTRY, fetchedAt: NOW - DAY_MS },
      [KEY]: { value: 'hold', payload: AGENT, fetchedAt: NOW - 8 * DAY_MS }
    })
    serve({})
    await initCoreBetaCampaigns({ distinctId: 'id' })
    expect((await getCoreBetaCampaigns()).answers.size).toBe(0)
  })

  it('lists nothing once the saved registry itself has expired', async () => {
    seed('campaign-flags.json', {
      desktop_campaigns: { value: true, payload: REGISTRY, fetchedAt: NOW - 8 * DAY_MS },
      [KEY]: { value: 'hold', payload: AGENT, fetchedAt: NOW }
    })
    serve({})
    await initCoreBetaCampaigns({ distinctId: 'id' })
    expect(fetchedKeys(), 'an expired registry discovers no key').toEqual(['desktop_campaigns'])
    expect(await getCoreBetaCampaigns()).toEqual({ registry: [], answers: new Map() })
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
    // Slot #0 rewrote its own file with the same answer and a fresh stamp; nothing else moved.
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

  it('reads nothing from a missing or corrupt file', () => {
    expect(readCampaignRecords()).toEqual({})
    fs.writeFileSync(file('campaign-enrolments.json'), '{not json')
    expect(readCampaignRecords()).toEqual({})
  })
})
