import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TemplateSearchAvailability } from '../../types/ipc'
import {
  createSearchService,
  IDLE_STOP_MS,
  type BundleSource,
  type SearchServiceDeps,
  type SidecarPython
} from './service'
import type { RunningSidecar, SidecarLaunch, SidecarStart } from './sidecar'
import { SidecarRequestError } from './sidecarClient'

const BUILD_A: SidecarPython = { installationId: 'a', python: '/a/python' }
const BUILD_B: SidecarPython = { installationId: 'b', python: '/b/python' }

function fakeSidecar() {
  let exit!: () => void
  const exited = new Promise<void>((resolve) => (exit = resolve))
  const sidecar: RunningSidecar = {
    ready: { port: 4100, token: 't'.repeat(64) },
    exited,
    stop: vi.fn(async () => exit())
  }
  return { sidecar, crash: exit }
}

function bundles(over: Partial<BundleSource> = {}): BundleSource {
  return {
    newest: vi.fn(async () => ({ dir: '/bundles/1.0.0', version: '1.0.0' })),
    discard: vi.fn(async () => undefined),
    prepare: vi.fn(async (): Promise<TemplateSearchAvailability> => ({ kind: 'ready' })),
    ...over
  }
}

type Start = (launch: SidecarLaunch, signal: AbortSignal) => Promise<SidecarStart>

function setup(over: Partial<SearchServiceDeps> = {}) {
  const started: ReturnType<typeof fakeSidecar>[] = []
  const announced: TemplateSearchAvailability[] = []
  const start = vi.fn<Start>(async () => {
    const next = fakeSidecar()
    started.push(next)
    return { ok: true, sidecar: next.sidecar }
  })
  const deps: SearchServiceDeps = {
    pyz: () => '/search.pyz',
    cacheDir: '/cache',
    pythons: async () => [BUILD_A, BUILD_B],
    isBusy: () => false,
    bundles: bundles(),
    start,
    post: vi.fn(async (_sidecar: RunningSidecar, body: unknown) => ({ echo: body })),
    onAvailability: (a) => announced.push(a),
    ...over
  }
  return { service: createSearchService(deps), start, started, announced }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('search service', () => {
  it('stays off without a sidecar to run, and starts nothing', async () => {
    const { service, start } = setup({ pyz: () => null })
    expect(await service.decide({ text: 'x' })).toEqual({
      kind: 'unavailable',
      availability: { kind: 'off' }
    })
    expect(start).not.toHaveBeenCalled()
  })

  it('says a local build is needed when there is none', async () => {
    const { service } = setup({ pythons: async () => [] })
    expect(await service.decide({ text: 'x' })).toEqual({
      kind: 'unavailable',
      availability: { kind: 'no_local_build' }
    })
  })

  it('starts one sidecar for searches that arrive together, and answers both', async () => {
    const { service, start, announced } = setup()
    const [first, second] = await Promise.all([
      service.decide({ text: 'one' }),
      service.decide({ text: 'two' })
    ])
    expect(start).toHaveBeenCalledTimes(1)
    expect(first).toEqual({ kind: 'answer', body: { echo: { text: 'one' } } })
    expect(second).toEqual({ kind: 'answer', body: { echo: { text: 'two' } } })
    expect(announced).toEqual([{ kind: 'starting' }, { kind: 'ready' }])
  })

  it('starts with the first Python it is given, the bundle, the cache and no verify', async () => {
    const { service, start } = setup()
    await service.decide({ text: 'x' })
    expect(start.mock.calls[0]![0]).toEqual({
      python: '/a/python',
      pyz: '/search.pyz',
      bundleDir: '/bundles/1.0.0',
      cacheDir: '/cache',
      verify: false
    })
  })

  it('starts search when asked to get ready, and stops it after a quiet spell', async () => {
    vi.useFakeTimers()
    const { service, start, started } = setup()
    await service.prepare()
    expect(start).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(IDLE_STOP_MS)
    expect(started[0]!.sidecar.stop).toHaveBeenCalled()
  })

  it('stops after a quiet spell even when the first search failed', async () => {
    vi.useFakeTimers()
    const post = vi.fn().mockRejectedValue(new SidecarRequestError('400', false))
    const { service, started } = setup({ post })
    await expect(service.decide({ text: 'x' })).rejects.toThrow('400')
    await vi.advanceTimersByTimeAsync(IDLE_STOP_MS)
    expect(started[0]!.sidecar.stop).toHaveBeenCalled()
  })

  it('stops a running sidecar once search is switched off', async () => {
    let zipapp: string | null = '/search.pyz'
    const { service, started } = setup({ pyz: () => zipapp })
    await service.decide({ text: 'x' })
    zipapp = null
    expect(await service.decide({ text: 'x' })).toEqual({
      kind: 'unavailable',
      availability: { kind: 'off' }
    })
    expect(started[0]!.sidecar.stop).toHaveBeenCalled()
  })

  it('waits, rather than saying no build can run search, when its only start was called off', async () => {
    const start = vi.fn<Start>(
      (_launch, signal) =>
        new Promise<SidecarStart>((resolve) =>
          signal.addEventListener('abort', () => resolve({ ok: false, problem: 'failed' }))
        )
    )
    let busy = false
    const { service } = setup({ start, isBusy: () => busy, pythons: async () => [BUILD_A] })
    const searching = service.decide({ text: 'x' })
    await vi.waitFor(() => expect(start).toHaveBeenCalled())
    busy = true
    await service.onBuildAction('a')
    expect(await searching).toEqual({
      kind: 'unavailable',
      availability: { kind: 'waiting_for_build' }
    })
  })

  it('says no build can run search when the version probe found none could', async () => {
    const probe: { service?: ReturnType<typeof createSearchService> } = {}
    const prepare = vi.fn(async (): Promise<TemplateSearchAvailability> => {
      probe.service!.markUnsupported('/a/python')
      probe.service!.markUnsupported('/b/python')
      return { kind: 'unavailable', reason: 'update_desktop' }
    })
    probe.service = setup({ bundles: bundles({ prepare }) }).service
    expect(await probe.service.decide({ text: 'x' })).toEqual({
      kind: 'unavailable',
      availability: { kind: 'unavailable', reason: 'runtime_unsupported' }
    })
  })

  it('says no build can run search when every Python was found unable to while it got ready', async () => {
    const probe: { service?: ReturnType<typeof createSearchService> } = {}
    const prepare = vi.fn(async (): Promise<TemplateSearchAvailability> => {
      probe.service!.markUnsupported('/a/python')
      probe.service!.markUnsupported('/b/python')
      return { kind: 'ready' }
    })
    probe.service = setup({ bundles: bundles({ prepare }) }).service
    expect(await probe.service.decide({ text: 'x' })).toEqual({
      kind: 'unavailable',
      availability: { kind: 'unavailable', reason: 'runtime_unsupported' }
    })
  })

  it("uses another build's Python while the first build is busy", async () => {
    const { service, start } = setup({ isBusy: (id) => id === 'a' })
    await service.decide({ text: 'x' })
    expect(start.mock.calls[0]![0].python).toBe('/b/python')
  })

  it('waits while every build is busy, and says so again when an operation ends', async () => {
    let busy = true
    const { service, start, announced } = setup({ isBusy: () => busy })
    expect(await service.decide({ text: 'x' })).toEqual({
      kind: 'unavailable',
      availability: { kind: 'waiting_for_build' }
    })
    expect(start).not.toHaveBeenCalled()

    busy = false
    service.onBuildActionEnd()
    expect(announced.at(-1)).toEqual({ kind: 'idle' })
    expect((await service.decide({ text: 'x' })).kind).toBe('answer')
  })

  it("stops the sidecar before an operation on its build, and not for another build's", async () => {
    const { service, started } = setup()
    await service.decide({ text: 'x' })
    await service.onBuildAction('b')
    expect(started[0]!.sidecar.stop).not.toHaveBeenCalled()
    await service.onBuildAction('a')
    expect(started[0]!.sidecar.stop).toHaveBeenCalled()
  })

  it('does not hold up an operation on another build while search is starting', async () => {
    const start = vi.fn<Start>(() => new Promise<SidecarStart>(() => {}))
    const { service } = setup({ start })
    void service.decide({ text: 'x' })
    await vi.waitFor(() => expect(start).toHaveBeenCalled())
    await expect(service.onBuildAction('b')).resolves.toBeUndefined()
  })

  it('calls off a start on the build an operation is about to change, and moves on', async () => {
    let busy = new Set<string>()
    const signals: AbortSignal[] = []
    const start = vi.fn<Start>(
      (launch, signal) =>
        new Promise<SidecarStart>((resolve) => {
          signals.push(signal)
          if (launch.python === '/b/python') resolve({ ok: true, sidecar: fakeSidecar().sidecar })
          signal.addEventListener('abort', () => resolve({ ok: false, problem: 'failed' }))
        })
    )
    const { service } = setup({ start, isBusy: (id) => busy.has(id) })
    const searching = service.decide({ text: 'x' })
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1))

    busy = new Set(['a'])
    await service.onBuildAction('a')

    expect(signals[0]!.aborted).toBe(true)
    expect((await searching).kind).toBe('answer')
    expect(start.mock.calls.map(([l]) => l.python)).toEqual(['/a/python', '/b/python'])
  })

  it('stops a sidecar whose build became busy while it was starting', async () => {
    let finishStart!: (value: SidecarStart) => void
    let busy = false
    const pending = fakeSidecar()
    const { service, announced } = setup({
      start: () => new Promise((resolve) => (finishStart = resolve)),
      isBusy: () => busy
    })
    const searching = service.decide({ text: 'x' })
    await vi.waitFor(() => expect(finishStart).toBeDefined())
    busy = true
    finishStart({ ok: true, sidecar: pending.sidecar })

    expect(await searching).toEqual({
      kind: 'unavailable',
      availability: { kind: 'waiting_for_build' }
    })
    expect(pending.sidecar.stop).toHaveBeenCalled()
    expect(announced.at(-1)).toEqual({ kind: 'waiting_for_build' })
  })

  it('waits, rather than passing on what the bundle store said, when every build became busy meanwhile', async () => {
    let busy = false
    const prepare = vi.fn(async (): Promise<TemplateSearchAvailability> => {
      busy = true
      return { kind: 'unavailable', reason: 'update_desktop' }
    })
    const { service, announced } = setup({ isBusy: () => busy, bundles: bundles({ prepare }) })
    expect(await service.decide({ text: 'x' })).toEqual({
      kind: 'unavailable',
      availability: { kind: 'waiting_for_build' }
    })
    busy = false
    service.onBuildActionEnd()
    expect(announced.at(-1)).toEqual({ kind: 'idle' })
  })

  it('moves on from a Python that cannot run search, and remembers it', async () => {
    const start = vi.fn<Start>(async (launch) =>
      launch.python === '/a/python'
        ? { ok: false, problem: 'runtime_unsupported' }
        : { ok: true, sidecar: fakeSidecar().sidecar }
    )
    const { service } = setup({ start })
    await service.decide({ text: 'x' })
    await service.onBuildAction('b')
    await service.decide({ text: 'x' })
    expect(start.mock.calls.map(([l]) => l.python)).toEqual(['/a/python', '/b/python', '/b/python'])
    expect((await service.freePythons()).map((p) => p.python)).toEqual(['/b/python'])
  })

  it('says no build can run search when every Python fails', async () => {
    const { service } = setup({
      start: async () => ({ ok: false, problem: 'runtime_unsupported' })
    })
    expect(await service.decide({ text: 'x' })).toEqual({
      kind: 'unavailable',
      availability: { kind: 'unavailable', reason: 'runtime_unsupported' }
    })
  })

  it('discards a bundle the sidecar finds damaged, and passes on what the store says next', async () => {
    const prepare = vi
      .fn<() => Promise<TemplateSearchAvailability>>()
      .mockResolvedValueOnce({ kind: 'ready' })
      .mockResolvedValueOnce({ kind: 'downloading', received: 0, total: 1000 })
    const store = bundles({ prepare })
    const { service } = setup({
      bundles: store,
      start: async () => ({ ok: false, problem: 'bundle_invalid' })
    })
    expect(await service.decide({ text: 'x' })).toEqual({
      kind: 'unavailable',
      availability: { kind: 'downloading', received: 0, total: 1000 }
    })
    expect(store.discard).toHaveBeenCalledWith('1.0.0')
  })

  it('asks for a Desktop update when the bundle is too new for this sidecar', async () => {
    const { service } = setup({
      start: async () => ({ ok: false, problem: 'bundle_incompatible' })
    })
    expect(await service.decide({ text: 'x' })).toEqual({
      kind: 'unavailable',
      availability: { kind: 'unavailable', reason: 'update_desktop' }
    })
  })

  it('passes on a bundle that is still downloading, without starting', async () => {
    const { service, start } = setup({
      bundles: bundles({
        prepare: async () => ({ kind: 'downloading', received: 0, total: 179_000_000 })
      })
    })
    expect(await service.decide({ text: 'x' })).toEqual({
      kind: 'unavailable',
      availability: { kind: 'downloading', received: 0, total: 179_000_000 }
    })
    expect(start).not.toHaveBeenCalled()
  })

  it('stops after a quiet spell counted from the last search, and starts again on the next', async () => {
    vi.useFakeTimers()
    const { service, start, started } = setup()
    await service.decide({ text: 'x' })
    await vi.advanceTimersByTimeAsync(IDLE_STOP_MS - 1000)
    await service.decide({ text: 'x' })
    await vi.advanceTimersByTimeAsync(IDLE_STOP_MS - 1000)
    expect(started[0]!.sidecar.stop).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(started[0]!.sidecar.stop).toHaveBeenCalled()
    await service.decide({ text: 'x' })
    expect(start).toHaveBeenCalledTimes(2)
  })

  it('counts getting ready as use of a sidecar that is already running', async () => {
    vi.useFakeTimers()
    const { service, started } = setup()
    await service.decide({ text: 'x' })
    await vi.advanceTimersByTimeAsync(IDLE_STOP_MS - 1000)
    await service.prepare()
    await vi.advanceTimersByTimeAsync(IDLE_STOP_MS - 1000)
    expect(started[0]!.sidecar.stop).not.toHaveBeenCalled()
  })

  it('verifies the bundle on the next start after the sidecar dies', async () => {
    const { service, start, started, announced } = setup()
    await service.decide({ text: 'x' })
    started[0]!.crash()
    await vi.waitFor(() => expect(announced.at(-1)).toEqual({ kind: 'idle' }))
    await service.decide({ text: 'x' })
    expect(start.mock.calls[1]![0].verify).toBe(true)
  })

  it('starts again and retries once when the sidecar stops answering', async () => {
    const post = vi
      .fn()
      .mockRejectedValueOnce(new SidecarRequestError('ECONNREFUSED', true))
      .mockResolvedValueOnce({ ok: 1 })
    const { service, start } = setup({ post })
    expect(await service.decide({ text: 'x' })).toEqual({ kind: 'answer', body: { ok: 1 } })
    expect(start).toHaveBeenCalledTimes(2)
    expect(start.mock.calls[1]![0].verify).toBe(true)
  })

  it('reports a search the sidecar refused without restarting it', async () => {
    const post = vi.fn().mockRejectedValue(new SidecarRequestError('400', false))
    const { service, start } = setup({ post })
    await expect(service.decide({ text: 'x' })).rejects.toThrow('400')
    expect(start).toHaveBeenCalledTimes(1)
  })
})
