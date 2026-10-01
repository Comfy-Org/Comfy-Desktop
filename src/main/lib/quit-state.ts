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

/** A relaunch is already scheduled for when this process exits (`app.relaunch()`). */
let relaunchScheduled = false

export function markRelaunchScheduled(): void {
  relaunchScheduled = true
}

/**
 * Desktop was opened again while this one is quitting (it may be waiting for ComfyUI to exit):
 * the new instance cannot take the single-instance lock and exits, and this one is on its way
 * out, so without this nothing would be left running. Schedule one relaunch for when this process
 * exits. Not during an update install (the installer starts the new version), and not when a
 * relaunch is already scheduled. Returns whether it scheduled one.
 */
export function relaunchForSecondInstance(relaunch: () => void): boolean {
  if (!isQuitInProgress() || isUpdateInstallQuit() || relaunchScheduled) return false
  relaunchScheduled = true
  relaunch()
  return true
}

export function _resetQuitStateForTest(): void {
  quitReason = 'none'
  relaunchScheduled = false
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
