// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CoreBetaGrant } from './coreBetaGrants'
import type { CoreCheckout } from './version'
import type { ComfyArgsSchema } from './comfy-args'
import type { InstallationRecord } from '../installations'
import type { LaunchCommand } from '../types/sources'
import type * as CoreBetaGrantsModule from './coreBetaGrants'
import type * as ComfyArgsModule from './comfy-args'
import type * as CoreBetaInputsModule from './coreBetaInputs'
import type * as CoreBetaAncestryModule from './coreBetaAncestry'

const h = vi.hoisted(() => ({
  grants: [] as CoreBetaGrant[],
  betaEnabled: true,
  schema: null as ComfyArgsSchema | null,
  checkout: { kind: 'not-git' } as CoreCheckout,
  prove: vi.fn(),
  exempt: vi.fn(),
  campaigns: { registry: [] as unknown[], answers: new Map<string, unknown>() },
  records: {} as Record<string, unknown>
}))

vi.mock('./coreBetaCampaignFlags', () => ({
  getCoreBetaCampaigns: async () => h.campaigns,
  readCampaignRecords: () => h.records
}))
vi.mock('./deviceId', () => ({ getIdClass: () => 'machine_derived' }))

vi.mock('./coreBetaGrants', async (importOriginal) => ({
  ...(await importOriginal<typeof CoreBetaGrantsModule>()),
  getCoreBetaGrantsAsync: async () => h.grants
}))
vi.mock('../settings', () => ({ peekBetaFeaturesEnabled: () => h.betaEnabled }))
vi.mock('./comfy-args', async (importOriginal) => ({
  ...(await importOriginal<typeof ComfyArgsModule>()),
  peekComfyArgsSchema: () => h.schema
}))
vi.mock('./coreBetaInputs', async (importOriginal) => ({
  ...(await importOriginal<typeof CoreBetaInputsModule>()),
  resolveCoreCheckout: () => h.checkout
}))
vi.mock('./coreBetaAncestry', async (importOriginal) => ({
  ...(await importOriginal<typeof CoreBetaAncestryModule>()),
  proveCommitRelation: h.prove
}))
vi.mock('./git', () => ({
  withoutPygit2Breaker: <T>(work: () => Promise<T>): Promise<T> => {
    h.exempt()
    return work()
  }
}))

import { parseCampaignAnswer } from './coreBetaCampaigns'
import {
  PREVIEW_PROOF_BUDGET_MS,
  _resetForTest,
  answerCoreBetaArgs,
  previewCoreBetaArgs,
  withCommittedArgs
} from './coreBetaPreview'

const HEAD = 'e'.repeat(40)
const OTHER_HEAD = 'f'.repeat(40)
const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)

const versionGrant: CoreBetaGrant = {
  arg: '--enable-assets',
  minCoreVersion: '0.3.80',
  notice: { description: 'Asset library' }
}
const commitGrant: CoreBetaGrant = { arg: '--enable-agent', commitRanges: [[SHA_A, SHA_B]] }

const SCHEMA: ComfyArgsSchema = {
  args: [],
  knownFlags: new Set(['enable-assets', 'enable-agent', 'disable-assets'])
}

const INST = {
  id: 'inst-1',
  comfyVersion: { commit: HEAD, baseTag: 'v0.3.81', baseTagVerified: true, commitsAhead: 0 }
} as unknown as InstallationRecord

const launchCmd = (...userArgs: string[]): LaunchCommand => ({
  cmd: '/python',
  args: ['-s', 'ComfyUI/main.py', ...userArgs],
  cwd: '/install'
})

const proven = (relations: Record<string, boolean | null>) =>
  h.prove.mockImplementation(async (_repo: string, sha: string) => ({
    relation: relations[sha] ?? null,
    absentFromShallow: false,
    notes: []
  }))

const preview = (cmd: LaunchCommand | null = launchCmd()) =>
  previewCoreBetaArgs('inst-1', INST, cmd)

beforeEach(() => {
  _resetForTest()
  h.grants = [versionGrant, commitGrant]
  h.betaEnabled = true
  h.schema = SCHEMA
  h.checkout = { kind: 'head', commit: HEAD }
  h.prove.mockReset()
  h.exempt.mockReset()
  h.campaigns = { registry: [], answers: new Map() }
  h.records = {}
  proven({ [SHA_A]: true, [SHA_B]: false })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('previewCoreBetaArgs', () => {
  it("lists a held campaign arg after slot #0's, and none for a machine that is not enrolled", async () => {
    const key = 'desktop_core_beta_agent'
    h.grants = [versionGrant]
    h.campaigns = {
      registry: [{ key, args: ['--enable-agent'] }],
      answers: new Map([
        [
          key,
          parseCampaignAnswer(
            'hold',
            {
              grants: [
                {
                  arg: '--enable-agent',
                  min_core_version: '0.3.60',
                  notice: 'silent',
                  enrolment: { epoch: 1, epochs: [1] }
                }
              ]
            },
            Date.now()
          )
        ]
      ])
    }
    await expect(preview()).resolves.toEqual([{ arg: '--enable-assets', name: 'Asset library' }])
    h.records = { [key]: { '--enable-agent': { epoch: 1, enrolledAt: 1 } } }
    await expect(preview()).resolves.toEqual([
      { arg: '--enable-assets', name: 'Asset library' },
      { arg: '--enable-agent', name: null }
    ])
  })

  it('lists every grant the next launch is eligible for, with its feature name', async () => {
    await expect(preview()).resolves.toEqual([
      { arg: '--enable-assets', name: 'Asset library' },
      { arg: '--enable-agent', name: null }
    ])
  })

  it.each([
    ['opted out', () => (h.betaEnabled = false)],
    ['no grants', () => (h.grants = [])],
    ['no cached args schema', () => (h.schema = null)]
  ])('shows nothing and runs no git when %s', async (_label, arrange) => {
    arrange()
    await expect(preview()).resolves.toEqual([])
    expect(h.prove).not.toHaveBeenCalled()
  })

  it.each([
    ['no launch command', null],
    ['a remote launch command', { url: 'https://example.invalid' }],
    ['no -s main.py pair', { cmd: '/python', args: ['main.py'], cwd: '/install' }]
  ])('shows nothing for %s', async (_label, cmd) => {
    await expect(preview(cmd as LaunchCommand | null)).resolves.toEqual([])
    expect(h.prove).not.toHaveBeenCalled()
  })

  it("runs no git when the user's own args already decide every commit grant", async () => {
    await expect(preview(launchCmd('--enable-agent'))).resolves.toEqual([
      { arg: '--enable-assets', name: 'Asset library' }
    ])
    expect(h.prove).not.toHaveBeenCalled()
  })

  it('proves each SHA against the current HEAD, outside the pygit2 breaker', async () => {
    await preview()
    expect(h.prove.mock.calls).toEqual([
      ['/install/ComfyUI', SHA_A, HEAD],
      ['/install/ComfyUI', SHA_B, HEAD]
    ])
    expect(h.exempt).toHaveBeenCalledTimes(2)
  })

  it('answers a second request from the cache, with no git at all', async () => {
    await preview()
    h.prove.mockClear()
    await expect(preview()).resolves.toHaveLength(2)
    expect(h.prove).not.toHaveBeenCalled()
  })

  it('proves again for a new HEAD, since the cache is keyed on it', async () => {
    await preview()
    h.prove.mockClear()
    h.checkout = { kind: 'head', commit: OTHER_HEAD }
    proven({ [SHA_A]: true, [SHA_B]: true })
    // The record names the old HEAD, so its version grant is refused as stale too.
    await expect(preview()).resolves.toEqual([])
    expect(h.prove.mock.calls.map((call) => call[2])).toEqual([OTHER_HEAD, OTHER_HEAD])
  })

  it('hides a grant git cannot prove, and does not cache that', async () => {
    proven({ [SHA_A]: true })
    await expect(preview()).resolves.toEqual([{ arg: '--enable-assets', name: 'Asset library' }])
    proven({ [SHA_A]: true, [SHA_B]: false })
    await expect(preview()).resolves.toHaveLength(2)
    expect(h.prove.mock.calls.filter((call) => call[1] === SHA_B)).toHaveLength(2)
  })

  it('hides a grant whose proof failed outright', async () => {
    h.prove.mockRejectedValue(new Error('spawn failed'))
    await expect(preview()).resolves.toEqual([{ arg: '--enable-assets', name: 'Asset library' }])
  })

  it('shares one proof between concurrent requests', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    h.prove.mockImplementation(async (_repo: string, sha: string) => {
      await gate
      return { relation: sha === SHA_A, absentFromShallow: false, notes: [] }
    })
    const both = Promise.all([preview(), preview()])
    release()
    const [first, second] = await both
    expect(first).toEqual(second)
    expect(h.prove).toHaveBeenCalledTimes(2)
  })

  it('stops waiting at the budget, and caches the late answers for the next request', async () => {
    vi.useFakeTimers()
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    h.prove.mockImplementation(async (_repo: string, sha: string) => {
      if (sha === SHA_A) await gate
      return { relation: sha === SHA_A, absentFromShallow: false, notes: [] }
    })
    const pending = preview()
    await vi.advanceTimersByTimeAsync(PREVIEW_PROOF_BUDGET_MS)
    await expect(pending).resolves.toEqual([{ arg: '--enable-assets', name: 'Asset library' }])

    release()
    await vi.advanceTimersByTimeAsync(0)
    h.prove.mockClear()
    // The abandoned walk went on to prove SHA_B as well.
    await expect(preview()).resolves.toHaveLength(2)
    expect(h.prove).not.toHaveBeenCalled()
  })

  it.each([
    ['not a git checkout', { kind: 'not-git' }],
    ['an unreadable checkout', { kind: 'unreadable' }],
    ['a HEAD that is not a full SHA', { kind: 'head', commit: 'abc' }]
  ] as const)('runs no git and shows no commit grant for %s', async (_label, checkout) => {
    h.grants = [commitGrant]
    h.checkout = checkout as CoreCheckout
    await expect(preview()).resolves.toEqual([])
    expect(h.prove).not.toHaveBeenCalled()
  })

  it('proves no more SHAs than the launch would', async () => {
    const shas = Array.from({ length: 20 }, (_, i) => i.toString(16).padStart(40, '0'))
    h.grants = shas.map((sha) => ({ arg: '--enable-agent', commitRanges: [[sha, null]] }))
    proven({})
    await preview()
    expect(h.prove).toHaveBeenCalledTimes(16)
  })

  it('leaves out a grant this core cannot parse', async () => {
    h.schema = { args: [], knownFlags: new Set(['enable-agent']) }
    await expect(preview()).resolves.toEqual([{ arg: '--enable-agent', name: null }])
  })
})

describe('withCommittedArgs', () => {
  const stored = { ...INST, launchArgs: '--port 8188' } as InstallationRecord

  it('previews the args the settings view committed, over the stored ones', () => {
    expect(withCommittedArgs(stored, '--port 8188 --disable-assets').launchArgs).toBe(
      '--port 8188 --disable-assets'
    )
    expect(withCommittedArgs(stored, '').launchArgs).toBe('')
    expect(stored.launchArgs, 'the stored record is not touched').toBe('--port 8188')
  })

  it.each([undefined, null, 7, ['--x']])('keeps the stored args when sent %j', (sent) => {
    expect(withCommittedArgs(stored, sent)).toBe(stored)
  })

  it('withholds a grant the committed args override, before the write lands', async () => {
    const committed = withCommittedArgs(stored, '--port 8188 --disable-assets')
    const cmd = launchCmd(...String(committed.launchArgs).split(' '))
    await expect(previewCoreBetaArgs('inst-1', committed, cmd)).resolves.toEqual([
      { arg: '--enable-agent', name: null }
    ])
  })
})

describe('answerCoreBetaArgs', () => {
  const lookup = (overrides: Partial<Parameters<typeof answerCoreBetaArgs>[2]> = {}) => ({
    sessionArgs: () => null,
    record: async () => INST,
    launchCommand: () => launchCmd(),
    ...overrides
  })

  it('answers a running install from its session, with no preview', async () => {
    const args = [{ arg: '--enable-assets', name: 'Asset library' }]
    await expect(
      answerCoreBetaArgs('inst-1', undefined, lookup({ sessionArgs: () => args }))
    ).resolves.toEqual({ timing: 'session', args })
    expect(h.prove).not.toHaveBeenCalled()
  })

  it('shows nothing for a running session that recorded no grants, rather than a preview', async () => {
    await expect(
      answerCoreBetaArgs('inst-1', undefined, lookup({ sessionArgs: () => [] }))
    ).resolves.toEqual({ timing: 'session', args: [] })
  })

  it('previews a stopped install', async () => {
    await expect(answerCoreBetaArgs('inst-1', undefined, lookup())).resolves.toEqual({
      timing: 'next-launch',
      args: [
        { arg: '--enable-assets', name: 'Asset library' },
        { arg: '--enable-agent', name: null }
      ]
    })
  })

  it.each([
    ['the record lookup', { record: () => Promise.reject(new Error('EIO')) }],
    [
      'building the launch command',
      {
        launchCommand: () => {
          throw new TypeError('path must be a string')
        }
      }
    ]
  ])('answers "nothing" instead of failing when %s throws', async (_label, overrides) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(answerCoreBetaArgs('inst-1', undefined, lookup(overrides))).resolves.toEqual({
      timing: 'next-launch',
      args: []
    })
  })
})
