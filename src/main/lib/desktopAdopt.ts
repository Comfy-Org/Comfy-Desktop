import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFile } from 'child_process'

import {
  detectDesktopInstall,
  captureDesktopSnapshot,
  ADOPT_MARKER_FILE,
  type DesktopInstallInfo
} from './desktopDetect'
import { defaultInstallDir, allocateUniqueDir, sanitizeDirName } from './paths'
import {
  gitClone,
  readGitHead,
  fetchTags,
  isGitAvailable,
  isPygit2Configured,
  tryConfigurePygit2Fallback
} from './git'
import { resolveLocalVersion } from './version-resolve'
import type { ComfyVersion } from './version'
import { getComfyUIRemoteUrl } from './github-mirror'
import { installFilteredRequirements, runUvPip, getPipIndexArgs } from './pip'
import * as installations from '../installations'
import type { InstallationRecord } from '../installations'
import * as settings from '../settings'
import * as telemetry from './telemetry'
import { DEFAULT_INSTALL_NAME } from '../../shared/defaultInstallName'
import * as i18n from './i18n'
import {
  KNOWN_MODEL_FOLDERS,
  parseExtraModelsSections,
  parseExtraModelsYaml,
  type ExtraModelsSection
} from './models'

export { parseExtraModelsSections, parseExtraModelsYaml }
export type { ExtraModelsSection }

const MARKER_FILE = ADOPT_MARKER_FILE
const STAGED_SOURCE_REL = path.join('legacy-staging', 'comfyui')
const BACKUP_REL = 'legacy-backup'
const SNAPSHOTS_REL = '.snapshots'
const ADOPT_INSTALL_NAME = DEFAULT_INSTALL_NAME
const COMFY_SETTINGS_FILE = 'comfy.settings.json'
const DESKTOP_CONFIG_FILE = 'config.json'
const EXTRA_MODELS_YAML = 'extra_models_config.yaml'
const WINDOW_FILE = 'window.json'
const VENV_VALIDATE_TIMEOUT_MS = 30_000
const ADOPTED_SETTINGS_VERSION = 1

function legacyComfySettingsPath(basePath: string): string {
  return path.join(basePath, 'user', 'default', COMFY_SETTINGS_FILE)
}

interface LegacyComfySettingsRead {
  settings: Record<string, unknown>
  status: 'ok' | 'missing' | 'error'
}

export type AdoptPromptKind = 'tcc' | 'venv-broken' | 'source-missing' | 'confirm-adopt'

export type UserChoice =
  | { kind: 'tcc'; choice: 'continue' | 'denied' }
  | { kind: 'venv-broken'; choice: 'use-anyway' | 'cancel' }
  | { kind: 'source-missing'; choice: 'retry' | 'cancel' }
  | { kind: 'confirm-adopt'; choice: 'yes' | 'no' }

export interface AdoptTools {
  sendProgress: (phase: string, detail: Record<string, unknown>) => void
  sendOutput: (text: string) => void
  signal: AbortSignal
  promptUser: (kind: AdoptPromptKind, ctx?: unknown) => Promise<UserChoice>
}

export interface AdoptDeps {
  detectDesktopInstall: typeof detectDesktopInstall
  captureDesktopSnapshot: typeof captureDesktopSnapshot
  validateLegacyVenv: (
    pythonPath: string,
    signal: AbortSignal
  ) => Promise<{ ok: true } | { ok: false; message: string }>
  copyStagedSource: (src: string, dest: string) => Promise<void>
  cloneSourceFromGit: (
    url: string,
    dest: string,
    sendOutput: (t: string) => void,
    signal: AbortSignal
  ) => Promise<{ ok: true } | { ok: false; message: string }>
  now: () => Date
}

export interface AdoptOptions {
  tools: AdoptTools
  deps?: Partial<AdoptDeps>
}

export type AdoptSourceMode = 'pre-swap-copy' | 'git-clone-fallback'

interface LegacyComfySettings {
  sendStatistics?: boolean
  autoUpdate?: boolean
  pypiMirror?: string
}

const CHINESE_MIRROR_HINTS = ['aliyun', 'tencent', 'tsinghua', 'mirrors.cernet.edu.cn']

function looksLikeChineseMirror(url: string | undefined): boolean {
  if (!url) return false
  const lower = url.toLowerCase()
  return CHINESE_MIRROR_HINTS.some((hint) => lower.includes(hint))
}

export function validateLegacyVenvDefault(
  pythonPath: string,
  signal: AbortSignal
): Promise<{ ok: true } | { ok: false; message: string }> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve({ ok: false, message: 'aborted' })
      return
    }
    const child = execFile(
      pythonPath,
      ['-c', 'import sys, torch; sys.stdout.write("ok")'],
      { windowsHide: true, timeout: VENV_VALIDATE_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (signal.aborted) {
          resolve({ ok: false, message: 'aborted' })
          return
        }
        if (err) {
          const out =
            (stderr || '').toString().trim() || (stdout || '').toString().trim() || err.message
          resolve({ ok: false, message: out.slice(0, 1000) })
          return
        }
        if (stdout.toString().trim() !== 'ok') {
          resolve({ ok: false, message: `unexpected stdout: ${stdout.toString().slice(0, 200)}` })
          return
        }
        resolve({ ok: true })
      }
    )
    const onAbort = (): void => {
      try {
        child.kill()
      } catch {}
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export async function copyStagedSourceDefault(src: string, dest: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(dest), { recursive: true })
  await fs.promises.cp(src, dest, { recursive: true })
}

export async function cloneSourceFromGitDefault(
  url: string,
  dest: string,
  sendOutput: (t: string) => void,
  signal: AbortSignal
): Promise<{ ok: true } | { ok: false; message: string }> {
  const cloneResult = await gitClone(url, dest, sendOutput, signal)
  if (cloneResult.exitCode !== 0) {
    return { ok: false, message: cloneResult.stderr.slice(0, 1000) || 'clone failed' }
  }
  return { ok: true }
}

const STRIPPED_LAUNCH_KEYS: ReadonlySet<string> = new Set([
  'extra-model-paths-config',
  'front-end-root',
  'log-stdout',
  'database-url'
])

const PROMOTED_LAUNCH_KEYS: ReadonlySet<string> = new Set(['input-directory', 'output-directory'])

export interface DerivedLaunchArgs {
  launchArgs: string
  pathOverrides: {
    inputDir?: string
    outputDir?: string
  }
}

function normalizeLaunchValue(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'boolean') return value ? '' : null
  return String(value)
}

export function deriveLaunchArgs(
  comfySettings: Record<string, unknown>,
  selectedDevice?: string | null
): DerivedLaunchArgs {
  const asMap = (raw: unknown): Record<string, unknown> =>
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}

  const serverConfigValues = asMap(comfySettings['Comfy.Server.ServerConfigValues'])
  const launchArgsMap = asMap(comfySettings['Comfy.Server.LaunchArgs'])

  const mergedMap: Record<string, unknown> = { ...serverConfigValues, ...launchArgsMap }
  if (selectedDevice === 'cpu' && !('cpu' in mergedMap)) mergedMap.cpu = true

  const parts: string[] = []
  const pathOverrides: DerivedLaunchArgs['pathOverrides'] = {}
  let hasPort = false

  for (const [key, value] of Object.entries(mergedMap)) {
    if (!key) continue
    if (STRIPPED_LAUNCH_KEYS.has(key)) continue
    const strVal = normalizeLaunchValue(value)
    if (strVal === null) continue
    if (PROMOTED_LAUNCH_KEYS.has(key)) {
      if (strVal === '') continue
      if (key === 'input-directory') pathOverrides.inputDir = strVal
      else if (key === 'output-directory') pathOverrides.outputDir = strVal
      continue
    }
    if (key === 'port') hasPort = true
    if (strVal === '') {
      parts.push(`--${key}`)
    } else {
      parts.push(`--${key}`, strVal)
    }
  }

  if (!hasPort) parts.unshift('--port', '8000')
  const usesLegacyManager = parts.includes('--enable-manager-legacy-ui')
  if (!usesLegacyManager && !parts.includes('--enable-manager')) parts.push('--enable-manager')

  return { launchArgs: parts.join(' '), pathOverrides }
}

function readLegacyComfySettings(basePath: string): LegacyComfySettingsRead {
  try {
    const raw = fs.readFileSync(legacyComfySettingsPath(basePath), 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { settings: parsed as Record<string, unknown>, status: 'ok' }
    }
    return { settings: {}, status: 'error' }
  } catch (err) {
    const status = (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'error'
    return { settings: {}, status }
  }
}

function readLegacyComfyPrefs(raw: Record<string, unknown>): LegacyComfySettings {
  const asBool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined)
  const asNonEmptyString = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() !== '' ? v : undefined
  return {
    sendStatistics: asBool(raw['Comfy-Desktop.SendStatistics']),
    autoUpdate: asBool(raw['Comfy-Desktop.AutoUpdate']),
    pypiMirror: asNonEmptyString(raw['Comfy-Desktop.UV.PypiInstallMirror'])
  }
}

function readLegacyDesktopConfig(configDir: string): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(path.join(configDir, DESKTOP_CONFIG_FILE), 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {}
  return {}
}

function readLegacyAppVersion(executablePath: string | null): string | null {
  if (!executablePath) return null
  const candidates: string[] = []
  if (process.platform === 'win32') {
    candidates.push(path.join(path.dirname(executablePath), 'resources', 'app', 'package.json'))
  } else if (process.platform === 'darwin') {
    candidates.push(path.join(executablePath, 'Contents', 'Resources', 'app', 'package.json'))
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf-8')) as Record<string, unknown>
      if (typeof parsed.version === 'string' && parsed.version) return parsed.version
    } catch {}
  }
  return null
}

function isDir(dir: string): boolean {
  return fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory() === true
}

function isDangerousRoot(resolved: string): boolean {
  if (resolved === path.parse(resolved).root) return true
  try {
    if (path.resolve(os.homedir()) === resolved) return true
  } catch {}
  return false
}

export function computeModelsDirsToCarry(
  basePath: string,
  extraYamlContent: string | null,
  existing: string[]
): string[] {
  const seen = new Set(existing.map((d) => path.resolve(d)))
  const out: string[] = []

  const carry = (dir: string): boolean => {
    const resolved = path.resolve(dir)
    if (seen.has(resolved)) return true
    if (isDangerousRoot(resolved)) {
      console.warn(`[adopt] skipping unsafe legacy models root: ${resolved}`)
      return false
    }
    if (!isDir(resolved)) return false
    seen.add(resolved)
    out.push(resolved)
    return true
  }

  const primary = path.resolve(path.join(basePath, 'models'))
  if (!seen.has(primary)) {
    seen.add(primary)
    out.push(primary)
  }

  if (!extraYamlContent) return out

  for (const section of parseExtraModelsSections(extraYamlContent)) {
    const sectionBase = section.basePath
      ? path.resolve(basePath, section.basePath)
      : path.resolve(basePath)

    const carriedRoots: string[] = []

    if (section.basePath) {
      if (carry(path.join(sectionBase, 'models'))) {
        carriedRoots.push(path.resolve(path.join(sectionBase, 'models')))
      } else if (carry(sectionBase)) {
        carriedRoots.push(path.resolve(sectionBase))
      }
    }

    for (const { type, path: overridePath } of section.overrides) {
      const resolvedOverride = path.isAbsolute(overridePath)
        ? path.resolve(overridePath)
        : path.resolve(sectionBase, overridePath)
      if (carriedRoots.some((root) => isUnderRoot(resolvedOverride, root))) continue
      if (seen.has(resolvedOverride)) continue
      if (!isDir(resolvedOverride)) continue
      const root =
        KNOWN_MODEL_FOLDERS.has(type) && path.basename(resolvedOverride) === type
          ? path.dirname(resolvedOverride)
          : resolvedOverride
      if (carry(root)) carriedRoots.push(path.resolve(root))
    }
  }

  return out
}

function isUnderRoot(child: string, root: string): boolean {
  const rel = path.relative(root, child)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

async function backupLegacyState(
  configDir: string,
  basePath: string,
  timestamp: string,
  sendOutput: (t: string) => void
): Promise<void> {
  const destDir = path.join(configDir, BACKUP_REL, timestamp)
  try {
    await fs.promises.mkdir(destDir, { recursive: true })
  } catch (err) {
    sendOutput(`Warning: could not create backup dir: ${(err as Error).message}\n`)
    return
  }
  const files = [
    { file: DESKTOP_CONFIG_FILE, src: path.join(configDir, DESKTOP_CONFIG_FILE) },
    { file: COMFY_SETTINGS_FILE, src: legacyComfySettingsPath(basePath) },
    { file: EXTRA_MODELS_YAML, src: path.join(configDir, EXTRA_MODELS_YAML) },
    { file: WINDOW_FILE, src: path.join(configDir, WINDOW_FILE) }
  ]
  for (const { file, src } of files) {
    const dst = path.join(destDir, file)
    try {
      if (fs.existsSync(src)) await fs.promises.copyFile(src, dst)
    } catch (err) {
      sendOutput(`Warning: backup of ${file} failed: ${(err as Error).message}\n`)
    }
  }
}

function readComfyVersion(sourceDir: string): string | null {
  try {
    const content = fs.readFileSync(path.join(sourceDir, 'comfyui_version.py'), 'utf-8')
    const m = content.match(/__version__\s*=\s*['"]([^'"]+)['"]/)
    return m ? m[1]!.trim() : null
  } catch {
    return null
  }
}

function isStagedSourceValid(stagingDir: string): boolean {
  return fs.existsSync(path.join(stagingDir, 'main.py'))
}

export function getLegacyVenvUvPath(basePath: string): string {
  return process.platform === 'win32'
    ? path.join(basePath, '.venv', 'Scripts', 'uv.exe')
    : path.join(basePath, '.venv', 'bin', 'uv')
}

interface RequirementsInstallReport {
  uvAvailable: boolean
  coreExitCode: number | null
  managerExitCode: number | null
  pygit2ExitCode: number | null
}

async function installAdoptedRequirements(
  destSource: string,
  installPath: string,
  pythonPath: string,
  basePath: string,
  tools: AdoptTools
): Promise<RequirementsInstallReport> {
  const uvPath = getLegacyVenvUvPath(basePath)
  if (!fs.existsSync(uvPath)) {
    tools.sendOutput(
      `Warning: legacy venv uv not found at ${uvPath} — skipping ComfyUI requirements install. ` +
        `You may need to manually run \`pip install -r requirements.txt\` later if launches fail.\n`
    )
    return { uvAvailable: false, coreExitCode: null, managerExitCode: null, pygit2ExitCode: null }
  }

  const mirrors = settings.getMirrorConfig()
  const report: RequirementsInstallReport = {
    uvAvailable: true,
    coreExitCode: null,
    managerExitCode: null,
    pygit2ExitCode: null
  }

  const coreReqs = path.join(destSource, 'requirements.txt')
  if (fs.existsSync(coreReqs)) {
    tools.sendOutput('Installing ComfyUI requirements into legacy venv via uv…\n')
    const code = await installFilteredRequirements(
      coreReqs,
      uvPath,
      pythonPath,
      installPath,
      '.adopt-core-reqs.txt',
      tools.sendOutput,
      tools.signal,
      mirrors
    )
    report.coreExitCode = code
    if (code !== 0) {
      tools.sendOutput(`Warning: ComfyUI requirements install exited with code ${code}.\n`)
    }
  } else {
    tools.sendOutput(`Warning: ${coreReqs} missing — ComfyUI source may be incomplete.\n`)
  }

  const mgrReqs = path.join(destSource, 'manager_requirements.txt')
  if (fs.existsSync(mgrReqs)) {
    tools.sendOutput('Installing ComfyUI-Manager requirements…\n')
    const code = await installFilteredRequirements(
      mgrReqs,
      uvPath,
      pythonPath,
      installPath,
      '.adopt-mgr-reqs.txt',
      tools.sendOutput,
      tools.signal,
      mirrors
    )
    report.managerExitCode = code
    if (code !== 0) {
      tools.sendOutput(`Warning: manager requirements install exited with code ${code}.\n`)
    }
  }

  tools.sendOutput('Installing pygit2 into legacy venv (enables Manager + in-place updates)…\n')
  const pygit2Code = await runUvPip(
    uvPath,
    [
      'pip',
      'install',
      'pygit2',
      '--python',
      pythonPath,
      ...getPipIndexArgs(mirrors.pypiMirror, mirrors.useChineseMirrors)
    ],
    installPath,
    tools.sendOutput,
    tools.signal
  )
  report.pygit2ExitCode = pygit2Code
  if (pygit2Code !== 0) {
    tools.sendOutput(
      `Warning: pygit2 install exited with code ${pygit2Code}. Manager will fall back ` +
        `to GitPython (requires system git) and in-place ComfyUI updates will be unavailable ` +
        `until pygit2 is installed manually or via "Copy & Update".\n`
    )
  }

  return report
}

async function findExistingAdoption(basePath: string): Promise<InstallationRecord | null> {
  const markerPath = path.join(basePath, MARKER_FILE)
  if (!fs.existsSync(markerPath)) return null
  let markerId: string
  try {
    markerId = fs.readFileSync(markerPath, 'utf-8').trim()
  } catch {
    return null
  }
  if (!markerId) return null
  const list = await installations.list()
  return list.find((i) => i.id === markerId) ?? null
}

async function sourceComfyUI(
  info: DesktopInstallInfo,
  destDir: string,
  tools: AdoptTools,
  deps: AdoptDeps
): Promise<{ mode: AdoptSourceMode } | { mode: 'failed'; message: string }> {
  const stagedDir = path.join(info.configDir, STAGED_SOURCE_REL)
  if (fs.existsSync(stagedDir) && isStagedSourceValid(stagedDir)) {
    try {
      await deps.copyStagedSource(stagedDir, destDir)
      tools.sendOutput(`Sourced ComfyUI from pre-swap copy at ${stagedDir}\n`)
      return { mode: 'pre-swap-copy' }
    } catch (err) {
      tools.sendOutput(
        `Pre-swap copy failed: ${(err as Error).message}; falling back to git clone\n`
      )
    }
  }
  const url = getComfyUIRemoteUrl(settings.get('useChineseMirrors') === true)
  tools.sendOutput(
    `Pre-swap copy not available; downloading ComfyUI source from ${url} …\n` +
      `This is a one-time download and can take a few minutes on a slow connection.\n`
  )
  const cloneResult = await deps.cloneSourceFromGit(url, destDir, tools.sendOutput, tools.signal)
  if (!cloneResult.ok) {
    return { mode: 'failed', message: cloneResult.message }
  }
  tools.sendOutput(`ComfyUI source download complete.\n`)
  return { mode: 'git-clone-fallback' }
}

interface CarryReport {
  addedModelsDirs: string[]
  carriedKeys: string[]
  carrySkippedKeys: string[]
}

function carryLegacySettings(
  basePath: string,
  configDir: string | null,
  legacy: LegacyComfySettings,
  sendOutput: (t: string) => void
): CarryReport {
  let extraYamlContent: string | null = null
  if (configDir) {
    try {
      extraYamlContent = fs.readFileSync(path.join(configDir, EXTRA_MODELS_YAML), 'utf-8')
    } catch {}
  }

  const currentModelsDirs = (settings.get('modelsDirs') as string[] | undefined) ?? [
    ...settings.defaults.modelsDirs
  ]
  const additions = computeModelsDirsToCarry(basePath, extraYamlContent, currentModelsDirs)
  if (additions.length > 0) {
    settings.set('modelsDirs', [...currentModelsDirs, ...additions])
    sendOutput(`Registered ${additions.length} legacy model dir(s) for cross-install visibility.\n`)
  }

  const carriedKeys: string[] = []
  const carrySkippedKeys: string[] = []

  function tryCarry<T>(key: string, value: T | undefined): void {
    if (value === undefined) return
    if (settings.has(key)) {
      carrySkippedKeys.push(key)
      return
    }
    settings.set(key, value)
    carriedKeys.push(key)
  }

  tryCarry('telemetryEnabled', legacy.sendStatistics)
  tryCarry('pypiMirror', legacy.pypiMirror)

  if (!settings.has('autoInstallUpdates')) {
    settings.set('autoInstallUpdates', true)
    carriedKeys.push('autoInstallUpdates')
  }

  if (looksLikeChineseMirror(legacy.pypiMirror)) {
    tryCarry('useChineseMirrors', true)
    tryCarry('chineseMirrorsPrompted', true)
  }

  if (!settings.has('firstUseCompleted')) {
    settings.set('firstUseCompleted', true)
    carriedKeys.push('firstUseCompleted')
  }

  tryCarry('inputDir', path.join(basePath, 'input'))
  tryCarry('outputDir', path.join(basePath, 'output'))

  const changedKeys = additions.length > 0 ? [...carriedKeys, 'modelsDirs'] : carriedKeys
  const trackedProps = settings.getTrackedSettingsTelemetryProperties(changedKeys)
  if (Object.keys(trackedProps).length > 0) {
    telemetry.registerPersonProperties(trackedProps)
  }

  return { addedModelsDirs: additions, carriedKeys, carrySkippedKeys }
}

export async function reconcileAdoptedSettings(): Promise<number> {
  const all = await installations.list()
  let repaired = 0
  const generatedDefaultArgs = deriveLaunchArgs({}).launchArgs

  for (const existing of all) {
    if (existing.adopted !== true || existing.sourceId !== 'standalone') continue
    if (existing.adoptedSettingsVersion === ADOPTED_SETTINGS_VERSION) continue

    try {
      const basePath = existing.adoptedBaseDir as string | undefined
      if (!basePath) continue
      const selectedDevice = existing.adoptedSelectedDevice as string | undefined
      const settingsRead = readLegacyComfySettings(basePath)
      if (settingsRead.status === 'error') continue
      const rawComfySettings = settingsRead.settings
      const derived = deriveLaunchArgs(rawComfySettings, selectedDevice)

      carryLegacySettings(basePath, null, readLegacyComfyPrefs(rawComfySettings), () => {})

      const patch: Record<string, unknown> = {
        adoptedSettingsVersion: ADOPTED_SETTINGS_VERSION
      }
      if (existing.launchArgs === generatedDefaultArgs) {
        patch.launchArgs = derived.launchArgs
      }
      if (derived.pathOverrides.inputDir && existing.inputDir === path.join(basePath, 'input')) {
        patch.inputDir = derived.pathOverrides.inputDir
      }
      if (derived.pathOverrides.outputDir && existing.outputDir === path.join(basePath, 'output')) {
        patch.outputDir = derived.pathOverrides.outputDir
      }

      if (await installations.update(existing.id, patch)) repaired += 1
    } catch (err) {
      console.warn(`Failed to reconcile adopted settings for ${existing.id}:`, err)
    }
  }

  return repaired
}

async function reconcileAdoptedRequirements(
  existing: InstallationRecord,
  info: DesktopInstallInfo,
  tools: AdoptTools
): Promise<void> {
  const destSource = path.join(existing.installPath, 'ComfyUI')
  const pythonPath =
    (existing.adoptedPythonPath as string | undefined) ??
    (process.platform === 'win32'
      ? path.join(info.basePath, '.venv', 'Scripts', 'python.exe')
      : path.join(info.basePath, '.venv', 'bin', 'python3'))
  const basePath = (existing.adoptedBaseDir as string | undefined) ?? info.basePath
  try {
    await telemetry.trackedStep(
      'comfy.desktop.adopt.requirements_reconcile',
      { installation_id: existing.id },
      async () => {
        await installAdoptedRequirements(
          destSource,
          existing.installPath,
          pythonPath,
          basePath,
          tools
        )
      },
      { emitError: true }
    )
  } catch (err) {
    tools.sendOutput(`Warning: requirements reconcile threw: ${(err as Error).message}\n`)
  }
}

export async function adoptDesktopInstall(opts: AdoptOptions): Promise<InstallationRecord> {
  const { tools } = opts
  const deps: AdoptDeps = {
    detectDesktopInstall: opts.deps?.detectDesktopInstall ?? detectDesktopInstall,
    captureDesktopSnapshot: opts.deps?.captureDesktopSnapshot ?? captureDesktopSnapshot,
    validateLegacyVenv: opts.deps?.validateLegacyVenv ?? validateLegacyVenvDefault,
    copyStagedSource: opts.deps?.copyStagedSource ?? copyStagedSourceDefault,
    cloneSourceFromGit: opts.deps?.cloneSourceFromGit ?? cloneSourceFromGitDefault,
    now: opts.deps?.now ?? (() => new Date())
  }

  const info = await telemetry.trackedStep('comfy.desktop.adopt.detect', {}, async () => {
    const detected = deps.detectDesktopInstall()
    if (!detected) throw new Error('no-legacy-install')
    return detected
  })

  const existing = await telemetry.trackedStep('comfy.desktop.adopt.find_existing', {}, async () =>
    findExistingAdoption(info.basePath)
  )
  if (existing) {
    tools.sendOutput(`Already adopted as installation ${existing.id}; reconciling requirements…\n`)
    if (existing.installPath) {
      try {
        const installMarker = path.join(existing.installPath, MARKER_FILE)
        if (!fs.existsSync(installMarker)) {
          await fs.promises.writeFile(installMarker, existing.id)
        }
      } catch {}
    }
    await reconcileAdoptedRequirements(existing, info, tools)
    return existing
  }

  telemetry.capture('comfy.desktop.adopt.started', {})

  return runAdoption(info, tools, deps)
}

async function runAdoption(
  info: DesktopInstallInfo,
  tools: AdoptTools,
  deps: AdoptDeps
): Promise<InstallationRecord> {
  const { sendProgress, sendOutput, signal } = tools
  const timestamp = deps.now().toISOString().replace(/[:.]/g, '-')

  sendProgress('steps', {
    steps: [
      { phase: 'backup', label: i18n.t('desktop.adoptStepBackup') },
      ...(process.platform === 'darwin'
        ? [{ phase: 'tcc', label: i18n.t('desktop.adoptStepTcc') }]
        : []),
      { phase: 'venv', label: i18n.t('desktop.adoptStepVenv') },
      { phase: 'snapshot', label: i18n.t('desktop.adoptStepSnapshot') },
      { phase: 'allocate', label: i18n.t('desktop.adoptStepAllocate') },
      { phase: 'source', label: i18n.t('desktop.adoptStepSource') },
      { phase: 'requirements', label: i18n.t('desktop.adoptStepRequirements') },
      { phase: 'settings', label: i18n.t('desktop.adoptStepSettings') },
      { phase: 'register', label: i18n.t('desktop.adoptStepRegister') }
    ]
  })

  sendProgress('backup', { percent: 0 })
  await telemetry.trackedStep('comfy.desktop.adopt.backup', {}, async () => {
    await backupLegacyState(info.configDir, info.basePath, timestamp, sendOutput)
  })

  if (process.platform === 'darwin') {
    sendProgress('tcc', { percent: 0 })
    await telemetry.trackedStep('comfy.desktop.adopt.tcc', {}, async () => {
      try {
        await fs.promises.readdir(info.basePath)
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if (code === 'EACCES' || code === 'EPERM') {
          await tools.promptUser('tcc', { path: info.basePath })
          throw new Error('tcc-denied', { cause: err })
        }
        throw err
      }
    })
  }

  sendProgress('venv', { percent: 0 })
  const pythonPath =
    process.platform === 'win32'
      ? path.join(info.basePath, '.venv', 'Scripts', 'python.exe')
      : path.join(info.basePath, '.venv', 'bin', 'python3')

  await telemetry.trackedStep('comfy.desktop.adopt.validate_venv', {}, async () => {
    if (!fs.existsSync(pythonPath)) {
      const choice = await tools.promptUser('venv-broken', { reason: 'venv-missing', pythonPath })
      if (choice.kind === 'venv-broken' && choice.choice === 'cancel')
        throw new Error('venv-broken-cancelled')
      return
    }
    const result = await deps.validateLegacyVenv(pythonPath, signal)
    if (!result.ok) {
      const choice = await tools.promptUser('venv-broken', {
        reason: 'import-failed',
        message: result.message
      })
      if (choice.kind === 'venv-broken' && choice.choice === 'cancel')
        throw new Error('venv-broken-cancelled')
    }
  })

  sendProgress('snapshot', { percent: 0 })
  await telemetry.trackedStep('comfy.desktop.adopt.snapshot', {}, async () => {
    try {
      const snap = await deps.captureDesktopSnapshot(info)
      const snapshotsDir = path.join(info.basePath, SNAPSHOTS_REL)
      await fs.promises.mkdir(snapshotsDir, { recursive: true })
      const snapshotFile = path.join(snapshotsDir, `legacy-adopted-${timestamp}.json`)
      await fs.promises.writeFile(
        snapshotFile,
        JSON.stringify({ ...snap, skipPipSync: true }, null, 2)
      )
    } catch (err) {
      sendOutput(`Warning: forensic snapshot failed: ${(err as Error).message}\n`)
    }
  })

  sendProgress('allocate', { percent: 0 })
  const installPath = await telemetry.trackedStep('comfy.desktop.adopt.allocate', {}, async () => {
    const allocated = allocateUniqueDir(defaultInstallDir(), sanitizeDirName(ADOPT_INSTALL_NAME))
    await fs.promises.mkdir(allocated, { recursive: true })
    return allocated
  })

  sendProgress('source', { percent: 0 })
  const destSource = path.join(installPath, 'ComfyUI')
  let sourceMode: AdoptSourceMode | null = null
  let sourceAttempts = 0
  while (sourceMode === null) {
    sourceAttempts++
    sourceMode = await telemetry.trackedStep(
      'comfy.desktop.adopt.source',
      { attempt: sourceAttempts },
      async () => {
        const sourceResult = await sourceComfyUI(info, destSource, tools, deps)
        if (sourceResult.mode !== 'failed') return sourceResult.mode
        const choice = await tools.promptUser('source-missing', {
          message: sourceResult.message,
          attempts: sourceAttempts
        })
        if (choice.kind === 'source-missing' && choice.choice === 'retry') return null
        throw new Error(`source-missing: ${sourceResult.message}`)
      }
    )
  }

  let resolvedComfyVersion: ComfyVersion | undefined
  if (fs.existsSync(path.join(destSource, '.git'))) {
    try {
      if (!isPygit2Configured() && !(await isGitAvailable())) {
        await tryConfigurePygit2Fallback(installPath)
      }
      await fetchTags(destSource)
      const headCommit = readGitHead(destSource)
      if (headCommit) {
        resolvedComfyVersion = await resolveLocalVersion(
          destSource,
          headCommit,
          readComfyVersion(destSource) ?? undefined
        )
      }
    } catch (err) {
      sendOutput(`Warning: could not resolve adopted ComfyUI version: ${(err as Error).message}\n`)
    }
  }

  sendProgress('requirements', { percent: 0 })
  const reqReport = await telemetry.trackedStep(
    'comfy.desktop.adopt.requirements',
    {},
    async () => {
      try {
        return await installAdoptedRequirements(
          destSource,
          installPath,
          pythonPath,
          info.basePath,
          tools
        )
      } catch (err) {
        sendOutput(`Warning: requirements install threw: ${(err as Error).message}\n`)
        return {
          uvAvailable: false,
          coreExitCode: null,
          managerExitCode: null,
          pygit2ExitCode: null
        }
      }
    }
  )

  const settingsRead = readLegacyComfySettings(info.basePath)
  const rawComfySettings = settingsRead.settings
  const prefs = readLegacyComfyPrefs(rawComfySettings)
  const legacyDesktopConfig = readLegacyDesktopConfig(info.configDir)
  const legacyAppVersion = readLegacyAppVersion(info.executablePath)
  const detectedGpu =
    typeof legacyDesktopConfig['detectedGpu'] === 'string'
      ? (legacyDesktopConfig['detectedGpu'] as string)
      : null
  const selectedDevice =
    typeof legacyDesktopConfig['selectedDevice'] === 'string'
      ? (legacyDesktopConfig['selectedDevice'] as string)
      : null
  const derived = deriveLaunchArgs(rawComfySettings, selectedDevice)

  sendProgress('settings', { percent: 0 })
  const carry = await telemetry.trackedStep('comfy.desktop.adopt.carry_settings', {}, async () => {
    return carryLegacySettings(info.basePath, info.configDir, prefs, sendOutput)
  })

  sendProgress('register', { percent: 0 })
  const record = await telemetry.trackedStep('comfy.desktop.adopt.register', {}, async () => {
    const comfyVersion = readComfyVersion(destSource) ?? undefined

    const inputDir = derived.pathOverrides.inputDir ?? path.join(info.basePath, 'input')
    const outputDir = derived.pathOverrides.outputDir ?? path.join(info.basePath, 'output')

    const recordData: Record<string, unknown> = {
      name: ADOPT_INSTALL_NAME,
      sourceId: 'standalone',
      installPath,
      adopted: true,
      adoptedAt: deps.now().toISOString(),
      adoptedBaseDir: info.basePath,
      adoptedPythonPath: pythonPath,
      adoptedSourceMode: sourceMode!,
      ...(settingsRead.status !== 'error'
        ? { adoptedSettingsVersion: ADOPTED_SETTINGS_VERSION }
        : {}),
      ...(legacyAppVersion ? { adoptedFromLegacyVersion: legacyAppVersion } : {}),
      ...(detectedGpu ? { adoptedFromGpu: detectedGpu } : {}),
      ...(selectedDevice ? { adoptedSelectedDevice: selectedDevice } : {}),
      releaseTag: 'legacy-adopted',
      variant: 'legacy-uv-py312',
      pythonVersion: '3.12',
      ...(comfyVersion ? { version: comfyVersion } : {}),
      ...(resolvedComfyVersion ? { comfyVersion: resolvedComfyVersion } : {}),
      launchArgs: derived.launchArgs,
      launchMode: 'window',
      browserPartition: 'unique',
      portConflict: 'auto',
      autoUpdateComfyUI: false,
      useSharedModels: true,
      useSharedInput: false,
      useSharedOutput: false,
      inputDir,
      outputDir,
      copiedFrom: 'legacy-desktop',
      copyReason: 'in-place-adoption',
      status: 'installed',
      seen: false
    }
    const entry = await installations.add(recordData)
    try {
      await fs.promises.writeFile(path.join(info.basePath, MARKER_FILE), entry.id)
      await fs.promises.writeFile(path.join(installPath, MARKER_FILE), entry.id)
    } catch (err) {
      try {
        await installations.remove(entry.id)
      } catch {}
      throw err
    }
    try {
      const all = await installations.list()
      for (const i of all) {
        if (i.sourceId !== 'desktop') continue
        if (i.installPath !== info.basePath) continue
        await installations.remove(i.id)
      }
    } catch {}
    return entry
  })

  telemetry.capture('comfy.desktop.adopt.succeeded', {
    installation_id: record.id,
    legacy_version: legacyAppVersion ?? null,
    adopted_source_mode: sourceMode,
    has_venv: info.hasVenv,
    has_extra_models_yaml: fs.existsSync(path.join(info.configDir, EXTRA_MODELS_YAML)),
    models_dir_count: carry.addedModelsDirs.length,
    carried_keys: carry.carriedKeys,
    carry_skipped_keys: carry.carrySkippedKeys,
    adopted_path_override_input: !!derived.pathOverrides.inputDir,
    adopted_path_override_output: !!derived.pathOverrides.outputDir,
    adopted_comfy_tag_at_migration: null,
    requirements_uv_available: reqReport.uvAvailable,
    requirements_core_exit: reqReport.coreExitCode,
    requirements_manager_exit: reqReport.managerExitCode,
    requirements_pygit2_exit: reqReport.pygit2ExitCode,
    gpu: detectedGpu,
    selected_device: selectedDevice
  })

  telemetry.captureInstallCompleted({
    installationId: record.id,
    method: 'adopt',
    express: false
  })

  sendProgress('done', { percent: 100 })
  return record
}
