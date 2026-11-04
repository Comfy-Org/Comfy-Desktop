import { useSessionStore } from '../stores/sessionStore'
import type { Installation } from '../types/ipc'

/**
 * Bring a build's existing window forward when it has one: running, starting or
 * crashed. Crash records can outlive the window, so this resolves false when there
 * is nothing to focus and the caller should launch.
 */
export async function focusRunningBuild(inst: Installation): Promise<boolean> {
  const sessionStore = useSessionStore()
  const mayHaveWindow =
    sessionStore.isRunning(inst.id) ||
    sessionStore.isLaunching(inst.id) ||
    sessionStore.errorInstances.has(inst.id)
  return mayHaveWindow ? window.api.focusComfyWindow(inst.id) : false
}
