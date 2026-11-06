import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import {
  configDir,
  homeDir,
  defaultDataRoot,
  defaultDownloadCacheDir,
  builtinDefaultInstallDir,
  setInstallDirResolver
} from './lib/paths'
import { MODEL_FOLDER_TYPES } from './lib/models'
import {
  readFileSafe,
  readFileSafeAsync,
  writeFileSafe,
  type SafeReadOutcome
} from './lib/safe-file'

export interface KnownSettings {
  cacheDir: string
  maxCachedDownloads: number
  onAppClose: 'tray' | 'quit'
  modelsDirs: string[]
  inputDir: string
  outputDir: string
  installDir: string
  language?: string
  theme?: string
  autoUpdate?: boolean
  autoInstallUpdates?: boolean
  autoLaunchOnStartup?: string
  confirmBeforeClosingWindow?: boolean
  warnBeforeRunningMultipleInstances?: boolean
  hardwareAcceleration?: boolean
  pypiMirror?: string
  useChineseMirrors?: boolean
  chineseMirrorsPrompted?: boolean
  telemetryEnabled?: boolean
  betaFeaturesEnabled?: boolean
  firstUseCompleted?: boolean
  minimaxAnnouncementSeen?: boolean
  cloudNodesAnnouncementSeen?: boolean
  comfyRouterAnnouncementSeen?: boolean
  comfyApiAnnouncementSeen?: boolean
  betaNoticeAnnouncedArgs?: string[]
  hideCloudFromPicker?: boolean
  oemManagedModelDirs?: string[]
  oemWorkflowImportVersion?: number
  lastSaveDialogDir?: string
  skipTemplatePickerStep?: boolean
  dashboardWorkspaceId?: string
  pendingDownloadedUpdateVersion?: string
  lastStartupUpdateAttemptVersion?: string
  startupInstallNotReadyVersion?: string
  startupInstallNotReadyCount?: number
  pendingDesktopUpdateAttemptId?: string
  pendingDesktopUpdateAttemptVersion?: string
  installUpdatesOnStartup?: boolean
  showInstallerUI?: boolean
}

export type Settings = KnownSettings & Record<string, unknown>

type DefaultedSettingKey =
  | 'cacheDir'
  | 'maxCachedDownloads'
  | 'onAppClose'
  | 'modelsDirs'
  | 'inputDir'
  | 'outputDir'
  | 'installDir'
type SettingsDefaults = Pick<KnownSettings, DefaultedSettingKey>

const dataPath = path.join(configDir(), 'settings.json')

const SHARED_ROOT = path.join(defaultDataRoot(), 'ComfyUI-Shared')

export type SettingTelemetryValue = boolean | number | string | null

type SettingTelemetryCtx = { platform: NodeJS.Platform }

type SettingTelemetryTransform<K extends keyof KnownSettings> = (
  raw: KnownSettings[K] | undefined,
  ctx: SettingTelemetryCtx
) => SettingTelemetryValue

type SettingEmitter<K extends keyof KnownSettings> =
  | { kind: 'value'; prop: string; toTelemetry?: SettingTelemetryTransform<K> }
  | { kind: 'presence'; prop: string }

type SettingTelemetryPolicy<K extends keyof KnownSettings> =
  | { policy: 'omit' }
  | { policy: 'presence'; prop?: string }
  | {
      policy: 'value'
      prop?: string
      toTelemetry?: SettingTelemetryTransform<K>
    }
  | { policy: 'multi'; emitters: SettingEmitter<K>[] }

type SettingSchemaEntry<K extends keyof KnownSettings> = {
  nullable: boolean
  telemetry: SettingTelemetryPolicy<K>
}

const SETTINGS_SCHEMA = {
  cacheDir: { nullable: false, telemetry: { policy: 'presence' } },
  maxCachedDownloads: {
    nullable: false,
    telemetry: { policy: 'value', toTelemetry: (raw) => (typeof raw === 'number' ? raw : null) }
  },
  onAppClose: {
    nullable: false,
    telemetry: {
      policy: 'value',
      toTelemetry: (raw) => (raw === 'quit' || raw === 'tray' ? raw : null)
    }
  },
  modelsDirs: { nullable: false, telemetry: { policy: 'presence' } },
  inputDir: { nullable: false, telemetry: { policy: 'presence' } },
  outputDir: { nullable: false, telemetry: { policy: 'presence' } },
  installDir: { nullable: false, telemetry: { policy: 'presence' } },
  language: {
    nullable: false,
    telemetry: {
      policy: 'value',
      prop: 'setting_language_selected',
      toTelemetry: (raw) => (typeof raw === 'string' && raw ? raw : null)
    }
  },
  theme: { nullable: false, telemetry: { policy: 'omit' } },
  autoUpdate: { nullable: false, telemetry: { policy: 'omit' } },
  autoInstallUpdates: {
    nullable: false,
    telemetry: {
      policy: 'multi',
      emitters: [
        { kind: 'value', prop: 'auto_install_updates', toTelemetry: (raw) => raw !== false },
        { kind: 'presence', prop: 'auto_install_updates_explicit' }
      ]
    }
  },
  autoLaunchOnStartup: { nullable: false, telemetry: { policy: 'presence' } },
  confirmBeforeClosingWindow: {
    nullable: false,
    telemetry: { policy: 'value', toTelemetry: (raw) => raw === true }
  },
  warnBeforeRunningMultipleInstances: {
    nullable: false,
    telemetry: { policy: 'value', toTelemetry: (raw) => raw !== false }
  },
  hardwareAcceleration: {
    nullable: false,
    telemetry: { policy: 'value', toTelemetry: (raw) => raw !== false }
  },
  pypiMirror: { nullable: false, telemetry: { policy: 'presence' } },
  useChineseMirrors: {
    nullable: false,
    telemetry: { policy: 'value', toTelemetry: (raw) => raw === true }
  },
  chineseMirrorsPrompted: { nullable: false, telemetry: { policy: 'omit' } },
  telemetryEnabled: { nullable: false, telemetry: { policy: 'omit' } },
  betaFeaturesEnabled: { nullable: false, telemetry: { policy: 'omit' } },
  firstUseCompleted: { nullable: false, telemetry: { policy: 'omit' } },
  minimaxAnnouncementSeen: { nullable: false, telemetry: { policy: 'omit' } },
  cloudNodesAnnouncementSeen: { nullable: false, telemetry: { policy: 'omit' } },
  comfyRouterAnnouncementSeen: { nullable: false, telemetry: { policy: 'omit' } },
  comfyApiAnnouncementSeen: { nullable: false, telemetry: { policy: 'omit' } },
  betaNoticeAnnouncedArgs: { nullable: false, telemetry: { policy: 'omit' } },
  hideCloudFromPicker: {
    nullable: false,
    telemetry: { policy: 'value', toTelemetry: (raw) => raw === true }
  },
  oemManagedModelDirs: { nullable: false, telemetry: { policy: 'presence' } },
  oemWorkflowImportVersion: { nullable: false, telemetry: { policy: 'omit' } },
  lastSaveDialogDir: { nullable: true, telemetry: { policy: 'presence' } },
  skipTemplatePickerStep: {
    nullable: false,
    telemetry: { policy: 'value', toTelemetry: (raw) => raw === true }
  },
  dashboardWorkspaceId: { nullable: false, telemetry: { policy: 'omit' } },
  pendingDownloadedUpdateVersion: { nullable: true, telemetry: { policy: 'omit' } },
  lastStartupUpdateAttemptVersion: { nullable: true, telemetry: { policy: 'omit' } },
  startupInstallNotReadyVersion: { nullable: true, telemetry: { policy: 'omit' } },
  startupInstallNotReadyCount: { nullable: true, telemetry: { policy: 'omit' } },
  pendingDesktopUpdateAttemptId: { nullable: true, telemetry: { policy: 'omit' } },
  pendingDesktopUpdateAttemptVersion: { nullable: true, telemetry: { policy: 'omit' } },
  installUpdatesOnStartup: {
    nullable: false,
    telemetry: {
      policy: 'value',
      prop: 'install_updates_on_startup',
      toTelemetry: (raw, ctx) => (ctx.platform === 'win32' ? raw !== false : null)
    }
  },
  showInstallerUI: {
    nullable: false,
    telemetry: {
      policy: 'value',
      toTelemetry: (raw, ctx) => (ctx.platform === 'win32' ? raw !== false : null)
    }
  }
} as const satisfies { [K in keyof KnownSettings]: SettingSchemaEntry<K> }

export type KnownSettingKey = keyof typeof SETTINGS_SCHEMA
export type NullableKnownSettingKey = {
  [K in KnownSettingKey]-?: (typeof SETTINGS_SCHEMA)[K]['nullable'] extends true ? K : never
}[KnownSettingKey]

const KNOWN_SETTING_KEYS = Object.keys(SETTINGS_SCHEMA) as KnownSettingKey[]

function isKnownSettingKey(key: string): key is KnownSettingKey {
  return Object.prototype.hasOwnProperty.call(SETTINGS_SCHEMA, key)
}

function isNullableKnownSettingKey(key: KnownSettingKey): key is NullableKnownSettingKey {
  return SETTINGS_SCHEMA[key].nullable
}

export const defaults: SettingsDefaults = {
  cacheDir: defaultDownloadCacheDir(),
  maxCachedDownloads: 1,
  onAppClose: 'quit',
  modelsDirs: [path.join(SHARED_ROOT, 'models')],
  inputDir: path.join(SHARED_ROOT, 'input'),
  outputDir: path.join(SHARED_ROOT, 'output'),
  installDir: builtinDefaultInstallDir()
}

const systemDefault = defaults.modelsDirs[0]!
const shouldSanitizeCopiedUserDefaults = process.platform === 'win32'

function resolveIfNonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? path.resolve(value) : null
}

function isOnAccessibleVolume(value: unknown): boolean {
  const resolved = resolveIfNonEmpty(value)
  if (!resolved) return false
  const root = path.parse(resolved).root
  if (!root) return false
  try {
    return fs.existsSync(root)
  } catch {
    return false
  }
}

function getRelativeDefaultFromHome(currentDefault: string): string | null {
  const home = path.resolve(homeDir())
  const rel = path.relative(home, path.resolve(currentDefault))
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null
  return rel
}

function isForeignUserDefaultPath(value: unknown, currentDefault: string): boolean {
  const candidate = resolveIfNonEmpty(value)
  if (!candidate) return false

  const currentResolved = path.resolve(currentDefault)
  if (candidate === currentResolved) return false

  const home = path.resolve(homeDir())
  const relativeDefault = getRelativeDefaultFromHome(currentDefault)
  if (!relativeDefault) return false

  let candidateHome = candidate
  for (const _part of relativeDefault.split(path.sep).filter(Boolean)) {
    candidateHome = path.dirname(candidateHome)
  }

  if (candidateHome === home) return false
  if (path.dirname(candidateHome) !== path.dirname(home)) return false

  return path.resolve(path.join(candidateHome, relativeDefault)) === candidate
}

function sanitizeUserDefaultPath(value: unknown, currentDefault: string): string {
  const candidate = resolveIfNonEmpty(value)
  if (!candidate) return currentDefault
  return isForeignUserDefaultPath(candidate, currentDefault) ? currentDefault : candidate
}

function sanitizeModelsDirs(value: unknown, currentDefault: string): string[] {
  const dirs = Array.isArray(value) ? value : []
  const seen = new Set<string>()
  const result: string[] = []

  for (const dir of dirs) {
    const candidate = resolveIfNonEmpty(dir)
    if (!candidate) continue
    if (isForeignUserDefaultPath(candidate, currentDefault)) continue
    if (seen.has(candidate)) continue
    seen.add(candidate)
    result.push(candidate)
  }

  return result
}

let e2eSeedApplied = false
function maybeSeedFromEnv(): void {
  if (e2eSeedApplied) return
  e2eSeedApplied = true
  if (app.isPackaged) return
  if (process.env['E2E'] !== '1') return
  const seed = process.env['E2E_SETTINGS_SEED']
  if (!seed) return
  delete process.env['E2E_SETTINGS_SEED']
  try {
    JSON.parse(seed)
    fs.mkdirSync(path.dirname(dataPath), { recursive: true })
    writeFileSafe(dataPath, seed, { backup: true })
  } catch (err) {
    console.warn('Settings: failed to apply E2E_SETTINGS_SEED:', (err as Error).message)
  }
}

function load(): Settings {
  return loadOutcome().settings
}

function loadOutcome(preRead?: SafeReadOutcome): {
  settings: Settings
  unreadable: boolean
  defaultsOnly?: true
} {
  maybeSeedFromEnv()
  let parsed: Record<string, unknown> | null = null
  let unreadable = false
  const read = preRead ?? readFileSafe(dataPath)
  if (read.kind === 'unreadable') {
    return { settings: { ...defaults }, unreadable: true, defaultsOnly: true }
  }
  if (read.kind === 'data') {
    unreadable = read.primaryUnreadable === true
    try {
      const obj: unknown = JSON.parse(read.data)
      if (obj && typeof obj === 'object' && !Array.isArray(obj))
        parsed = obj as Record<string, unknown>
    } catch (err) {
      console.warn('Settings: failed to parse settings JSON:', (err as Error).message)
    }
  }
  if (parsed) {
    for (const key of KNOWN_SETTING_KEYS) {
      if (parsed[key] === null && !isNullableKnownSettingKey(key)) {
        delete parsed[key]
      }
    }
  }
  const result: Settings = { ...defaults, ...(parsed || {}) }
  let changed = false

  for (const key of [
    'primaryInstallId',
    'pinnedInstallIds',
    'maxCachedFiles',
    'closeDirectlyOnLastWindow'
  ]) {
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      delete result[key]
      changed = true
    }
  }

  if (result.onAppClose === 'tray') {
    delete (result as Record<string, unknown>).onAppClose
    changed = true
  }

  if (shouldSanitizeCopiedUserDefaults) {
    const nextCacheDir = sanitizeUserDefaultPath(result.cacheDir, defaults.cacheDir)
    if (nextCacheDir !== result.cacheDir) {
      result.cacheDir = nextCacheDir
      changed = true
    }

    const nextModelsDirs = sanitizeModelsDirs(result.modelsDirs, systemDefault)
    if (
      !Array.isArray(result.modelsDirs) ||
      nextModelsDirs.length !== result.modelsDirs.length ||
      nextModelsDirs.some((dir, index) => dir !== result.modelsDirs[index])
    ) {
      result.modelsDirs = nextModelsDirs
      changed = true
    }

    const nextInputDir = sanitizeUserDefaultPath(result.inputDir, defaults.inputDir)
    if (nextInputDir !== result.inputDir) {
      result.inputDir = nextInputDir
      changed = true
    }

    const nextOutputDir = sanitizeUserDefaultPath(result.outputDir, defaults.outputDir)
    if (nextOutputDir !== result.outputDir) {
      result.outputDir = nextOutputDir
      changed = true
    }

    const nextInstallDir = sanitizeUserDefaultPath(result.installDir, defaults.installDir)
    if (nextInstallDir !== result.installDir) {
      result.installDir = nextInstallDir
      changed = true
    }
  }

  if (Array.isArray(result.modelsDirs)) {
    const before = result.modelsDirs.length
    result.modelsDirs = result.modelsDirs.filter(
      (d): d is string => typeof d === 'string' && d.trim() !== ''
    )
    if (result.modelsDirs.length !== before) changed = true
  }
  if (!Array.isArray(result.modelsDirs) || result.modelsDirs.length === 0) {
    result.modelsDirs = [systemDefault]
    changed = true
  }

  const anyModelsDirExists = result.modelsDirs.some(
    (d): d is string => typeof d === 'string' && fs.existsSync(path.resolve(d))
  )
  if (!anyModelsDirExists) {
    const others = result.modelsDirs.filter((d) => path.resolve(d) !== path.resolve(systemDefault))
    const restored = [systemDefault, ...others]
    if (
      restored.length !== result.modelsDirs.length ||
      restored.some((d, i) => d !== result.modelsDirs[i])
    ) {
      result.modelsDirs = restored
      changed = true
    }
  }

  const usesSystemDefault = result.modelsDirs.some(
    (d): d is string => typeof d === 'string' && path.resolve(d) === path.resolve(systemDefault)
  )
  if (usesSystemDefault) {
    try {
      fs.mkdirSync(systemDefault, { recursive: true })
      for (const folder of MODEL_FOLDER_TYPES) {
        fs.mkdirSync(path.join(systemDefault, folder), { recursive: true })
      }
    } catch {}
  }

  for (const key of ['inputDir', 'outputDir'] as const) {
    const designated = result[key] as string | undefined
    const exists =
      typeof designated === 'string' &&
      designated.trim() !== '' &&
      fs.existsSync(path.resolve(designated))
    if (exists) continue
    if (result[key] !== defaults[key]) {
      result[key] = defaults[key]
      changed = true
    }
    try {
      fs.mkdirSync(defaults[key], { recursive: true })
    } catch {}
  }

  for (const key of ['installDir', 'cacheDir'] as const) {
    if (isOnAccessibleVolume(result[key])) continue
    if (result[key] !== defaults[key]) {
      result[key] = defaults[key]
      changed = true
    }
  }
  if (changed && !unreadable && !preRead) save(result)
  return { settings: result, unreadable }
}

function save(settings: Settings): void {
  writeFileSafe(dataPath, JSON.stringify(settings, null, 2), { backup: true })
}

export const AUTO_LAUNCH_NONE = 'none'
export const AUTO_LAUNCH_LAST = 'last'

export function get<K extends KnownSettingKey>(key: K): KnownSettings[K]
export function get(key: string): unknown
export function get(key: string): unknown {
  const { settings: loaded, defaultsOnly } = loadOutcome()
  if (key === 'firstUseCompleted' && defaultsOnly) return true
  const value = loaded[key]
  if (key === 'autoLaunchOnStartup' && (value === undefined || value === null)) {
    return AUTO_LAUNCH_NONE
  }
  return value
}

const EMPTY_STRING_MEANS_UNSET: ReadonlySet<string> = new Set<KnownSettingKey>(['pypiMirror'])

const DEFAULT_VALUE_MEANS_UNSET: ReadonlyMap<string, unknown> = new Map<KnownSettingKey, unknown>([
  ['autoLaunchOnStartup', AUTO_LAUNCH_NONE]
])

export function set<K extends string>(
  key: K,
  value: K extends KnownSettingKey ? KnownSettings[K] | undefined : unknown
): void {
  const { settings, unreadable } = loadOutcome()
  if (unreadable) {
    console.warn(`Settings: not persisting '${key}' - settings.json is currently unreadable`)
    return
  }
  if (
    value === undefined ||
    (value === null && isKnownSettingKey(key) && !isNullableKnownSettingKey(key)) ||
    (typeof value === 'string' && value.trim() === '' && EMPTY_STRING_MEANS_UNSET.has(key)) ||
    (DEFAULT_VALUE_MEANS_UNSET.has(key) && value === DEFAULT_VALUE_MEANS_UNSET.get(key))
  ) {
    delete settings[key]
    save(settings)
    return
  }
  settings[key] = value
  save(settings)
}

export function getAll(): Settings {
  return load()
}

const SETTLED_RETRY_DELAYS_MS = [500, 1000, 1500, 2000]

export async function readSettled(signal?: AbortSignal): Promise<Settings | null> {
  for (const delayMs of [0, ...SETTLED_RETRY_DELAYS_MS]) {
    if (delayMs > 0 && !signal?.aborted) {
      await new Promise<void>((resolve) => {
        const done = (): void => {
          clearTimeout(timer)
          signal?.removeEventListener('abort', done)
          resolve()
        }
        const timer = setTimeout(done, delayMs)
        signal?.addEventListener('abort', done, { once: true })
      })
    }
    if (signal?.aborted) return null
    maybeSeedFromEnv()
    const outcome = loadOutcome(await readFileSafeAsync(dataPath, { restore: false }))
    if (!outcome.defaultsOnly) return outcome.settings
  }
  return null
}

export function resolveBetaFeaturesEnabled(): boolean {
  const { settings, unreadable } = loadOutcome()
  const enabled = betaFeaturesEnabledIn(settings, unreadable)
  if (typeof settings.betaFeaturesEnabled === 'boolean' || unreadable) return enabled
  settings.betaFeaturesEnabled = enabled
  save(settings)
  return enabled
}

export function peekBetaFeaturesEnabled(): boolean {
  maybeSeedFromEnv()
  const read = readFileSafe(dataPath, { restore: false })
  if (read.kind === 'unreadable') return false
  let stored: Partial<Settings> = {}
  if (read.kind === 'data') {
    try {
      const obj: unknown = JSON.parse(read.data)
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) stored = obj as Partial<Settings>
    } catch {}
  }
  return betaFeaturesEnabledIn(stored, read.kind === 'data' && read.primaryUnreadable === true)
}

function betaFeaturesEnabledIn(settings: Partial<Settings>, unreadable: boolean): boolean {
  const stored = settings.betaFeaturesEnabled
  if (typeof stored === 'boolean') return stored
  return unreadable ? false : settings.telemetryEnabled === true
}

function camelToSnake(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
}

function toScalarOrNull(v: unknown): SettingTelemetryValue {
  return typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string' ? v : null
}

export function getTrackedSettingsTelemetryProperties(
  keys: readonly string[] = KNOWN_SETTING_KEYS
): Record<string, SettingTelemetryValue> {
  const ctx: SettingTelemetryCtx = { platform: process.platform }
  const out: Record<string, SettingTelemetryValue> = {}
  const emitValue = (
    raw: unknown,
    transform?: SettingTelemetryTransform<KnownSettingKey>
  ): SettingTelemetryValue => (transform ? transform(raw as never, ctx) : toScalarOrNull(raw))
  for (const key of keys) {
    if (!isKnownSettingKey(key)) continue
    const tel = (SETTINGS_SCHEMA[key] as SettingSchemaEntry<KnownSettingKey>).telemetry
    if (tel.policy === 'omit') continue
    if (tel.policy === 'presence') {
      out[tel.prop ?? `setting_${camelToSnake(key)}`] = has(key)
      continue
    }
    if (tel.policy === 'multi') {
      for (const em of tel.emitters) {
        out[em.prop] = em.kind === 'presence' ? has(key) : emitValue(get(key), em.toTelemetry)
      }
      continue
    }
    out[tel.prop ?? `setting_${camelToSnake(key)}`] = emitValue(get(key), tel.toTelemetry)
  }
  return out
}

export function has(key: string): boolean {
  const read = readFileSafe(dataPath)
  if (read.kind !== 'data') return false
  try {
    const parsed: unknown = JSON.parse(read.data)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
    const value = (parsed as Record<string, unknown>)[key]
    if (value === undefined || value === null) return false
    if (DEFAULT_VALUE_MEANS_UNSET.has(key) && value === DEFAULT_VALUE_MEANS_UNSET.get(key)) {
      return false
    }
    if (typeof value === 'string' && value.trim() === '' && EMPTY_STRING_MEANS_UNSET.has(key)) {
      return false
    }
    if (key in defaults) {
      const def = (defaults as Record<string, unknown>)[key]
      if (typeof def === 'string' && typeof value === 'string') {
        if (path.resolve(def) === path.resolve(value)) return false
      } else if (Array.isArray(def) && Array.isArray(value)) {
        if (
          def.length === value.length &&
          def.every((d, i) =>
            typeof d === 'string' && typeof value[i] === 'string'
              ? path.resolve(d as string) === path.resolve(value[i] as string)
              : d === value[i]
          )
        ) {
          return false
        }
      } else if (def === value) {
        return false
      }
    }
    return true
  } catch {
    return false
  }
}

export function getMirrorConfig(): { pypiMirror?: string; useChineseMirrors?: boolean } {
  return { pypiMirror: get('pypiMirror'), useChineseMirrors: get('useChineseMirrors') === true }
}

setInstallDirResolver(() => get('installDir'))
