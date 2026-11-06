import * as settings from '../settings'
import * as telemetry from './telemetry'
import { buildErrorFields } from '../../shared/errorEvent'
import { ensureManagerConfig, isManagerSecurityLevel, isManagerNetworkMode } from './managerConfig'

export type ManagerReconcileResult = { ok: true } | { ok: false; error: unknown }

export async function reconcileManagerConfigForLaunch(opts: {
  remote: boolean
  installPath: string
  securityLevel?: unknown
  networkMode?: unknown
}): Promise<ManagerReconcileResult> {
  if (opts.remote) return { ok: true }
  const securityLevel = isManagerSecurityLevel(opts.securityLevel) ? opts.securityLevel : undefined
  const networkMode = isManagerNetworkMode(opts.networkMode) ? opts.networkMode : undefined
  try {
    await ensureManagerConfig(opts.installPath, {
      useChineseMirrors: settings.get('useChineseMirrors') === true,
      securityLevel,
      networkMode
    })
    return { ok: true }
  } catch (err) {
    console.warn('Failed to reconcile ComfyUI-Manager config:', err)
    telemetry.capture('comfy.desktop.manager.config_seed_failed', {
      ...buildErrorFields(err)
    })
    if (securityLevel !== undefined || networkMode !== undefined) {
      return { ok: false, error: err }
    }
    return { ok: true }
  }
}
