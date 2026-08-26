import {
  path,
  fs,
  installations,
  settings,
  i18n,
  sourceMap,
  spawnProcess,
  waitForPort,
  waitForUrl,
  killProcessTree,
  findPidsByPort,
  getProcessInfo,
  looksLikeComfyUI,
  setPortArg,
  findAvailablePort,
  isPortListening,
  writePortLock,
  readPortLock,
  COMFY_BOOT_TIMEOUT_MS,
  SENSITIVE_ARG_RE,
  _onLaunch,
  _onComfyExited,
  _onComfyRestarted,
  _onModelFolderRelaunch,
  _operationAborts,
  _runningSessions,
  _pendingPorts,
  _reservePort,
  _releasePort,
  _addSession,
  _removeSession,
  _markLaunching,
  _clearLaunchingFailed,
  _beginLaunch,
  _endLaunch,
  installDirStateAsync,
  captureSnapshotIfChanged,
  getSnapshotCount,
  syncCustomModelFolders,
  discoverExtraModelFolders,
  instanceModelPathsYaml,
  resolveLauncherModelDirs,
  createSessionPath,
  buildLaunchEnv,
  checkRebootMarker,
  makeSendProgress,
  makeSendOutput,
  getComfyArgsSchema,
  filterUnsupportedArgs,
  getComfyFeatureFlagRegistry,
  _broadcastToRenderer
} from '../shared'
import type { ChildProcess, InstallationRecord, LaunchCmd } from '../shared'
import type { LaunchCommand } from '../../../types/sources'
import { randomUUID } from 'node:crypto'
import { displayLaunchUrl } from '../../cloudUrl'
import type { ModelPathsOptions } from '../../models'
import type { ActionContext, ActionResult } from './types'
import { lastNLines, stripAnsi } from '../../stderrTail'
import { decodeExitCode } from '../../exitCodeInfo'
import { auditVcRuntime } from '../../vcRuntimeAudit'
import { rotateLogFiles, getLogDir } from '../../logRotation'
import { createExecutionTap } from '../../executionTap'
import { createHardwareTap } from '../../hardwareTap'
import { createLaunchProgressTracker } from '../../launchProgress'
import { buildLaunchPhases } from '../../launchPhases'
import {
  getTemplateDownloadState,
  summarizeTemplateState,
  formatTemplateSubStatus,
  awaitTemplateDownloadSettled
} from '../../../sources/standalone/templateDownloadTask'
import { isTerminal as isTemplateDownloadTerminal } from '../../../sources/standalone/templateDownloadCore'
import { initializeModelDownloads } from '../../comfyDownloadManager'
import type { PreLaunchPhase } from '../../launchPhases'
import { scanCustomNodes } from '../../nodes'
import type { LaunchProgressTracker } from '../../launchProgress'
import { clearCrash, recordCrash } from '../../crashBuffer'
import type { ComfyExitedData } from '../../../../types/ipc'
import * as telemetry from '../../telemetry'
import { buildErrorFields, errorTail } from '../../../../shared/errorEvent'
import {
  startBootPhases,
  recordBootPhase,
  clearBootPhases,
  flushBootPhasesOnFailure
} from '../../bootPhaseBuffer'
import { appendLog } from '../../logsBroadcast'
import { reconcileManagerConfigForLaunch } from '../../managerConfigLaunch'
import { recoverInterruptedComfyOp } from '../../opMarker'
import { waitLaunchSpawnHold } from '../../e2eOverrides'
import { migrateEnvLayout } from '../../../sources/standalone/install'
import { writeComfyEnvironment } from '../../../sources/standalone/envPaths'
import type { PersistedTorchStack } from '../../../sources/standalone/torchStackTypes'
import type { WriteStream } from 'fs'
import {
  getCoreCanaryConfigAsync,
  isCoreCanaryEligible,
  resolveCoreCanaryLaunchArgs
} from '../../coreCanary'

// Feature flags injected on a spawned ComfyUI, gated by the running install's
// --list-feature-flags registry so we never inject unrecognized keys.
export function desktopFeatureFlags(
  inst: InstallationRecord,
  telemetryEnabled: boolean
): Record<string, string> {
  const flags: Record<string, string> = {
    show_signin_button: 'true',
    // Do not advertise inline PTY support. Desktop injects a navigation-only
    // terminal entry instead.
    supports_terminal: 'false'
  }
  // Telemetry is opt-in (default off) and only signaled for managed standalone
  // installs — never for portable or user-managed git clones.
  if (inst.sourceId === 'standalone' && telemetryEnabled) {
    flags.enable_telemetry = 'true'
  }
  return flags
}

export interface StorageLaunchState {
  preLaunchExtras: string[]
  manageModelFolders: boolean
  modelDirsForLaunch: string[] | undefined
  modelSyncOptions: ModelPathsOptions
}

export function applyStorageLaunchArgs(
  inst: InstallationRecord,
  installationId: string,
  launchCmd: LaunchCommand
): StorageLaunchState {
  // Shared models and shared input/output are independent flags.
  const argsAvailable = !launchCmd.skipSharedPaths && !!launchCmd.args
  let preLaunchExtras: string[] = []
  // Model dirs whose extra-folder changes drive auto-relaunch, plus the sync
  // options (target YAML + which dir is `is_default`). Shared and per-install
  // dirs are additive: the global settings dirs (unless the install excludes
  // them via `useSharedModels: false`) plus the install's own `modelDirs`.
  let modelDirsForLaunch: string[] | undefined
  let modelSyncOptions: ModelPathsOptions = {}
  let manageModelFolders = false
  if (argsAvailable) {
    const sharedDirs = (settings.get('modelsDirs') as string[] | undefined) ?? []
    const { dirs, primaryDir } = resolveLauncherModelDirs(inst, sharedDirs)
    if (dirs.length > 0) {
      manageModelFolders = true
      modelDirsForLaunch = dirs
      // Always the per-install YAML: the effective dir set is install-specific
      // now that shared and per-install dirs combine.
      modelSyncOptions = { yamlPath: instanceModelPathsYaml(installationId), primaryDir }
    }
  }
  if (manageModelFolders) {
    const { config } = syncCustomModelFolders(
      inst.installPath,
      modelDirsForLaunch,
      [],
      modelSyncOptions
    )
    if (config) {
      launchCmd.args!.push('--extra-model-paths-config', config.yamlPath)
    }
    const installExtras = discoverExtraModelFolders(inst.installPath)
    const baselineSet = new Set([...(config?.extraFolders ?? []), ...installExtras])
    preLaunchExtras = [...baselineSet].sort()
  }
  if (argsAvailable) {
    // Input and output are independent per-folder choices: shared (global
    // settings) or the per-install path. A per-install path is omitted when
    // unset so ComfyUI falls back to its own <installPath>/{input,output}
    // defaults (e.g. adopted-from-legacy records pin these fields).
    const useSharedInput = (inst.useSharedInput as boolean | undefined) !== false
    const useSharedOutput = (inst.useSharedOutput as boolean | undefined) !== false
    if (useSharedInput) {
      const inputDir =
        (settings.get('inputDir') as string | undefined) || settings.defaults.inputDir
      fs.mkdirSync(inputDir, { recursive: true })
      launchCmd.args!.push('--input-directory', inputDir)
    } else {
      const perInstallInput = inst.inputDir as string | undefined
      if (perInstallInput) {
        fs.mkdirSync(perInstallInput, { recursive: true })
        launchCmd.args!.push('--input-directory', perInstallInput)
      }
    }
    if (useSharedOutput) {
      const outputDir =
        (settings.get('outputDir') as string | undefined) || settings.defaults.outputDir
      fs.mkdirSync(outputDir, { recursive: true })
      launchCmd.args!.push('--output-directory', outputDir)
    } else {
      const perInstallOutput = inst.outputDir as string | undefined
      if (perInstallOutput) {
        fs.mkdirSync(perInstallOutput, { recursive: true })
        launchCmd.args!.push('--output-directory', perInstallOutput)
      }
    }
  }

  return { preLaunchExtras, manageModelFolders, modelDirsForLaunch, modelSyncOptions }
}

// A clean exit is code 0 with no signal; anything else (non-zero code or a
// signal) is a crash, since the user didn't go through our Stop path.
export function isCrashedExit(code: number | null, signal: NodeJS.Signals | null): boolean {
  return code !== 0 || signal !== null
}

const PROCESS_CLOSE_GRACE_MS = 1_000

/** Prefer `close` so output pipes can drain, but do not hang on inherited pipes. */
export function onProcessTerminated(
  proc: ChildProcess,
  callback: (code: number | null, signal: NodeJS.Signals | null) => void | Promise<void>
): void {
  let finished = false
  let fallbackTimer: NodeJS.Timeout | undefined

  const finish = (code: number | null, signal: NodeJS.Signals | null): void => {
    if (finished) return
    finished = true
    if (fallbackTimer) clearTimeout(fallbackTimer)
    try {
      void Promise.resolve(callback(code, signal)).catch((err) => {
        console.error('Process termination callback failed:', err)
      })
    } catch (err) {
      console.error('Process termination callback failed:', err)
    }
  }

  proc.once('close', finish)
  proc.once('exit', (code, signal) => {
    if (finished) return
    fallbackTimer = setTimeout(() => finish(code, signal), PROCESS_CLOSE_GRACE_MS)
    fallbackTimer.unref()
  })
}

/**
 * Diagnose a crash exit code into the extra fields the UI needs to show a
 * human-readable message. Returns `{}` for a plain application exit (the
 * generic "exited with code N" copy still applies). For a Windows native
 * fault it adds the decoded hex + kind, and for an access violation it also
 * audits the VC++ runtime so the UI can suggest repairing it when DLLs are
 * actually missing.
 */
async function diagnoseCrash(
  code: number | null
): Promise<Pick<ComfyExitedData, 'exitCodeHex' | 'crashKind' | 'vcRuntimeMissing'>> {
  const decoded = decodeExitCode(code)
  if (!decoded) return {}
  const out: Pick<ComfyExitedData, 'exitCodeHex' | 'crashKind' | 'vcRuntimeMissing'> = {
    exitCodeHex: decoded.hex,
    crashKind: decoded.kind
  }
  if (decoded.kind === 'access-violation') {
    // Never let an audit failure reject this helper: it runs inside an async
    // EventEmitter listener, so a throw would become an unhandledRejection and
    // skip recordCrash/broadcast. Keep the decoded hex/kind regardless.
    try {
      const missing = await auditVcRuntime()
      if (missing.length > 0) out.vcRuntimeMissing = missing
    } catch (err) {
      console.warn('VC++ runtime audit failed:', err)
    }
  }
  return out
}

/**
 * Render an exit code for a plain-text launch-failure message. A normal exit
 * stays as its number; a decoded Windows native fault gets `decimal / hex` plus
 * a short access-violation explanation and, when the VC++ runtime DLLs are
 * actually missing, a repair hint. English-only to match the surrounding
 * non-localized launch-failure strings.
 */
async function describeExitCode(code: number | null): Promise<string> {
  if (code == null) return 'unknown'
  const decoded = decodeExitCode(code)
  if (!decoded) return String(code)
  let out = `${decoded.code} / ${decoded.hex}`
  if (decoded.kind === 'access-violation') {
    out += ' (memory access violation — usually a faulty or missing native library)'
    // Swallow audit failures: this feeds earlyExitPromise's rejection, so a
    // throw here would leave the launch race hanging until the boot timeout.
    try {
      if ((await auditVcRuntime()).length > 0) {
        out +=
          '. The Microsoft Visual C++ Redistributable runtime files appear to be missing; ' +
          'installing the latest redistributable may fix this'
      }
    } catch (err) {
      console.warn('VC++ runtime audit failed:', err)
    }
  }
  return out
}

async function openLogStream(installPath: string): Promise<WriteStream> {
  const logDir = getLogDir(installPath)
  fs.mkdirSync(logDir, { recursive: true })
  await rotateLogFiles(logDir, 'comfyui.log')
  return fs.createWriteStream(path.join(logDir, 'comfyui.log'), { flags: 'w' })
}

function writeLog(stream: WriteStream, text: string): void {
  if (!stream.writableEnded) stream.write(stripAnsi(text))
}

/** Failure cleanup for a throw after launch resources were acquired (launching
 *  marker set, port possibly reserved) but before the normal failure handling
 *  is reachable: close the log stream, release the port, free the operation
 *  slot (ownership-guarded), stop launch-scoped work via abort, and clear the
 *  launching marker. Safe when only some of the resources exist. Without it a
 *  leaked marker/port would wedge every later launch while the handler's
 *  settled promise tells `cancelLaunching` teardown completed. */
export function _cleanupFailedLaunchSetup(
  installationId: string,
  abort: AbortController,
  opts: { port?: number; logStream?: { end: () => unknown } } = {}
): void {
  opts.logStream?.end()
  if (opts.port !== undefined) _releasePort(opts.port)
  if (_operationAborts.get(installationId) === abort) _operationAborts.delete(installationId)
  abort.abort()
  _clearLaunchingFailed(installationId)
}

export async function handleLaunch(ctx: ActionContext): Promise<ActionResult> {
  const { installationId } = ctx
  if (_runningSessions.has(installationId)) {
    return { ok: false, message: i18n.t('errors.alreadyRunning') }
  }
  // No `_hasActiveLaunch` here: this guard, `_beginLaunch`, and runLaunch's
  // `_operationAborts.set` all run in one synchronous stretch, so a second
  // launch can never slip between them. Checking it would instead reject a
  // legitimate restart relaunch during the post-registration window (session
  // up, handler still draining post-launch work like the template gate).
  if (_operationAborts.has(installationId)) {
    return { ok: false, message: 'Another operation is already running for this installation.' }
  }
  // Track the launch for its ENTIRE handler lifetime so `cancelLaunching` can
  // abort it at any point - including the pre-spawn prep that runs before the
  // launching marker exists. The finally is the single teardown-complete
  // signal: `cancelLaunching` awaits it before letting a restart relaunch.
  const launch = _beginLaunch(installationId)
  try {
    return await runLaunch(ctx, launch.abort)
  } finally {
    if (_operationAborts.get(installationId) === launch.abort)
      _operationAborts.delete(installationId)
    _endLaunch(installationId, launch)
  }
}

async function runLaunch(
  { event, installationId, inst: instArg, actionData }: ActionContext,
  abort: AbortController
): Promise<ActionResult> {
  let inst = instArg
  // Synthetic repair steps that ran during launch prep, prepended to the launch
  // progress in display order (e.g. a source rollback, then a PyTorch restore).
  const preLaunchPhases: PreLaunchPhase[] = []
  // Claim the operation slot for the whole launch, prep included, so no other
  // operation can start against this install while the launch is preparing.
  _operationAborts.set(installationId, abort)
  // Drop retained crash detail so the lifecycle view doesn't resurface it.
  clearCrash(installationId)
  // The startup model-download pass (migrate legacy final-path partials,
  // hydrate staged `.part` downloads) runs to completion before ComfyUI can
  // scan the model dirs, so a truncated file cannot masquerade as a loadable
  // model (#1322). Memoized - normally already done long before the first
  // launch. An UNSAFE result (a known-incomplete file is still visible under
  // a final model name, or the pass could not certify the roots) NEVER blocks
  // the launch: at worst ComfyUI sees a file that fails to load, which is
  // strictly better than refusing to start. The per-file warning rows in
  // Downloads carry the details, and an unsafe pass is not memoized, so the
  // next launch retries the quarantine.
  try {
    const modelStartup = await initializeModelDownloads()
    if (!modelStartup.safe) {
      console.warn(
        'Model download startup pass could not certify all model roots; launching anyway.' +
          (modelStartup.unsafePaths.length > 0
            ? ` Still-visible incomplete files: ${modelStartup.unsafePaths.join(', ')}`
            : '')
      )
    }
  } catch (err) {
    console.warn('Model download startup pass failed; launching anyway:', err)
  }
  if (abort.signal.aborted) return { ok: false, cancelled: true }
  const source = sourceMap[inst.sourceId]
  if (!source) return { ok: false, message: i18n.t('errors.unknownSource') }
  if (!source.skipInstall) {
    // Async (timeout-guarded) so launching an install on a dead network/
    // removable path can't block the main process on a sync readdir.
    const dirState = await installDirStateAsync(inst.installPath)
    // Block on the persistent, accurately-identified failures with a message
    // that names the actual problem: `missing` (folder gone/renamed) and
    // `no-permission` (folder exists but access is denied). `inaccessible` is a
    // transient readdir error (EIO/EBUSY) or a slow-drive probe timeout, which
    // can be a false positive on a healthy-but-slow network/removable drive —
    // so let launch proceed: the common case is a drive that woke up by now and
    // launches fine. If the path is genuinely unusable the downstream env/exe
    // checks (getLaunchCommand, the executable existsSync, spawn errors) return
    // a readable modal error. (A truly-wedged mount can still stall those sync
    // checks; we accept that over blocking healthy slow drives.)
    if (dirState === 'missing') {
      return { ok: false, message: i18n.t('errors.installDirNotFound') }
    }
    if (dirState === 'no-permission') {
      return { ok: false, message: i18n.t('errors.installDirNoPermission') }
    }
    if (dirState === 'empty') {
      return { ok: false, message: i18n.t('errors.installDirEmpty') }
    }
  }

  const sender = event.sender
  const sendProgress = makeSendProgress(sender, installationId)

  /** Show template model-download phase for first launch if needed. */
  const showTemplatePhase =
    inst.sourceId === 'standalone' &&
    !!inst.bundledTemplateId &&
    inst.downloadTemplateModels === true &&
    (inst.bundledTemplateSizeBytes ?? 0) > 0 &&
    !!inst.pendingTemplateOpen &&
    getTemplateDownloadState(installationId) !== undefined

  /** Enabled custom-node count for the "X of Y" launch detail. Best-effort
   *  one-shot scan; 0 (scan failed/none) → the tracker shows a streaming line
   *  instead. */
  let launchNodeCount = 0
  async function scanLaunchNodeCount(): Promise<void> {
    try {
      const scanned = await scanCustomNodes(path.join(inst.installPath, 'ComfyUI'))
      launchNodeCount = scanned.filter((n) => n.enabled).length
    } catch (err) {
      console.warn('Custom-node scan for launch progress failed:', err)
    }
  }

  /** Single launch tracker, armed once and reused. A pre-launch repair arms it
   *  early (so the repair shows as a live step); otherwise the first spawn arms
   *  it. `start()` emits the steps payload + enters the first phase exactly
   *  once — re-arming on a relaunch would reset the stepper. */
  let launchTracker: LaunchProgressTracker | null = null
  async function armLaunchTracker(): Promise<LaunchProgressTracker> {
    if (launchTracker) return launchTracker
    await scanLaunchNodeCount()
    launchTracker = createLaunchProgressTracker({
      phases: buildLaunchPhases(inst, { preLaunchPhases, templateModels: showTemplatePhase }),
      nodeCount: launchNodeCount,
      sendProgress,
      // Buffer per-phase entry timings in memory. They are emitted as
      // `boot_phase` events ONLY if the boot later fails/times out (paired
      // with `boot_failed`); a healthy boot discards them — `boot_started`
      // is already ~258k/14d and per-phase emits on every boot would be pure
      // volume. See `bootPhaseBuffer`.
      onPhaseEnter: (phase) => recordBootPhase(installationId, phase)
    })
    launchTracker.start()
    return launchTracker
  }

  // Wraps launch setup that runs AFTER the launching marker (and possibly the
  // port reservation) exists but BEFORE the normal failure handling is
  // reachable; an unexpected throw there must tear those down, not leak them.
  async function guardLaunchSetup<T>(
    step: () => Promise<T> | T,
    opts: { port?: number; logStream?: WriteStream } = {}
  ): Promise<T> {
    try {
      return await step()
    } catch (err) {
      _cleanupFailedLaunchSetup(installationId, abort, opts)
      throw err
    }
  }

  // Log stream + telemetry taps + progress tracker, grouped so a throw partway
  // through closes the already-opened log stream. The tracker is armed once -
  // a pre-launch repair may have armed it already; re-arming would re-emit
  // steps and reset the stepper.
  async function acquireLaunchResources(): Promise<{
    logStream: WriteStream
    execTap: ReturnType<typeof createExecutionTap>
    hwTap: ReturnType<typeof createHardwareTap>
    tracker: LaunchProgressTracker
  }> {
    const logStream = await openLogStream(inst.installPath)
    try {
      const execTap = createExecutionTap({
        installationId,
        variant: (inst.variant as string | undefined) ?? null,
        release: (inst.release as string | undefined) ?? null
      })
      const hwTap = createHardwareTap({
        installationId,
        variant: (inst.variant as string | undefined) ?? null,
        release: (inst.release as string | undefined) ?? null
      })
      const tracker = await armLaunchTracker()
      return { logStream, execTap, hwTap, tracker }
    } catch (err) {
      logStream.end()
      throw err
    }
  }

  // Migrate legacy envs/default/ → ComfyUI/.venv/ for standalone installs.
  if (inst.sourceId === 'standalone') {
    // Recover from an update/restore interrupted by a hard process kill (power
    // loss, taskkill): if a marker survived, roll ComfyUI's source back to the
    // pre-op commit so we never launch new source against stale packages. Safe
    // here: the _operationAborts guard above rules out a concurrent operation,
    // and recovery is a no-op when HEAD already matches the recorded commit.
    // Capture the recovery narration so it can be surfaced to the user on the
    // failure path, not just dropped into the main-process log.
    const recoveryLog: string[] = []
    try {
      const recovered = await recoverInterruptedComfyOp(
        inst.installPath,
        (text) => {
          recoveryLog.push(text)
          console.log(text.trim())
        },
        // A real source rollback ran — lead the launch progress with a
        // "Repairing installation…" step. Fires only for a genuine repair,
        // never a benign marker cleanup.
        () => {
          preLaunchPhases.push('repair')
        }
      )
      if (recovered) inst = (await installations.get(installationId)) || inst
    } catch (err) {
      // Recovery threw because the source rollback failed: launching now would run
      // new source against stale packages (the crash we're preventing). Fail
      // closed; the marker is left in place so the next launch retries.
      console.warn('Interrupted-operation recovery failed:', err)
      const detail = recoveryLog.join('').trim()
      const base = i18n.t('errors.recoveryFailed', { message: (err as Error).message })
      return { ok: false, message: detail ? `${base}\n\n${detail}` : base }
    }
    const updateFn = async (data: Record<string, unknown>): Promise<unknown> =>
      installations.update(installationId, data)
    try {
      const migrated = await migrateEnvLayout(inst.installPath, updateFn)
      if (migrated) inst = (await installations.get(installationId)) || inst
    } catch (err) {
      console.warn('Env layout migration failed:', err)
    }
    // Recover a PyTorch stack change that died mid-transaction: restore the
    // backed-up venv so we never launch a half-swapped env. A failed rollback
    // fails the launch closed — reconciliation/repair/ComfyUI must not run
    // against a venv in an unknown state (the backup remains for retry).
    try {
      const { recoverTorchStackTransaction } =
        await import('../../../sources/standalone/torchStackTransaction')
      await recoverTorchStackTransaction(inst)
    } catch (err) {
      console.warn('PyTorch stack transaction recovery failed:', err)
      return {
        ok: false,
        message: i18n.t('errors.recoveryFailed', { message: (err as Error).message })
      }
    }
    // Recover a torch-family swap (startup repair) that died mid-rename: an
    // uncommitted swap's backups hold the only good copies of the live venv's
    // torch packages, so a failed rollback fails the launch closed too - the
    // marker stays behind for the next attempt.
    try {
      const { recoverTorchFamilyBackups } =
        await import('../../../sources/standalone/torchFamilyFs')
      const { findSitePackages } = await import('../../../sources/standalone/envPaths')
      const { getActiveVenvDir } = await import('../../pythonEnv')
      const liveSite = findSitePackages(getActiveVenvDir(inst))
      if (liveSite) await recoverTorchFamilyBackups(liveSite)
    } catch (err) {
      console.warn('PyTorch family swap recovery failed:', err)
      return {
        ok: false,
        message: i18n.t('errors.recoveryFailed', { message: (err as Error).message })
      }
    }
    // Reconcile the persisted stack state with what's actually in the venv
    // (e.g. a manual terminal install). Never mutates the venv; must run
    // before repair so repair sees up-to-date verified/observed state. If it
    // fails, `lastVerifiedTorchStack` may be stale (e.g. persisted by a torch
    // change that was rolled back) — skip repair for this launch rather than
    // let it trust that ref as an acquisition source. Repair is optional;
    // launching the un-repaired venv is safer than repairing on bad metadata.
    let stackStateTrusted = true
    // Captured BEFORE reconciliation: on a damaged venv reconciliation clears
    // the verified ref (the installed tuple no longer matches it), but repair
    // needs that ref to restore the stack the user actually chose instead of
    // reverting to the install-time bundle.
    let preReconcileVerified: PersistedTorchStack | null = null
    try {
      const { reconcileTorchStack, getLastVerifiedTorchStack } =
        await import('../../../sources/standalone/torchStackCatalog')
      preReconcileVerified = getLastVerifiedTorchStack(inst)
      await reconcileTorchStack(inst, updateFn)
      inst = (await installations.get(installationId)) || inst
    } catch (err) {
      console.warn('PyTorch stack reconciliation failed:', err)
      stackStateTrusted = false
    }
    // One-time repair for installs damaged by the brief `--upgrade` window that
    // replaced bundled GPU torch with a CPU build. Non-fatal: CPU torch still
    // runs, so a failed repair must never block launch (it retries next time).
    // Runs under the launch's own abort controller (already in
    // `_operationAborts`, held for the whole handler), so cancelling the
    // launch cancels the repair too and no second operation can overlap it.
    if (stackStateTrusted) {
      try {
        const { maybeRepairTorch, getTorchVendorMismatch } =
          await import('../../../sources/standalone/torchRepair')
        // Arm the launch stepper BEFORE the (slow, multi-GB) copy so it shows as a
        // live `torchRepair` step rather than flashing a flat status. Detection is
        // a cheap sync check; arming only when a repair will actually run.
        if (getTorchVendorMismatch(inst)) {
          preLaunchPhases.push('torchRepair')
          await armLaunchTracker()
        }
        const repaired = await maybeRepairTorch(
          inst,
          {
            sendProgress,
            sendOutput: makeSendOutput(event.sender, installationId),
            update: updateFn,
            signal: abort.signal
          },
          { preReconcileVerified }
        )
        if (repaired) inst = (await installations.get(installationId)) || inst
      } catch (err) {
        if (abort.signal.aborted) {
          return { ok: false, cancelled: true }
        }
        console.warn('PyTorch vendor repair failed:', err)
      }
    }
    await writeComfyEnvironment(path.join(inst.installPath, 'ComfyUI'))
  }
  // The standalone prep above (recovery, migration, torch repair) is the
  // longest pre-spawn stretch; a restart clicked during it must not spawn.
  if (abort.signal.aborted) return { ok: false, cancelled: true }

  const launchStartedAt = Date.now()
  const launchCmdRaw = source.getLaunchCommand(inst)
  if (!launchCmdRaw) {
    return { ok: false, message: i18n.t('errors.noEnvFound') }
  }
  const launchCmd = launchCmdRaw

  // Filter unsupported args, then inject desktop-managed feature flags.
  if (launchCmd.cmd && launchCmd.args && launchCmd.cwd) {
    const sIdx = launchCmd.args.indexOf('-s')
    if (sIdx !== -1 && sIdx + 1 < launchCmd.args.length) {
      const mainPyRel = launchCmd.args[sIdx + 1]!
      const mainPyAbs = path.resolve(launchCmd.cwd, mainPyRel)
      const revision = inst.comfyVersion?.commit ?? (inst.version as string | undefined)
      try {
        const schema = await getComfyArgsSchema(
          launchCmd.cmd,
          mainPyAbs,
          launchCmd.cwd,
          installationId,
          revision
        )
        const prefixArgs = launchCmd.args.slice(0, sIdx + 2)
        const userArgs = launchCmd.args.slice(sIdx + 2)
        const filtered = filterUnsupportedArgs(userArgs, schema)
        const canaryConfig = await getCoreCanaryConfigAsync()
        let canaryEligible = isCoreCanaryEligible(canaryConfig, inst)
        if (
          canaryEligible &&
          !canaryConfig.includeExistingInstalls &&
          typeof inst.coreCanaryEnrolledAt !== 'string'
        ) {
          // Persist only genuinely new-install enrollment. If this write
          // fails, skip remote flags for this launch rather than applying a
          // canary we cannot keep stable across restarts.
          try {
            const coreCanaryEnrolledAt = new Date().toISOString()
            const updated = await installations.update(installationId, { coreCanaryEnrolledAt })
            if (updated) inst = updated
            else canaryEligible = false
          } catch (err) {
            canaryEligible = false
            console.warn('[core-canary] Failed to persist new-install enrollment:', err)
          }
        }
        const coreCanaryArgs = canaryEligible
          ? resolveCoreCanaryLaunchArgs(canaryConfig, schema, filtered)
          : []
        if (coreCanaryArgs.length > 0) {
          console.info('[core-canary] Injecting Core beta feature flags:', coreCanaryArgs)
        }

        // Skip when the discovery flag is absent (avoids a pointless python spawn).
        const desktopFlagArgs: string[] = []
        if (schema.knownFlags.has('feature-flag') && schema.knownFlags.has('list-feature-flags')) {
          const registry = await getComfyFeatureFlagRegistry(
            launchCmd.cmd,
            mainPyAbs,
            launchCmd.cwd,
            installationId,
            revision
          )
          const flagEntries = Object.entries(
            desktopFeatureFlags(inst, settings.get('telemetryEnabled') === true)
          )
          for (const [key, value] of flagEntries) {
            if (key in registry) {
              desktopFlagArgs.push('--feature-flag', `${key}=${value}`)
            }
          }
        }

        // Canary args precede user args, and the resolver omits any feature
        // the user already controls (same flag, --disable-* opposite, or an
        // argparse-exclusive peer).
        launchCmd.args = [...prefixArgs, ...coreCanaryArgs, ...desktopFlagArgs, ...filtered]
      } catch {
        // Schema not available — pass args as-is.
      }
    }
  }
  // Schema/feature-flag discovery spawns Python and can take seconds; another
  // pre-spawn stretch a restart must be able to cancel out of.
  if (abort.signal.aborted) return { ok: false, cancelled: true }

  // Fail closed: launching after a failed config write would run Manager
  // with stale security settings while the UI claims the chosen values.
  const managerReconcile = await reconcileManagerConfigForLaunch({
    remote: Boolean(launchCmd.remote),
    installPath: inst.installPath,
    securityLevel: inst.managerSecurityLevel,
    networkMode: inst.managerNetworkMode
  })
  if (!managerReconcile.ok) {
    return { ok: false, message: i18n.t('errors.managerConfigWriteFailed') }
  }

  const { preLaunchExtras, manageModelFolders, modelDirsForLaunch, modelSyncOptions } =
    applyStorageLaunchArgs(inst, installationId, launchCmd)

  /** Pipe a spawned process's output to the log file, renderer, execution tap,
   *  and the launch tracker (ANSI-stripped); returns a bounded stderr tail for
   *  crash diagnostics. */
  function attachLaunchStreams(
    proc: ChildProcess,
    logStream: WriteStream,
    sendOutput: (text: string) => void,
    execTap: ReturnType<typeof createExecutionTap>,
    hwTap: ReturnType<typeof createHardwareTap>,
    tracker: LaunchProgressTracker
  ): { getStderr: () => string } {
    let stderrBuf = ''
    proc.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8')
      writeLog(logStream, text)
      sendOutput(text)
      execTap.ingest(text, 'stdout')
      hwTap.ingest(text, 'stdout')
      tracker.ingest(stripAnsi(text))
    })
    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8')
      // Strip ANSI once for both the tail buffer and the launch tracker.
      const clean = stripAnsi(text)
      stderrBuf += clean
      if (stderrBuf.length > 16 * 1024) stderrBuf = stderrBuf.slice(-(16 * 1024))
      writeLog(logStream, text)
      sendOutput(text)
      execTap.ingest(text, 'stderr')
      hwTap.ingest(text, 'stderr')
      tracker.ingest(clean)
    })
    return { getStderr: () => stderrBuf }
  }

  /** Gates the `template-models` reader: the bar derives "prior steps done" from
   *  the active phase index, so the reader stays silent through the real phases
   *  and only drives the trailing download row once the server is reachable.
   *  Flipped true by `waitForTemplateDownloadGate()` at port-ready. */
  let serverUp = false

  // Single 500 ms reader for the `template-models` phase — paces the display only
  // (bytes flow in the background task; logs are emitted there, not here).
  if (showTemplatePhase) {
    void (async (): Promise<void> => {
      // A pre-completed phase reports indeterminate (emitting 100 into its slot
      // would fill it in one frame and leap the bar); a live download reports
      // real percent so the bar advances with the bytes.
      let firstEmittedTick = true
      let preCompleted = false
      const tick = (): boolean => {
        if (!serverUp) return false
        const state = getTemplateDownloadState(installationId)
        if (!state) return true
        const summary = summarizeTemplateState(state)
        const terminal =
          summary.status === 'done' || summary.status === 'error' || summary.status === 'cancelled'
        if (firstEmittedTick) {
          firstEmittedTick = false
          preCompleted = terminal
        }
        const percent = preCompleted
          ? -1
          : terminal
            ? -1
            : Math.min(99, Math.max(0, summary.percent))
        sendProgress('template-models', {
          percent,
          status: formatTemplateSubStatus(summary),
          error: summary.status === 'error'
        })
        return terminal
      }
      while (!abort.signal.aborted) {
        if (tick()) return
        const done = await new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => {
            abort.signal.removeEventListener('abort', onAbort)
            resolve(false)
          }, 500)
          const onAbort = (): void => {
            clearTimeout(timer)
            resolve(true)
          }
          abort.signal.addEventListener('abort', onAbort, { once: true })
        })
        if (done) return
      }
    })()
  }

  /** Abortable sleep used by the failure countdown. Resolves early on abort. */
  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        abort.signal.removeEventListener('abort', onAbort)
        resolve()
      }, ms)
      const onAbort = (): void => {
        clearTimeout(timer)
        resolve()
      }
      abort.signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  /**
   * Hold the ComfyUI reveal until the template-model download settles, so the
   * (last) download step is genuinely shown and its "Skip & open ComfyUI" footer
   * button is actionable instead of flashing past on port-ready.
   *
   *   - still running → wait (the 500 ms reader keeps the substatus live; Skip
   *     resolves the wait via `requestSkipTemplateDownload`)
   *   - done / skipped / cancelled / aborted → proceed immediately
   *   - error (after the task's 2× retries) → show a clear "failed, retry later"
   *     line + a 3·2·1 countdown, then proceed
   *
   * No-op (returns at once) when there's no template phase or nothing is running.
   */
  async function waitForTemplateDownloadGate(): Promise<void> {
    if (!showTemplatePhase) return
    // Release the reader (it held silent through the real phases). Set before the
    // early-returns so the pre-done case still paints the final "models ready" row.
    serverUp = true

    const state = getTemplateDownloadState(installationId)
    if (!state) return
    // Already failed by gate entry (e.g. resolve threw before the server was up,
    // while the reader was muted): surface it now, then run the countdown — the
    // reader's first post-`serverUp` tick could be up to 500 ms away.
    const failedAlready = state.status === 'error'
    if (isTemplateDownloadTerminal(state.status) && !failedAlready) return

    if (!failedAlready) {
      const reason = await awaitTemplateDownloadSettled(installationId, abort.signal)
      if (reason !== 'error' || abort.signal.aborted) return
    }

    // Failed for real: count down into ComfyUI so the user notices the failure
    // before the view swaps.
    for (let secs = 3; secs >= 1; secs--) {
      if (abort.signal.aborted) return
      sendProgress('template-models', {
        percent: -1,
        error: true,
        status: i18n.t('standalone.templateModelsFailedCountdown', { secs })
      })
      await delay(1000)
    }
  }

  // Remote connection
  if (launchCmd.remote) {
    // Display the host only — the full `launchCmd.url` may carry UTM params
    // that do not belong in user-facing status. `waitForUrl` gets the real URL.
    const displayUrl = displayLaunchUrl(launchCmd.url || '')
    sendProgress('launch', {
      percent: -1,
      status: i18n.t('launch.connecting', { url: displayUrl })
    })
    try {
      await waitForUrl(launchCmd.url!, {
        timeoutMs: 15000,
        signal: abort.signal,
        onPoll: ({ elapsedMs }) => {
          const secs = Math.round(elapsedMs / 1000)
          sendProgress('launch', {
            percent: -1,
            status: i18n.t('launch.connectingTime', { url: displayUrl, secs })
          })
        }
      })
    } catch (_err) {
      if (_operationAborts.get(installationId) === abort) _operationAborts.delete(installationId)
      if (abort.signal.aborted) return { ok: false, cancelled: true }
      return { ok: false, message: i18n.t('errors.cannotConnect', { url: displayUrl }) }
    }

    if (_operationAborts.get(installationId) === abort) _operationAborts.delete(installationId)
    const mode = (inst.launchMode as string | undefined) || 'window'
    _addSession(
      installationId,
      { proc: null, port: launchCmd.port!, url: launchCmd.url, mode, installationName: inst.name },
      Date.now() - launchStartedAt
    )
    if (_onLaunch) {
      _onLaunch({
        port: launchCmd.port!,
        url: launchCmd.url,
        process: null,
        installation: inst,
        mode
      })
    }
    return { ok: true, mode, port: launchCmd.port, url: launchCmd.url }
  }

  // Local process launch
  if (!fs.existsSync(launchCmd.cmd!)) {
    if (_operationAborts.get(installationId) === abort) _operationAborts.delete(installationId)
    return { ok: false, message: i18n.t('errors.executableNotFound', { cmd: launchCmd.cmd ?? '' }) }
  }

  // Skip port logic entirely
  if (launchCmd.skipPortWait) {
    const sendOutput = makeSendOutput(sender, installationId)
    const launchEnv = buildLaunchEnv(inst)

    // Marked inside the guard: even the marker's renderer broadcast can
    // throw, and every throw after the marker exists must clear it before
    // the handler settles.
    const { logStream, execTap, hwTap, tracker } = await guardLaunchSetup(() => {
      _markLaunching(installationId, inst.name)
      return acquireLaunchResources()
    })

    // Last pre-spawn cancellation point on this path: a launch cancelled
    // during the awaits above must never spawn.
    if (abort.signal.aborted) {
      logStream.end()
      _clearLaunchingFailed(installationId)
      return { ok: false, cancelled: true }
    }

    const { proc, getStderr } = await guardLaunchSetup(
      async () => {
        hwTap.beginBoot()
        const p = spawnProcess(launchCmd.cmd!, launchCmd.args!, launchCmd.cwd!, launchEnv, {
          showWindow: launchCmd.showWindow
        })
        try {
          return {
            proc: p,
            ...attachLaunchStreams(p, logStream, sendOutput, execTap, hwTap, tracker)
          }
        } catch (err) {
          // Stream wiring failed: kill and WAIT for the child so the settled
          // handler can't outlive a live process.
          await killProcessTree(p)
          throw err
        }
      },
      { logStream }
    )

    if (_operationAborts.get(installationId) === abort) _operationAborts.delete(installationId)
    const mode = (inst.launchMode as string | undefined) || 'window'
    _addSession(
      installationId,
      {
        proc,
        port: 0,
        mode,
        installationName: inst.name,
        flushTelemetry: () => {
          execTap.flushSummary()
          hwTap.flushSummary()
        }
      },
      Date.now() - launchStartedAt
    )

    onProcessTerminated(proc, async (code, signal) => {
      logStream.end()
      const crashed = _runningSessions.has(installationId) && isCrashedExit(code, signal)
      // Raw stderr — this payload is shown to the user in the crashed-state
      // lifecycle UI. PII scrubbing happens on the telemetry path
      // (`scrubTelemetryContext` in renderer bootstrap), not here.
      const lastStderr = lastNLines(getStderr(), 100)
      execTap.flushSummary()
      hwTap.flushSummary()
      // Run the (awaited) crash diagnosis BEFORE releasing the session, so a
      // relaunch can't slip in and clearCrash() during the audit and have this
      // handler then resurrect the stale crash via recordCrash().
      const crashDiagnosis = crashed ? await diagnoseCrash(code) : {}
      _removeSession(installationId)
      const exitedPayload = {
        installationId,
        crashed,
        exitCode: code ?? undefined,
        signal: signal ?? undefined,
        installationName: inst.name,
        lastStderr,
        ...crashDiagnosis
      }
      // Emit from main so it survives the Desktop 2 panel teardown on exit.
      // `emit` = PostHog + Datadog crash-rate monitor; `last_stderr` is scrubbed.
      telemetry.emit('comfy.desktop.comfyui.exited', {
        installation_id: installationId,
        crashed,
        exit_code: code ?? null,
        last_stderr: lastStderr ?? null
      })
      if (crashed) {
        recordCrash(exitedPayload)
        // Broadcast to every renderer (not just `sender`) so any already-open
        // dashboard shows the red error tile live.
        _broadcastToRenderer('instance-crashed', exitedPayload)
      }
      if (!sender.isDestroyed()) {
        sender.send('comfy-exited', exitedPayload)
      }
      if (_onComfyExited) _onComfyExited({ installationId, crashed })
    })

    if (_onLaunch) {
      _onLaunch({ port: 0, process: proc, installation: inst, mode })
    }
    return { ok: true, mode }
  }

  if (actionData?.portOverride != null) {
    setPortArg(launchCmd as LaunchCmd, actionData.portOverride as number)
  }

  const defaults = source.getDefaults ? source.getDefaults() : {}
  const portConflictMode =
    (inst.portConflict as string | undefined) ||
    (defaults.portConflict as string | undefined) ||
    'auto'
  const userArgs = ((inst.launchArgs as string | undefined) || '').trim()
  const portIsExplicit =
    actionData?.portOverride != null || /(?:^|\s)--port(?:\s|=|$)/.test(userArgs)

  // isPortListening (bind test) is the primary check; findPidsByPort's lsof
  // only sees same-user processes on Linux.
  const pendingPortOwner = _pendingPorts.get(launchCmd.port!)
  const portBusy = !pendingPortOwner && (await isPortListening(launchCmd.port!))
  const existingPids = pendingPortOwner || !portBusy ? [] : await findPidsByPort(launchCmd.port!)
  const portOccupied = !!pendingPortOwner || portBusy

  if (portOccupied) {
    const reservedPorts = new Set(_pendingPorts.keys())
    let nextPort: number | null = null
    try {
      nextPort = await findAvailablePort(
        '127.0.0.1',
        launchCmd.port! + 1,
        launchCmd.port! + 1000,
        reservedPorts
      )
    } catch {}

    if (portConflictMode === 'auto' && nextPort && !portIsExplicit) {
      sendProgress('launch', {
        percent: -1,
        status: i18n.t('launch.portBusyUsing', { old: launchCmd.port!, new: nextPort })
      })
      setPortArg(launchCmd as LaunchCmd, nextPort)
    } else {
      let message: string
      let isComfy: boolean
      if (pendingPortOwner) {
        message = i18n.t('errors.portConflictLauncher', {
          port: launchCmd.port!,
          name: pendingPortOwner
        })
        isComfy = true
      } else {
        const lock = readPortLock(launchCmd.port!)
        if (lock) {
          message = i18n.t('errors.portConflictLauncher', {
            port: launchCmd.port!,
            name: lock.installationName
          })
          isComfy = true
        } else if (existingPids.length > 0) {
          const info = await getProcessInfo(existingPids[0]!)
          isComfy = looksLikeComfyUI(info)
          const processDesc = info ? info.name : `PID ${existingPids[0]}`
          message = isComfy
            ? i18n.t('errors.portConflictComfy', { port: launchCmd.port!, process: processDesc })
            : i18n.t('errors.portConflictOther', { port: launchCmd.port!, process: processDesc })
        } else {
          // Busy but the owner is unidentifiable (e.g. other-user process on Linux).
          isComfy = false
          message = i18n.t('errors.portConflictOther', {
            port: launchCmd.port!,
            process: i18n.t('errors.unknownProcess')
          })
        }
      }
      if (_operationAborts.get(installationId) === abort) _operationAborts.delete(installationId)
      return {
        ok: false,
        message,
        portConflict: { port: launchCmd.port, pids: existingPids, isComfy, nextPort }
      }
    }
  }

  // Synchronous re-check: TOCTOU gap
  const lateConflictOwner = _pendingPorts.get(launchCmd.port!)
  if (lateConflictOwner) {
    const reservedPorts = new Set(_pendingPorts.keys())
    let nextPort: number | null = null
    try {
      nextPort = await findAvailablePort(
        '127.0.0.1',
        launchCmd.port! + 1,
        launchCmd.port! + 1000,
        reservedPorts
      )
    } catch {}

    if (portConflictMode === 'auto' && nextPort && !portIsExplicit) {
      sendProgress('launch', {
        percent: -1,
        status: i18n.t('launch.portBusyUsing', { old: launchCmd.port!, new: nextPort })
      })
      setPortArg(launchCmd as LaunchCmd, nextPort)
    } else {
      if (_operationAborts.get(installationId) === abort) _operationAborts.delete(installationId)
      return {
        ok: false,
        message: i18n.t('errors.portConflictLauncher', {
          port: launchCmd.port!,
          name: lateConflictOwner
        }),
        portConflict: { port: launchCmd.port, pids: [], isComfy: true, nextPort }
      }
    }
  }

  // The port probes above are the last pre-marker awaits; don't reserve a
  // port or set the launching marker for a launch that was already cancelled.
  if (abort.signal.aborted) return { ok: false, cancelled: true }

  // Session path / env / progress plumbing before the port is reserved, so a
  // throw here has nothing to clean up yet.
  const sessionPath = createSessionPath()
  const launchEnv = buildLaunchEnv(inst, sessionPath)
  const sendOutput = makeSendOutput(sender, installationId)

  // Port reservation and launching marker sit INSIDE the guard: even the
  // marker's renderer broadcast can throw, and every throw after either
  // exists must tear them back down before the handler settles. Pre-armed
  // tracker so the synchronous relaunch loop can reuse the single instance.
  const { logStream, execTap, hwTap, tracker } = await guardLaunchSetup(
    () => {
      _reservePort(launchCmd.port!, inst.name)
      _markLaunching(installationId, inst.name)
      return acquireLaunchResources()
    },
    { port: launchCmd.port! }
  )

  async function spawnComfy(): Promise<{ proc: ChildProcess; getStderr: () => string }> {
    // Reset per-boot accelerator state so each (re)spawn re-emits
    // accelerator_detected.
    hwTap.beginBoot()
    const p = spawnProcess(launchCmd.cmd!, launchCmd.args!, launchCmd.cwd!, launchEnv, {
      showWindow: launchCmd.showWindow
    })
    try {
      return { proc: p, ...attachLaunchStreams(p, logStream, sendOutput, execTap, hwTap, tracker) }
    } catch (err) {
      // Stream wiring failed: kill and WAIT for the child so cleanup can't
      // outlive a live process.
      await killProcessTree(p)
      throw err
    }
  }

  const PORT_RETRY_MAX = 3
  const REBOOT_RETRY_MAX = 5
  let portRetries = 0
  let rebootRetries = 0
  // One id per logical boot, reused across port/reboot retries (tryLaunch
  // recurses), so boot_started→boot_completed joins per-attempt, not per-machine.
  const bootId = randomUUID()

  const tryLaunch = async (): Promise<
    | { ok: true; proc: ChildProcess; getStderr: () => string }
    | {
        ok: false
        message: string
        cancelled?: boolean
        stderr?: string
        exitCode?: number | null
        signal?: string | null
      }
  > => {
    // E2E-only: parks the launch here - launching marker set, port reserved,
    // no process yet - so tests can exercise restart-during-boot without
    // racing real boot speed. No-op in production and when not armed.
    await waitLaunchSpawnHold(abort.signal)
    // A cancel that landed during the awaits since the marker was set (log
    // stream open, tracker arming, the E2E hold) must never spawn. Returning
    // the cancelled shape routes through the standard failure cleanup below
    // (port release, marker clear).
    if (abort.signal.aborted) {
      return { ok: false, message: 'Launch cancelled', cancelled: true }
    }
    const cmdLine = [launchCmd.cmd!, ...launchCmd.args!]
      .map((a, ci, ca) => {
        if (ci > 0 && SENSITIVE_ARG_RE.test(ca[ci - 1]!)) return '"***"'
        return /\s/.test(a) ? `"${a}"` : a
      })
      .join(' ')
    sendProgress('launch', { percent: -1, status: i18n.t('launch.starting') })
    if (!sender.isDestroyed()) {
      sender.send('comfy-output', { installationId, text: `> ${cmdLine}\n\n` })
    }
    appendLog(installationId, `> ${cmdLine}\n\n`)
    // Explicit boot-attempt event. `installation_started` already fires
    // on successful boot with `boot_time_ms`, and `comfyui.exited` carries
    // `crashed=true` on failure — but boot success rate needed inferred
    // counts from those two events. Emitting `boot_started` makes it a
    // single division (`installation_started / boot_started`) and surfaces
    // retries (port_retry / reboot_retry counters) directly.
    telemetry.capture('comfy.desktop.comfyui.boot_started', {
      installation_id: installationId,
      boot_id: bootId,
      variant: (inst.variant as string | undefined) ?? null,
      port_retry_count: portRetries,
      reboot_retry_count: rebootRetries
    })
    // Begin (re)buffering per-phase timings for THIS attempt. On a port /
    // reboot retry this resets so the buffer reflects the attempt that
    // actually fails (or succeeds). The tracker's `onPhaseEnter` feeds it;
    // it is flushed only on the terminal failure path below.
    startBootPhases(installationId, (inst.variant as string | undefined) ?? null)
    // Re-arm per-attempt phase observation: the UI tracker's index is
    // monotonic across retries, so without this the respawned boot's re-hit
    // milestones would never reach the fresh buffer above.
    tracker.resetPhaseObservation()
    const spawned = await spawnComfy()

    let earlyExit: string | null = null
    // Exit code / signal of an early process exit, surfaced on `boot_failed`
    // so the failure carries WHY the process died, not just that it did.
    let exitCode: number | null = null
    let exitSignal: string | null = null
    const earlyExitPromise = new Promise<void>((_resolve, reject) => {
      spawned.proc.on('error', (err: Error) => {
        const code = (err as NodeJS.ErrnoException).code
          ? ` (${(err as NodeJS.ErrnoException).code})`
          : ''
        earlyExit = err.message
        reject(new Error(`Failed to start${code}: ${launchCmd.cmd}`))
      })
      onProcessTerminated(spawned.proc, async (code, signal) => {
        exitCode = code
        exitSignal = signal
        if (!earlyExit) {
          const detail = spawned.getStderr().trim() ? `\n\n${spawned.getStderr().trim()}` : ''
          // A startup crash (e.g. a C-extension segfault during import) is the
          // most common access-violation case; decode the cryptic NTSTATUS code
          // and add the VC++ hint inline so the launch-failure modal is useful.
          // A signal-kill (code null) reports the signal name instead.
          const rendered = signal ? `signal ${signal}` : `code ${await describeExitCode(code)}`
          earlyExit = `Process exited with ${rendered}${detail}`
          reject(new Error(earlyExit))
        }
      })
    })

    // No flat `launch.waiting` progress here: the log-driven stepped phases
    // own this window. A flat update would race the `startingServer` phase
    // and flash an indeterminate "(secs)" caption, reflowing the layout.
    try {
      await Promise.race([
        waitForPort(launchCmd.port!, '127.0.0.1', {
          timeoutMs: COMFY_BOOT_TIMEOUT_MS,
          signal: abort.signal
        }),
        earlyExitPromise
      ])
      // The port wait can resolve successfully even after an abort (a probe
      // already in flight when the signal fired still calls back). Returning
      // ok would register the cancelled process as a running session, so
      // route it through the abort teardown in the catch below instead.
      if (abort.signal.aborted) throw new Error('Launch cancelled')
      return { ok: true, proc: spawned.proc, getStderr: spawned.getStderr }
    } catch (err) {
      // A user abort (cancel, or restart-during-boot) is terminal: kill the
      // spawn and WAIT for it to die before returning, so the launching
      // marker and operation slot are only cleared after the process has
      // released its port and a caller like `cancelLaunching` can relaunch
      // safely. Checked before the retry paths below - an aborted boot must
      // never respawn via the reboot/port retries.
      if (abort.signal.aborted) {
        await killProcessTree(spawned.proc)
        return {
          ok: false,
          message: (err as Error).message,
          cancelled: true,
          stderr: spawned.getStderr(),
          exitCode,
          signal: exitSignal
        }
      }
      // WAIT for the failed spawn's whole tree to die before any retry below:
      // the reboot path reuses the same port, and an overlapping old process
      // can hold it (or its stream handlers) into the replacement's boot.
      await killProcessTree(spawned.proc)
      if (checkRebootMarker(sessionPath) && rebootRetries < REBOOT_RETRY_MAX) {
        rebootRetries++
        sendOutput('\n--- Manager requested restart during startup, respawning… ---\n\n')
        return tryLaunch()
      }
      const stderr = spawned.getStderr().toLowerCase()
      const isPortConflict =
        stderr.includes('address already in use') ||
        (stderr.includes('port') && stderr.includes('in use'))
      // Auto-switching ports is only allowed under the same policy as the
      // pre-launch conflict checks: never override an explicitly chosen port,
      // and never switch when the conflict mode is not 'auto'.
      if (
        isPortConflict &&
        portConflictMode === 'auto' &&
        !portIsExplicit &&
        portRetries < PORT_RETRY_MAX
      ) {
        portRetries++
        try {
          const reservedPorts = new Set(_pendingPorts.keys())
          const retryPort = await findAvailablePort(
            '127.0.0.1',
            launchCmd.port! + 1,
            launchCmd.port! + 1000,
            reservedPorts
          )
          sendOutput(`\nPort ${launchCmd.port} in use, retrying on port ${retryPort}…\n`)
          _releasePort(launchCmd.port!)
          setPortArg(launchCmd as LaunchCmd, retryPort)
          _reservePort(launchCmd.port!, inst.name)
          return tryLaunch()
        } catch {}
      }
      // Carry the in-memory stderr tail + exit info out so `boot_failed` can
      // report the actual error. The buffer lives in main (survives a hard
      // child crash) but was previously discarded on the failure path.
      const failureStderr = spawned.getStderr()
      return {
        ok: false,
        message: (err as Error).message,
        stderr: failureStderr,
        exitCode,
        signal: exitSignal
      }
    }
  }

  // A throw that escapes tryLaunch (sync spawn failure, telemetry, boot-phase
  // buffering) must still route through the standard failure cleanup below -
  // port release, marker clear, operation-slot release.
  const launchResult = await tryLaunch().catch(
    (err: unknown): Awaited<ReturnType<typeof tryLaunch>> => ({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      ...(abort.signal.aborted ? { cancelled: true } : {})
    })
  )
  if (!launchResult.ok) {
    logStream.end()
    _releasePort(launchCmd.port!)
    // Ownership-guarded: never evict a slot a newer operation already claimed.
    if (_operationAborts.get(installationId) === abort) _operationAborts.delete(installationId)
    abort.abort() // stop the template-models reader timer on launch failure
    _clearLaunchingFailed(installationId)
    // Flush the hardware tap on terminal failure/cancel too: the exit handler
    // covers a process that exits, but a waitForPort timeout can return here
    // with the proc still alive, leaving a pending accelerator event unemitted.
    // flushSummary is idempotent, so a later exit re-flush is harmless.
    hwTap.flushSummary()
    if (launchResult.cancelled) {
      // User-initiated cancel is not a boot failure — discard the buffer so a
      // later relaunch starts clean and we don't emit phantom boot_phase rows.
      clearBootPhases(installationId)
      return { ok: false, cancelled: true }
    }
    execTap.flushSummary()
    // Terminal boot failure (waitForPort timeout or early process exit, after
    // any port/reboot retries were exhausted). Flush the buffered phase
    // timings — they're the breakdown explaining where the boot stalled — then
    // emit the paired boot_failed. `failed_phase` is the last phase the boot
    // reached (null if it never entered one). The error is bucketed; the
    // retry counters surface how many times we re-spawned before giving up.
    const failedPhase = flushBootPhasesOnFailure(installationId)
    // Standard error schema derived from the failure message + the stderr
    // tail (a Python traceback in the tail yields a real `error_class` /
    // `error_message`; otherwise the launch message drives it). `error_tail`
    // carries the last ~40 lines of stderr — where the fatal error prints —
    // scrubbed and capped, so the failure is diagnosable without depending on
    // the separate, unreliable `boot_log` event.
    const tail = errorTail(launchResult.stderr)
    const errorSource = tail
      ? `${launchResult.message}\n${launchResult.stderr}`
      : launchResult.message
    telemetry.emit('comfy.desktop.comfyui.boot_failed', {
      installation_id: installationId,
      boot_id: bootId,
      variant: (inst.variant as string | undefined) ?? null,
      failed_phase: failedPhase,
      ...buildErrorFields(errorSource),
      error_tail: tail,
      exit_code: launchResult.exitCode ?? null,
      signal: launchResult.signal ?? null,
      retry_count: portRetries + rebootRetries,
      port_retry_count: portRetries,
      reboot_retry_count: rebootRetries
    })
    return { ok: false, message: launchResult.message }
  }
  // Healthy boot — discard buffered phase timings (no boot_phase on success;
  // healthy timing is covered by instance_started.boot_time_ms).
  clearBootPhases(installationId)
  let { proc } = launchResult

  _pendingPorts.delete(launchCmd.port!)
  if (_operationAborts.get(installationId) === abort) _operationAborts.delete(installationId)
  const mode = (inst.launchMode as string | undefined) || 'window'
  const bootTimeMs = Date.now() - launchStartedAt
  _addSession(
    installationId,
    {
      proc,
      port: launchCmd.port!,
      mode,
      installationName: inst.name,
      flushTelemetry: () => {
        execTap.flushSummary()
        hwTap.flushSummary()
      }
    },
    bootTimeMs,
    { portRetries, rebootRetries }
  )
  // Paired success terminal for boot_started: server up + session registered.
  // Same boot_id as this launch's boot_started(s), so the boot-success rate is
  // count(boot_completed.boot_id) / count(distinct boot_started.boot_id).
  telemetry.capture('comfy.desktop.comfyui.boot_completed', {
    installation_id: installationId,
    boot_id: bootId,
    variant: (inst.variant as string | undefined) ?? null,
    boot_time_ms: bootTimeMs,
    port_retry_count: portRetries,
    reboot_retry_count: rebootRetries
  })
  writePortLock(launchCmd.port!, { pid: proc.pid!, installationName: inst.name })

  if (!sender.isDestroyed()) {
    // Raw bootStderr — telemetry forwarders scrub it before it leaves the box.
    const bootStderr = lastNLines(launchResult.getStderr(), 50)
    sender.send('comfy-boot-log', { installationId, bootStderr })
  }

  // Capture snapshot in background after successful launch
  if (inst.sourceId === 'standalone') {
    captureSnapshotIfChanged(inst.installPath, inst, 'boot')
      .then(async ({ saved, filename }) => {
        if (saved) {
          const snapshotCount = await getSnapshotCount(inst.installPath)
          installations.update(installationId, { lastSnapshot: filename, snapshotCount })
        }
      })
      .catch((err) => console.warn('Snapshot capture failed:', err))
  }

  // Check if custom nodes created new model folders during startup
  let site1Relaunched = false
  if (manageModelFolders) {
    const { newFolders } = syncCustomModelFolders(
      inst.installPath,
      modelDirsForLaunch,
      preLaunchExtras,
      modelSyncOptions
    )
    if (newFolders.length > 0) {
      sendOutput(`\n--- Restarting: new model folders detected (${newFolders.join(', ')}) ---\n\n`)
      if (_onModelFolderRelaunch) {
        await Promise.resolve(_onModelFolderRelaunch({ installationId })).catch(() => {})
      }
      await killProcessTree(proc)
      const respawned = await spawnComfy()
      proc = respawned.proc
      const session = _runningSessions.get(installationId)
      if (session) session.proc = proc
      writePortLock(launchCmd.port!, { pid: proc.pid!, installationName: inst.name })
      const relaunchEarlyExit = new Promise<void>((_resolve, reject) => {
        proc.on('error', (err: Error) => reject(err))
        onProcessTerminated(proc, (code, signal) => {
          const rendered = signal ? `signal ${signal}` : `code ${code}`
          reject(new Error(`Process exited with ${rendered}`))
        })
      })
      try {
        // Re-armed tracker re-emits stepped phases during this relaunch wait;
        // no flat poll (would race the stepped caption — see above).
        await Promise.race([
          waitForPort(launchCmd.port!, '127.0.0.1', {
            timeoutMs: COMFY_BOOT_TIMEOUT_MS,
            signal: abort.signal
          }),
          relaunchEarlyExit
        ])
      } catch (err) {
        logStream.end()
        await killProcessTree(proc)
        // This relaunch path returns before the normal exit handler is
        // attached; flush so a pending accelerator event isn't dropped.
        // flushSummary is idempotent.
        execTap.flushSummary()
        hwTap.flushSummary()
        _removeSession(installationId)
        _clearLaunchingFailed(installationId)
        if (abort.signal.aborted) return { ok: false, cancelled: true }
        return { ok: false, message: (err as Error).message }
      }
      site1Relaunched = true
    }
  }

  const knownExtras = new Set(
    site1Relaunched ? discoverExtraModelFolders(inst.installPath) : preLaunchExtras
  )
  let pendingModelFolderRelaunch = false
  let rebootModelCheckAbort: AbortController | null = null
  let currentGetStderr = launchResult.getStderr

  function attachExitHandler(p: ChildProcess): void {
    onProcessTerminated(p, async (code, signal) => {
      if (rebootModelCheckAbort) {
        rebootModelCheckAbort.abort()
        rebootModelCheckAbort = null
      }

      if (pendingModelFolderRelaunch || checkRebootMarker(sessionPath)) {
        const isModelRelaunch = pendingModelFolderRelaunch
        pendingModelFolderRelaunch = false
        if (!isModelRelaunch) {
          sendOutput('\n--- ComfyUI restarting ---\n\n')
        }
        if (manageModelFolders) {
          const { config } = syncCustomModelFolders(
            inst.installPath,
            modelDirsForLaunch,
            [],
            modelSyncOptions
          )
          if (config) {
            for (const f of config.extraFolders) knownExtras.add(f)
          }
          if (!isModelRelaunch) {
            knownExtras.clear()
            const freshExtras = discoverExtraModelFolders(inst.installPath)
            for (const f of freshExtras) knownExtras.add(f)
            if (config) {
              for (const f of config.extraFolders) knownExtras.add(f)
            }
          }
        }
        const spawned = await spawnComfy()
        proc = spawned.proc
        currentGetStderr = spawned.getStderr
        const session = _runningSessions.get(installationId)
        if (session) session.proc = proc
        writePortLock(launchCmd.port!, { pid: proc.pid!, installationName: inst.name })
        attachExitHandler(proc)
        if (_onComfyRestarted) _onComfyRestarted({ installationId, process: proc })
        if (manageModelFolders) {
          rebootModelCheckAbort = new AbortController()
          const checkSignal = rebootModelCheckAbort.signal
          waitForPort(launchCmd.port!, '127.0.0.1', {
            timeoutMs: COMFY_BOOT_TIMEOUT_MS,
            signal: checkSignal
          })
            .then(async () => {
              if (checkSignal.aborted) return
              const currentSession = _runningSessions.get(installationId)
              if (!currentSession || currentSession.proc !== proc) return
              const currentExtras = discoverExtraModelFolders(inst.installPath)
              const newFolders = currentExtras.filter((f) => !knownExtras.has(f))
              if (newFolders.length > 0) {
                const { config } = syncCustomModelFolders(
                  inst.installPath,
                  modelDirsForLaunch,
                  [],
                  modelSyncOptions
                )
                if (config) {
                  for (const f of config.extraFolders) knownExtras.add(f)
                }
                for (const f of newFolders) knownExtras.add(f)
                sendOutput(
                  `\n--- Restarting: new model folders detected (${newFolders.join(', ')}) ---\n\n`
                )
                pendingModelFolderRelaunch = true
                if (_onModelFolderRelaunch) {
                  await Promise.resolve(_onModelFolderRelaunch({ installationId })).catch(() => {})
                }
                killProcessTree(proc)
              }
            })
            .catch(() => {})
        }
        // Capture snapshot after Manager-triggered restart
        if (inst.sourceId === 'standalone') {
          installations.get(installationId).then((currentInst) => {
            if (!currentInst) return
            captureSnapshotIfChanged(currentInst.installPath, currentInst, 'restart')
              .then(async ({ saved, filename }) => {
                if (saved) {
                  const snapshotCount = await getSnapshotCount(currentInst.installPath)
                  installations.update(installationId, { lastSnapshot: filename, snapshotCount })
                }
              })
              .catch((err) => console.warn('Snapshot capture failed:', err))
          })
        }
        return
      }
      logStream.end()
      const crashed = _runningSessions.has(installationId) && isCrashedExit(code, signal)
      // Raw stderr — see note in the early-fail exit handler above.
      const lastStderr = lastNLines(currentGetStderr(), 100)
      execTap.flushSummary()
      hwTap.flushSummary()
      // Run the (awaited) crash diagnosis BEFORE releasing the session, so a
      // relaunch can't slip in and clearCrash() during the audit and have this
      // handler then resurrect the stale crash via recordCrash().
      const crashDiagnosis = crashed ? await diagnoseCrash(code) : {}
      _removeSession(installationId)
      const exitedPayload = {
        installationId,
        crashed,
        exitCode: code ?? undefined,
        signal: signal ?? undefined,
        installationName: inst.name,
        lastStderr,
        ...crashDiagnosis
      }
      // Emit from main so it survives the Desktop 2 panel teardown on exit.
      // `emit` = PostHog + Datadog crash-rate monitor; `last_stderr` is scrubbed.
      telemetry.emit('comfy.desktop.comfyui.exited', {
        installation_id: installationId,
        crashed,
        exit_code: code ?? null,
        last_stderr: lastStderr ?? null
      })
      if (crashed) {
        recordCrash(exitedPayload)
        // Broadcast to every renderer (not just `sender`) so any already-open
        // dashboard shows the red error tile live.
        _broadcastToRenderer('instance-crashed', exitedPayload)
      }
      if (!sender.isDestroyed()) {
        sender.send('comfy-exited', exitedPayload)
      }
      if (_onComfyExited) _onComfyExited({ installationId, crashed })
    })
  }
  attachExitHandler(proc)

  // Server is up. If a template-model download is still running, hold here (the
  // download step is the active row + the footer Skip is live) until it settles
  // or the user skips, instead of flashing past into ComfyUI.
  await waitForTemplateDownloadGate()

  // Stop the `template-models` reader's 500 ms timer: on a skip the download
  // stays non-terminal, so its loop would otherwise spin for the app's lifetime.
  abort.abort()

  if (_onLaunch) {
    _onLaunch({ port: launchCmd.port!, process: proc, installation: inst, mode })
  }
  return { ok: true, mode, port: launchCmd.port }
}
