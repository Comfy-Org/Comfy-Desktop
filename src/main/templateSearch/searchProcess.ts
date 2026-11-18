import { spawn, type ChildProcess } from 'child_process'
import { net } from 'electron'
import path from 'path'
import * as settings from '../settings'
import { list as listInstallations, type InstallationRecord } from '../installations'
import { cacheDir, dataDir } from '../lib/paths'
import { killProcessTree } from '../lib/process'
import { startModelTransfer } from '../lib/modelDownloadTransport'
import { _hasActiveLaunch, _operationAborts } from '../lib/ipc/shared'
import { _getActiveOperations } from '../lib/ipc/sessionActions'
import { occupiesInstall } from '../lib/ipc/sessionActions/occupiesInstall'
import type { TerminalEnv } from '../types/sources'
import type { TemplateSearchAvailability } from '../../types/ipc'
import {
  createBundleStore,
  Unreachable,
  type BackgroundTrigger,
  type Supported,
  type TransferResult
} from './bundles'
import { buildRuntime } from './buildRuntime'
import {
  createSearchService,
  type SidecarDecision,
  type SidecarPython,
  type SidecarRequest
} from './service'
import { RUNTIME_UNSUPPORTED_EXIT, startSidecar } from './sidecar'
import { postToSidecar } from './sidecarClient'
import { asRecord } from './json'
import { reportBundleDownload, reportStartAttempt } from './searchTelemetry'

export const SIDECAR_PATH_ENV = 'COMFY_DESKTOP_TEMPLATE_SEARCH_SIDECAR'
const SEARCH_TIMEOUT_MS = 3000
const TOOL_TIMEOUT_MS = 120_000
const SMALL_FILE_LIMIT = 8 * 1024 * 1024
const ACTIONS_THAT_LEAVE_THE_ENV = new Set(['rename', 'open-folder'])

export function changesBuildEnv(actionId: string): boolean {
  return occupiesInstall(actionId) && !ACTIONS_THAT_LEAVE_THE_ENV.has(actionId)
}

export function isBuildBusy(installationId: string): boolean {
  return (
    _operationAborts.has(installationId) ||
    _hasActiveLaunch(installationId) ||
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

export async function readCapped(response: Response, limit: number): Promise<Buffer> {
  const reader = response.body?.getReader()
  if (!reader) return Buffer.alloc(0)
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return Buffer.concat(chunks)
    size += value.byteLength
    if (size > limit) {
      await reader.cancel()
      throw new Error(`more than ${limit} bytes`)
    }
    chunks.push(value)
  }
}

async function getSmall(url: string): Promise<Buffer> {
  const response = await net
    .fetch(url, { signal: AbortSignal.timeout(30_000) })
    .catch((err: unknown) => {
      throw new Unreachable(String(err))
    })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return readCapped(response, SMALL_FILE_LIMIT)
}

export interface HelperResult {
  code: number
  stdout: string
}

export type SpawnHelper = (python: string, args: string[]) => ChildProcess

export const spawnHelperProcess: SpawnHelper = (python, args) =>
  spawn(python, args, {
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
    detached: process.platform !== 'win32'
  })

export function helperResult(child: ChildProcess, timeoutMs: number): Promise<HelperResult> {
  return new Promise((resolve) => {
    let stdout = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < 1024 * 1024) stdout += chunk.toString('utf8')
    })
    const timer = setTimeout(() => void killProcessTree(child), timeoutMs)
    const finish = (code: number | null): void => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, stdout })
    }
    child.once('error', () => finish(1))
    child.once('close', (code) => finish(code))
  })
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

function configuredZipapp(): string | null {
  return zipappPath(settings.get('templateSearchEnabled'), process.env[SIDECAR_PATH_ENV])
}

export function templateSearchOn(): boolean {
  return configuredZipapp() !== null
}

export function templateSearchPartnersOn(): boolean {
  return settings.get('templateSearchPartners') !== false
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
  spawnHelper?: SpawnHelper
  storeRoot?: string
  cacheRoot?: string
  isOnline?: () => boolean
}

export function createSearchProcess({
  isLocalInstallation,
  terminalEnvOf,
  broadcast,
  spawnHelper = spawnHelperProcess,
  storeRoot = path.join(dataDir(), 'template-search'),
  cacheRoot = path.join(cacheDir(), 'template-search-cache'),
  isOnline = () => net.isOnline()
}: SearchProcessOptions) {
  const helpers = new Map<string, Set<ChildProcess>>()
  const cancelled = new WeakSet<ChildProcess>()

  const pyz = configuredZipapp

  async function pythons(): Promise<SidecarPython[]> {
    return sidecarPythons(await listInstallations(), isLocalInstallation, terminalEnvOf)
  }

  const supports = rememberOnceFound(async () => {
    const out = await withPyz(['--supports'])
    return out ? parseSupports(out.stdout) : null
  })

  function runHelper(candidate: SidecarPython, args: string[]): Promise<HelperResult | null> {
    const active = helpers.get(candidate.installationId) ?? new Set<ChildProcess>()
    helpers.set(candidate.installationId, active)
    const child = spawnHelper(candidate.python, args)
    active.add(child)
    return helperResult(child, TOOL_TIMEOUT_MS)
      .then((out) => (cancelled.has(child) ? null : out))
      .finally(() => active.delete(child))
  }

  async function withPyz(args: string[]): Promise<HelperResult | null> {
    for (const candidate of await service.freePythons()) {
      const zipapp = pyz()
      if (!zipapp) return null
      if (isBuildBusy(candidate.installationId)) continue
      const out = await runHelper(candidate, ['-I', '-B', zipapp, ...args])
      if (!out) continue
      if (out.code !== RUNTIME_UNSUPPORTED_EXIT) return out
      service.markUnsupported(candidate.python)
    }
    return null
  }

  const store = createBundleStore({
    root: storeRoot,
    base: () => settings.get('templateSearchBundleBase') ?? null,
    getSmall,
    transfer,
    supports,
    check: async (dir) => {
      const out = await withPyz(['check', dir])
      return out === null || out.code === 0
    },
    onAvailability: broadcast,
    onDownloaded: reportBundleDownload
  })

  const service = createSearchService({
    pyz,
    cacheDir: cacheRoot,
    pythons,
    isBusy: isBuildBusy,
    bundles: store,
    start: (launch, signal) => startSidecar(launch, { signal }),
    post: (sidecar, body) => postToSidecar(sidecar.ready, '/api/decide', body, SEARCH_TIMEOUT_MS),
    onAvailability: broadcast,
    onStartAttempt: reportStartAttempt
  })

  async function onBuildAction(installationId: string): Promise<void> {
    const active = [...(helpers.get(installationId) ?? [])]
    for (const child of active) cancelled.add(child)
    await Promise.all([
      service.onBuildAction(installationId),
      ...active.map((child) => killProcessTree(child))
    ])
  }

  async function downloadInBackground(trigger: BackgroundTrigger): Promise<boolean> {
    if (!pyz() || !store.hasBase() || !isOnline()) return false
    if ((await service.freePythons()).length === 0 || !(await supports())) return false
    if (!(await store.newest())) await store.download({ quietly: true, trigger })
    return true
  }

  return {
    decide: (request: SidecarRequest): Promise<SidecarDecision> => service.decide(request),
    prepare: (): Promise<void> => service.prepare(),
    download: (): Promise<void> => (pyz() ? store.download() : Promise.resolve()),
    downloadInBackground,
    onBuildAction,
    onBuildActionEnd: (): void => service.onBuildActionEnd()
  }
}

export type SearchProcess = ReturnType<typeof createSearchProcess>
