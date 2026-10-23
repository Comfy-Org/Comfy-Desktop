import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  records: new Map<string, Record<string, unknown>>(),
  updateThrows: false,
  betaEnabled: true,
  mirrors: { pypiMirror: undefined as string | undefined, useChineseMirrors: false },
  answers: new Map<string, unknown>(),
  registry: [] as { key: string; args: string[] }[],
  idClass: 'machine_derived',
  runs: [] as { request: unknown; finish: (report: unknown) => void; done?: boolean }[],
  busy: false,
  stopped: false,
  unprepared: new Set<string>(),
  plannable: new Set<string>()
}))

vi.mock('../installations', () => ({
  get: async (id: string) => harness.records.get(id) ?? null,
  list: async () => [...harness.records.values()],
  update: async (id: string, data: Record<string, unknown>) => {
    if (harness.updateThrows) throw new Error('EIO')
    harness.records.set(id, { ...harness.records.get(id), ...data })
  }
}))

vi.mock('../settings', () => ({
  getMirrorConfig: () => harness.mirrors,
  peekBetaFeaturesEnabled: () => harness.betaEnabled
}))

vi.mock('./coreBetaCampaignFlags', () => ({
  getCoreBetaCampaigns: async () => ({ registry: harness.registry, answers: harness.answers })
}))

vi.mock('./deviceId', () => ({ getIdClass: () => harness.idClass }))

vi.mock('./agentRequirementsLaunch', () => ({
  agentPrefetchesStopped: () => harness.stopped,
  planAgentRequirementsInstall: (inst: { installPath: string }, args: string[]) =>
    harness.plannable.has(inst.installPath) && args.includes('--enable-agent')
      ? { installPath: inst.installPath }
      : null,
  prepareAgentPrefetch: async (plan: { installPath: string }, raw: unknown, state: unknown) =>
    harness.unprepared.has(plan.installPath)
      ? null
      : {
          plan,
          steps: [{ text: JSON.stringify({ raw, state }) }],
          signature: raw ? 'comfy-agent==0.1.0rc3' : 'core',
          eager: true
        },
  prefetchAgentRequirements: (request: unknown, onDone: (report: unknown) => void) => {
    if (harness.busy) return false
    harness.runs.push({ request, finish: onDone })
    return true
  }
}))

import * as telemetry from './telemetry'
import { prefetchEnrolledAgents, startAgentPrefetch } from './agentPrefetch'
import type { PrefetchRequest } from './agentRequirementsLaunch'

const REPORT = {
  outcome: 'download_failed',
  exitCode: 2,
  elapsedMs: 5,
  budgetMs: 1_800_000,
  downloadsStarted: 2,
  downloadsFinished: 1,
  errorTail: 'error: Failed to download',
  uvVersion: '0.13.4'
}

const request = (signature: string): PrefetchRequest => ({
  plan: {
    reqPath: '/i/ComfyUI/agent_requirements.txt',
    uvPath: '/uv',
    pythonPath: '/py',
    installPath: '/i'
  },
  steps: [{ text: 'comfy-agent==0.1.0rc3\n' }],
  signature
})

const prefetchEvents = (): Record<string, unknown>[] =>
  vi
    .mocked(telemetry.emit)
    .mock.calls.filter(([event]) => event === 'comfy.desktop.agent_requirements_prefetch')
    .map(([, props]) => props as Record<string, unknown>)

async function finishNext(report: unknown): Promise<void> {
  await vi.waitFor(() => expect(harness.runs.some((run) => !run.done)).toBe(true))
  const run = harness.runs.find((candidate) => !candidate.done)!
  run.done = true
  run.finish(report)
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(telemetry, 'emit').mockImplementation((() => {}) as unknown as typeof telemetry.emit)
  harness.records = new Map([['a', { id: 'a', installPath: '/a' }]])
  harness.updateThrows = false
  harness.betaEnabled = true
  harness.mirrors = { pypiMirror: undefined, useChineseMirrors: false }
  harness.answers = new Map()
  harness.registry = [{ key: 'agent', args: ['--enable-agent'] }]
  harness.idClass = 'machine_derived'
  harness.runs = []
  harness.busy = false
  harness.stopped = false
  harness.unprepared = new Set()
  harness.plannable = new Set()
})

describe('startAgentPrefetch', () => {
  it('reports each download with its attempt, counted per signature', async () => {
    for (const signature of ['core', 'core', 'comfy-agent==0.1.0rc3']) {
      const done = startAgentPrefetch('a', request(signature))
      await vi.waitFor(() => expect(harness.runs).toHaveLength(prefetchEvents().length + 1))
      harness.runs.at(-1)!.finish(REPORT)
      await done
      await vi.waitFor(() =>
        expect(harness.records.get('a')?.agentPrefetch).toMatchObject({ signature })
      )
    }

    expect(prefetchEvents().map((e) => [e.target, e.pins, e.attempt])).toEqual([
      ['core', null, 1],
      ['core', null, 2],
      ['override', 'comfy-agent==0.1.0rc3', 1]
    ])
    expect(prefetchEvents()[1]).toEqual({
      installation_id: 'a',
      target: 'core',
      pins: null,
      install_outcome: 'download_failed',
      exit_code: 2,
      elapsed_ms: 5,
      budget_ms: 1_800_000,
      attempt: 2,
      downloads_started: 2,
      downloads_finished: 1,
      error_tail: 'error: Failed to download',
      index: 'pypi',
      uv_version: '0.13.4'
    })
    expect(harness.records.get('a')?.agentPrefetch).toEqual({
      signature: 'comfy-agent==0.1.0rc3',
      attempts: 1
    })
  })

  it('names the kind of index, never its URL', async () => {
    harness.mirrors = { pypiMirror: 'https://mirror.example/simple/', useChineseMirrors: false }
    const done = startAgentPrefetch('a', request('core'))
    await finishNext(REPORT)
    await done

    expect(prefetchEvents()[0]).toMatchObject({ index: 'custom' })
  })

  it('counts and reports nothing for an eager run that found everything cached', async () => {
    const done = startAgentPrefetch('a', request('core'))
    await finishNext(null)
    await done

    expect(prefetchEvents()).toEqual([])
    expect(harness.records.get('a')?.agentPrefetch).toBeUndefined()
  })

  it('resolves at once, counting nothing, when one is already running', async () => {
    harness.busy = true

    await startAgentPrefetch('a', request('core'))

    expect(harness.records.get('a')?.agentPrefetch).toBeUndefined()
  })

  it('says so when the attempt cannot be recorded, and still reports it', async () => {
    harness.updateThrows = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const done = startAgentPrefetch('a', request('core'))
    await finishNext(REPORT)
    await done

    expect(prefetchEvents()).toHaveLength(1)
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        'agent requirements: could not record the background download:',
        expect.any(Error)
      )
    )
  })
})

describe('prefetchEnrolledAgents', () => {
  const ENROL = {
    enrol: true,
    fetchedAt: Date.now(),
    grants: [{ grant: { arg: '--enable-agent' }, epoch: 1, epochs: [1], requiresArgs: [] }],
    payload: { agent_requirements_override: { 'comfy-agent': '0.1.0rc3' } }
  }

  beforeEach(() => {
    harness.records = new Map([
      ['a', { id: 'a', installPath: '/a' }],
      ['portable', { id: 'portable', installPath: '/portable' }],
      [
        'b',
        { id: 'b', installPath: '/b', agentRequirementsOverride: { signature: 's', failures: 1 } }
      ]
    ])
    harness.plannable = new Set(['/a', '/b'])
  })

  it('downloads for every install that can take the agent, one install at a time', async () => {
    harness.answers = new Map([['agent', ENROL]])

    const done = prefetchEnrolledAgents()
    await vi.waitFor(() => expect(harness.runs).toHaveLength(1))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(harness.runs, 'the next install waits for this one').toHaveLength(1)
    harness.runs[0]!.finish(null)
    await vi.waitFor(() => expect(harness.runs).toHaveLength(2))
    harness.runs[1]!.finish(null)
    await done

    expect(harness.runs.map((run) => run.request)).toEqual([
      {
        plan: { installPath: '/a' },
        steps: [{ text: JSON.stringify({ raw: { 'comfy-agent': '0.1.0rc3' }, state: null }) }],
        signature: 'comfy-agent==0.1.0rc3',
        eager: true
      },
      expect.objectContaining({
        plan: { installPath: '/b' },
        steps: [
          {
            text: JSON.stringify({
              raw: { 'comfy-agent': '0.1.0rc3' },
              state: { signature: 's', failures: 1 }
            })
          }
        ]
      })
    ])
  })

  it('skips an install it could not prepare a download for, and goes on', async () => {
    harness.answers = new Map([['agent', ENROL]])
    harness.unprepared = new Set(['/a'])

    const done = prefetchEnrolledAgents()
    await finishNext(null)
    await done

    expect(harness.runs.map((run) => (run.request as { plan: unknown }).plan)).toEqual([
      { installPath: '/b' }
    ])
  })

  it('starts nothing more once Desktop is quitting', async () => {
    harness.answers = new Map([['agent', ENROL]])

    const done = prefetchEnrolledAgents()
    await vi.waitFor(() => expect(harness.runs).toHaveLength(1))
    harness.stopped = true
    harness.runs[0]!.done = true
    harness.runs[0]!.finish(null)
    await done

    expect(harness.runs, 'the second install is never started').toHaveLength(1)
  })

  it("downloads core file's packages for an answer with no override", async () => {
    harness.answers = new Map([['agent', { ...ENROL, payload: {} }]])
    harness.plannable = new Set(['/a'])

    const done = prefetchEnrolledAgents()
    await finishNext(null)
    await done

    expect(harness.runs[0]!.request).toMatchObject({ signature: 'core' })
  })

  it.each([
    [
      'no answer enrols',
      () => (harness.answers = new Map([['agent', { ...ENROL, enrol: false }]]))
    ],
    [
      'the enrolling answer grants something else',
      () =>
        (harness.answers = new Map([
          [
            'agent',
            { ...ENROL, grants: [{ ...ENROL.grants[0], grant: { arg: '--enable-assets' } }] }
          ]
        ]))
    ],
    [
      'this machine could not enrol',
      () => {
        harness.answers = new Map([['agent', ENROL]])
        harness.idClass = 'random_fallback'
      }
    ],
    [
      'the enrolling answer is too old to enrol',
      () =>
        (harness.answers = new Map([
          ['agent', { ...ENROL, fetchedAt: Date.now() - 49 * 3_600_000 }]
        ]))
    ],
    [
      'the campaign does not list the agent',
      () => {
        harness.answers = new Map([['agent', ENROL]])
        harness.registry = [{ key: 'agent', args: ['--enable-assets'] }]
      }
    ],
    [
      'beta features are off',
      () => {
        harness.answers = new Map([['agent', ENROL]])
        harness.betaEnabled = false
      }
    ]
  ])('downloads nothing when %s', async (_label, arrange) => {
    arrange()

    await prefetchEnrolledAgents()

    expect(harness.runs).toEqual([])
  })
})
