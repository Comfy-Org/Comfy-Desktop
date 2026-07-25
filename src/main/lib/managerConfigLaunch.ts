import * as settings from '../settings'
import * as telemetry from './telemetry'
import { buildErrorFields } from '../../shared/errorEvent'
import {
  ensureManagerConfig,
  isManagerSecurityLevel,
  isManagerNetworkMode
} from './managerConfig'

export type ManagerReconcileResult = { ok: true } | { ok: false; error: unknown }

/** Reconcile ComfyUI-Manager's config.ini before a local launch.
 *  `securityLevel` / `networkMode` are the launched install's own
 *  (per-install) settings; the enums are validated here so a hand-edited
 *  record can't leak a free-form string into config.ini.  Remote instances
 *  have no local install to reconcile.
 *
 *  Failure policy: when the user chose a Manager option, a failed write must
 *  block the launch - starting anyway would run Manager with stale (possibly
 *  weaker) security settings while the UI claims the new value. Mirror-only
 *  seeding keeps the old non-blocking behavior (telemetry only): it is a
 *  convenience, not a security boundary. */
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
