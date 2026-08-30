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

/**
 * Title-bar status pills consume the current app-update state via
 * `getCurrentUpdateState()` for the initial push (when a title bar
 * mounts after the broadcast already fired) and via the
 * `onUpdateStateChanged` callback for live updates. The two stay in
 * sync because both writes go through `_setUpdateState`, which fans
 * out to every registered callback.
 *
 * `kind` is `'available'` after `update-available`, `'ready'` after
 * `update-downloaded`, and `null` when nothing is pending. `version`
 * carries the corresponding version string. `update-error` does NOT
 * clear the kind — the pill keeps reflecting the last-known state so
 * the user can still act on a previously-discovered update.
 *
 * `autoUpdate` mirrors the `autoUpdate` setting at the moment the
 * state was committed. With auto-updates ON the `'available'` state
 * is suppressed (main triggers the download itself) so the user only
 * ever sees the `'ready'` pill ("Desktop Update Ready"). With
 * auto-updates OFF the `'available'` pill ("Desktop Update Available")
 * surfaces a confirm-modal that runs the download.
 */
export interface AppUpdateState {
  kind: 'available' | 'downloading' | 'ready' | null
  version: string | null
  autoUpdate: boolean
}

let _appUpdateState: AppUpdateState = { kind: null, version: null, autoUpdate: true }
/** Guard against re-entering the update-available → runCheck →
 *  update-available cycle. todesktop usually dedupes per-version
 *  internally, but the intent here is explicit: we only programmatically
 *  kick off the download once per detected version even if the periodic
 *  auto-check refires the event. Reset on `update-downloaded` and on
 *  `update-error` so a subsequent check for a NEW version can trigger
 *  again. */
let _autoDownloadTriggeredFor: string | null = null
/** Telemetry dedup per `(event-name × version)` per process. The
 *  todesktop / electron-updater state machine re-fires `update-available`
 *  and `update-downloaded` on every periodic check that finds a staged
 *  build, and our own `update-available` handler used to call
 *  `runCheck('auto-download')` re-entrantly — together they produced
 *  ~3M+ of each event in 24h across ~27 users (the volume incident
 *  this dedup was introduced for). One emit per version covers every
 *  analytical question (did this user see version X become available?
 *  did the download finish?) without per-cycle re-emit. */
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
/** True when the most recent download was started by an explicit user
 *  action (the auto-off "Desktop Update Available" pill confirm-modal).
 *  Drives the post-download "restart now?" prompt: when the user opted
 *  in to download, surface the restart prompt automatically once the
 *  download finishes. With auto-updates ON the download is silent and
 *  this stays false. Cleared on `update-downloaded` (after broadcasting
 *  the prompt) and on `update-error`. */
let _userInitiatedDownload = false
const _stateChangeCallbacks = new Set<(state: AppUpdateState) => void>()
/** Observers notified on every raw `download-progress` tick, regardless of who
 *  initiated the download. The cached `AppUpdateState` only flips to
 *  `'downloading'` for user-initiated downloads, so the startup-install wait
 *  needs this raw signal to detect that electron-updater rejected the cached
 *  installer and started re-downloading it. */
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

/** Common privacy-safe context for the complete updater chain. */
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
  // Broadcast to renderer surfaces (panel views) so the Global
  // Settings update-action panel can mirror the title-bar pill state
  // without a separate poll. Title-bar webContents pick the state up
  // via the dedicated `comfy-titlebar:app-update-state-changed`
  // channel routed through `_stateChangeCallbacks`.
  _broadcastToRenderer('app-update:state-changed', next)
}

const NO_UPDATE_AVAILABLE_MESSAGE = 'No update available. Try checking for updates first.'
const UPDATER_UNAVAILABLE_MESSAGE = 'ToDesktop auto-updater is unavailable.'

/** Issue #488 — single source of truth for the auto-install flag.
 *  Default-on: any non-`false` value (including missing) is treated as
 *  enabled. Reads the `autoInstallUpdates` key — auto-checks always
 *  run, and only the install behavior is user-controllable. The
 *  `AppUpdateState.autoUpdate` field name is kept for the renderer
 *  payload and mirrors this flag. */
function isAutoInstallEnabled(): boolean {
  return settings.get('autoInstallUpdates') !== false
}

/**
 * Settings handler calls this when the user toggles the auto-install
 * preference. Two effects:
 *   1. Re-applies the install-on-quit policy (Issue #1104) so flipping the
 *      setting arms/disarms install-on-quit immediately, without a restart.
 *      This runs regardless of whether an update is cached.
 *   2. Re-broadcasts the cached `_appUpdateState` with a refreshed `autoUpdate`
 *      flag so a pending `'ready'` state immediately reads as auto-on / auto-off
 *      (drives the title-bar pill copy and the click-modal flow without waiting
 *      for the next update-check broadcast). No-op when there's no cached state.
 */
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
  // .deb installs place the app under /opt/ or /usr/; check the executable path
  const appPath = app.getPath('exe')
  return appPath.startsWith('/opt/') || appPath.startsWith('/usr/')
}

/**
 * Windows-only feature gate that defaults on: enabled unless the setting is
 * explicitly `false`. The startup-install and installer-UI gates share this so
 * their platform check and opt-out semantics can't drift apart.
 */
function isWindowsOptOutGate(key: 'installUpdatesOnStartup' | 'showInstallerUI'): boolean {
  if (process.platform !== 'win32') return false
  return settings.get(key) !== false
}

/**
 * Local, static feature gate for applying a staged update at the next launch
 * (the "startup install" path) instead of letting electron-updater install it
 * on quit.
 *
 * Windows-only. The install corruption this guards against is specific to
 * electron-updater's NSIS install-on-quit, which spawns a detached installer the
 * OS can kill mid-write during a shutdown. macOS (Squirrel.Mac / ShipIt — a
 * launchd-supervised, resumable helper) and Linux don't have that failure mode,
 * so applying updates at startup there would only add risk to a working update
 * channel. On those platforms this always returns false.
 *
 * Default ON on Windows. The staged update applies at startup and
 * electron-updater's install-on-quit is disabled entirely. Set the
 * `installUpdatesOnStartup` setting to `false` to opt back out to the old
 * install-on-quit behavior (where the `session-end` guard,
 * `suppressInstallOnQuit`, only suppresses the install while the OS is shutting
 * down).
 */
function isStartupInstallEnabled(): boolean {
  return isWindowsOptOutGate('installUpdatesOnStartup')
}

/**
 * Local, static gate for showing the NSIS installer's own progress window during
 * an update (`isSilent: false`) instead of installing fully silently.
 *
 * Windows-only — `isSilent` is an NSIS flag with no effect on the macOS
 * (Squirrel) / Linux update paths. On an update the assisted installer skips the
 * welcome/license/directory pages (electron-builder's `skipPageIfUpdated`) and
 * our `customFinishPage` auto-launches the app + aborts the finish page, so the
 * user sees only a progress window with no clicks required. This gives
 * continuous visual feedback during the actual file copy — which our Electron
 * "Updating…" splash can't, since the copy runs after the app has quit.
 *
 * Default ON on Windows. Set the `showInstallerUI` setting to `false` to opt
 * back out to a fully silent install.
 */
function isInstallerUIEnabled(): boolean {
  return isWindowsOptOutGate('showInstallerUI')
}

/** Set once the OS session-end guard suppresses install-on-quit; never cleared
 *  for the life of the process. Latches the suppression so a later settings
 *  toggle (which re-runs `syncInstallOnQuitPolicy`) can't re-arm install-on-quit
 *  mid-shutdown and reintroduce the mid-write corruption the guard prevents. */
let _installOnQuitSuppressedForSession = false

/**
 * Disable electron-updater's install-on-quit. Called when the OS signals the
 * session is ending (Windows shutdown / restart / logoff) so the quit handler
 * electron-updater registers after a download won't spawn the installer while
 * the OS tears everything down — that mid-write kill is the corruption mode
 * behind the "reinstall on every shutdown" loop. The quit handler re-reads this
 * flag at quit time, so flipping it here is enough. Latches for the session so
 * `syncInstallOnQuitPolicy` can't undo it. Safe to call in any mode.
 */
export function suppressInstallOnQuit(): void {
  _installOnQuitSuppressedForSession = true
  try {
    electronAutoUpdater.autoInstallOnAppQuit = false
  } catch {}
}

/**
 * Reconcile electron-updater's install-on-quit flag with current settings.
 * Install-on-quit is disabled when any of:
 *   - the OS session-end guard already suppressed it for this session
 *     (`suppressInstallOnQuit` — never re-arm mid-shutdown), or
 *   - the startup-install path owns the install (Windows default — the staged
 *     update applies on the next launch, not on quit), or
 *   - the user disabled auto-install (Issue #1104 — a staged update must wait
 *     for an explicit "Desktop Update Ready" pill click rather than installing
 *     on the next quit/close).
 * It stays enabled only when none hold (non-Windows with auto-install on),
 * where a normal quit still applies a staged update. Re-applied on the
 * `autoInstallUpdates` toggle so flipping the setting takes effect without a
 * restart. The download itself is unaffected — updates still download in the
 * background; only the install is gated.
 */
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

/**
 * True only when `offered` has strictly-higher semver precedence than
 * `current`. Build metadata is ignored, prerelease ordering is preserved (so a
 * higher-version RC like `1.0.25-rc.1` is newer than `1.0.24` but `1.0.24-rc.1`
 * is not), and a malformed version on either side is treated as not newer. This
 * is the guard that stops the updater from "updating" to a non-newer version
 * and looping (#1161).
 */
function isStrictlyNewerVersion(offered: string | null | undefined, current: string): boolean {
  if (!offered) return false
  const o = semver.valid(offered)
  const c = semver.valid(current)
  if (!o || !c) return false
  return semver.gt(o, c)
}

/**
 * True (and emits a once-per-version diagnostic) when `version` is not strictly
 * newer than the running build, i.e. the caller should ignore the offer.
 */
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
    // Ignore a non-newer offer so it can't drive a download / pill / install.
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
      // Auto-install ON suppresses the 'available' pill entirely.
      // electron-updater's default `autoDownload: true` already starts
      // the download in the background; we only need to mark the
      // intent for telemetry and let the natural `update-downloaded`
      // event finish the cycle. A previous version called
      // `runCheck('auto-download')` here to "kick" the download — that
      // re-entrant check fired its own `update-available` /
      // `update-downloaded` events and turned what should have been a
      // single transition into a per-cycle telemetry storm. The dedup
      // guard above defends against any residual re-emit even if the
      // underlying updater fires the event multiple times per version.
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
    // A non-newer download must not persist `pendingDownloadedUpdateVersion`
    // (which drives the startup-install splash) nor flip state to `'ready'`.
    if (shouldIgnoreNonNewerVersion(version, 'downloaded')) return
    _autoDownloadTriggeredFor = null
    if (_shouldEmitAppUpdateOnce('comfy.desktop.app_update.download_complete', version)) {
      emitUpdateTelemetry('comfy.desktop.app_update.download_complete', version, { version }, true)
    }
    // Persist that an installer is staged on disk. electron-updater caches the
    // download across restarts; this marker lets the startup-install path apply
    // it on the next boot. Harmless when installing on quit instead —
    // it's just a record that a download finished and is cleared once the staged
    // version is the one running.
    try {
      settings.set('pendingDownloadedUpdateVersion', version)
    } catch {}
    _setUpdateState({ kind: 'ready', version, autoUpdate: isAutoInstallEnabled() })
    if (_userInitiatedDownload) {
      // The user opted in to download via the auto-off available pill
      // modal. Push the restart prompt automatically so the flow ends
      // on a single user gesture (Download → wait → Restart) instead
      // of forcing them to find the pill again.
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
    // A failed download can't stay in `'downloading'`. Auto-on downloads
    // return to the silent idle state (the periodic auto-check retries on
    // its own; surfacing an "available" pill for a background blip would be
    // noise). User-initiated downloads roll back to `'available'` so the
    // pill/panel offer "Download" again and the user can retry.
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
      // Only surface failures the user is actively waiting on.
      // Background auto-on download errors stay silent — the user
      // hasn't asked for anything and bothering them with a modal
      // for a transient network blip would be noisy.
      _broadcastToRenderer('app-update:user-action-failed', { message: updaterErrorMessage(args) })
    }
  })

  // Forward electron-updater's `download-progress` ticks to renderer
  // surfaces (title-bar pill + Global Settings update panel) so the
  // user has feedback during the download instead of staring at a
  // static "Download" affordance. The payload shape is
  // electron-updater's `ProgressInfo` — we narrow it to the fields
  // the UI actually uses.
  //
  // The first tick of ANY download (user-initiated or auto-on background)
  // flips the cached app-update state to `'downloading'`, so the title-bar
  // pill shows "Downloading update" and the Settings panel shows the
  // progress bar with percent / bytes / speed; clicking the pill routes to
  // Settings. Auto-on downloads used to stay silent (state `null`) until
  // `update-downloaded`, which left the UI claiming "up to date" while
  // hundreds of megabytes were in flight - the same invisibility that hid
  // the startup re-download behind the update loop.
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
        // Auto-on downloads skip the `'available'` state, so the cached
        // state carries no version; the auto-download trigger recorded it.
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

/** Triggers that originate from explicit user intent (the title-bar
 *  "Check for Updates" menu and the auto-off available-pill confirm
 *  modal). Background triggers (`auto-check` every 10 min, plus any
 *  app-open / dashboard-revisit / IPP-click code path that quietly
 *  re-runs a check) are implementation details and would otherwise
 *  fire on every periodic interval without carrying analytical
 *  signal, so `comfy.desktop.app_update.checked` only emits for the
 *  user-initiated set. Per-version dedup also applies — a user
 *  mashing the menu item while a download is staged still produces
 *  one event per version. The `up_to_date` result is intentionally
 *  not emitted at all: every analytical question that needs the
 *  denominator can use `session.started` instead. */
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
    // A non-newer surfaced version is not an available update.
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

/**
 * Run an update check and return the result. Exported so callers in
 * main (e.g. the title-bar "Check for Updates" entry routed through
 * `comfy-window:check-for-updates`) can trigger a check without going
 * through the renderer-facing `check-for-update` IPC. Result also flows
 * through the broadcast pipeline (`update-available` / `update-error`)
 * so any subscribed renderer surface still updates.
 */
export function runCheck(
  source: string
): Promise<{ available: boolean; version?: string; error?: string }> {
  return checkForUpdate(source)
}

/**
 * Current app-update state for the title-bar status pill. Returned by
 * reference for cheapness; callers must not mutate.
 * Title-bar webContents that mount AFTER an `update-available` /
 * `update-downloaded` broadcast still need the latest state to render
 * their pill, so main pushes this on `comfy-titlebar:title-bar-ready`
 * via `comfy-titlebar:app-update-state-changed`.
 */
export function getCurrentUpdateState(): AppUpdateState {
  return _appUpdateState
}

/**
 * Subscribe to app-update state transitions. Main
 * registers once at startup and forwards each call to every host
 * window's title-bar webContents. Returns an unsubscribe function.
 *
 * Skipped over a renderer-side relay (renderer → main → all-renderers
 * → title-bar) because the _broadcastToRenderer() helper already reaches the
 * title-bar webContents via BrowserWindow.getAllWindows; the title-bar
 * preload just doesn't expose those raw events. Forwarding through
 * `comfy-titlebar:app-update-state-changed` keeps the pill data path
 * separate from the banner data path so the two surfaces can evolve
 * independently.
 */
export function onUpdateStateChanged(cb: (state: AppUpdateState) => void): () => void {
  _stateChangeCallbacks.add(cb)
  return () => {
    _stateChangeCallbacks.delete(cb)
  }
}

/**
 * User-initiated download of the pending update. Marks the next
 * `update-downloaded` as user-initiated so the updater module fires
 * the auto restart-prompt event; the flag is cleared on download
 * completion or on error so a subsequent background auto-on download
 * doesn't re-trigger the prompt. Failures broadcast
 * `app-update:user-action-failed` so the UI can surface them.
 *
 * Exported so both the renderer-facing `download-update` IPC handler
 * and main-process callers (e.g. the system-modal "Download" confirm)
 * share a single implementation.
 */
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

/**
 * Apply the pending downloaded update by restarting the app under the
 * silent installer. Failures broadcast `app-update:user-action-failed`
 * so the UI can surface them. Exported so both the renderer-facing
 * `install-update` IPC handler and main-process callers (e.g. the
 * system-modal "Restart" confirm) share a single implementation.
 */
export function installUpdate(userInitiated = true): void {
  const updateSource = userInitiated ? 'install_call' : 'startup_install'
  if (isSessionEnding()) {
    // The OS is shutting down / logging off. Spawning the installer now risks
    // it being force-killed mid-write, corrupting the install — the exact
    // failure this whole flow exists to avoid. The staged update stays put and
    // applies on the next launch instead.
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
    // macOS Squirrel quirk: if requestSingleInstanceLock is still held by
    // the quitting process, ShipIt swaps the .app bundle correctly but
    // the new Squirrel.Mac process cannot acquire the lock and exits
    // silently — the user sees the app close and nothing relaunches.
    // Electron's own docs call this out: quitAndInstall + single-instance
    // lock is a known footgun on darwin. Releasing the lock immediately
    // before restartAndInstall lets the next process come up cleanly.
    // Windows / Linux update paths don't have this contention and don't
    // need the release.
    if (process.platform === 'darwin') {
      app.releaseSingleInstanceLock()
    }
    // `isSilent: false` shows the NSIS progress window during the install (see
    // `isInstallerUIEnabled` — Windows-only, default on). Forced silent on
    // macOS/Linux, where `isSilent` has no effect anyway.
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

/**
 * Test-only: push an arbitrary `AppUpdateState` through the same
 * `_setUpdateState` path the real updater uses, so every subscribed
 * surface (title-bar pills, Global Settings panel) repaints exactly
 * as it would for a real `update-available` / `update-downloaded`
 * event. Only called from `e2eHooks.ts` which is itself only loaded
 * when `process.env['E2E'] === '1'`.
 */
export function _test_setUpdateState(next: AppUpdateState): void {
  _setUpdateState(next)
}

/** Record recovery when the startup installer did not enter Electron's quit path. */
export function recordStartupInstallBackstopRecovered(): void {
  emitUpdateTelemetry(
    'comfy.desktop.app_update.startup_install_backstop_recovered',
    _appUpdateState.version ?? settings.get('pendingDownloadedUpdateVersion') ?? null
  )
}

let _processExitRecorded = false

/** Record the updater state after the app's quit checks have accepted the quit. */
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

/** Upper bound on how long the startup-install check may delay boot. The
 *  installer was already downloaded in a previous session, so this only
 *  re-validates the cached file against the release feed (no re-download); the
 *  cap keeps a slow / offline network from ever hanging the launch. */
const STARTUP_UPDATE_CHECK_TIMEOUT_MS = 5000

/** How long the splash stays up between committing to the install and quitting
 *  the app to run it. Measured from the commit point (when the splash swaps to
 *  its install-countdown copy), so the countdown the user is watching runs its
 *  full length regardless of how long the readiness check took. Keep in sync
 *  with `UPDATE_INSTALL_COUNTDOWN_SECONDS` (updateSplash.ts). Only applies when
 *  a splash is actually up (startup-install path). */
const STARTUP_INSTALL_MIN_SPLASH_MS = 5000

/** Consecutive boots that may skip the same staged version as not-ready before
 *  the staged marker is abandoned. Each such boot costs the user a splash plus
 *  the bounded wait, so a staged installer that never becomes ready (corrupt or
 *  partial on disk, with re-downloads that never complete before the app exits)
 *  must not show that splash forever. Abandoning only clears the marker: if a
 *  background re-download later completes, `update-downloaded` re-stages the
 *  version and the next boot installs it normally. */
const STARTUP_INSTALL_NOT_READY_LIMIT = 3

/** Why a startup install was or wasn't attempted. The skip reasons that carry
 *  canary signal (`loop_breaker`, `session_ending`, `not_ready`) are reported via
 *  `comfy.desktop.app_update.startup_install_skipped`; the rest are normal boots
 *  and stay silent. */
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
      /** Which marker home tripped a `loop_breaker` skip. `sidecar` means the
       *  settings copy of the marker was GONE and only the sidecar remembered
       *  the attempt - in the wild, that is direct evidence of the
       *  settings.json rollback suspected in issue #1367. */
      loopBreakerSource?: 'settings' | 'sidecar'
    }

/**
 * Decide whether to install a staged Desktop update on this launch. Cheap and
 * synchronous (reads only persisted markers + environment).
 *
 * Returns a skip for: the startup-install gate being off (non-Windows, or the
 * `installUpdatesOnStartup` opt-out — installs still happen on quit), auto-install
 * being disabled (Issue #1104 — staged update waits for an explicit pill click),
 * E2E runs, system-package-managed installs (apt/dnf own
 * the update), an OS session that's already ending, no staged download (or one
 * that's already the running version), and the loop-breaker case (we already
 * auto-attempted this exact version and are still on the old one).
 */
function evaluateStartupInstall(sidecar: StartupAttemptMarkerRead): StartupInstallDecision {
  if (!isStartupInstallEnabled()) return { attempt: false, reason: 'disabled' }
  // Issue #1104 — with auto-install off, a staged update must wait for an
  // explicit pill click; never apply it automatically at startup.
  if (!isAutoInstallEnabled()) return { attempt: false, reason: 'auto_install_disabled' }
  if (process.env['E2E'] === '1') return { attempt: false, reason: 'e2e' }
  if (isSystemPackageInstall()) return { attempt: false, reason: 'system_managed' }
  if (isSessionEnding()) return { attempt: false, reason: 'session_ending' }
  const pending = settings.get('pendingDownloadedUpdateVersion')
  // Only install a staged version that is strictly newer than what's running,
  // so the running build or a stale marker can't re-trigger the install loop.
  if (!pending || !isStrictlyNewerVersion(pending, app.getVersion())) {
    return { attempt: false, reason: 'no_pending' }
  }
  // Loop-breaker: we already auto-attempted this exact version and are still
  // on the old one. Checked in BOTH homes because settings.json can be rolled
  // back to a stale .bak snapshot under AV/indexer interference, erasing its
  // copy of the marker (issue #1367).
  const lastAttempt = settings.get('lastStartupUpdateAttemptVersion')
  if (lastAttempt === pending) {
    return { attempt: false, reason: 'loop_breaker', loopBreakerSource: 'settings' }
  }
  if (sidecar.state === 'present' && sidecar.marker.version === pending) {
    // Only the sidecar remembers the attempt: the settings marker was lost
    // between launches. Telemetry on this source confirms (or rules out) the
    // settings.json rollback mechanism in the field.
    return { attempt: false, reason: 'loop_breaker', loopBreakerSource: 'sidecar' }
  }
  if (sidecar.state === 'unavailable') {
    // The sidecar EXISTS but can't be read (e.g. an AV lock outlasting the
    // retry budget). It may record an attempt of exactly this version, so
    // installing now could reopen the reinstall loop - fail closed. The
    // explicit "update ready" pill install remains available.
    return { attempt: false, reason: 'marker_unavailable' }
  }
  return { attempt: true, version: pending }
}

/**
 * True when there is a staged Desktop update we should try to install on this
 * launch. Lets callers decide whether to show an "Updating…" splash before the
 * bounded `applyPendingUpdateOnStartup` check runs.
 */
export function hasPendingStartupUpdate(): boolean {
  return evaluateStartupInstall(readStartupAttemptMarker()).attempt
}

/** How the bounded startup update check settled. Only `'ready'` can lead to an
 *  install; the others mean "bail into the normal UI now" and say why:
 *  `'downloading'` = the cached installer was rejected and electron-updater
 *  started re-downloading it (finishing takes minutes, not the seconds the boot
 *  wait allows), `'check_failed'` = the feed check found no applicable update
 *  (offline, feed error, or the update was pulled), `'timeout'` = the deadline
 *  passed without any of the above. */
type StartupUpdateWaitOutcome = 'ready' | 'downloading' | 'check_failed' | 'timeout'

/**
 * Kick off a startup update check and resolve with how it settled. Don't rely
 * on `runCheck` resolving to imply readiness - the `'ready'` transition happens
 * in the `update-downloaded` handler, which (depending on the updater) can fire
 * slightly after the check promise settles. Subscribing first closes that race.
 *
 * Resolves as soon as the outcome is knowable instead of always burning the
 * full deadline: a `download-progress` tick proves the staged installer was
 * invalid and a full re-download is underway (which cannot finish within a
 * boot-time budget), and a check that finds no applicable update means the
 * ready state can never be reached this launch.
 */
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
        // Otherwise an update exists upstream but isn't ready yet; keep
        // waiting for a ready transition, a re-download tick, or the deadline.
      })
      .catch(() => finish('check_failed'))
  })
}

/**
 * Apply a previously-downloaded Desktop update at startup instead of on quit.
 * Installing on quit is what gets interrupted by a Windows shutdown and leaves
 * a corrupted install; doing it at launch decouples the install from the
 * shutdown entirely. Returns `true` when an install was triggered (the caller
 * should then keep the splash up and NOT open the normal UI — the app is about
 * to quit and the installer relaunches it). Returns `false` (open the UI as
 * usual) when there's nothing to do, the check can't confirm a ready update, or
 * the loop-breaker is engaged.
 *
 * `hooks.onInstallCommitted` is called once the staged update is confirmed
 * ready and the install WILL proceed, before the pre-install splash hold
 * starts. The caller uses it to swap the splash from its "checking" copy to the
 * install countdown, so the countdown only ever shows for a real install.
 */
export interface StartupInstallHooks {
  onInstallCommitted?: () => void | Promise<void>
}

export async function applyPendingUpdateOnStartup(hooks?: StartupInstallHooks): Promise<boolean> {
  // Clear markers that no longer point at a strictly-newer target, while
  // preserving genuinely-newer attempts so the loop-breaker below stays armed.
  const running = app.getVersion()
  const lastAttempt = settings.get('lastStartupUpdateAttemptVersion')
  const pendingVersion = settings.get('pendingDownloadedUpdateVersion')
  // Read the sidecar once and pass it down: each read is synchronous and can
  // block up to the transient-lock retry budget when the file is locked, and
  // this codepath runs before the first window appears.
  let sidecar = readStartupAttemptMarker()

  // The sidecar is the durable cross-launch identity source because late
  // settings.json writes may be unavailable or restored from backup. A pending
  // result stays open so a later successful explicit install remains visible.
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
    // Only the skips that mean "a staged update exists but we declined it"
    // carry canary signal; normal boots (no pending / feature off) stay silent.
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
          // Which marker home tripped a loop_breaker skip (see loopBreakerSource).
          source: decision.loopBreakerSource ?? null,
          bakFallbacks: getSafeFileDiagnostics().bakFallbacks
        }
      )
    }
    return false
  }

  // The installer is cached on disk from a previous session; this check
  // usually just re-validates it (no re-download) and populates the updater's
  // ready state. Bounded so a slow/offline network can't hang boot - if it
  // doesn't resolve to a ready update in time, we open the UI and try again
  // next launch. When the cached installer turns out invalid, electron-updater
  // deletes it and starts a re-download; the wait detects that and bails
  // immediately so the user gets into the app while the download continues in
  // the background (a completed download re-stages the update for next boot).
  const waitOutcome = await waitForStartupUpdateOutcome(STARTUP_UPDATE_CHECK_TIMEOUT_MS)

  const state = getCurrentUpdateState()
  // Require the ready version to be the exact staged version we decided to
  // install - a concurrent check could surface a different (or no) ready
  // version, which must not bypass the loop-breaker recorded for `decision.version`.
  if (state.kind !== 'ready' || state.version !== decision.version) {
    // Bound how many consecutive boots may skip this same version as not-ready.
    // Without a bound, a permanently-invalid staged installer (e.g. a corrupt
    // or partial file whose re-download never completes before the app exits)
    // would show the update splash on every boot forever. After the limit, the
    // staged marker is abandoned; a later completed download re-stages it.
    const seenVersion = settings.get('startupInstallNotReadyVersion')
    const seenCount = settings.get('startupInstallNotReadyCount')
    const consecutive =
      (seenVersion === decision.version && typeof seenCount === 'number' ? seenCount : 0) + 1
    // `update-downloaded` can restage the pending marker DURING the wait (e.g. a
    // newer version finished downloading). Strikes only apply while the marker
    // still belongs to the version this boot decided to install; a restaged
    // marker must never be abandoned on the old version's strikes.
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
        // A different version is staged now; the old version's strikes are
        // obsolete and the new version starts with a clean count.
        settings.set('startupInstallNotReadyVersion', undefined)
        settings.set('startupInstallNotReadyCount', undefined)
      }
    } catch {
      // Best-effort: if settings can't persist, next boot just repeats the
      // bounded wait, which is the pre-counter behavior.
    }
    emitUpdateTelemetry('comfy.desktop.app_update.startup_install_skipped', decision.version, {
      reason: 'not_ready',
      version: decision.version,
      // Ready state with the wrong version means a concurrent check surfaced a
      // different update than the one staged for install.
      wait_outcome:
        waitOutcome === 'ready' || state.kind === 'ready' ? 'version_mismatch' : waitOutcome,
      consecutive_not_ready: consecutive,
      abandoned
    })
    return false
  }
  // The staged update is confirmed and the install will proceed; the not-ready
  // strike counter no longer applies to this version.
  try {
    settings.set('startupInstallNotReadyVersion', undefined)
    settings.set('startupInstallNotReadyCount', undefined)
  } catch {
    // Stale counter keys are also cleaned up by the marker hygiene above.
  }

  // The session may have started ending while we awaited the check. Skip
  // before the commit hook so the user is never shown an install countdown
  // for an install that must not happen.
  if (isSessionEnding()) {
    emitUpdateTelemetry('comfy.desktop.app_update.startup_install_skipped', state.version, {
      reason: 'session_ending',
      version: state.version
    })
    return false
  }

  // Commit point for the caller's splash: swap it from "checking" to the
  // install countdown (awaited so the hold starts only once the countdown is
  // actually on screen), then hold so the countdown plays out before the app
  // quits. The hold is measured from here (not from when the splash appeared)
  // so it matches the countdown the user just started watching. Keep
  // `STARTUP_INSTALL_MIN_SPLASH_MS` in sync with
  // `UPDATE_INSTALL_COUNTDOWN_SECONDS` (updateSplash.ts).
  if (hooks) {
    await hooks.onInstallCommitted?.()
    await new Promise<void>((resolve) => setTimeout(resolve, STARTUP_INSTALL_MIN_SPLASH_MS))
  }

  // The session may have started ending while the splash countdown played.
  if (isSessionEnding()) {
    emitUpdateTelemetry('comfy.desktop.app_update.startup_install_skipped', state.version, {
      reason: 'session_ending',
      version: state.version
    })
    return false
  }

  // Record the attempt BEFORE installing so a failed install (app relaunches
  // on the old version) trips the loop-breaker next boot. The verified sidecar
  // is the authoritative marker; if it cannot be made durable, fail closed
  // WITHOUT writing any marker - installing unguarded risks an unbounded
  // reinstall loop (issue #1367), and a lone settings marker would block every
  // future auto-install of this version instead of retrying next launch.
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
  } catch {
    // The sidecar is already durable, so the loop-breaker holds without the
    // settings copy.
  }
  emitUpdateTelemetry('comfy.desktop.app_update.startup_install', state.version, {
    version: state.version,
    // Non-zero means reads were served from `.bak` this session (primary
    // missing, empty, or locked past retries - issue #1367's environment);
    // lets telemetry correlate install loops with filesystem interference.
    bakFallbacks: getSafeFileDiagnostics().bakFallbacks
  })
  installUpdate(false)
  return true
}

export function register(): void {
  bindUpdaterEvents()

  // Reconcile install-on-quit with current settings (see
  // `syncInstallOnQuitPolicy`). Disabled when the startup-install path owns the
  // install (the Windows default — the staged update applies on the next launch
  // instead of on quit, avoiding the Windows-shutdown mid-write corruption
  // loop) or when auto-install is off (Issue #1104 — wait for an explicit pill
  // click). Otherwise (non-Windows with auto-install on) install-on-quit stays
  // armed; the `session-end` guard (`suppressInstallOnQuit`) still flips it off
  // only while the OS is shutting down. `electronAutoUpdater` is the same
  // singleton the ToDesktop runtime drives, so this affects the real updater.
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

  // Snapshot of the cached app-update state for renderer surfaces
  // (Global Settings) that mount AFTER an `update-available` /
  // `update-downloaded` broadcast has already fired. Live updates
  // arrive via the `app-update:state-changed` event.
  ipcMain.handle('get-app-update-state', () => getCurrentUpdateState())

  // Issue #488 — always check on startup and periodically. The
  // user-controllable `autoInstallUpdates` setting only gates whether
  // a discovered update silently downloads + installs vs prompts the
  // user; the check loop itself is no longer user-disablable.
  const runAutoCheck = (): void => {
    runCheck('auto-check').catch(() => {})
  }
  setTimeout(runAutoCheck, 2000)
  setInterval(runAutoCheck, 10 * 60 * 1000)
}
