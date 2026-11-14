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
  waitForPortFree,
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
  _getActiveLaunchIds,
  _getStoppingInstallationIds,
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
import { auditVcRuntime, isDllLoadFailure } from '../../vcRuntimeAudit'
import { rotateLogFiles, getLogDir } from '../../logRotation'
import { createAssetsTap } from '../../assetsTap'
import { createAgentTap } from '../../agentTap'
import { createExecutionTap } from '../../executionTap'
import { createHardwareTap } from '../../hardwareTap'
import { createLaunchProgressTracker } from '../../launchProgress'
import {
  buildLaunchPhases,
  AGENT_REQUIREMENTS_PHASE,
  FRONTEND_RESTORE_PHASE
} from '../../launchPhases'
import {
  getTemplateDownloadState,
  formatTemplateSubStatus,
  awaitTemplateDownloadSettled,
  subscribeTemplateDownload,
  type TemplateDownloadSummary
} from '../../../sources/standalone/templateDownloadTask'
import { isTerminal as isTemplateDownloadTerminal } from '../../../sources/standalone/templateDownloadCore'
import { restageBuildModelsIfNeeded } from '../../../sources/comfybuilder/modelStagingTask'
import { initializeModelDownloads } from '../../comfyDownloadManager'
import type { PreLaunchPhase } from '../../launchPhases'
import { scanCustomNodes } from '../../nodes'
import type { LaunchProgressTracker } from '../../launchProgress'
import { clearCrash, recordCrash } from '../../crashBuffer'
import type { ComfyExitedData } from '../../../../types/ipc'
import * as telemetry from '../../telemetry'
import { buildErrorFields, errorTail, findExceptionLine } from '../../../../shared/errorEvent'
import {
  startBootPhases,
  recordBootPhase,
  clearBootPhases,
  flushBootPhasesOnFailure
} from '../../bootPhaseBuffer'
import { appendLog } from '../../logsBroadcast'
import { reconcileManagerConfigForLaunch } from '../../managerConfigLaunch'
import {
  installAgentRequirements,
  holdAgentPrefetch,
  installedWorkingAgent,
  planAgentRequirementsInstall,
  restoreCoreFrontend
} from '../../agentRequirementsLaunch'
import type { PrefetchRequest } from '../../agentRequirementsLaunch'
import { startAgentPrefetch } from '../../agentPrefetch'
import {
  FRONTEND_PACKAGE,
  createAgentStartWatcher,
  indexKind,
  nextOverrideState,
  pinSpecifier,
  readFrontendPin,
  readOverrideState,
  reportAgentCoreFailure,
  reportOverrideDecision
} from '../../agentRequirementsOverride'
import type { AgentStartOutcome, OverridePins } from '../../agentRequirementsOverride'
import { recoverInterruptedComfyOp } from '../../opMarker'
import { waitLaunchSpawnHold } from '../../e2eOverrides'
import {
  holderIsInstall,
  resolvePriorProcess,
  trackSpawn,
  type PriorProcessOutcome
} from '../../comfyProcessRecord'
import { identifyDbLockHolder, isDbLockFailure, type DbLockHolder } from '../../comfyDbLock'
import { isNewerAssetDbFailure, parseAssetsStartupFailure } from '../../assetsStartupFailure'
import {
  installationIdOf,
  sessionKindOf,
  type SessionKind
} from '../../../../shared/performanceTestSession'
import { migrateEnvLayout } from '../../../sources/standalone/install'
import { writeComfyEnvironment } from '../../../sources/standalone/envPaths'
import type { PersistedTorchStack } from '../../../sources/standalone/torchStackTypes'
import type { WriteStream } from 'fs'
import {
  assetsFloorShas,
  commitGrantShas,
  getCoreBetaGrantsAsync,
  isCommitGrant,
  planCoreBetaArgs,
  toBetaArgView
} from '../../coreBetaGrants'
import { armBetaActivationNotice, clearBetaActivationClaim } from '../../betaActivationNotice'
import type { CoreBetaGrant, CoreCommitState } from '../../coreBetaGrants'
import { coreSemver, formatComfyVersion } from '../../version'
import type { CoreCheckout } from '../../version'
import { coreVersionState, resolveCoreCheckout, splitLaunchCommand } from '../../coreBetaInputs'
import { resolveCoreCommitState } from '../../coreBetaAncestry'
import {
  appliedPassThrough,
  campaignCandidateGrants,
  campaignPresentArgs,
  heldArgUnanswered,
  planCampaignArgs
} from '../../coreBetaCampaigns'
import type { CampaignFacts, CampaignPlan, CampaignRecords } from '../../coreBetaCampaigns'
import {
  getCoreBetaCampaigns,
  readCampaignRecords,
  writeCampaignRecord
} from '../../coreBetaCampaignFlags'
import { getIdClass } from '../../deviceId'
import { outputDirOverride } from '../../outputFolders'
import type { ComfyArgsSchema } from '../../comfy-args'

export function desktopFeatureFlags(
  inst: InstallationRecord,
  telemetryEnabled: boolean
): Record<string, string> {
  const flags: Record<string, string> = {
    show_signin_button: 'true',
    supports_terminal: 'false'
  }
  if (inst.sourceId === 'standalone' && telemetryEnabled) {
    flags.enable_telemetry = 'true'
  }
  return flags
}

function fullSha(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const sha = value.trim().toLowerCase()
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null
}

export function launchedCoreCommit(
  inst: InstallationRecord,
  checkout: CoreCheckout
): string | null {
  switch (checkout.kind) {
    case 'head':
      return fullSha(checkout.commit)
    case 'not-git':
      return fullSha(inst.comfyVersion?.commit)
    case 'unreadable':
      return null
  }
}

export interface CoreBetaLaunch {
  readonly applied: readonly CoreBetaGrant[]
  readonly campaign: Pick<CampaignPlan, 'applied' | 'misses'>
  readonly droppedUnsupported: readonly string[]
  readonly logRecords: readonly string[]
  readonly coreVersion: string | null
  readonly optedIn: boolean
}

function noCoreBeta(optedIn: boolean): CoreBetaLaunch {
  return {
    applied: [],
    campaign: { applied: [], misses: [] },
    droppedUnsupported: [],
    logRecords: [],
    coreVersion: null,
    optedIn
  }
}

function coreBetaLogRecord(
  grant: CoreBetaGrant,
  coreVersion: string | null,
  coreHead: string | null
): string {
  if (isCommitGrant(grant)) {
    return `[core-beta] ${grant.arg} (core ${coreHead?.slice(0, 12)} in a granted commit range, opted in)\n`
  }
  return `[core-beta] ${grant.arg} (core ${coreVersion} >= ${grant.minCoreVersion}, opted in)\n`
}

export function buildLaunchArgs(input: {
  prefixArgs: readonly string[]
  userArgs: readonly string[]
  desktopFlagArgs: readonly string[]
  schema: ComfyArgsSchema
  betaFlags: readonly CoreBetaGrant[]
  coreVersion: string | null
  coreVersionExact: boolean
  coreVersionVerified: boolean
  coreVersionCurrent: boolean
  coreCommits: CoreCommitState
  betaEnabled: boolean
  campaign?: Pick<CampaignFacts, 'registry' | 'answers' | 'records' | 'idClass' | 'now'>
}): { args: string[]; beta: CoreBetaLaunch } {
  const { prefixArgs, userArgs, desktopFlagArgs, schema, coreVersion } = input
  const filtered = filterUnsupportedArgs([...userArgs], schema)
  const plan = planCoreBetaArgs({
    grants: input.betaFlags,
    betaEnabled: input.betaEnabled,
    userArgs,
    core: {
      semver: coreVersion,
      exact: input.coreVersionExact,
      verified: input.coreVersionVerified,
      current: input.coreVersionCurrent
    },
    commits: input.coreCommits,
    schema
  })
  for (const line of plan.trace) console.log(line)
  let campaign: CampaignPlan = { applied: [], misses: [], trace: [] }
  try {
    if (input.campaign)
      campaign = planCampaignArgs({
        ...input.campaign,
        betaEnabled: input.betaEnabled,
        presentArgs: campaignPresentArgs(userArgs, plan),
        core: {
          semver: coreVersion,
          exact: input.coreVersionExact,
          verified: input.coreVersionVerified,
          current: input.coreVersionCurrent
        },
        commits: input.coreCommits,
        schema
      })
  } catch (err) {
    console.warn('[core-campaign] planning failed; no campaign args this launch:', err)
  }
  for (const line of campaign.trace) console.log(line)
  const applied = [...plan.applied, ...campaign.applied.map((entry) => entry.grant)]
  return {
    args: [
      ...prefixArgs,
      ...desktopFlagArgs,
      ...plan.assetsArgs,
      ...applied.map((grant) => grant.arg),
      ...filtered
    ],
    beta: {
      applied,
      campaign: { applied: campaign.applied, misses: campaign.misses },
      droppedUnsupported: plan.droppedUnsupported,
      logRecords: [
        `${plan.assetsRecord}\n`,
        ...applied.map((grant) => coreBetaLogRecord(grant, coreVersion, input.coreCommits.head)),
        ...plan.withheld.map((line) => `${line}\n`),
        ...plan.droppedUnsupported.map(
          (arg) => `[core-beta] ${arg} withheld: not supported by this core\n`
        )
      ],
      coreVersion,
      optedIn: input.betaEnabled
    }
  }
}

async function loadCampaignInputs(): Promise<
  | (Awaited<ReturnType<typeof getCoreBetaCampaigns>> & {
      records: CampaignRecords
      grants: CoreBetaGrant[]
    })
  | null
> {
  try {
    const campaigns = await getCoreBetaCampaigns()
    const records = readCampaignRecords()
    const grants = campaignCandidateGrants(
      campaigns.registry,
      campaigns.answers,
      records,
      Date.now(),
      getIdClass()
    )
    return { ...campaigns, records, grants }
  } catch (err) {
    console.warn('[core-campaign] inputs unavailable; no campaign args this launch:', err)
    return null
  }
}

export function recordCampaignEnrolments(
  campaign: CoreBetaLaunch['campaign']
): CoreBetaLaunch['campaign'] {
  const now = Date.now()
  const misses = [...campaign.misses]
  for (const { key, grant, epoch, enrolledNow, fetchedAt } of campaign.applied) {
    if (!enrolledNow) continue
    try {
      if (!writeCampaignRecord(key, grant.arg, epoch, now)) continue
    } catch (err) {
      console.warn(`[core-campaign] ${key}: ${grant.arg} enrolment not recorded:`, err)
      misses.push({ key, arg: grant.arg, member: false, reason: 'record_failed' })
      continue
    }
    try {
      telemetry.emit('comfy.desktop.core_beta.enrolled', {
        key,
        arg: grant.arg,
        epoch,
        lag_ms: fetchedAt === undefined ? null : now - fetchedAt
      })
    } catch {}
  }
  return { applied: campaign.applied, misses }
}

export function emitCoreBetaRecords(
  records: readonly string[],
  sinks: { writeLog: (text: string) => void; sendOutput: (text: string) => void }
): void {
  for (const record of records) {
    try {
      sinks.writeLog(record)
    } catch {}
    try {
      sinks.sendOutput(record)
    } catch {}
  }
}

export function emitCoreBetaTelemetry(input: {
  appliedArgs: readonly string[]
  droppedUnsupported: readonly string[]
  coreVersion: string | null
  coreCommit: string | null
  coreVersionLabel: string | null
  optedIn: boolean
  campaign?: CoreBetaLaunch['campaign']
}): void {
  const campaign = input.campaign ?? { applied: [], misses: [] }
  const unrecorded = new Set(
    campaign.misses
      .filter(({ reason }) => reason === 'record_failed')
      .map(({ key, arg }) => `${key}:${arg}`)
  )
  const active = campaign.applied.filter(({ key, grant }) => !unrecorded.has(`${key}:${grant.arg}`))
  if (input.appliedArgs.length > 0 || input.droppedUnsupported.length > 0) {
    telemetry.emit('comfy.desktop.core_beta.applied', {
      args: [...input.appliedArgs],
      core_version: input.coreVersion,
      core_commit: input.coreCommit,
      core_version_label: input.coreVersionLabel,
      dropped_unsupported: [...input.droppedUnsupported],
      ...(active.length > 0 && {
        campaign_args: active.map(({ key, grant, epoch }) => `${key}:${grant.arg}:${epoch}`)
      })
    })
  }
  if (campaign.misses.length > 0) {
    const misses = (member: boolean): string[] =>
      campaign.misses
        .filter((miss) => miss.member === member)
        .map(({ key, arg, reason }) => `${key}:${arg}:${reason}`)
    telemetry.emit('comfy.desktop.core_beta.campaign_missed', {
      idle: misses(true),
      enrol_refused: misses(false)
    })
  }
  telemetry.emit('comfy.desktop.core_beta.opt_state', { opted_in: input.optedIn })
}

const overrideRecording = new Map<string, Promise<void>>()

function recordOverrideOutcome(
  installationId: string,
  pins: OverridePins,
  outcome: AgentStartOutcome,
  failedBy: 'start_failed' | 'install_failed' | 'check_failed' = 'start_failed'
): Promise<void> {
  const queued = (overrideRecording.get(installationId) ?? Promise.resolve()).then(() =>
    foldOverrideOutcome(installationId, pins, outcome, failedBy)
  )
  overrideRecording.set(installationId, queued)
  return queued
}

async function foldOverrideOutcome(
  installationId: string,
  pins: OverridePins,
  outcome: AgentStartOutcome,
  failedBy: 'start_failed' | 'install_failed' | 'check_failed'
): Promise<void> {
  try {
    const current = await installations.get(installationId)
    if (!current) return
    const next = nextOverrideState(
      readOverrideState(current),
      pins,
      outcome,
      failedBy === 'start_failed'
    )
    if (!next) return
    await installations.update(installationId, { agentRequirementsOverride: next.state })
    if (next.reverted) {
      reportOverrideDecision(installationId, {
        decision: 'reverted',
        reason: failedBy,
        pins,
        failures: next.state.failures
      })
    }
  } catch (err) {
    console.warn('agent requirements override: could not record the outcome:', err)
  }
}

function watchOverriddenAgentStart(installationId: string, pins: OverridePins): AgentStartWatch {
  return createAgentStartWatcher(
    (outcome) => void recordOverrideOutcome(installationId, pins, outcome)
  )
}

type AgentStartWatch = ReturnType<typeof createAgentStartWatcher>

export interface StorageLaunchState {
  preLaunchExtras: string[]
  manageModelFolders: boolean
  modelDirsForLaunch: string[] | undefined
  modelSyncOptions: ModelPathsOptions
}

export function applyStorageLaunchArgs(
  inst: InstallationRecord,
  installationId: string,
  launchCmd: LaunchCommand,
  storage: Pick<settings.Settings, 'modelsDirs' | 'inputDir' | 'outputDir'>
): StorageLaunchState {
  const argsAvailable = !launchCmd.skipSharedPaths && !!launchCmd.args
  let preLaunchExtras: string[] = []
  let modelDirsForLaunch: string[] | undefined
  let modelSyncOptions: ModelPathsOptions = {}
  let manageModelFolders = false
  if (argsAvailable) {
    const sharedDirs = storage.modelsDirs ?? []
    const { dirs, primaryDir } = resolveLauncherModelDirs(inst, sharedDirs)
    if (dirs.length > 0) {
      manageModelFolders = true
      modelDirsForLaunch = dirs
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
    const useSharedInput = (inst.useSharedInput as boolean | undefined) !== false
    if (useSharedInput) {
      const inputDir = storage.inputDir || settings.defaults.inputDir
      fs.mkdirSync(inputDir, { recursive: true })
      launchCmd.args!.push('--input-directory', inputDir)
    } else {
      const perInstallInput = inst.inputDir as string | undefined
      if (perInstallInput) {
        fs.mkdirSync(perInstallInput, { recursive: true })
        launchCmd.args!.push('--input-directory', perInstallInput)
      }
    }
    const outputDir = outputDirOverride(inst, storage.outputDir || settings.defaults.outputDir)
    if (outputDir) {
      fs.mkdirSync(outputDir, { recursive: true })
      launchCmd.args!.push('--output-directory', outputDir)
    }
  }

  return { preLaunchExtras, manageModelFolders, modelDirsForLaunch, modelSyncOptions }
}

export function isCrashedExit(code: number | null, signal: NodeJS.Signals | null): boolean {
  return code !== 0 || signal !== null
}

const PROCESS_CLOSE_GRACE_MS = 1_000

export function onProcessTerminated(
  proc: ChildProcess,
  callback: (
    code: number | null,
    signal: NodeJS.Signals | null,
    info: { pipesHeld: boolean }
  ) => void | Promise<void>
): void {
  let finished = false
  let fallbackTimer: NodeJS.Timeout | undefined

  const finish = (code: number | null, signal: NodeJS.Signals | null, pipesHeld: boolean): void => {
    if (finished) return
    finished = true
    if (fallbackTimer) clearTimeout(fallbackTimer)
    try {
      void Promise.resolve(callback(code, signal, { pipesHeld })).catch((err) => {
        console.error('Process termination callback failed:', err)
      })
    } catch (err) {
      console.error('Process termination callback failed:', err)
    }
  }

  proc.once('close', (code, signal) => finish(code, signal, false))
  proc.once('exit', (code, signal) => {
    if (finished) return
    fallbackTimer = setTimeout(() => finish(code, signal, true), PROCESS_CLOSE_GRACE_MS)
    fallbackTimer.unref()
  })
}

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
    try {
      const missing = await auditVcRuntime()
      if (missing.length > 0) out.vcRuntimeMissing = missing
    } catch (err) {
      console.warn('VC++ runtime audit failed:', err)
    }
  }
  return out
}

async function describeExitCode(code: number | null, stderr: string): Promise<string> {
  if (code == null) return 'unknown'
  const decoded = decodeExitCode(code)
  const accessViolation = decoded?.kind === 'access-violation'
  const dllFailure = !decoded && isDllLoadFailure(findExceptionLine(stderr) ?? '')
  let out = decoded ? `${decoded.code} / ${decoded.hex}` : String(code)
  if (accessViolation) {
    out += ' (memory access violation — usually a faulty or missing native library)'
  }
  if (accessViolation || dllFailure) {
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
  try {
    fs.mkdirSync(logDir, { recursive: true })
  } catch (err) {
    console.warn('[launch] log directory unavailable:', err)
  }
  await rotateLogFiles(logDir, 'comfyui.log')
  const stream = fs.createWriteStream(path.join(logDir, 'comfyui.log'), { flags: 'w' })
  stream.on('error', (err) => console.warn('[launch] comfyui.log unavailable:', err))
  return stream
}

export function writeLog(stream: WriteStream, text: string): void {
  if (!stream.writableEnded && !stream.destroyed) stream.write(stripAnsi(text))
}

export function emitPriorProcessFound(installationId: string, prior: PriorProcessOutcome): void {
  telemetry.capture('comfy.desktop.comfyui.prior_process_found', {
    installation_id: installationId,
    action: prior.action,
    proof: prior.proof,
    age_ms: prior.ageMs,
    wait_ms: prior.waitMs,
    exited_in_time: prior.exitedInTime,
    busy_override: prior.busyOverride === true,
    lingering_count: prior.lingering ?? 0,
    queue_unknown: prior.queueUnknown === true
  })
}

export function describeLockHolder(holder: DbLockHolder | null): string {
  if (!holder) return 'holder not identified'
  const parts = [
    `holder pid ${holder.pid}`,
    `source ${holder.source}`,
    `same install ${holder.sameInstall}`
  ]
  if (holder.name) parts.push(`name ${holder.name}`)
  if (holder.runsMainPy !== null) parts.push(`runs main.py ${holder.runsMainPy}`)
  if (holder.ageS !== null) parts.push(`running ${holder.ageS}s`)
  return parts.join(', ')
}

export function describePriorOutcome(prior: PriorProcessOutcome): string {
  const what =
    prior.action === 'terminated'
      ? prior.exitedInTime
        ? 'stopped, and it exited'
        : 'stopped, but it did not exit'
      : prior.action === 'waited'
        ? 'it exited on its own'
        : prior.action === 'busy_left'
          ? prior.queueUnknown
            ? 'left running: it did not answer whether it is working on a prompt'
            : 'left running: it is working on a prompt'
          : 'left running: not proven to be ours'
  const reason = prior.queueUnknown ? 'unknown' : prior.blocked
  const blocked = prior.blocked ? `; launch refused (${reason})` : ''
  const lingering = prior.lingering ? `; ${prior.lingering} surviving subprocess(es) stopped` : ''
  const covered = prior.stoppedPids?.length ? `; stopped pids ${prior.stoppedPids.join(', ')}` : ''
  if (prior.survivorPids) {
    const them =
      prior.action === 'terminated'
        ? prior.exitedInTime
          ? 'stopped, and they exited'
          : 'stopped, but not all of them exited'
        : prior.blocked === 'unverified'
          ? 'left running: they could not be re-verified'
          : "left running: they do not answer on this installation's port, so whether they " +
            'are working cannot be asked'
    return (
      `processes left by an earlier ComfyUI (pids ${prior.survivorPids.join(', ')}, proof ` +
      `${prior.proof}): ${them}${covered}${blocked}`
    )
  }
  return `earlier ComfyUI (pid ${prior.pid}, port ${prior.port}, proof ${prior.proof}): ${what}${lingering}${covered}${blocked}`
}

export function _resolveLaunchMode(
  inst: InstallationRecord,
  actionData?: Record<string, unknown>
): string {
  if (actionData?.launchModeOverride === 'console') return 'console'
  return (inst.launchMode as string | undefined) || 'window'
}

export function _resolvePortConflictPolicy(
  inst: InstallationRecord,
  defaults: Record<string, unknown>,
  actionData?: Record<string, unknown>
): { mode: string; portIsExplicit: boolean } {
  const autoPortOnConflict = actionData?.autoPortOnConflict === true
  return {
    mode: autoPortOnConflict
      ? 'auto'
      : (inst.portConflict as string | undefined) ||
        (defaults.portConflict as string | undefined) ||
        'auto',
    portIsExplicit:
      actionData?.portOverride != null ||
      (!autoPortOnConflict && /(?:^|\s)--port(?:\s|=|$)/.test(String(inst.launchArgs ?? '')))
  }
}

export function createAssetsTapSafe(
  base: Parameters<typeof createAssetsTap>[0]
): ReturnType<typeof createAssetsTap> {
  try {
    return createAssetsTap(base)
  } catch (err) {
    console.error('Failed to create assets telemetry tap; continuing without it:', err)
    return { ingest: () => {}, beginBoot: () => {}, flushSummary: () => {} }
  }
}

export function createAgentTapSafe(
  base: Parameters<typeof createAgentTap>[0]
): ReturnType<typeof createAgentTap> {
  try {
    return createAgentTap(base)
  } catch (err) {
    console.error('Failed to create agent telemetry tap; continuing without it:', err)
    return { ingest: () => {}, beginBoot: () => {} }
  }
}

export function attachLaunchStreams(
  proc: ChildProcess,
  logStream: WriteStream,
  sendOutput: (text: string) => void,
  execTap: ReturnType<typeof createExecutionTap>,
  hwTap: ReturnType<typeof createHardwareTap>,
  assetsTap: ReturnType<typeof createAssetsTap>,
  agentTap: ReturnType<typeof createAgentTap>,
  tracker: LaunchProgressTracker,
  agentStartWatch?: AgentStartWatch
): { getStderr: () => string } {
  let stderrBuf = ''
  proc.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf-8')
    writeLog(logStream, text)
    sendOutput(text)
    execTap.ingest(text, 'stdout')
    hwTap.ingest(text, 'stdout')
    assetsTap.ingest(text, 'stdout')
    agentTap.ingest(text, 'stdout')
    agentStartWatch?.ingest(text, 'stdout')
    tracker.ingest(stripAnsi(text))
  })
  proc.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf-8')
    const clean = stripAnsi(text)
    stderrBuf += clean
    if (stderrBuf.length > 16 * 1024) stderrBuf = stderrBuf.slice(-(16 * 1024))
    writeLog(logStream, text)
    sendOutput(text)
    execTap.ingest(text, 'stderr')
    hwTap.ingest(text, 'stderr')
    assetsTap.ingest(text, 'stderr')
    agentTap.ingest(text, 'stderr')
    agentStartWatch?.ingest(text, 'stderr')
    tracker.ingest(clean)
  })
  return { getStderr: () => stderrBuf }
}

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
  clearBetaActivationClaim(installationId)
}

const isLocalSource = (sourceId: string): boolean =>
  (sourceMap[sourceId]?.category ?? 'local') === 'local'

export function otherLocalComfyUIs(sessionId: string, records: InstallationRecord[]): string[] {
  const ids = new Set([
    ..._runningSessions.keys(),
    ..._getActiveLaunchIds().filter((id) => _operationAborts.has(id))
  ])
  ids.delete(sessionId)
  for (const id of _getStoppingInstallationIds()) ids.add(id)
  const names: string[] = []
  const perfTests: string[] = []
  for (const id of ids) {
    const perf = sessionKindOf(id) === 'performance_test'
    const inst = records.find((r) => r.id === installationIdOf(id))
    if (inst && !isLocalSource(inst.sourceId)) continue
    const name = inst?.name ?? _runningSessions.get(id)?.installationName ?? id
    if (perf) perfTests.push(i18n.t('errors.performanceTestOfInstallation', { name }))
    else names.push(`“${name}”`)
  }
  return [...names, ...perfTests]
}

export async function handleLaunch(ctx: ActionContext): Promise<ActionResult> {
  const { installationId } = ctx
  const sessionId = ctx.sessionId ?? installationId
  if (sessionKindOf(sessionId) === 'performance_test' && isLocalSource(ctx.inst.sourceId)) {
    const records = await installations.list()
    const others = otherLocalComfyUIs(sessionId, records)
    if (others.length > 0) {
      appendLog(sessionId, `[launch] Performance Test refused: also running ${others.join(', ')}\n`)
      telemetry.emit('comfy.desktop.performance_test.refused', {
        installation_id: installationId,
        other_count: others.length
      })
      const names = new Intl.ListFormat(i18n.getLocale(), { type: 'conjunction' }).format(others)
      return {
        ok: false,
        message:
          others.length === 1
            ? i18n.t('errors.performanceTestOtherInstanceRunningOne', { name: names })
            : i18n.t('errors.performanceTestOtherInstanceRunning', { names })
      }
    }
  }
  if (_runningSessions.has(sessionId)) {
    return { ok: false, message: i18n.t('errors.alreadyRunning') }
  }
  if (_operationAborts.has(sessionId)) {
    return { ok: false, message: 'Another operation is already running for this installation.' }
  }
  const launch = _beginLaunch(sessionId)
  const prefetchHold = { release: (): void => {} }
  try {
    return await runLaunch(ctx, launch.abort, prefetchHold)
  } finally {
    prefetchHold.release()
    if (_operationAborts.get(sessionId) === launch.abort) _operationAborts.delete(sessionId)
    _endLaunch(sessionId, launch)
  }
}

async function runLaunch(
  { event, installationId, sessionId: runtimeSessionId, inst: instArg, actionData }: ActionContext,
  abort: AbortController,
  prefetchHold: { release: () => void }
): Promise<ActionResult> {
  let inst = instArg
  const sessionId = runtimeSessionId ?? installationId
  const sessionKind = sessionKindOf(sessionId)
  const preLaunchPhases: PreLaunchPhase[] = []
  let betaEnabled = false
  try {
    betaEnabled = settings.resolveBetaFeaturesEnabled()
  } catch (err) {
    console.warn('[core-beta] beta setting resolution failed:', err)
  }
  let coreBeta: CoreBetaLaunch = noCoreBeta(betaEnabled)
  let desktopAddedAssets = false
  let agentUnanswered = false
  let coreCommit: string | null = null
  const coreVersionLabel = (): string | null =>
    typeof (inst.comfyVersion?.commit as unknown) === 'string'
      ? formatComfyVersion(inst.comfyVersion, 'short')
      : null
  let coreBetaReported = false
  let coreBetaLogged = false
  _operationAborts.set(sessionId, abort)
  if (typeof inst.installPath === 'string') {
    prefetchHold.release = await holdAgentPrefetch(inst.installPath)
  }
  clearCrash(sessionId)
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
    const dirState = await installDirStateAsync(inst.installPath)
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
  const sendProgress = makeSendProgress(sender, sessionId)

  if (
    inst.sourceId === 'comfybuilder' &&
    inst.status === 'installed' &&
    inst.modelsStaged !== true
  ) {
    restageBuildModelsIfNeeded(inst)
  }

  const showTemplatePhase =
    inst.sourceId === 'standalone' &&
    !!inst.bundledTemplateId &&
    inst.downloadTemplateModels === true &&
    (inst.bundledTemplateSizeBytes ?? 0) > 0 &&
    !!inst.pendingTemplateOpen &&
    getTemplateDownloadState(installationId) !== undefined

  let launchNodeCount = 0
  async function scanLaunchNodeCount(): Promise<void> {
    try {
      const scanned = await scanCustomNodes(path.join(inst.installPath, 'ComfyUI'))
      launchNodeCount = scanned.filter((n) => n.enabled).length
    } catch (err) {
      console.warn('Custom-node scan for launch progress failed:', err)
    }
  }

  let launchTracker: LaunchProgressTracker | null = null
  async function armLaunchTracker(): Promise<LaunchProgressTracker> {
    if (launchTracker) return launchTracker
    await scanLaunchNodeCount()
    launchTracker = createLaunchProgressTracker({
      phases: buildLaunchPhases(inst, { preLaunchPhases, templateModels: showTemplatePhase }),
      nodeCount: launchNodeCount,
      sendProgress,
      onPhaseEnter: (phase) => recordBootPhase(sessionId, phase)
    })
    launchTracker.start()
    return launchTracker
  }

  async function guardLaunchSetup<T>(
    step: () => Promise<T> | T,
    opts: { port?: number; logStream?: WriteStream } = {}
  ): Promise<T> {
    try {
      return await step()
    } catch (err) {
      _cleanupFailedLaunchSetup(sessionId, abort, opts)
      throw err
    }
  }

  async function acquireLaunchResources(): Promise<{
    logStream: WriteStream
    execTap: ReturnType<typeof createExecutionTap>
    hwTap: ReturnType<typeof createHardwareTap>
    assetsTap: ReturnType<typeof createAssetsTap>
    agentTap: ReturnType<typeof createAgentTap>
    tracker: LaunchProgressTracker
  }> {
    const logStream = await openLogStream(inst.installPath)
    const coreBetaFlags = coreBeta.applied.map((grant) => grant.arg)
    try {
      const execTap = createExecutionTap({
        installationId,
        variant: (inst.variant as string | undefined) ?? null,
        release: (inst.release as string | undefined) ?? null,
        coreBetaFlags,
        coreCommit,
        coreVersionLabel: coreVersionLabel(),
        sessionKind
      })
      const hwTap = createHardwareTap({
        installationId,
        variant: (inst.variant as string | undefined) ?? null,
        release: (inst.release as string | undefined) ?? null,
        coreBetaFlags,
        coreCommit,
        coreVersionLabel: coreVersionLabel(),
        sessionKind
      })
      const assetsTap = createAssetsTapSafe({
        installationId,
        variant: (inst.variant as string | undefined) ?? null,
        release: (inst.release as string | undefined) ?? null,
        coreBetaFlags,
        sessionKind
      })
      const agentTap = createAgentTapSafe({
        installationId,
        variant: (inst.variant as string | undefined) ?? null,
        release: (inst.release as string | undefined) ?? null,
        coreBetaFlags
      })
      const tracker = await armLaunchTracker()
      return { logStream, execTap, hwTap, assetsTap, agentTap, tracker }
    } catch (err) {
      logStream.end()
      throw err
    }
  }

  function logCoreBetaRecords(logStream: WriteStream, sendOutput: (text: string) => void): void {
    if (coreBetaLogged) return
    coreBetaLogged = true
    emitCoreBetaRecords(coreBeta.logRecords, {
      writeLog: (text) => writeLog(logStream, text),
      sendOutput
    })
  }

  function reportCoreBetaLaunchOnSpawn(proc: ChildProcess): void {
    proc.once('spawn', () => {
      try {
        reportCoreBetaLaunch()
      } catch (err) {
        console.warn('[core-beta] launch report failed:', err)
      }
    })
  }

  function reportCoreBetaLaunch(): void {
    if (coreBetaReported) return
    coreBetaReported = true
    coreBeta = { ...coreBeta, campaign: recordCampaignEnrolments(coreBeta.campaign) }
    armBetaActivationNotice(installationId, coreBeta.applied)
    try {
      emitCoreBetaTelemetry({
        appliedArgs: coreBeta.applied.map((grant) => grant.arg),
        droppedUnsupported: coreBeta.droppedUnsupported,
        coreVersion: coreBeta.coreVersion,
        coreCommit,
        coreVersionLabel: coreVersionLabel(),
        optedIn: coreBeta.optedIn,
        campaign: coreBeta.campaign
      })
    } catch {}
  }

  function bootCohort(): {
    core_beta_flags: string[]
    assets_enabled: boolean
    core_beta_opted_in: boolean
    core_version: string | null
    core_commit: string | null
    core_version_label: string | null
    session_kind: SessionKind
  } {
    return {
      core_beta_flags: coreBeta.applied.map((grant) => grant.arg),
      assets_enabled: launchCmd.args?.includes('--enable-assets') === true,
      core_beta_opted_in: coreBeta.optedIn,
      core_version: coreSemver(inst),
      core_commit: coreCommit,
      core_version_label: coreVersionLabel(),
      session_kind: sessionKind
    }
  }

  if (inst.sourceId === 'standalone') {
    const recoveryLog: string[] = []
    try {
      const recovered = await recoverInterruptedComfyOp(
        inst.installPath,
        (text) => {
          recoveryLog.push(text)
          console.log(text.trim())
        },
        () => {
          preLaunchPhases.push('repair')
        }
      )
      if (recovered) inst = (await installations.get(installationId)) || inst
    } catch (err) {
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
    let stackStateTrusted = true
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
    if (stackStateTrusted) {
      try {
        const { maybeRepairTorch, getTorchVendorMismatch } =
          await import('../../../sources/standalone/torchRepair')
        if (getTorchVendorMismatch(inst)) {
          preLaunchPhases.push('torchRepair')
          await armLaunchTracker()
        }
        const repaired = await maybeRepairTorch(
          inst,
          {
            sendProgress,
            sendOutput: makeSendOutput(event.sender, sessionId),
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
  if (abort.signal.aborted) return { ok: false, cancelled: true }

  const launchStartedAt = Date.now()
  const launchCmdRaw = source.getLaunchCommand(inst)
  if (!launchCmdRaw) {
    return { ok: false, message: i18n.t('errors.noEnvFound') }
  }
  const launchCmd = launchCmdRaw
  const storageSettings =
    !launchCmd.skipSharedPaths && launchCmd.args
      ? await settings.readSettled(abort.signal)
      : settings.defaults
  if (abort.signal.aborted) return { ok: false, cancelled: true }
  if (!storageSettings) return { ok: false, message: i18n.t('errors.settingsUnreadable') }

  if (launchCmd.cmd && launchCmd.args && launchCmd.cwd) {
    const split = splitLaunchCommand(launchCmd)
    if (split) {
      const { prefixArgs, userArgs, mainPyAbs, comfyuiDir } = split
      const revision = inst.comfyVersion?.commit ?? (inst.version as string | undefined)
      const checkout = resolveCoreCheckout(comfyuiDir)
      coreCommit = launchedCoreCommit(inst, checkout)
      launchCmd.args = [...launchCmd.args]
      try {
        const schema = await getComfyArgsSchema(
          launchCmd.cmd,
          mainPyAbs,
          launchCmd.cwd,
          installationId,
          revision
        )
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

        const [betaFlags, campaigns] = await Promise.all([
          getCoreBetaGrantsAsync(),
          betaEnabled ? loadCampaignInputs() : null
        ])
        const campaignGrants = campaigns?.grants ?? []
        const core = coreVersionState(inst, checkout)
        const [floor, granted] = await Promise.all([
          resolveCoreCommitState(
            comfyuiDir,
            checkout,
            assetsFloorShas(betaFlags, userArgs, schema, core),
            abort.signal
          ),
          resolveCoreCommitState(
            comfyuiDir,
            checkout,
            betaEnabled ? commitGrantShas([...betaFlags, ...campaignGrants], userArgs) : [],
            abort.signal
          )
        ])
        const coreCommits = {
          head: granted.head ?? floor.head,
          ancestry: new Map([...granted.ancestry, ...floor.ancestry])
        }
        const built = buildLaunchArgs({
          prefixArgs,
          userArgs,
          desktopFlagArgs,
          schema,
          betaFlags,
          coreVersion: core.semver,
          coreVersionExact: core.exact,
          coreVersionVerified: core.verified,
          coreVersionCurrent: core.current,
          coreCommits,
          betaEnabled,
          ...(campaigns && {
            campaign: {
              registry: campaigns.registry,
              answers: campaigns.answers,
              records: campaigns.records,
              idClass: getIdClass(),
              now: Date.now()
            }
          })
        })
        launchCmd.args = built.args
        coreBeta = built.beta
        agentUnanswered =
          !!campaigns &&
          heldArgUnanswered(built.beta.campaign.misses, campaigns, '--enable-agent') &&
          !built.args.includes('--enable-agent') &&
          !built.args.includes('--disable-agent') &&
          !userArgs.includes('--disable-agent') &&
          filterUnsupportedArgs(['--enable-agent'], schema).length > 0
        desktopAddedAssets =
          built.args.includes('--enable-assets') && !userArgs.includes('--enable-assets')
      } catch {}
    }
  }
  if (abort.signal.aborted) return { ok: false, cancelled: true }

  const managerReconcile = await reconcileManagerConfigForLaunch({
    remote: Boolean(launchCmd.remote),
    installPath: inst.installPath,
    securityLevel: inst.managerSecurityLevel,
    networkMode: inst.managerNetworkMode
  })
  if (!managerReconcile.ok) {
    return { ok: false, message: i18n.t('errors.managerConfigWriteFailed') }
  }

  let kept: string | null = null
  if (agentUnanswered && launchCmd.args) {
    const plan = planAgentRequirementsInstall(inst, [...launchCmd.args, '--enable-agent'])
    kept = plan && (await installedWorkingAgent(plan, readOverrideState(inst), abort.signal))
    if (abort.signal.aborted) return { ok: false, cancelled: true }
    if (kept) {
      launchCmd.args.push('--enable-agent')
      makeSendOutput(
        sender,
        installationId
      )(`\nNo campaign answer in time; keeping the installed agent ${kept}\n`)
      reportOverrideDecision(installationId, {
        decision: 'kept_installed',
        reason: 'no_answer',
        kept
      })
    }
  }
  const agentRequirements = kept ? null : planAgentRequirementsInstall(inst, launchCmd.args ?? [])
  let overridePins: OverridePins | undefined
  const handedBack: { request?: PrefetchRequest } = {}
  const startHandedBack = (): void => {
    prefetchHold.release()
    if (handedBack.request) void startAgentPrefetch(installationId, handedBack.request)
  }
  if (agentRequirements) {
    const tracker = await armLaunchTracker()
    tracker.addLatePhase(AGENT_REQUIREMENTS_PHASE)
    const overrideDecision = await installAgentRequirements(
      agentRequirements,
      makeSendOutput(sender, installationId),
      abort.signal,
      appliedPassThrough(coreBeta.campaign.applied, '--enable-agent'),
      readOverrideState(inst),
      (request, deferral) => {
        sendProgress('agentRequirements', {
          percent: -1,
          status: i18n.t(
            deferral === 'agent'
              ? 'launch.agentRequirements.deferred'
              : 'launch.agentRequirements.deferredUpdate'
          )
        })
        handedBack.request = request
      },
      (report) => {
        sendProgress('agentRequirements', {
          percent: -1,
          status: i18n.t('launch.agentRequirements.failed')
        })
        reportAgentCoreFailure(installationId, report, indexKind(settings.getMirrorConfig()))
      }
    )
    if (abort.signal.aborted) {
      startHandedBack()
      return { ok: false, cancelled: true }
    }
    if (overrideDecision) {
      reportOverrideDecision(
        installationId,
        overrideDecision,
        indexKind(settings.getMirrorConfig())
      )
      if (overrideDecision.decision === 'applied') overridePins = overrideDecision.pins
      if ('kept' in overrideDecision && overrideDecision.kept) kept = overrideDecision.kept
      const costly = 'reason' in overrideDecision ? overrideDecision.reason : undefined
      if (overrideDecision.pins && (costly === 'install_failed' || costly === 'check_failed')) {
        void recordOverrideOutcome(installationId, overrideDecision.pins, 'failed', costly)
      }
    }
  }

  const frontendPin = overridePins?.get(FRONTEND_PACKAGE)
  const recordedFrontend = readFrontendPin(inst)
  if (kept && recordedFrontend !== null) {
    makeSendOutput(
      sender,
      installationId
    )(`Keeping the installed ${FRONTEND_PACKAGE} with the agent\n`)
  } else if (frontendPin !== undefined) {
    const pinned = typeof frontendPin === 'string' ? frontendPin : pinSpecifier(frontendPin)
    if (recordedFrontend !== pinned) {
      await installations
        .update(installationId, { frontendVersionOverride: { version: pinned } })
        .catch(() => {})
    }
  } else if (recordedFrontend !== null) {
    const tracker = await armLaunchTracker()
    tracker.addLatePhase(FRONTEND_RESTORE_PHASE)
    sendProgress('frontendRestore', { percent: -1, status: '' })
    const restored = await restoreCoreFrontend(
      inst,
      makeSendOutput(sender, installationId),
      abort.signal
    )
    if (abort.signal.aborted) {
      startHandedBack()
      return { ok: false, cancelled: true }
    }
    if (restored) {
      await installations
        .update(installationId, { frontendVersionOverride: undefined })
        .catch(() => {})
    }
  }
  startHandedBack()

  const { preLaunchExtras, manageModelFolders, modelDirsForLaunch, modelSyncOptions } =
    applyStorageLaunchArgs(inst, installationId, launchCmd, storageSettings)

  let serverUp = false
  let latestTemplateSummary: TemplateDownloadSummary | null = null
  let firstTemplatePaint = true
  let templatePreCompleted = false
  let templatePaintDone = false
  const paintTemplateProgress = (summary: TemplateDownloadSummary): void => {
    if (!serverUp || templatePaintDone) return
    const terminal = isTemplateDownloadTerminal(summary.status)
    if (firstTemplatePaint) {
      firstTemplatePaint = false
      templatePreCompleted = terminal
    }
    sendProgress('template-models', {
      percent: templatePreCompleted || terminal ? -1 : Math.min(99, Math.max(0, summary.percent)),
      status: formatTemplateSubStatus(summary),
      error: summary.status === 'error'
    })
    templatePaintDone = terminal
  }

  if (showTemplatePhase) {
    const unsubscribe = subscribeTemplateDownload(installationId, (summary) => {
      latestTemplateSummary = summary
      paintTemplateProgress(summary)
    })
    abort.signal.addEventListener('abort', unsubscribe, { once: true })
  }

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

  async function waitForTemplateDownloadGate(): Promise<void> {
    if (!showTemplatePhase) return
    serverUp = true
    if (latestTemplateSummary) paintTemplateProgress(latestTemplateSummary)

    const state = getTemplateDownloadState(installationId)
    if (!state) return
    const failedAlready = state.status === 'error'
    if (isTemplateDownloadTerminal(state.status) && !failedAlready) return

    if (!failedAlready) {
      const reason = await awaitTemplateDownloadSettled(installationId, abort.signal)
      if (reason !== 'error' || abort.signal.aborted) return
    }

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

  if (launchCmd.remote) {
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
      if (_operationAborts.get(sessionId) === abort) _operationAborts.delete(sessionId)
      if (abort.signal.aborted) return { ok: false, cancelled: true }
      return { ok: false, message: i18n.t('errors.cannotConnect', { url: displayUrl }) }
    }

    if (_operationAborts.get(sessionId) === abort) _operationAborts.delete(sessionId)
    const mode = _resolveLaunchMode(inst, actionData)
    _addSession(
      sessionId,
      { proc: null, port: launchCmd.port!, url: launchCmd.url, mode, installationName: inst.name },
      Date.now() - launchStartedAt,
      undefined,
      installationId
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

  if (!fs.existsSync(launchCmd.cmd!)) {
    if (_operationAborts.get(sessionId) === abort) _operationAborts.delete(sessionId)
    return { ok: false, message: i18n.t('errors.executableNotFound', { cmd: launchCmd.cmd ?? '' }) }
  }

  if (launchCmd.skipPortWait) {
    const sendOutput = makeSendOutput(sender, sessionId)
    const launchEnv = buildLaunchEnv(inst)

    const { logStream, execTap, hwTap, assetsTap, agentTap, tracker } = await guardLaunchSetup(
      () => {
        _markLaunching(sessionId, inst.name)
        return acquireLaunchResources()
      }
    )
    if (abort.signal.aborted) {
      logStream.end()
      _clearLaunchingFailed(sessionId)
      return { ok: false, cancelled: true }
    }
    logCoreBetaRecords(logStream, sendOutput)

    const { proc, getStderr } = await guardLaunchSetup(
      async () => {
        hwTap.beginBoot()
        assetsTap.beginBoot()
        agentTap.beginBoot()
        const p = spawnProcess(launchCmd.cmd!, launchCmd.args!, launchCmd.cwd!, launchEnv, {
          showWindow: launchCmd.showWindow
        })
        reportCoreBetaLaunchOnSpawn(p)
        try {
          return {
            proc: p,
            ...attachLaunchStreams(
              p,
              logStream,
              sendOutput,
              execTap,
              hwTap,
              assetsTap,
              agentTap,
              tracker,
              overridePins && watchOverriddenAgentStart(installationId, overridePins)
            )
          }
        } catch (err) {
          await killProcessTree(p)
          throw err
        }
      },
      { logStream }
    )

    if (_operationAborts.get(sessionId) === abort) _operationAborts.delete(sessionId)
    const mode = _resolveLaunchMode(inst, actionData)
    _addSession(
      sessionId,
      {
        proc,
        port: 0,
        mode,
        installationName: inst.name,
        coreBetaArgs: coreBeta.applied.map(toBetaArgView),
        getAcceleratorInfo: () => hwTap.getAcceleratorInfo(),
        flushTelemetry: () => {
          execTap.flushSummary()
          hwTap.flushSummary()
          assetsTap.flushSummary()
        }
      },
      Date.now() - launchStartedAt,
      undefined,
      installationId
    )

    onProcessTerminated(proc, async (code, signal, { pipesHeld }) => {
      logStream.end()
      const crashed = _runningSessions.has(sessionId) && isCrashedExit(code, signal)
      const lastStderr = lastNLines(getStderr(), 100)
      execTap.flushSummary()
      hwTap.flushSummary()
      assetsTap.flushSummary()
      const crashDiagnosis = crashed ? await diagnoseCrash(code) : {}
      _removeSession(sessionId)
      const exitedPayload = {
        installationId: sessionId,
        crashed,
        exitCode: code ?? undefined,
        signal: signal ?? undefined,
        installationName: inst.name,
        lastStderr,
        ...crashDiagnosis
      }
      telemetry.emit('comfy.desktop.comfyui.exited', {
        installation_id: installationId,
        crashed,
        exit_code: code ?? null,
        session_kind: sessionKind,
        last_stderr: lastStderr ?? null,
        pipes_held_after_exit: pipesHeld
      })
      if (crashed) {
        recordCrash(exitedPayload)
        _broadcastToRenderer('instance-crashed', exitedPayload)
      }
      if (!sender.isDestroyed()) {
        sender.send('comfy-exited', exitedPayload)
      }
      if (_onComfyExited) _onComfyExited({ installationId: sessionId, crashed })
    })

    if (_onLaunch) {
      _onLaunch({ port: 0, process: proc, installation: inst, mode })
    }
    return { ok: true, mode }
  }

  let prior: PriorProcessOutcome | null = null
  try {
    prior = await resolvePriorProcess(sessionId, {
      stopBusy: actionData?.stopBusyPriorProcess === true,
      signal: abort.signal,
      onProbe: () =>
        sendProgress('launch', { percent: -1, status: i18n.t('launch.checkingPriorProcess') }),
      onNote: (line) => appendLog(sessionId, `[launch] ${line}\n`)
    })
  } catch (err) {
    console.warn('[launch] prior-process check failed:', err)
  }
  if (prior && (!abort.signal.aborted || prior.action === 'terminated')) {
    emitPriorProcessFound(installationId, prior)
    appendLog(sessionId, `[launch] ${describePriorOutcome(prior)}\n`)
  }
  if (abort.signal.aborted) return { ok: false, cancelled: true }
  if (prior?.blocked) {
    if (_operationAborts.get(sessionId) === abort) _operationAborts.delete(sessionId)
    if (prior.blocked === 'busy') {
      return {
        ok: false,
        message: prior.survivorPids
          ? i18n.t('errors.priorSurvivorsRunning', { pids: prior.survivorPids.join(', ') })
          : prior.queueUnknown
            ? i18n.t('errors.priorProcessUnresponsive')
            : i18n.t('errors.priorProcessBusy'),
        portConflict: {
          port: prior.port,
          pids: prior.survivorPids ?? [prior.pid],
          isComfy: true,
          priorBusy: true,
          ...(prior.queueUnknown ? { priorUnknown: true } : {}),
          ...(prior.survivorPids ? { priorSurvivors: true } : {})
        }
      }
    }
    const holders = await findPidsByPort(prior.port).catch(() => [] as number[])
    if (prior.scanOwed) {
      return {
        ok: false,
        message: prior.scanRecent
          ? i18n.t('errors.priorScanRecent')
          : holders.length > 0
            ? i18n.t('errors.priorScanUnavailablePid', {
                port: prior.port,
                pid: holders.join(', ')
              })
            : i18n.t('errors.priorScanUnavailable', { port: prior.port })
      }
    }
    return {
      ok: false,
      message: i18n.t(
        prior.blocked === 'unverified'
          ? 'errors.priorProcessUnverified'
          : 'errors.priorProcessStuck',
        { pid: [...new Set([...(prior.survivorPids ?? [prior.pid]), ...holders])].join(', ') }
      )
    }
  }
  if (prior?.exitedInTime) await waitForPortFree(prior.port)
  if (abort.signal.aborted) return { ok: false, cancelled: true }

  if (actionData?.portOverride != null) {
    setPortArg(launchCmd as LaunchCmd, actionData.portOverride as number)
  }

  const defaults = source.getDefaults ? source.getDefaults() : {}
  const { mode: portConflictMode, portIsExplicit } = _resolvePortConflictPolicy(
    inst,
    defaults,
    actionData
  )

  const pendingPortOwner = _pendingPorts.get(launchCmd.port!)
  const portBusy = !pendingPortOwner && (await isPortListening(launchCmd.port!))
  const existingPids = pendingPortOwner || !portBusy ? [] : await findPidsByPort(launchCmd.port!)
  const portOccupied = !!pendingPortOwner || portBusy
  let portBumpedFrom: number | null = null

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

    let sameInstallPid: number | null = null
    if (actionData?.autoPortOnConflict !== true && launchCmd.args!.includes('--enable-assets')) {
      const lockPid = pendingPortOwner ? null : (readPortLock(launchCmd.port!)?.pid ?? null)
      for (const pid of new Set([...existingPids, ...(lockPid ? [lockPid] : [])])) {
        if (await holderIsInstall(pid, inst.installPath).catch(() => false)) {
          sameInstallPid = pid
          break
        }
      }
    }
    if (sameInstallPid !== null) {
      if (prior?.action !== 'left')
        emitPriorProcessFound(installationId, {
          action: 'left',
          proof: 'none',
          pid: sameInstallPid,
          port: launchCmd.port!,
          ageMs: null,
          waitMs: 0,
          exitedInTime: false,
          blocked: null
        })
      const info = await getProcessInfo(sameInstallPid)
      appendLog(
        sessionId,
        `[launch] port ${launchCmd.port} is held by a ComfyUI of this installation that this ` +
          `Desktop cannot prove it started (pid ${sameInstallPid}): left running; asking ` +
          `instead of starting a second copy on the same database\n`
      )
      if (_operationAborts.get(sessionId) === abort) _operationAborts.delete(sessionId)
      return {
        ok: false,
        message: i18n.t('errors.portConflictSameInstall', {
          port: launchCmd.port!,
          process: info ? info.name : `PID ${sameInstallPid}`
        }),
        portConflict: { port: launchCmd.port, pids: existingPids, isComfy: true }
      }
    }
    if (portConflictMode === 'auto' && nextPort && !portIsExplicit) {
      sendProgress('launch', {
        percent: -1,
        status: i18n.t('launch.portBusyUsing', { old: launchCmd.port!, new: nextPort })
      })
      appendLog(
        sessionId,
        `[launch] port ${launchCmd.port} is held by ` +
          (pendingPortOwner
            ? `a launch of "${pendingPortOwner}" in this Desktop`
            : existingPids.length > 0
              ? `pids ${existingPids.join(', ')}`
              : 'a process that could not be listed') +
          `, not a ComfyUI of this installation; using port ${nextPort}\n`
      )
      portBumpedFrom = launchCmd.port!
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
          isComfy = false
          message = i18n.t('errors.portConflictOther', {
            port: launchCmd.port!,
            process: i18n.t('errors.unknownProcess')
          })
        }
      }
      if (_operationAborts.get(sessionId) === abort) _operationAborts.delete(sessionId)
      return {
        ok: false,
        message,
        portConflict: { port: launchCmd.port, pids: existingPids, isComfy, nextPort }
      }
    }
  }

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
      portBumpedFrom ??= launchCmd.port!
      setPortArg(launchCmd as LaunchCmd, nextPort)
    } else {
      if (_operationAborts.get(sessionId) === abort) _operationAborts.delete(sessionId)
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

  if (abort.signal.aborted) return { ok: false, cancelled: true }

  const sessionPath = createSessionPath()
  const launchEnv = buildLaunchEnv(inst, sessionPath)
  const sendOutput = makeSendOutput(sender, sessionId)

  const { logStream, execTap, hwTap, assetsTap, agentTap, tracker } = await guardLaunchSetup(
    () => {
      _reservePort(launchCmd.port!, inst.name)
      _markLaunching(sessionId, inst.name)
      return acquireLaunchResources()
    },
    { port: launchCmd.port! }
  )

  const bootId = randomUUID()

  async function spawnComfy(): Promise<{ proc: ChildProcess; getStderr: () => string }> {
    hwTap.beginBoot()
    assetsTap.flushSummary()
    assetsTap.beginBoot()
    agentTap.beginBoot()
    const p = spawnProcess(launchCmd.cmd!, launchCmd.args!, launchCmd.cwd!, launchEnv, {
      showWindow: launchCmd.showWindow
    })
    reportCoreBetaLaunchOnSpawn(p)
    trackSpawn(p, {
      sessionKey: sessionId,
      installationId,
      installPath: inst.installPath,
      port: launchCmd.port!,
      bootId
    })
    try {
      return {
        proc: p,
        ...attachLaunchStreams(
          p,
          logStream,
          sendOutput,
          execTap,
          hwTap,
          assetsTap,
          agentTap,
          tracker,
          overridePins && watchOverriddenAgentStart(installationId, overridePins)
        )
      }
    } catch (err) {
      await killProcessTree(p)
      throw err
    }
  }

  const PORT_RETRY_MAX = 3
  const REBOOT_RETRY_MAX = 5
  let portRetries = 0
  let rebootRetries = 0
  let assetsRetries = 0

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
    await waitLaunchSpawnHold(abort.signal)
    if (abort.signal.aborted) {
      return { ok: false, message: 'Launch cancelled', cancelled: true }
    }
    logCoreBetaRecords(logStream, sendOutput)
    const cmdLine = [launchCmd.cmd!, ...launchCmd.args!]
      .map((a, ci, ca) => {
        if (ci > 0 && SENSITIVE_ARG_RE.test(ca[ci - 1]!)) return '"***"'
        return /\s/.test(a) ? `"${a}"` : a
      })
      .join(' ')
    sendProgress('launch', { percent: -1, status: i18n.t('launch.starting') })
    if (!sender.isDestroyed()) {
      sender.send('comfy-output', { installationId: sessionId, text: `> ${cmdLine}\n\n` })
    }
    appendLog(sessionId, `> ${cmdLine}\n\n`)
    telemetry.capture('comfy.desktop.comfyui.boot_started', {
      installation_id: installationId,
      boot_id: bootId,
      variant: (inst.variant as string | undefined) ?? null,
      ...bootCohort(),
      port_retry_count: portRetries,
      reboot_retry_count: rebootRetries,
      assets_retry_count: assetsRetries,
      port: launchCmd.port ?? null,
      port_bumped_from: portBumpedFrom
    })
    startBootPhases(sessionId, (inst.variant as string | undefined) ?? null)
    tracker.resetPhaseObservation()
    const spawned = await spawnComfy()

    let earlyExit: string | null = null
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
          const rendered = signal
            ? `signal ${signal}`
            : `code ${await describeExitCode(code, spawned.getStderr())}`
          earlyExit = `Process exited with ${rendered}${detail}`
          reject(new Error(earlyExit))
        }
      })
    })

    try {
      await Promise.race([
        waitForPort(launchCmd.port!, '127.0.0.1', {
          timeoutMs: COMFY_BOOT_TIMEOUT_MS,
          signal: abort.signal
        }),
        earlyExitPromise
      ])
      if (abort.signal.aborted) throw new Error('Launch cancelled')
      return { ok: true, proc: spawned.proc, getStderr: spawned.getStderr }
    } catch (err) {
      const exitedDuringStartup = exitCode !== null
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
      const stopped = await killProcessTree(spawned.proc)
      if (!stopped.exited) {
        sendOutput(`\nThe failed ComfyUI process did not exit in time; not retrying.\n`)
      }
      if (stopped.exited && checkRebootMarker(sessionPath) && rebootRetries < REBOOT_RETRY_MAX) {
        rebootRetries++
        sendOutput('\n--- Manager requested restart during startup, respawning… ---\n\n')
        return tryLaunch()
      }
      if (
        stopped.exited &&
        exitedDuringStartup &&
        desktopAddedAssets &&
        assetsRetries === 0 &&
        isNewerAssetDbFailure(spawned.getStderr())
      ) {
        assetsRetries++
        launchCmd.args = launchCmd.args!.filter((arg) => arg !== '--enable-assets')
        const record =
          '[assets] --enable-assets withheld: the asset database is from a newer ComfyUI\n'
        writeLog(logStream, record)
        sendOutput(`\n${record}\n`)
        return tryLaunch()
      }
      const stderr = spawned.getStderr().toLowerCase()
      const isPortConflict =
        stderr.includes('address already in use') ||
        (stderr.includes('port') && stderr.includes('in use'))
      if (
        stopped.exited &&
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
    if (_operationAborts.get(sessionId) === abort) _operationAborts.delete(sessionId)
    abort.abort()
    _clearLaunchingFailed(sessionId)
    clearBetaActivationClaim(installationId)
    hwTap.flushSummary()
    assetsTap.flushSummary()
    if (launchResult.cancelled) {
      clearBootPhases(sessionId)
      return { ok: false, cancelled: true }
    }
    execTap.flushSummary()
    const failedPhase = flushBootPhasesOnFailure(sessionId)
    const tail = errorTail(launchResult.stderr)
    const errorSource = tail
      ? `${launchResult.message}\n${launchResult.stderr}`
      : launchResult.message
    const assetsFailure = parseAssetsStartupFailure(launchResult.stderr)
    const dbLocked =
      assetsFailure?.kind === 'in_use' ||
      (launchCmd.args!.includes('--enable-assets') && isDbLockFailure(launchResult.stderr))
    const bootFailed = {
      installation_id: installationId,
      boot_id: bootId,
      variant: (inst.variant as string | undefined) ?? null,
      ...bootCohort(),
      failed_phase: failedPhase,
      ...buildErrorFields(errorSource),
      error_tail: tail,
      exit_code: launchResult.exitCode ?? null,
      signal: launchResult.signal ?? null,
      retry_count: portRetries + rebootRetries + assetsRetries,
      port_retry_count: portRetries,
      reboot_retry_count: rebootRetries,
      assets_retry_count: assetsRetries,
      assets_startup_failure: assetsFailure?.kind ?? null
    }
    if (dbLocked) {
      void identifyDbLockHolder({
        sessionKey: sessionId,
        installationId,
        installPath: inst.installPath,
        cwd: launchCmd.cwd!,
        args: launchCmd.args!
      })
        .catch(() => null)
        .then((holder) => {
          appendLog(
            sessionId,
            `[launch] ComfyUI could not start: another process holds this installation's ` +
              `database lock (${describeLockHolder(holder)})\n`
          )
          telemetry.emit('comfy.desktop.comfyui.boot_failed', {
            ...bootFailed,
            error_class: 'comfyui_db_locked',
            lock_holder_pid: holder?.pid ?? null,
            lock_holder_source: holder?.source ?? 'unknown',
            lock_holder_same_install: holder?.sameInstall ?? null,
            lock_holder_name: holder?.name ?? null,
            lock_holder_runs_main_py: holder?.runsMainPy ?? null,
            lock_holder_age_s: holder?.ageS ?? null
          })
        })
    } else {
      telemetry.emit('comfy.desktop.comfyui.boot_failed', bootFailed)
    }
    if (dbLocked) {
      return { ok: false, message: i18n.t('errors.comfyDbLocked') }
    }
    return { ok: false, message: assetsFailure?.message || launchResult.message }
  }
  clearBootPhases(sessionId)
  let { proc } = launchResult

  _pendingPorts.delete(launchCmd.port!)
  if (_operationAborts.get(sessionId) === abort) _operationAborts.delete(sessionId)
  const mode = _resolveLaunchMode(inst, actionData)
  const bootTimeMs = Date.now() - launchStartedAt
  _addSession(
    sessionId,
    {
      proc,
      port: launchCmd.port!,
      mode,
      installationName: inst.name,
      coreBetaArgs: coreBeta.applied.map(toBetaArgView),
      getAcceleratorInfo: () => hwTap.getAcceleratorInfo(),
      flushTelemetry: () => {
        execTap.flushSummary()
        hwTap.flushSummary()
        assetsTap.flushSummary()
      }
    },
    bootTimeMs,
    { portRetries, rebootRetries },
    installationId
  )
  telemetry.capture('comfy.desktop.comfyui.boot_completed', {
    installation_id: installationId,
    boot_id: bootId,
    variant: (inst.variant as string | undefined) ?? null,
    ...bootCohort(),
    boot_time_ms: bootTimeMs,
    port_retry_count: portRetries,
    reboot_retry_count: rebootRetries,
    assets_retry_count: assetsRetries
  })
  writePortLock(launchCmd.port!, { pid: proc.pid!, installationName: inst.name })

  if (!sender.isDestroyed()) {
    const bootStderr = lastNLines(launchResult.getStderr(), 50)
    sender.send('comfy-boot-log', { installationId: sessionId, bootStderr })
  }

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
        await Promise.resolve(_onModelFolderRelaunch({ installationId: sessionId })).catch(() => {})
      }
      const abandonRelaunch = (): void => {
        logStream.end()
        execTap.flushSummary()
        hwTap.flushSummary()
        assetsTap.flushSummary()
        _removeSession(sessionId)
        _clearLaunchingFailed(sessionId)
        clearBetaActivationClaim(installationId)
      }
      const stopped = await killProcessTree(proc)
      if (!stopped.exited) {
        abandonRelaunch()
        return { ok: false, message: i18n.t('errors.priorProcessStuck', { pid: proc.pid ?? 0 }) }
      }
      const respawned = await spawnComfy()
      proc = respawned.proc
      const session = _runningSessions.get(sessionId)
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
        await Promise.race([
          waitForPort(launchCmd.port!, '127.0.0.1', {
            timeoutMs: COMFY_BOOT_TIMEOUT_MS,
            signal: abort.signal
          }),
          relaunchEarlyExit
        ])
      } catch (err) {
        await killProcessTree(proc)
        abandonRelaunch()
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
    onProcessTerminated(p, async (code, signal, { pipesHeld }) => {
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
        const session = _runningSessions.get(sessionId)
        if (session) session.proc = proc
        writePortLock(launchCmd.port!, { pid: proc.pid!, installationName: inst.name })
        attachExitHandler(proc)
        if (_onComfyRestarted) _onComfyRestarted({ installationId: sessionId, process: proc })
        if (manageModelFolders) {
          rebootModelCheckAbort = new AbortController()
          const checkSignal = rebootModelCheckAbort.signal
          waitForPort(launchCmd.port!, '127.0.0.1', {
            timeoutMs: COMFY_BOOT_TIMEOUT_MS,
            signal: checkSignal
          })
            .then(async () => {
              if (checkSignal.aborted) return
              const currentSession = _runningSessions.get(sessionId)
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
                  await Promise.resolve(
                    _onModelFolderRelaunch({ installationId: sessionId })
                  ).catch(() => {})
                }
                killProcessTree(proc)
              }
            })
            .catch(() => {})
        }
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
      const crashed = _runningSessions.has(sessionId) && isCrashedExit(code, signal)
      const lastStderr = lastNLines(currentGetStderr(), 100)
      execTap.flushSummary()
      hwTap.flushSummary()
      assetsTap.flushSummary()
      const crashDiagnosis = crashed ? await diagnoseCrash(code) : {}
      _removeSession(sessionId)
      const exitedPayload = {
        installationId: sessionId,
        crashed,
        exitCode: code ?? undefined,
        signal: signal ?? undefined,
        installationName: inst.name,
        lastStderr,
        ...crashDiagnosis
      }
      telemetry.emit('comfy.desktop.comfyui.exited', {
        installation_id: installationId,
        crashed,
        exit_code: code ?? null,
        session_kind: sessionKind,
        last_stderr: lastStderr ?? null,
        pipes_held_after_exit: pipesHeld
      })
      if (crashed) {
        recordCrash(exitedPayload)
        _broadcastToRenderer('instance-crashed', exitedPayload)
      }
      if (!sender.isDestroyed()) {
        sender.send('comfy-exited', exitedPayload)
      }
      if (_onComfyExited) _onComfyExited({ installationId: sessionId, crashed })
    })
  }
  attachExitHandler(proc)

  await waitForTemplateDownloadGate()

  abort.abort()

  if (_onLaunch) {
    _onLaunch({ port: launchCmd.port!, process: proc, installation: inst, mode })
  }
  return { ok: true, mode, port: launchCmd.port }
}
