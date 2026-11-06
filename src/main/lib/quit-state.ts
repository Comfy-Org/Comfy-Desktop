export type QuitReason = 'none' | 'user-quit' | 'update-install'

let quitReason: QuitReason = 'none'

export function setQuitReason(reason: QuitReason): void {
  quitReason = reason
}

export function clearQuitReason(): void {
  quitReason = 'none'
}

export function getQuitReason(): QuitReason {
  return quitReason
}

export function isQuitInProgress(): boolean {
  return quitReason !== 'none'
}

export function isUpdateInstallQuit(): boolean {
  return quitReason === 'update-install'
}

/** Set once the OS signals the session is ending (Windows shutdown / restart /
 *  logoff, via `app.on('session-end')`). Guards the update install paths so we
 *  never spawn an installer the OS is about to kill mid-write — the corruption
 *  mode behind the "reinstall every shutdown" loop. Never reset: the process is
 *  on its way out. */
let sessionEnding = false

export function setSessionEnding(): void {
  sessionEnding = true
}

export function isSessionEnding(): boolean {
  return sessionEnding
}

/** Electron starts one instance per `app.relaunch()` call, so every relaunch goes through here
 *  and the first one wins. Set only once the call succeeded: a sandboxed build can throw. */
let relaunchScheduled = false

export function scheduleRelaunch(relaunch: () => void): void {
  if (relaunchScheduled) return
  relaunch()
  relaunchScheduled = true
}

/**
 * An OS launch of Desktop while this one is quitting: the new process exits on the
 * single-instance lock, so the click would be lost. Relaunch once the quit ends instead, except
 * for an update install (the installer starts the new version). Returns false when no quit is
 * in progress and the launch should be handled normally.
 */
export function relaunchIfQuitting(relaunch: () => void): boolean {
  if (!isQuitInProgress()) return false
  if (!isUpdateInstallQuit()) scheduleRelaunch(relaunch)
  return true
}

/** Test-only. */
export function _resetQuitStateForTest(): void {
  quitReason = 'none'
  sessionEnding = false
  relaunchScheduled = false
}
