import { app, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { release as osRelease } from 'node:os'
import semver from 'semver'
import todesktop from '@todesktop/runtime'
import { autoUpdater as electronAutoUpdater } from 'electron-updater'
import * as settings from '../settings'
import { getSafeFileDiagnostics } from './safe-file'
import {
  clearStartupAttemptMarker,
  readStartupAttemptMarker,
  recordStartupAttempt,
  recordStartupAttemptOutcome,
  type StartupAttemptMarkerRead
} from './startup-attempt-marker'
import { clearQuitReason, getQuitReason, isSessionEnding, setQuitReason } from './quit-state'
import { _broadcastToRenderer } from './ipc/shared'
import { deriveAppChannel, emit as emitTelemetry } from './telemetry'
import { buildErrorFields, errorTail } from '../../shared/errorEvent'

export interface AppUpdateState {
  kind: 'available' | 'downloading' | 'ready' | null
  version: string | null
  autoUpdate: boolean
}

let _appUpdateState: AppUpdateState = { kind: null, version: null, autoUpdate: true }
let _autoDownloadTriggeredFor: string | null = null
const _appUpdateEmittedOnce: Map<string, Set<string>> = new Map()
function _shouldEmitAppUpdateOnce(event: string, version: string | null): boolean {
  if (!version) return true
  let seen = _appUpdateEmittedOnce.get(event)
  if (!seen) {
    seen = new Set()
    _appUpdateEmittedOnce.set(event, seen)
  }
  if (seen.has(version)) return false
  seen.add(version)
  return true
}
let _userInitiatedDownload = false
const _stateChangeCallbacks = new Set<(state: AppUpdateState) => void>()
const _downloadProgressObservers = new Set<() => void>()
let _listenersBound = false

interface UpdateAttempt {
  id: string
  version: string
}

let _updateAttempt: UpdateAttempt | null = null

function updateAttemptId(targetVersion: string | null, create = false): string | null {
  if (_updateAttempt?.version === targetVersion) return _updateAttempt.id
  const existing = settings.get('pendingDesktopUpdateAttemptId')
  const existingVersion = settings.get('pendingDesktopUpdateAttemptVersion')
  if (typeof existing === 'string' && existing && existingVersion === targetVersion) {
    _updateAttempt = { id: existing, version: targetVersion }
    return existing
  }
  if (!create || !targetVersion) return null
  const id = randomUUID()
  _updateAttempt = { id, version: targetVersion }
  try {
    settings.set('pendingDesktopUpdateAttemptId', id)
    settings.set('pendingDesktopUpdateAttemptVersion', targetVersion)
  } catch {}
  return id
}

function clearUpdateAttempt(attemptId: string): void {
  if (_updateAttempt?.id === attemptId) _updateAttempt = null
  if (settings.get('pendingDesktopUpdateAttemptId') !== attemptId) return
  try {
    settings.set('pendingDesktopUpdateAttemptId', undefined)
    settings.set('pendingDesktopUpdateAttemptVersion', undefined)
  } catch {}
}

function emitUpdateTelemetry(
  event: string,
  targetVersion: string | null,
  properties: Record<string, string | number | boolean | null | undefined> = {},
  createAttempt = false
): void {
  emitTelemetry(event, {
    running_version: app.getVersion(),
    target_version: targetVersion,
    update_attempt_id: updateAttemptId(targetVersion, createAttempt),
    platform: process.platform,
    os_version: osRelease(),
    app_channel: deriveAppChannel(app.getVersion()),
    is_packaged: app.isPackaged,
    updater_provider: 'todesktop',
    updater_mode: app.isPackaged ? 'packaged' : 'development',
    ...properties
  })
}

function _setUpdateState(next: AppUpdateState): void {
  _appUpdateState = next
  for (const cb of _stateChangeCallbacks) {
    try {
      cb(next)
    } catch {}
  }
  _broadcastToRenderer('app-update:state-changed', next)
}

const NO_UPDATE_AVAILABLE_MESSAGE = 'No update available. Try checking for updates first.'
const UPDATER_UNAVAILABLE_MESSAGE = 'ToDesktop auto-updater is unavailable.'

function isAutoInstallEnabled(): boolean {
  return settings.get('autoInstallUpdates') !== false
}

export function notifyAutoUpdateChanged(): void {
  syncInstallOnQuitPolicy()
  if (_appUpdateState.kind === null) return
  const refreshed = isAutoInstallEnabled()
  if (_appUpdateState.autoUpdate === refreshed) return
  _setUpdateState({ ..._appUpdateState, autoUpdate: refreshed })
}

function isSystemPackageInstall(): boolean {
  if (process.platform !== 'linux' || !app.isPackaged) return false
  if (process.env.APPIMAGE) return false
  const appPath = app.getPath('exe')
  return appPath.startsWith('/opt/') || appPath.startsWith('/usr/')
}

function isWindowsOptOutGate(key: 'installUpdatesOnStartup' | 'showInstallerUI'): boolean {
  if (process.platform !== 'win32') return false
  return settings.get(key) !== false
}

function isStartupInstallEnabled(): boolean {
  return isWindowsOptOutGate('installUpdatesOnStartup')
}

function isInstallerUIEnabled(): boolean {
  return isWindowsOptOutGate('showInstallerUI')
}

let _installOnQuitSuppressedForSession = false

export function suppressInstallOnQuit(): void {
  _installOnQuitSuppressedForSession = true
  try {
    electronAutoUpdater.autoInstallOnAppQuit = false
  } catch {}
}

export function syncInstallOnQuitPolicy(): void {
  try {
    electronAutoUpdater.autoInstallOnAppQuit =
      !_installOnQuitSuppressedForSession && !isStartupInstallEnabled() && isAutoInstallEnabled()
  } catch {}
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function versionFromPayload(payload: unknown): string | null {
  const topLevel = asRecord(payload)
  if (!topLevel) return null
  const direct = topLevel.version
  if (typeof direct === 'string' && direct) return direct
  const nested = asRecord(topLevel.updateInfo)
  if (!nested) return null
  const nestedVersion = nested.version
  if (typeof nestedVersion === 'string' && nestedVersion) return nestedVersion
  return null
}

function isStrictlyNewerVersion(offered: string | null | undefined, current: string): boolean {
  if (!offered) return false
  const o = semver.valid(offered)
  const c = semver.valid(current)
  if (!o || !c) return false
  return semver.gt(o, c)
}

function shouldIgnoreNonNewerVersion(version: string, stage: string): boolean {
  if (isStrictlyNewerVersion(version, app.getVersion())) return false
  if (_shouldEmitAppUpdateOnce('comfy.desktop.app_update.ignored_not_newer', version)) {
    emitUpdateTelemetry('comfy.desktop.app_update.ignored_not_newer', version, {
      version,
      current: app.getVersion(),
      stage
    })
  }
  return true
}

function updaterErrorMessage(args: unknown[]): string {
  for (const arg of args) {
    if (arg instanceof Error && arg.message) return arg.message
  }
  for (const arg of args) {
    if (typeof arg === 'string' && arg.trim()) return arg
  }
  return 'Update check failed.'
}

type DesktopUpdateOperation = 'check' | 'download' | 'apply_restart'
let _lastUpdateError: { key: string; at: number } | null = null
interface ActiveUpdateOperation {
  operation: DesktopUpdateOperation
  source: string
  targetVersion: string | null
  userInitiated: boolean
  startedAt: number
}
let _activeUpdateOperation: ActiveUpdateOperation | null = null

function currentUpdateOperation(): ActiveUpdateOperation | null {
  if (!_activeUpdateOperation) return null
  return Date.now() - _activeUpdateOperation.startedAt < 60_000 ? _activeUpdateOperation : null
}

function emitDesktopUpdateError(
  operation: DesktopUpdateOperation,
  error: unknown,
  options: { userInitiated: boolean; targetVersion?: string | null; source: string }
): void {
  const message = Array.isArray(error) ? updaterErrorMessage(error) : updaterErrorMessage([error])
  const targetVersion =
    options.targetVersion === undefined ? _appUpdateState.version : options.targetVersion
  const key = `${operation}|${targetVersion}|${message}`
  const now = Date.now()
  if (_lastUpdateError?.key === key && now - _lastUpdateError.at < 1_000) return
  _lastUpdateError = { key, at: now }
  const errorObject = Array.isArray(error)
    ? error.find((value): value is Error => value instanceof Error)
    : error instanceof Error
      ? error
      : null
  emitUpdateTelemetry('comfy.desktop.app_update.error', targetVersion, {
    component: 'desktop_application',
    operation,
    stage: operation === 'apply_restart' ? 'install' : operation,
    error_source: options.source,
    setting_use_chinese_mirrors: settings.get('useChineseMirrors') === true,
    ...buildErrorFields(errorObject ?? message),
    ...(errorObject?.stack ? { error_stack: errorTail(errorObject.stack) } : {}),
    user_initiated: options.userInitiated
  })
}

function getAutoUpdater() {
  return todesktop.autoUpdater
}

function bindUpdaterEvents(): void {
  if (_listenersBound) return
  const updater = getAutoUpdater()
  if (!updater) return
  _listenersBound = true

  updater.on('update-available', (info: unknown) => {
    const version = versionFromPayload(info)
    if (!version) return
    if (shouldIgnoreNonNewerVersion(version, 'available')) return
    const autoInstall = isAutoInstallEnabled()
    if (_shouldEmitAppUpdateOnce('comfy.desktop.app_update.available', version)) {
      emitUpdateTelemetry(
        'comfy.desktop.app_update.available',
        version,
        {
          version,
          auto_update_setting: autoInstall ? 'on' : 'off'
        },
        true
      )
    }
    if (autoInstall) {
      const active = currentUpdateOperation()
      if (active?.operation === 'check') {
        active.operation = 'download'
        active.targetVersion = version
        active.startedAt = Date.now()
      }
      if (_autoDownloadTriggeredFor !== version) {
        _autoDownloadTriggeredFor = version
        if (_shouldEmitAppUpdateOnce('comfy.desktop.app_update.download_started', version)) {
          emitUpdateTelemetry(
            'comfy.desktop.app_update.download_started',
            version,
            { version, initiator: 'auto' },
            true
          )
        }
      }
      return
    }
    _setUpdateState({ kind: 'available', version, autoUpdate: false })
  })

  updater.on('update-downloaded', (event: unknown) => {
    const version = versionFromPayload(event)
    if (!version) return
    if (shouldIgnoreNonNewerVersion(version, 'downloaded')) return
    _autoDownloadTriggeredFor = null
    if (_shouldEmitAppUpdateOnce('comfy.desktop.app_update.download_complete', version)) {
      emitUpdateTelemetry('comfy.desktop.app_update.download_complete', version, { version }, true)
    }
    try {
      settings.set('pendingDownloadedUpdateVersion', version)
    } catch {}
    _setUpdateState({ kind: 'ready', version, autoUpdate: isAutoInstallEnabled() })
    if (_userInitiatedDownload) {
      _userInitiatedDownload = false
      _broadcastToRenderer('app-update:prompt-restart', { version })
    }
  })

  updater.on('error', (...args: unknown[]) => {
    const wasUserInitiated = _userInitiatedDownload
    const active = currentUpdateOperation()
    const operation =
      active?.operation ??
      (_appUpdateState.kind === 'downloading' || _autoDownloadTriggeredFor || wasUserInitiated
        ? 'download'
        : 'check')
    emitDesktopUpdateError(operation, args, {
      userInitiated: active?.userInitiated ?? wasUserInitiated,
      targetVersion:
        active?.targetVersion ??
        (operation === 'download' ? (_autoDownloadTriggeredFor ?? _appUpdateState.version) : null),
      source: active ? `updater_event:${active.source}` : 'updater_event'
    })
    _activeUpdateOperation = null
    clearQuitReason()
    _autoDownloadTriggeredFor = null
    _userInitiatedDownload = false
    if (_appUpdateState.kind === 'downloading') {
      if (_appUpdateState.autoUpdate) {
        _setUpdateState({ kind: null, version: null, autoUpdate: true })
      } else {
        _setUpdateState({
          kind: 'available',
          version: _appUpdateState.version,
          autoUpdate: _appUpdateState.autoUpdate
        })
      }
    }
    if (wasUserInitiated) {
      _broadcastToRenderer('app-update:user-action-failed', { message: updaterErrorMessage(args) })
    }
  })

  updater.on('download-progress', (info: unknown) => {
    for (const cb of _downloadProgressObservers) cb()
    const p = asRecord(info)
    if (!p) return
    const percent = typeof p.percent === 'number' ? p.percent : null
    const transferred = typeof p.transferred === 'number' ? p.transferred : null
    const total = typeof p.total === 'number' ? p.total : null
    const bytesPerSecond = typeof p.bytesPerSecond === 'number' ? p.bytesPerSecond : null
    if (_appUpdateState.kind !== 'downloading' && _appUpdateState.kind !== 'ready') {
      _setUpdateState({
        kind: 'downloading',
        version: _appUpdateState.version ?? _autoDownloadTriggeredFor,
        autoUpdate: isAutoInstallEnabled()
      })
    }
    _broadcastToRenderer('app-update:download-progress', {
      percent,
      transferred,
      total,
      bytesPerSecond
    })
  })
}

const USER_INITIATED_CHECK_TRIGGERS = new Set(['manual-check', 'download-button'])

async function checkForUpdate(
  source: string
): Promise<{ available: boolean; version?: string; error?: string }> {
  const operation: DesktopUpdateOperation =
    source === 'download-button' || source === 'auto-download' ? 'download' : 'check'
  const activeOperation: ActiveUpdateOperation = {
    operation,
    source,
    targetVersion: operation === 'download' ? _appUpdateState.version : null,
    userInitiated: USER_INITIATED_CHECK_TRIGGERS.has(source),
    startedAt: Date.now()
  }
  _activeUpdateOperation = activeOperation
  try {
    const updater = getAutoUpdater()
    if (!updater) {
      if (USER_INITIATED_CHECK_TRIGGERS.has(source)) {
        emitUpdateTelemetry('comfy.desktop.app_update.checked', null, {
          trigger: source,
          result: 'updater_unavailable'
        })
      }
      return { available: false, error: UPDATER_UNAVAILABLE_MESSAGE }
    }
    bindUpdaterEvents()
    const result = await updater.checkForUpdates({
      source,
      disableUpdateReadyAction: true
    })
    const version = versionFromPayload(result)
    if (version && shouldIgnoreNonNewerVersion(version, 'check')) {
      return { available: false }
    }
    if (
      version &&
      USER_INITIATED_CHECK_TRIGGERS.has(source) &&
      _shouldEmitAppUpdateOnce('comfy.desktop.app_update.checked', version)
    ) {
      emitUpdateTelemetry(
        'comfy.desktop.app_update.checked',
        version,
        {
          trigger: source,
          result: 'available'
        },
        true
      )
    }
    return version ? { available: true, version } : { available: false }
  } catch (err) {
    emitDesktopUpdateError(activeOperation.operation, err, {
      userInitiated: activeOperation.userInitiated,
      targetVersion: activeOperation.targetVersion,
      source
    })
    throw err
  } finally {
    if (_activeUpdateOperation === activeOperation) _activeUpdateOperation = null
  }
}

export function runCheck(
  source: string
): Promise<{ available: boolean; version?: string; error?: string }> {
  return checkForUpdate(source)
}

export function getCurrentUpdateState(): AppUpdateState {
  return _appUpdateState
}

export function onUpdateStateChanged(cb: (state: AppUpdateState) => void): () => void {
  _stateChangeCallbacks.add(cb)
  return () => {
    _stateChangeCallbacks.delete(cb)
  }
}

export async function downloadUpdate(): Promise<void> {
  _userInitiatedDownload = true
  emitUpdateTelemetry(
    'comfy.desktop.app_update.download_started',
    _appUpdateState.version,
    {
      version: _appUpdateState.version,
      initiator: 'user'
    },
    true
  )
  try {
    const result = await runCheck('download-button')
    if (!result.available && _appUpdateState.kind !== 'ready') {
      _userInitiatedDownload = false
      if (result.error) {
        emitDesktopUpdateError('download', result.error, {
          userInitiated: true,
          source: 'download_check'
        })
      }
      _broadcastToRenderer('app-update:user-action-failed', {
        message: result.error || NO_UPDATE_AVAILABLE_MESSAGE
      })
    }
  } catch (err) {
    _userInitiatedDownload = false
    _broadcastToRenderer('app-update:user-action-failed', {
      message: err instanceof Error ? err.message : String(err)
    })
  }
}

export function installUpdate(userInitiated = true): void {
  const updateSource = userInitiated ? 'install_call' : 'startup_install'
  if (isSessionEnding()) {
    return
  }
  const updater = getAutoUpdater()
  if (!updater) {
    emitDesktopUpdateError('apply_restart', UPDATER_UNAVAILABLE_MESSAGE, {
      userInitiated,
      source: updateSource
    })
    _broadcastToRenderer('app-update:user-action-failed', { message: UPDATER_UNAVAILABLE_MESSAGE })
    return
  }
  emitUpdateTelemetry('comfy.desktop.app_update.install_triggered', _appUpdateState.version, {
    version: _appUpdateState.version,
    auto_update_setting: isAutoInstallEnabled() ? 'on' : 'off'
  })
  try {
    _activeUpdateOperation = {
      operation: 'apply_restart',
      source: updateSource,
      targetVersion: _appUpdateState.version,
      userInitiated,
      startedAt: Date.now()
    }
    setQuitReason('update-install')
    if (process.platform === 'darwin') {
      app.releaseSingleInstanceLock()
    }
    updater.restartAndInstall({ isSilent: !isInstallerUIEnabled() })
  } catch (err) {
    _activeUpdateOperation = null
    clearQuitReason()
    emitDesktopUpdateError('apply_restart', err, {
      userInitiated,
      source: updateSource
    })
    _broadcastToRenderer('app-update:user-action-failed', {
      message: err instanceof Error ? err.message : String(err)
    })
  }
}

export function _test_setUpdateState(next: AppUpdateState): void {
  _setUpdateState(next)
}

export function recordStartupInstallBackstopRecovered(): void {
  emitUpdateTelemetry(
    'comfy.desktop.app_update.startup_install_backstop_recovered',
    _appUpdateState.version ?? settings.get('pendingDownloadedUpdateVersion') ?? null
  )
}

let _processExitRecorded = false

export function recordProcessExit(): void {
  if (_processExitRecorded) return
  const targetVersion = _appUpdateState.version ?? _autoDownloadTriggeredFor
  if (!targetVersion && !_activeUpdateOperation) return
  _processExitRecorded = true
  emitUpdateTelemetry('comfy.desktop.app_update.process_exit', targetVersion, {
    quit_reason: getQuitReason(),
    download_in_progress:
      _activeUpdateOperation?.operation === 'download' ||
      _autoDownloadTriggeredFor !== null ||
      _userInitiatedDownload
  })
}

const STARTUP_UPDATE_CHECK_TIMEOUT_MS = 5000

const STARTUP_INSTALL_MIN_SPLASH_MS = 5000

const STARTUP_INSTALL_NOT_READY_LIMIT = 3

type StartupInstallDecision =
  | { attempt: true; version: string }
  | {
      attempt: false
      reason:
        | 'disabled'
        | 'auto_install_disabled'
        | 'e2e'
        | 'system_managed'
        | 'session_ending'
        | 'no_pending'
        | 'loop_breaker'
        | 'marker_unavailable'
      loopBreakerSource?: 'settings' | 'sidecar'
    }

function evaluateStartupInstall(sidecar: StartupAttemptMarkerRead): StartupInstallDecision {
  if (!isStartupInstallEnabled()) return { attempt: false, reason: 'disabled' }
  if (!isAutoInstallEnabled()) return { attempt: false, reason: 'auto_install_disabled' }
  if (process.env['E2E'] === '1') return { attempt: false, reason: 'e2e' }
  if (isSystemPackageInstall()) return { attempt: false, reason: 'system_managed' }
  if (isSessionEnding()) return { attempt: false, reason: 'session_ending' }
  const pending = settings.get('pendingDownloadedUpdateVersion')
  if (!pending || !isStrictlyNewerVersion(pending, app.getVersion())) {
    return { attempt: false, reason: 'no_pending' }
  }
  const lastAttempt = settings.get('lastStartupUpdateAttemptVersion')
  if (lastAttempt === pending) {
    return { attempt: false, reason: 'loop_breaker', loopBreakerSource: 'settings' }
  }
  if (sidecar.state === 'present' && sidecar.marker.version === pending) {
    return { attempt: false, reason: 'loop_breaker', loopBreakerSource: 'sidecar' }
  }
  if (sidecar.state === 'unavailable') {
    return { attempt: false, reason: 'marker_unavailable' }
  }
  return { attempt: true, version: pending }
}

export function hasPendingStartupUpdate(): boolean {
  return evaluateStartupInstall(readStartupAttemptMarker()).attempt
}

type StartupUpdateWaitOutcome = 'ready' | 'downloading' | 'check_failed' | 'timeout'

function waitForStartupUpdateOutcome(timeoutMs: number): Promise<StartupUpdateWaitOutcome> {
  if (getCurrentUpdateState().kind === 'ready') return Promise.resolve('ready')
  return new Promise<StartupUpdateWaitOutcome>((resolve) => {
    let done = false
    const finish = (outcome: StartupUpdateWaitOutcome): void => {
      if (done) return
      done = true
      unsub()
      _downloadProgressObservers.delete(onDownloadProgress)
      clearTimeout(timer)
      resolve(outcome)
    }
    const unsub = onUpdateStateChanged((s) => {
      if (s.kind === 'ready') finish('ready')
    })
    const onDownloadProgress = (): void => finish('downloading')
    _downloadProgressObservers.add(onDownloadProgress)
    const timer = setTimeout(() => finish('timeout'), timeoutMs)
    runCheck('startup-install')
      .then((result) => {
        if (getCurrentUpdateState().kind === 'ready') finish('ready')
        else if (!result.available) finish('check_failed')
      })
      .catch(() => finish('check_failed'))
  })
}

export interface StartupInstallHooks {
  onInstallCommitted?: () => void | Promise<void>
}

export async function applyPendingUpdateOnStartup(hooks?: StartupInstallHooks): Promise<boolean> {
  const running = app.getVersion()
  const lastAttempt = settings.get('lastStartupUpdateAttemptVersion')
  const pendingVersion = settings.get('pendingDownloadedUpdateVersion')
  let sidecar = readStartupAttemptMarker()

  if (sidecar.state === 'present' && sidecar.marker.attemptId) {
    const previousAttemptId = sidecar.marker.attemptId
    const previousAttemptVersion = sidecar.marker.version
    _updateAttempt = { id: previousAttemptId, version: previousAttemptVersion }
    const outcome = !isStrictlyNewerVersion(previousAttemptVersion, running)
      ? 'installed'
      : pendingVersion === previousAttemptVersion
        ? 'still_pending'
        : !pendingVersion
          ? 'staged_marker_missing'
          : 'unknown'
    if (sidecar.marker.reportedOutcome !== outcome) {
      emitUpdateTelemetry(
        'comfy.desktop.app_update.previous_attempt_outcome',
        previousAttemptVersion,
        {
          update_attempt_id: previousAttemptId,
          outcome,
          bakFallbacks: getSafeFileDiagnostics().bakFallbacks
        }
      )
      recordStartupAttemptOutcome(sidecar.marker, outcome)
    }
    if (outcome === 'installed') clearUpdateAttempt(previousAttemptId)
  }

  if (lastAttempt && !isStrictlyNewerVersion(lastAttempt, running)) {
    settings.set('lastStartupUpdateAttemptVersion', undefined)
  }
  if (pendingVersion && !isStrictlyNewerVersion(pendingVersion, running)) {
    settings.set('pendingDownloadedUpdateVersion', undefined)
  }
  const notReadyVersion = settings.get('startupInstallNotReadyVersion')
  if (notReadyVersion && !isStrictlyNewerVersion(notReadyVersion, running)) {
    settings.set('startupInstallNotReadyVersion', undefined)
    settings.set('startupInstallNotReadyCount', undefined)
  }
  const pendingAttemptId = settings.get('pendingDesktopUpdateAttemptId')
  const pendingAttemptVersion = settings.get('pendingDesktopUpdateAttemptVersion')
  if (
    typeof pendingAttemptId === 'string' &&
    typeof pendingAttemptVersion === 'string' &&
    !isStrictlyNewerVersion(pendingAttemptVersion, running)
  ) {
    clearUpdateAttempt(pendingAttemptId)
  }
  if (sidecar.state === 'present' && !isStrictlyNewerVersion(sidecar.marker.version, running)) {
    clearStartupAttemptMarker()
    sidecar = { state: 'absent' }
  }

  const decision = evaluateStartupInstall(sidecar)
  if (pendingVersion && isStrictlyNewerVersion(pendingVersion, running)) {
    emitUpdateTelemetry(
      'comfy.desktop.app_update.startup_decision',
      pendingVersion,
      {
        decision: decision.attempt ? 'install' : 'skip',
        reason: decision.attempt ? 'ready_check' : decision.reason,
        pending_version: pendingVersion,
        updater_state: getCurrentUpdateState().kind ?? 'unknown',
        marker_state: sidecar.state,
        marker_source: !decision.attempt ? (decision.loopBreakerSource ?? null) : null,
        bakFallbacks: getSafeFileDiagnostics().bakFallbacks
      },
      true
    )
  }
  if (!decision.attempt) {
    if (
      decision.reason === 'loop_breaker' ||
      decision.reason === 'session_ending' ||
      decision.reason === 'marker_unavailable'
    ) {
      emitUpdateTelemetry(
        'comfy.desktop.app_update.startup_install_skipped',
        settings.get('pendingDownloadedUpdateVersion') ?? null,
        {
          reason: decision.reason,
          version: settings.get('pendingDownloadedUpdateVersion') ?? null,
          source: decision.loopBreakerSource ?? null,
          bakFallbacks: getSafeFileDiagnostics().bakFallbacks
        }
      )
    }
    return false
  }

  const waitOutcome = await waitForStartupUpdateOutcome(STARTUP_UPDATE_CHECK_TIMEOUT_MS)

  const state = getCurrentUpdateState()
  if (state.kind !== 'ready' || state.version !== decision.version) {
    const seenVersion = settings.get('startupInstallNotReadyVersion')
    const seenCount = settings.get('startupInstallNotReadyCount')
    const consecutive =
      (seenVersion === decision.version && typeof seenCount === 'number' ? seenCount : 0) + 1
    const pendingNow = settings.get('pendingDownloadedUpdateVersion')
    const markerStillOurs = pendingNow === decision.version
    const abandoned = markerStillOurs && consecutive >= STARTUP_INSTALL_NOT_READY_LIMIT
    try {
      if (abandoned) {
        settings.set('pendingDownloadedUpdateVersion', undefined)
        settings.set('startupInstallNotReadyVersion', undefined)
        settings.set('startupInstallNotReadyCount', undefined)
      } else if (markerStillOurs) {
        settings.set('startupInstallNotReadyVersion', decision.version)
        settings.set('startupInstallNotReadyCount', consecutive)
      } else {
        settings.set('startupInstallNotReadyVersion', undefined)
        settings.set('startupInstallNotReadyCount', undefined)
      }
    } catch {}
    emitUpdateTelemetry('comfy.desktop.app_update.startup_install_skipped', decision.version, {
      reason: 'not_ready',
      version: decision.version,
      wait_outcome:
        waitOutcome === 'ready' || state.kind === 'ready' ? 'version_mismatch' : waitOutcome,
      consecutive_not_ready: consecutive,
      abandoned
    })
    return false
  }
  try {
    settings.set('startupInstallNotReadyVersion', undefined)
    settings.set('startupInstallNotReadyCount', undefined)
  } catch {}

  if (isSessionEnding()) {
    emitUpdateTelemetry('comfy.desktop.app_update.startup_install_skipped', state.version, {
      reason: 'session_ending',
      version: state.version
    })
    return false
  }

  if (hooks) {
    await hooks.onInstallCommitted?.()
    await new Promise<void>((resolve) => setTimeout(resolve, STARTUP_INSTALL_MIN_SPLASH_MS))
  }

  if (isSessionEnding()) {
    emitUpdateTelemetry('comfy.desktop.app_update.startup_install_skipped', state.version, {
      reason: 'session_ending',
      version: state.version
    })
    return false
  }

  const attemptId = updateAttemptId(state.version, true)
  if (!attemptId || !recordStartupAttempt(state.version, attemptId)) {
    emitUpdateTelemetry('comfy.desktop.app_update.startup_install_skipped', state.version, {
      reason: 'marker_not_durable',
      version: state.version,
      bakFallbacks: getSafeFileDiagnostics().bakFallbacks
    })
    return false
  }
  try {
    settings.set('lastStartupUpdateAttemptVersion', decision.version)
  } catch {}
  emitUpdateTelemetry('comfy.desktop.app_update.startup_install', state.version, {
    version: state.version,
    bakFallbacks: getSafeFileDiagnostics().bakFallbacks
  })
  installUpdate(false)
  return true
}

export function register(): void {
  bindUpdaterEvents()

  syncInstallOnQuitPolicy()

  ipcMain.handle('check-for-update', async () => {
    try {
      return await runCheck('manual-check')
    } catch (err) {
      return { available: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('download-update', async () => {
    await downloadUpdate()
  })

  ipcMain.handle('install-update', () => {
    installUpdate()
  })

  ipcMain.handle('get-update-capabilities', () => {
    const systemManaged = isSystemPackageInstall()
    return { canAutoUpdate: !systemManaged, systemManaged }
  })

  ipcMain.handle('get-app-update-state', () => getCurrentUpdateState())

  const runAutoCheck = (): void => {
    runCheck('auto-check').catch(() => {})
  }
  setTimeout(runAutoCheck, 2000)
  setInterval(runAutoCheck, 10 * 60 * 1000)
}
