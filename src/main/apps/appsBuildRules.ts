import path from 'path'
import { isAppsBuild } from '../../shared/appsBuild'

export const APPS_BUILD_NAME = 'Apps'
export const APPS_BUILD_RELEASE = 'v0.42.1-env1'
export const APPS_BUILD_FIRST_PORT = 8288
export const APPS_BUILD_LAST_PORT = 8388
export const APPS_BUILD_IDLE_MS = 10 * 60_000
export const APPS_SETUP_STAGE = 'Setting up ComfyUI for apps'
export const FREE_JSON = JSON.stringify({ unload_models: true, free_memory: true })
export const FREE_IDLE_MS = 5 * 60_000
export const MAC_GPU_ONLY_ARG = '--gpu-only'
export const MAC_GPU_ONLY_MIN_BYTES = 36 * 1024 ** 3

export const LINUX_NO_GPU = 'This computer needs an NVIDIA, AMD or Intel Arc GPU on Linux.'
export const MAC_NO_GPU = 'This computer needs a Mac with Apple Silicon.'

const LINUX_GPUS = ['nvidia', 'amd', 'intel']

export function localOff(platform: string, gpu: string | null | undefined): string | null {
  if (platform === 'linux' && !LINUX_GPUS.includes(gpu ?? '')) return LINUX_NO_GPU
  if (platform === 'darwin' && gpu !== 'mps') return MAC_NO_GPU
  return null
}

export function appsLaunchArgs(
  launchArgs: unknown,
  fallback: string,
  platform: string,
  totalBytes: number
): string {
  const args = typeof launchArgs === 'string' ? launchArgs.trim() : fallback
  const wanted = platform === 'darwin' && totalBytes >= MAC_GPU_ONLY_MIN_BYTES
  if (!wanted || args.split(/\s+/).includes(MAC_GPU_ONLY_ARG)) return args
  return `${args} ${MAC_GPU_ONLY_ARG}`.trim()
}

export function findAppsBuild<T extends object>(list: readonly T[]): T | null {
  return list.find(isAppsBuild) ?? null
}

function within(dir: string, root: string, p: typeof path): boolean {
  const rel = p.relative(root, dir)
  return rel === '' || (!rel.startsWith('..') && !p.isAbsolute(rel))
}

export interface OutputDirPlaces {
  dataRoot: string
  appData: string
  sharedOutput: string
  installPath: string
}

export function appsOutputDir(places: OutputDirPlaces, p: typeof path = path): string {
  const candidates = [
    p.join(places.dataRoot, 'ComfyUI-Apps', 'output'),
    p.join(places.appData, 'ComfyUI-Apps', 'output')
  ]
  const clashes = (dir: string) =>
    [places.sharedOutput, places.installPath].some(
      (other) => within(dir, other, p) || within(other, dir, p)
    )
  return candidates.find((dir) => !clashes(dir)) ?? candidates[1]!
}

export interface ModelSharingInstall {
  id: string
  installPath: string
  sourceId: string
  status?: string
  appsBuild?: unknown
  useSharedModels?: boolean
  modelDirs?: string[]
}

export function appsModelDirs<T extends ModelSharingInstall>(
  list: readonly T[],
  categoryOf: (inst: T) => string | undefined,
  modelsDirOf: (installPath: string) => string
): string[] {
  const dirs: string[] = []
  for (const inst of list) {
    if (isAppsBuild(inst) || categoryOf(inst) !== 'local') continue
    if (inst.sourceId === 'desktop' || inst.useSharedModels !== false) continue
    if (inst.status !== undefined && inst.status !== 'installed') continue
    const own = inst.installPath ? [modelsDirOf(inst.installPath)] : []
    for (const dir of [...own, ...(inst.modelDirs ?? [])]) {
      if (typeof dir === 'string' && dir && !dirs.includes(dir)) dirs.push(dir)
    }
  }
  return dirs
}

export function pickVariant<T extends { recommended?: boolean }>(options: readonly T[]): T | null {
  return options.find((o) => o.recommended) ?? options[0] ?? null
}

export function downloadBytes(files: unknown): number {
  if (!Array.isArray(files)) return 0
  return files.reduce(
    (n: number, f: unknown) =>
      n + (typeof (f as { size?: unknown })?.size === 'number' ? (f as { size: number }).size : 0),
    0
  )
}

export interface SetupEvent {
  stage: string
  step: string
  percent: number
  state: 'running' | 'done' | 'failed' | 'cancelled'
  done?: number
  total?: number
  error?: string
}

const SETUP_STEPS: Record<string, string> = {
  download: 'Downloading ComfyUI',
  extract: 'Unpacking it',
  setup: 'Setting up Python',
  cleanup: 'Finishing up'
}

export function setupEvent(
  phase: string,
  detail: Record<string, unknown>,
  totalBytes: number
): SetupEvent | null {
  if (phase === 'steps' || phase === 'done') return null
  const raw = detail['percent']
  const percent =
    typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? Math.min(100, raw) : -1
  const event: SetupEvent = {
    stage: APPS_SETUP_STAGE,
    step: SETUP_STEPS[phase] ?? 'Setting up',
    percent,
    state: 'running'
  }
  if (phase === 'download' && totalBytes > 0 && percent >= 0) {
    event.done = Math.round((totalBytes * percent) / 100)
    event.total = totalBytes
  }
  return event
}

export function setupEnd(state: 'done' | 'failed' | 'cancelled', error?: string): SetupEvent {
  return {
    stage: APPS_SETUP_STAGE,
    step: state === 'done' ? 'Ready' : state === 'cancelled' ? 'Cancelled' : 'Failed',
    percent: state === 'done' ? 100 : -1,
    state,
    ...(error ? { error } : {})
  }
}

const RUN_ENDS = ['execution_success', 'execution_error', 'execution_interrupted']

export function isRunEnd(type: unknown): boolean {
  return typeof type === 'string' && RUN_ENDS.includes(type)
}

export function freeWait(lastUse: number, now: number, idleMs = FREE_IDLE_MS): number {
  return Math.max(0, lastUse + idleMs - now)
}

export function queueEmpty(json: unknown): boolean {
  const info = (json as { exec_info?: { queue_remaining?: unknown } } | null)?.exec_info
  return info?.queue_remaining === 0
}

export interface IdleCheck {
  mode: string
  hasWindow: boolean
  lastUse: number
  now: number
  idleMs?: number
}

export function shouldStopIdle({
  mode,
  hasWindow,
  lastUse,
  now,
  idleMs = APPS_BUILD_IDLE_MS
}: IdleCheck): boolean {
  return mode === 'console' && !hasWindow && now - lastUse >= idleMs
}

export function pickOpenTarget<T extends { id: string }>(
  own: readonly T[],
  startedAt: ReadonlyMap<string, number>,
  wanted?: string
): T | null {
  if (wanted !== undefined) return own.find((inst) => inst.id === wanted) ?? null
  const running = own
    .filter((inst) => startedAt.has(inst.id))
    .sort((a, b) => startedAt.get(b.id)! - startedAt.get(a.id)!)
  return running[0] ?? own[0] ?? null
}
