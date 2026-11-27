import type { InstallationRecord } from '../installations'
import { isRunningForAppsOnly, startWithDesktop } from './localComfy'

type OpenComfyWindow = (installationId: string) => Promise<unknown>

let startedThisLaunch = false

function runsInConsoleOnly(inst: InstallationRecord): boolean {
  return inst.launchMode === 'console'
}

export async function startWithDesktopAndOpen(
  inst: InstallationRecord,
  openComfyWindow: OpenComfyWindow
): Promise<boolean> {
  if (startedThisLaunch) return false
  startedThisLaunch = true
  if (!(await startWithDesktop(inst))) return false
  if (runsInConsoleOnly(inst) || !isRunningForAppsOnly(inst.id)) return false
  await openComfyWindow(inst.id)
  return true
}

export function _resetForTest(): void {
  startedThisLaunch = false
}
