import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { downloadAndExtract, downloadAndExtractMulti } from '../../lib/installer'
import type { InstallPhaseName, InstallPhaseStatus } from '../../lib/installer'
import * as mainTelemetry from '../../lib/telemetry'
import { buildErrorFields } from '../../../shared/errorEvent'
import { copyDirWithProgress } from '../../lib/copy'
import { readGitHead, isGitAvailable, isPygit2Configured, tryConfigurePygit2Fallback, fetchTags } from '../../lib/git'
import { resolveLocalVersion } from '../../lib/version-resolve'
import { formatTime } from '../../lib/util'
import { t } from '../../lib/i18n'
import * as snapshots from '../../lib/snapshots'
import { fetchLatestRelease } from '../../lib/comfyui-releases'
import { repairMacBinaries, codesignBinaries } from './macRepair'
import { runComfyUIUpdate } from './updateOrchestrator'
import {
  MANIFEST_FILE, DEFAULT_LAUNCH_ARGS,
  getUvPath, getVenvDir, findSitePackages, getMasterPythonPath,
  writeComfyEnvironment,
} from './envPaths'
import type { InstallationRecord } from '../../installations'
import { tagsEqual, type ComfyVersion } from '../../lib/version'
import { resolveNestedComfyUIParent } from '../common/nestedRoot'
import type { InstallTools, PostInstallTools } from '../../types/sources'

const BULKY_PREFIXES = ['torch', 'nvidia', 'triton', 'cuda']

/**
 * Per-phase install telemetry. Splits the two former mega-spans
 * (`install.standalone` / `install.post_install`) into the five real dark
 * sub-steps so the install→canvas drop (−79%) is attributable to a phase.
 * `torch_deps_sync` is the dominant +60min sink and gets its own boundary.
 *
 * Lives here (not at the orchestration call sites) so BOTH the express install
 * path (`install-instance` handler) and the standalone-migration path — which
 * both call this module's `install` / `postInstall` — are instrumented by one
 * wiring. Enum/number/bool props only; the installation id is an opaque
 * `inst-<ms>` token and the variant is an enum, so nothing here is raw user
 * data. `error` events ride the Datadog mirror (via `emit`) for alerting.
 */
type InstallPhase = InstallPhaseName | 'env_create' | 'package_copy' | 'torch_deps_sync'

function emitInstallPhase(
  installation: InstallationRecord,
  phase: InstallPhase,
  status: InstallPhaseStatus,
  info: { durationMs?: number; error?: unknown } = {}
): void {
  // Side-channel only: classification/emission must never derail an install
  // phase (this is also the installer's onPhase tap).
  try {
    const props: Record<string, string | number | null> = {
      installation_id: installation.id,
      variant: (installation.variant as string | undefined) ?? null,
      phase,
      status
    }
    if (typeof info.durationMs === 'number') props.duration_ms = info.durationMs
    if (status === 'error') {
      // Standard error schema so a failing phase carries the actual error
      // text, not just the coarse bucket.
      Object.assign(props, buildErrorFields(info.error))
    }
    mainTelemetry.emit('comfy.desktop.install.phase', props)
  } catch (err) {
    console.warn('Install phase telemetry emission failed:', err)
  }
}

/** Wrap a post-install phase with start/end/error boundaries. Re-throws so the
 *  cancel / repair control flow is untouched; telemetry is a side-channel. */
async function withPostInstallPhase<T>(
  installation: InstallationRecord,
  phase: InstallPhase,
  fn: () => Promise<T>
): Promise<T> {
  emitInstallPhase(installation, phase, 'start')
  const t0 = Date.now()
  try {
    const result = await fn()
    emitInstallPhase(installation, phase, 'end', { durationMs: Date.now() - t0 })
    return result
  } catch (err) {
    emitInstallPhase(installation, phase, 'error', { durationMs: Date.now() - t0, error: err })
    throw err
  }
}

async function stripMasterPackages(installPath: string): Promise<void> {
  try {
    const sitePackages = findSitePackages(path.join(installPath, 'standalone-env'))
    if (!sitePackages || !fs.existsSync(sitePackages)) return

    const entries = await fs.promises.readdir(sitePackages, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const lower = entry.name.toLowerCase()
      if (BULKY_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
        await fs.promises.rm(path.join(sitePackages, entry.name), { recursive: true, force: true })
      }
    }
  } catch (err) {
    console.warn('Failed to strip master packages:', err)
  }
}

async function createEnv(
  installation: InstallationRecord,
  onProgress: (copied: number, total: number, elapsedSecs: number, etaSecs: number) => void,
  signal?: AbortSignal
): Promise<void> {
  const installPath = installation.installPath
  const uvPath = getUvPath(installPath)
  const masterPython = getMasterPythonPath(installPath)
  const venvPath = getVenvDir(installPath)
  // env_create: `uv venv` — the bare interpreter env, before any packages land.
  await withPostInstallPhase(installation, 'env_create', () =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(new Error('Cancelled'))
      const proc = execFile(uvPath, ['venv', '--python', masterPython, venvPath], { cwd: installPath }, (err, _stdout, stderr) => {
        if (signal?.aborted) return reject(new Error('Cancelled'))
        if (err) return reject(new Error(`Failed to create .venv: ${stderr || err.message}`))
        resolve()
      })
      signal?.addEventListener('abort', () => { try { proc.kill() } catch {} }, { once: true })
    })
  )

  try {
    const masterSitePackages = findSitePackages(path.join(installPath, 'standalone-env'))
    const envSitePackages = findSitePackages(venvPath)
    if (!masterSitePackages || !envSitePackages || !fs.existsSync(masterSitePackages)) {
      throw new Error('Could not locate site-packages for .venv.')
    }
    // package_copy: hydrate the venv from the master site-packages (multi-GB,
    // the disk-bound stretch of post-install).
    await withPostInstallPhase(installation, 'package_copy', async () => {
      await copyDirWithProgress(masterSitePackages, envSitePackages, onProgress, { signal })
      await codesignBinaries(envSitePackages)
    })
  } catch (err) {
    await fs.promises.rm(venvPath, { recursive: true, force: true }).catch(() => {})
    throw err
  }
}

export async function install(installation: InstallationRecord, tools: InstallTools): Promise<void> {
  // The installer owns the download↔extract seam; map its boundary callbacks
  // onto the consent-gated install.phase telemetry with this install's id/variant.
  const installerCtx = {
    ...tools,
    onPhase: (
      phase: InstallPhaseName,
      status: InstallPhaseStatus,
      info?: { durationMs?: number; error?: unknown }
    ) => emitInstallPhase(installation, phase, status, info ?? {})
  }
  const files = installation.downloadFiles as Array<{ url: string; filename: string; size: number }> | undefined
  if (files && files.length > 0) {
    const cacheDir = `${installation.releaseTag as string}_${installation.variant as string}`
    await downloadAndExtractMulti(files, installation.installPath, cacheDir, installerCtx)
  } else if (installation.downloadUrl as string | undefined) {
    const downloadUrl = installation.downloadUrl as string
    const filename = downloadUrl.split('/').pop()!
    const cacheKey = `${installation.releaseTag as string}_${filename}`
    await downloadAndExtract(downloadUrl, installation.installPath, cacheKey, installerCtx)
  }
}

export async function postInstall(installation: InstallationRecord, { sendProgress, update, signal }: PostInstallTools): Promise<void> {
  const standaloneEnvDir = path.join(installation.installPath, 'standalone-env')
  if (process.platform !== 'win32') {
    const binDir = path.join(standaloneEnvDir, 'bin')
    try {
      const entries = fs.readdirSync(binDir)
      for (const entry of entries) {
        const fullPath = path.join(binDir, entry)
        try { fs.chmodSync(fullPath, 0o755) } catch {}
      }
    } catch {}
  }
  await repairMacBinaries(installation.installPath, sendProgress)
  if (signal?.aborted) throw new Error('Cancelled')
  sendProgress('setup', { percent: 0, status: 'Creating Python environment…' })
  await createEnv(installation, (copied, total, elapsedSecs, etaSecs) => {
    const percent = Math.round((copied / total) * 100)
    const elapsed = formatTime(elapsedSecs)
    const eta = etaSecs >= 0 ? formatTime(etaSecs) : '—'
    sendProgress('setup', { percent, status: `Copying packages… ${copied} / ${total} files  ·  ${elapsed} elapsed  ·  ${eta} remaining` })
  }, signal)
  if (signal?.aborted) throw new Error('Cancelled')
  sendProgress('cleanup', { percent: -1, status: t('standalone.cleanupEnvStatus') })
  await stripMasterPackages(installation.installPath)

  // Populate comfyVersion now so version displays are correct without waiting
  // for the first update. Without a global git binary, configure pygit2 against
  // the just-installed standalone Python so tag resolution works.
  if (!isPygit2Configured() && !await isGitAvailable()) {
    await tryConfigurePygit2Fallback(installation.installPath)
  }
  const comfyuiDir = path.join(installation.installPath, 'ComfyUI')
  await writeComfyEnvironment(comfyuiDir)
  sendProgress('cleanup', { percent: -1, status: 'Fetching version tags…' })
  await fetchTags(comfyuiDir)
  const headCommit = readGitHead(comfyuiDir)
  if (headCommit) {
    const ref = installation.version as string | undefined
    const comfyVersion = await resolveLocalVersion(comfyuiDir, headCommit, ref)
    await update({ comfyVersion })
    installation = { ...installation, comfyVersion } as InstallationRecord
  }

  // Capture initial snapshot so the detail view shows "Current" immediately.
  try {
    const filename = await snapshots.saveSnapshot(installation.installPath, installation, 'boot')
    const snapshotCount = await snapshots.getSnapshotCount(installation.installPath)
    await update({ lastSnapshot: filename, snapshotCount })
  } catch (err) {
    console.warn('Initial snapshot failed:', err)
  }

  // Auto-update to the channel the user picked on the install wizard.
  // `installation.updateChannel` is set by `buildInstallation`:
  // 'stable' → check out the latest stable tag; 'latest' → fast-forward
  // to master HEAD. Defaults to 'stable' for installs created before
  // the channel split, where `autoUpdateComfyUI` implicitly meant stable.
  if (installation.autoUpdateComfyUI && fs.existsSync(path.join(comfyuiDir, '.git'))) {
    if (signal?.aborted) throw new Error('Cancelled')
    const channel: 'stable' | 'latest' =
      (installation.updateChannel as 'stable' | 'latest' | undefined) ?? 'stable'
    // The wizard's version picker pins an explicit stable tag for the install.
    // When set, the post-install update checks out that tag instead of
    // resolving the channel head, so the user lands on the version they
    // picked even if a newer one shipped between selection and download.
    const pickedTag = installation.comfyVersionTag as string | undefined
    const channelLabel = pickedTag
      ? `ComfyUI ${pickedTag}`
      : channel === 'latest' ? 'latest version' : 'latest stable version'
    sendProgress('update', { percent: -1, status: `Fetching ${channelLabel}` })

    try {
      // Bypass the in-memory tag cache, which can be poisoned with `null` at
      // startup before any git backend is configured. `tryConfigurePygit2Fallback`
      // above has since configured pygit2, so the refreshed lookup fires.
      const latestRelease = await fetchLatestRelease(channel, { refresh: true })
      const latestTag = latestRelease?.tag_name as string | undefined
      const current = installation.comfyVersion as ComfyVersion | undefined
      const onLatestTag = !!latestTag && tagsEqual(current?.baseTag, latestTag) && current?.commitsAhead === 0
      const onPickedTag = !!pickedTag && tagsEqual(current?.baseTag, pickedTag) && current?.commitsAhead === 0

      if (!latestTag && !pickedTag) {
        // A network flake must not masquerade as "up to date" — that stranded
        // first installs on the bundled version.
        sendProgress('update', { percent: 100, status: `Skipped — could not verify ${channelLabel}` })
      } else if (pickedTag ? onPickedTag : onLatestTag) {
        sendProgress('update', { percent: 100, status: 'Already up to date' })
      } else {
        // torch_deps_sync: the dominant dark time-sink in post-install
        // (the forced `pip install --upgrade -r requirements.txt` can run
        // 60+ min on a cold torch/cuda set). Own boundary so it stops hiding
        // inside the post_install mega-span and a stall here is attributable.
        const result = await withPostInstallPhase(installation, 'torch_deps_sync', () =>
          runComfyUIUpdate({
            installPath: installation.installPath,
            installation,
            channel,
            ...(pickedTag ? { targetTag: pickedTag } : {}),
            update,
            sendProgress: sendProgress as (step: string, data: Record<string, unknown>) => void,
            signal,
            // The standalone bundle ships a pre-extracted venv whose pinned
            // versions can lag ComfyUI's own `requirements.txt` (most visibly
            // `comfy-aimdo`, which crashes on import when the venv's copy is
            // older than what ComfyUI's source expects). Force a `pip install
            // --upgrade -r requirements.txt` after the post-install git update,
            // even when the file is byte-identical pre/post, so the venv always
            // ends up in sync with ComfyUI's pins before the user runs anything.
            forceDepsSync: true,
          })
        )
        installation = result.installation
        if (result.ok) {
          sendProgress('update', { percent: 100, status: 'Up to date' })
        } else {
          sendProgress('update', { percent: 100, status: 'Skipped (update failed)' })
        }
      }
    } catch (err) {
      if ((err as Error).message === 'Cancelled') throw err
      console.warn(`Auto-update to ${channel} failed:`, err)
      sendProgress('update', { percent: 100, status: 'Skipped' })
    }
  }
  // NOTE: starter-template model downloads no longer run here. They start in the
  // BACKGROUND when install begins (see `startTemplateDownload` wired in
  // registerInstallationHandlers) and are displayed as a launch-span stepper
  // phase, so the bytes overlap env setup instead of blocking the install.
}

/**
 * Resolve the standalone root for a probed directory. Returns the directory
 * itself when it holds the standalone markers (`standalone-env/` +
 * `ComfyUI/main.py`), or its parent when the user pointed at the nested
 * `ComfyUI/` folder inside a standalone install. Returns null otherwise.
 */
function findStandaloneRoot(dirPath: string): string | null {
  const hasMarkers = (root: string): boolean =>
    fs.existsSync(path.join(root, 'standalone-env')) &&
    fs.existsSync(path.join(root, 'ComfyUI', 'main.py'))
  if (hasMarkers(dirPath)) return dirPath
  // User pointed at the nested `ComfyUI/` folder — the root is one level up.
  return resolveNestedComfyUIParent(dirPath, hasMarkers)
}

export async function probeInstallation(dirPath: string): Promise<Record<string, unknown> | null> {
  const root = findStandaloneRoot(dirPath)
  if (!root) return null
  const hasVenv = fs.existsSync(path.join(root, 'ComfyUI', '.venv'))
  const hasLegacyEnvs = fs.existsSync(path.join(root, 'envs'))
  const hasGit = fs.existsSync(path.join(root, 'ComfyUI', '.git'))

  let version = 'unknown'
  let releaseTag = ''
  let variant = ''
  let pythonVersion = ''
  try {
    const data = JSON.parse(fs.readFileSync(path.join(root, MANIFEST_FILE), 'utf8')) as Record<string, string>
    version = data.comfyui_ref || version
    releaseTag = data.version || releaseTag
    variant = data.id || variant
    pythonVersion = data.python_version || pythonVersion
  } catch {}

  let comfyVersion: ComfyVersion | undefined
  if (hasGit) {
    const comfyuiDir = path.join(root, 'ComfyUI')
    const commit = readGitHead(comfyuiDir)
    if (commit) {
      const manifestTag = version !== 'unknown' ? version : undefined
      comfyVersion = await resolveLocalVersion(comfyuiDir, commit, manifestTag)
    }
  }

  return {
    version,
    ...(comfyVersion ? { comfyVersion } : {}),
    releaseTag,
    variant,
    pythonVersion,
    hasGit,
    // Record the standalone root, not whatever the user picked — they may have
    // pointed at the nested `ComfyUI/` folder. Runtime paths resolve off this.
    installPath: root,
    launchArgs: DEFAULT_LAUNCH_ARGS,
    launchMode: 'window',
    ...(hasLegacyEnvs && !hasVenv ? { needsEnvMigration: true } : {}),
  }
}

export async function migrateEnvLayout(
  installPath: string,
  update: (data: Record<string, unknown>) => Promise<unknown>,
  sendProgress?: (step: string, data: { percent: number; status: string }) => void,
): Promise<boolean> {
  const venvDir = getVenvDir(installPath)
  if (fs.existsSync(venvDir)) return false

  const legacyEnvDir = path.join(installPath, 'envs', 'default')
  if (!fs.existsSync(legacyEnvDir)) return false

  sendProgress?.('migration', { percent: 0, status: 'Migrating environment layout…' })

  await fs.promises.rename(legacyEnvDir, venvDir)

  // Rewrite the pyvenv.cfg home path (old path included envs/default/).
  const cfgPath = path.join(venvDir, 'pyvenv.cfg')
  if (fs.existsSync(cfgPath)) {
    let content = await fs.promises.readFile(cfgPath, 'utf-8')
    const oldEnvPath = path.join(installPath, 'envs', 'default')
    content = content.replaceAll(oldEnvPath, venvDir)
    await fs.promises.writeFile(cfgPath, content, 'utf-8')
  }

  // Rewrite shebangs on unix.
  if (process.platform !== 'win32') {
    const binDir = path.join(venvDir, 'bin')
    if (fs.existsSync(binDir)) {
      const entries = await fs.promises.readdir(binDir, { withFileTypes: true })
      const oldEnvPath = path.join(installPath, 'envs', 'default')
      for (const entry of entries) {
        if (!entry.isFile()) continue
        const filePath = path.join(binDir, entry.name)
        try {
          let content = await fs.promises.readFile(filePath, 'utf-8')
          if (content.startsWith('#!') && content.includes(oldEnvPath)) {
            content = content.replaceAll(oldEnvPath, venvDir)
            await fs.promises.writeFile(filePath, content, 'utf-8')
          }
        } catch {}
      }
    }
  }

  // Re-codesign moved binaries on macOS.
  if (process.platform === 'darwin') {
    sendProgress?.('migration', { percent: 50, status: 'Codesigning migrated binaries…' })
    await codesignBinaries(venvDir)
  }

  const envsDir = path.join(installPath, 'envs')
  try {
    const remaining = await fs.promises.readdir(envsDir)
    if (remaining.length === 0) {
      await fs.promises.rmdir(envsDir)
    }
  } catch {}

  await update({ activeEnv: undefined, envMethods: undefined, needsEnvMigration: undefined })

  sendProgress?.('migration', { percent: 100, status: 'Migration complete' })
  return true
}
