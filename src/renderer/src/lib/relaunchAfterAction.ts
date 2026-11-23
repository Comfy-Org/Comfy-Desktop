import type { ActionResult } from '../types/ipc'
import { stopAndWaitForExit } from './stopWarning'

export async function relaunchAfterAction(
  installationId: string,
  result: ActionResult
): Promise<ActionResult> {
  if (result?.ok === false) return result
  const relaunch = await window.api.runAction(installationId, 'launch')
  if (!relaunch?.portConflict) return result
  return { ...result, ok: false, message: relaunch.message, portConflict: relaunch.portConflict }
}

export async function stopThenRun(
  installationId: string,
  isRunning: () => boolean,
  cancelRequested: () => boolean,
  run: () => Promise<ActionResult>
): Promise<ActionResult> {
  await stopAndWaitForExit(installationId, isRunning)
  if (cancelRequested()) return { ok: false, cancelled: true }
  return run()
}
