import { useSessionStore } from '../stores/sessionStore'
import type { Installation } from '../types/ipc'

/**
 * Picking an install on the dashboard. The install's window owns its
 * lifecycle: if a window already exists for it - running, launching, or
 * crashed (the window stays open on its lifecycle/error surface) - bring it
 * forward instead of starting a second launch. Otherwise hand the pick on.
 */
export function usePickInstall(onPick: (inst: Installation) => void) {
  const sessionStore = useSessionStore()

  async function pickInstall(inst: Installation): Promise<void> {
    if (
      sessionStore.isRunning(inst.id) ||
      sessionStore.isLaunching(inst.id) ||
      sessionStore.errorInstances.has(inst.id)
    ) {
      const focused = await window.api.focusComfyWindow(inst.id)
      // `errorInstances` can be hydrated from the retained crash buffer after
      // the window was closed, so a focus may find nothing - fall through and
      // launch normally in that case.
      if (focused) return
    }
    onPick(inst)
  }

  return { pickInstall }
}
