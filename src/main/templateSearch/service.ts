import type { TemplateSearchAvailability } from '../../types/ipc'
import type { RunningSidecar, SidecarLaunch, SidecarProblem, SidecarStart } from './sidecar'
import { SidecarRequestError } from './sidecarClient'

export const IDLE_STOP_MS = 5 * 60_000

export interface SidecarPython {
  installationId: string
  python: string
}

export interface LocalBundle {
  dir: string
  version: string
}

export interface BundleSource {
  newest(): Promise<LocalBundle | null>
  discard(version: string): Promise<void>
  prepare(): Promise<TemplateSearchAvailability>
}

export interface SearchServiceDeps {
  pyz: () => string | null
  cacheDir: string
  pythons: () => Promise<SidecarPython[]>
  isBusy: (installationId: string) => boolean
  bundles: BundleSource
  start: (launch: SidecarLaunch, signal: AbortSignal) => Promise<SidecarStart>
  post: (sidecar: RunningSidecar, body: unknown) => Promise<unknown>
  onAvailability: (availability: TemplateSearchAvailability) => void
  onStartAttempt?: (attempt: StartAttempt) => void
  now?: () => number
  idleStopMs?: number
}

export interface StartAttempt {
  result: SidecarProblem | 'ready' | 'aborted'
  startMs: number
  bundleVersion: string
  verified: boolean
}

interface Running {
  sidecar: RunningSidecar
  installationId: string
}

type Ensure =
  { ok: true; running: Running } | { ok: false; availability: TemplateSearchAvailability }

type Started = { ok: true; running: Running } | { ok: false; problem: SidecarProblem | 'busy' }

export type SidecarDecision =
  | { kind: 'answer'; body: unknown; coldStart: boolean }
  | { kind: 'unavailable'; availability: TemplateSearchAvailability }

const UNSUPPORTED: TemplateSearchAvailability = {
  kind: 'unavailable',
  reason: 'runtime_unsupported'
}

function availabilityFor(problem: SidecarProblem): TemplateSearchAvailability {
  if (problem === 'runtime_unsupported') return UNSUPPORTED
  if (problem === 'bundle_incompatible') return { kind: 'unavailable', reason: 'update_desktop' }
  return { kind: 'unavailable', reason: 'failed' }
}

export function createSearchService(deps: SearchServiceDeps) {
  const idleStopMs = deps.idleStopMs ?? IDLE_STOP_MS
  const now = deps.now ?? Date.now
  const unsupportedPythons = new Set<string>()
  let running: Running | null = null
  let starting: Promise<Ensure> | null = null
  let spawning: {
    installationId: string
    abort: AbortController
    settled: Promise<unknown>
  } | null = null
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let verifyNext = false
  let waitingForBuild = false

  function announce(availability: TemplateSearchAvailability): void {
    deps.onAvailability(availability)
  }

  function armIdleStop(): void {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => void stop(), idleStopMs)
  }

  async function stop(): Promise<void> {
    clearTimeout(idleTimer)
    const current = running
    running = null
    if (current) await current.sidecar.stop()
  }

  function watchExit(current: Running): void {
    void current.sidecar.exited.then(() => {
      if (running !== current) return
      running = null
      verifyNext = true
      announce({ kind: 'idle' })
    })
  }

  function waitForBuild(): Ensure {
    waitingForBuild = true
    return { ok: false, availability: { kind: 'waiting_for_build' } }
  }

  async function freePythons(): Promise<SidecarPython[]> {
    return (await deps.pythons()).filter(
      (p) => !unsupportedPythons.has(p.python) && !deps.isBusy(p.installationId)
    )
  }

  function markUnsupported(python: string): void {
    unsupportedPythons.add(python)
  }

  async function startOn(
    pyz: string,
    bundle: LocalBundle,
    candidates: SidecarPython[]
  ): Promise<Started> {
    let unsupported = false
    for (const candidate of candidates) {
      if (unsupportedPythons.has(candidate.python) || deps.isBusy(candidate.installationId))
        continue
      const abort = new AbortController()
      const startedAt = now()
      const verify = verifyNext
      const attempt = deps.start(
        {
          python: candidate.python,
          pyz,
          bundleDir: bundle.dir,
          cacheDir: deps.cacheDir,
          verify
        },
        abort.signal
      )
      spawning = {
        installationId: candidate.installationId,
        abort,
        settled: attempt.catch(() => null)
      }
      const started = await attempt.finally(() => {
        spawning = null
      })
      deps.onStartAttempt?.({
        result: abort.signal.aborted ? 'aborted' : started.ok ? 'ready' : started.problem,
        startMs: now() - startedAt,
        bundleVersion: bundle.version,
        verified: verify
      })
      if (abort.signal.aborted) {
        if (started.ok) await started.sidecar.stop()
        continue
      }
      if (started.ok) {
        verifyNext = false
        return {
          ok: true,
          running: { sidecar: started.sidecar, installationId: candidate.installationId }
        }
      }
      if (started.problem !== 'runtime_unsupported') return started
      unsupported = true
      markUnsupported(candidate.python)
    }
    return { ok: false, problem: unsupported ? 'runtime_unsupported' : 'busy' }
  }

  function blockedBy(pythons: SidecarPython[]): Ensure | null {
    const supported = pythons.filter((p) => !unsupportedPythons.has(p.python))
    if (supported.length === 0) {
      return { ok: false, availability: pythons.length ? UNSUPPORTED : { kind: 'no_local_build' } }
    }
    if (supported.every((p) => deps.isBusy(p.installationId))) return waitForBuild()
    return null
  }

  async function launch(pyz: string): Promise<Ensure> {
    const pythons = await deps.pythons()
    const blocked = blockedBy(pythons)
    if (blocked) return blocked
    const prepared = await deps.bundles.prepare()
    if (prepared.kind !== 'ready')
      return blockedBy(pythons) ?? { ok: false, availability: prepared }
    const bundle = await deps.bundles.newest()
    if (!bundle) return { ok: false, availability: { kind: 'unavailable', reason: 'failed' } }
    announce({ kind: 'starting' })
    const started = await startOn(pyz, bundle, pythons)
    if (started.ok) return started
    if (started.problem === 'busy') return blockedBy(pythons) ?? waitForBuild()
    if (started.problem === 'bundle_invalid') {
      await deps.bundles.discard(bundle.version)
      return { ok: false, availability: await deps.bundles.prepare() }
    }
    return { ok: false, availability: availabilityFor(started.problem) }
  }

  async function ensureRunning(): Promise<Ensure> {
    const pyz = deps.pyz()
    if (!pyz) {
      await stop()
      announce({ kind: 'off' })
      return { ok: false, availability: { kind: 'off' } }
    }
    if (running) {
      armIdleStop()
      return { ok: true, running }
    }
    if (!starting) {
      starting = launch(pyz).finally(() => {
        starting = null
      })
    }
    const result = await starting
    if (!result.ok) {
      announce(result.availability)
      return result
    }
    if (running !== result.running) {
      if (deps.isBusy(result.running.installationId)) {
        await result.running.sidecar.stop()
        announce({ kind: 'waiting_for_build' })
        return waitForBuild()
      }
      running = result.running
      watchExit(running)
      announce({ kind: 'ready' })
    }
    armIdleStop()
    return { ok: true, running }
  }

  async function decide(body: unknown): Promise<SidecarDecision> {
    let coldStart = running === null
    for (let attempt = 0; attempt < 2; attempt++) {
      const ensured = await ensureRunning()
      if (!ensured.ok) return { kind: 'unavailable', availability: ensured.availability }
      try {
        const answer = await deps.post(ensured.running.sidecar, body)
        armIdleStop()
        return { kind: 'answer', body: answer, coldStart }
      } catch (err) {
        if (!(err instanceof SidecarRequestError) || !err.unreachable) throw err
        coldStart = true
        if (running === ensured.running) {
          running = null
          verifyNext = true
          await ensured.running.sidecar.stop()
        }
      }
    }
    throw new Error('the search stopped answering')
  }

  async function onBuildAction(installationId: string): Promise<void> {
    if (spawning?.installationId === installationId) {
      spawning.abort.abort()
      await spawning.settled
    }
    if (running?.installationId === installationId) await stop()
  }

  function onBuildActionEnd(): void {
    if (!waitingForBuild) return
    waitingForBuild = false
    announce({ kind: 'idle' })
  }

  async function prepare(): Promise<void> {
    await ensureRunning()
  }

  return {
    decide,
    prepare,
    onBuildAction,
    onBuildActionEnd,
    freePythons,
    markUnsupported,
    partnerSwitch: (): boolean => running?.sidecar.ready.partner === true
  }
}

export type SearchService = ReturnType<typeof createSearchService>
