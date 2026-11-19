import { useSessionStore } from '../stores/sessionStore'
import type { Installation } from '../types/ipc'

export async function focusRunningBuild(inst: Installation): Promise<boolean> {
  const sessionStore = useSessionStore()
  const mayHaveWindow =
    sessionStore.isRunning(inst.id) ||
    sessionStore.isLaunching(inst.id) ||
    sessionStore.errorInstances.has(inst.id)
  return mayHaveWindow ? window.api.focusComfyWindow(inst.id) : false
}
