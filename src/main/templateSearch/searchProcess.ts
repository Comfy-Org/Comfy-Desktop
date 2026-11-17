import { execFile, type ChildProcess } from 'child_process'
import { net } from 'electron'
import path from 'path'
import * as settings from '../settings'
import { list as listInstallations, type InstallationRecord } from '../installations'
import { cacheDir, dataDir } from '../lib/paths'
import { killProcessTree } from '../lib/process'
import { startModelTransfer } from '../lib/modelDownloadTransport'
import { _operationAborts } from '../lib/ipc/shared'
import { _getActiveOperations } from '../lib/ipc/sessionActions'
import type { TerminalEnv } from '../types/sources'
import type { TemplateSearchAvailability } from '../../types/ipc'
import { createBundleStore, type Supported, type TransferResult } from './bundles'
import { buildRuntime } from './buildRuntime'
import { createSearchService, type SidecarDecision, type SidecarPython } from './service'
import { RUNTIME_UNSUPPORTED_EXIT, startSidecar } from './sidecar'
import { postToSidecar } from './sidecarClient'
import { asRecord } from './json'

export const SIDECAR_PATH_ENV = 'COMFY_DESKTOP_TEMPLATE_SEARCH_SIDECAR'
const SEARCH_TIMEOUT_MS = 3000
const SMALL_FILE_LIMIT = 8 * 1024 * 1024
const TOOL_TIMEOUT_MS = 120_000
const ACTIONS_THAT_LEAVE_THE_ENV = new Set(['rename', 'open-folder'])

export function changesBuildEnv(actionId: string): boolean {
  return !ACTIONS_THAT_LEAVE_THE_ENV.has(actionId)
}

export function isBuildBusy(installationId: string): boolean {
  return (
    _operationAborts.has(installationId) ||
    _getActiveOperations().some(
      (op) => op.installationId === installationId && changesBuildEnv(op.actionId)
    )
  )
}

export function parseSupports(stdout: string): Supported | null {
  try {
    const out = asRecord(JSON.parse(stdout.trim().split('\n').at(-1) ?? ''))
    const accepts = asRecord(out?.accepts)
    if (typeof out?.sidecar !== 'string' || typeof accepts?.major !== 'number') return null
    if (typeof accepts.min_minor !== 'number') return null
    return { sidecar: out.sidecar, major: accepts.major, minMinor: accepts.min_minor }
  } catch {
    return null
  }
}

async function getSmall(url: string): Promise<Buffer> {
  const response = await net.fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  const body = Buffer.from(await response.arrayBuffer())
  if (body.length > SMALL_FILE_LIMIT) throw new Error(`${url} is too large`)
  return body
}

async function transfer(file: {
  url: string
  finalPath: string
  size: number
  sha256: string
  onProgress: (received: number) => void
}): Promise<TransferResult> {
  const outcome = await startModelTransfer({
    url: file.url,
    finalPath: file.finalPath,
    directory: path.dirname(file.finalPath),
    filename: path.basename(file.finalPath),
    expectedSize: file.size,
    sha256: file.sha256,
    onProgress: (p) => file.onProgress(p.receivedBytes)
  }).done
  return outcome.outcome === 'completed'
    ? { ok: true }
    : { ok: false, error: outcome.outcome === 'error' ? outcome.error : outcome.outcome }
}

function byLastLaunch(a: InstallationRecord, b: InstallationRecord): number {
  return (b.lastLaunchedAt ?? 0) - (a.lastLaunchedAt ?? 0)
}

export function zipappPath(enabled: unknown, configured: string | undefined): string | null {
  return enabled === true ? configured?.trim() || null : null
}

export function sidecarPythons(
  builds: InstallationRecord[],
  isLocalInstallation: (installation: InstallationRecord) => boolean,
  terminalEnvOf: (installation: InstallationRecord) => TerminalEnv | null
): SidecarPython[] {
  return builds
    .filter(isLocalInstallation)
    .sort(byLastLaunch)
    .flatMap((build) => {
      const runtime = buildRuntime(build, terminalEnvOf(build))
      return runtime ? [{ installationId: build.id, python: runtime.python }] : []
    })
}

export function rememberOnceFound<T>(find: () => Promise<T | null>): () => Promise<T | null> {
  let found: Promise<T | null> | null = null
  return () => {
    const attempt = found ?? find()
    found = attempt
    void attempt.then((value) => {
      if (value === null && found === attempt) found = null
    })
    return attempt
  }
}

export interface SearchProcessOptions {
  isLocalInstallation: (installation: InstallationRecord) => boolean
  terminalEnvOf: (installation: InstallationRecord) => TerminalEnv | null
  broadcast: (availability: TemplateSearchAvailability) => void
}

export function createSearchProcess({
  isLocalInstallation,
  terminalEnvOf,
  broadcast
}: SearchProcessOptions) {
  const helpers = new Map<string, Set<ChildProcess>>()

  const pyz = (): string | null =>
    zipappPath(settings.get('templateSearchEnabled'), process.env[SIDECAR_PATH_ENV])

  async function pythons(): Promise<SidecarPython[]> {
    return sidecarPythons(await listInstallations(), isLocalInstallation, terminalEnvOf)
  }

  const supports = rememberOnceFound(async () => {
    const out = await withPyz(['--supports'])
    return out ? parseSupports(out.stdout) : null
  })

  function runHelper(
    candidate: SidecarPython,
    args: string[]
  ): Promise<{ code: number; stdout: string }> {
    const active = helpers.get(candidate.installationId) ?? new Set<ChildProcess>()
    helpers.set(candidate.installationId, active)
    return new Promise((resolve) => {
      const child = execFile(
        candidate.python,
        args,
        { windowsHide: true, timeout: TOOL_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
        (err, stdout) => {
          active.delete(child)
          const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0
          resolve({ code, stdout: String(stdout) })
        }
      )
      active.add(child)
    })
  }

  async function withPyz(args: string[]): Promise<{ code: number; stdout: string } | null> {
    const zipapp = pyz()
    if (!zipapp) return null
    for (const candidate of await service.freePythons()) {
      const out = await runHelper(candidate, ['-I', '-B', zipapp, ...args])
      if (out.code !== RUNTIME_UNSUPPORTED_EXIT) return out
      service.markUnsupported(candidate.python)
    }
    return null
  }

  const store = createBundleStore({
    root: path.join(dataDir(), 'template-search'),
    base: () => settings.get('templateSearchBundleBase') ?? null,
    getSmall,
    transfer,
    supports,
    check: async (dir) => (await withPyz(['check', dir]))?.code === 0,
    onAvailability: broadcast
  })

  const service = createSearchService({
    pyz,
    cacheDir: path.join(cacheDir(), 'template-search'),
    pythons,
    isBusy: isBuildBusy,
    bundles: store,
    start: (launch, signal) => startSidecar(launch, { signal }),
    post: (sidecar, body) => postToSidecar(sidecar.ready, '/api/decide', body, SEARCH_TIMEOUT_MS),
    onAvailability: broadcast
  })

  async function onBuildAction(installationId: string): Promise<void> {
    if (!pyz()) return
    const active = [...(helpers.get(installationId) ?? [])]
    await Promise.all([
      service.onBuildAction(installationId),
      ...active.map((child) => killProcessTree(child))
    ])
  }

  return {
    decide: (body: unknown): Promise<SidecarDecision> => service.decide(body),
    prepare: (): Promise<void> => service.prepare(),
    download: (): Promise<void> => store.download(),
    onBuildAction,
    onBuildActionEnd: (): void => service.onBuildActionEnd()
  }
}

export type SearchProcess = ReturnType<typeof createSearchProcess>
