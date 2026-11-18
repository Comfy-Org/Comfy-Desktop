import type { ActionResult } from '../types/ipc'

export async function relaunchAfterAction(
  installationId: string,
  result: ActionResult
): Promise<ActionResult> {
  if (result?.ok === false) return result
  const relaunch = await window.api.runAction(installationId, 'launch')
  if (!relaunch?.portConflict) return result
  return { ...result, ok: false, message: relaunch.message, portConflict: relaunch.portConflict }
}
