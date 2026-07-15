import {
  installations, i18n,
  sourceMap,
  _operationAborts,
  MSG_CANCELLED,
} from '../shared'
import type { ActionContext, ActionResult } from './types'
import { appendLog } from '../../logsBroadcast'

export async function handleDelegateToSource({ event, installationId, inst, actionData }: ActionContext, actionId: string): Promise<ActionResult> {
  const abort = new AbortController()
  _operationAborts.set(installationId, abort)
  const sender = event.sender
  const sendProgress = (phase: string, detail: Record<string, unknown>): void => {
    try { if (!sender.isDestroyed()) sender.send('install-progress', { installationId, phase, ...detail }) } catch {}
  }
  const sendOutput = (text: string): void => {
    try { if (!sender.isDestroyed()) sender.send('comfy-output', { installationId, text }) } catch {}
    appendLog(installationId, text)
  }
  const update = (data: Record<string, unknown>): Promise<void> =>
    installations.update(installationId, data).then(() => {})
  const source = sourceMap[inst.sourceId]
  if (!source) {
    _operationAborts.delete(installationId)
    return { ok: false, message: i18n.t('errors.unknownSource') }
  }
  // Failures surfaced to the UI must also land in the app log (#1250) —
  // sendOutput covers per-step output, but the final failure summary is
  // otherwise only returned to the renderer.
  const logFailure = (message: string): void =>
    appendLog(installationId, `\n⚠ ${actionId} failed: ${message}\n`)
  try {
    const result = await source.handleAction(actionId, inst, actionData, { update, sendProgress, sendOutput, signal: abort.signal })
    if (!result.ok && result.message && !result.cancelled) {
      logFailure(result.message)
    }
    return result
  } catch (err) {
    if (abort.signal.aborted) return { ok: false, cancelled: true, message: MSG_CANCELLED }
    logFailure((err as Error).message)
    return { ok: false, message: (err as Error).message }
  } finally {
    _operationAborts.delete(installationId)
  }
}
