import * as settings from '../settings'
import * as telemetry from './telemetry'
import { buildErrorFields } from '../../shared/errorEvent'
import { ensureManagerConfig, isManagerSecurityLevel } from './managerConfig'

/** Reconcile ComfyUI-Manager's config.ini before a local launch.
 *  `securityLevel` is the launched install's own (per-install) setting; the
 *  enum is validated here so a hand-edited record can't leak a free-form
 *  string into config.ini. Remote instances have no local install to
 *  reconcile. A failure is reported to telemetry but never blocks the launch. */
export async function reconcileManagerConfigForLaunch(opts: {
  remote: boolean
  installPath: string
  securityLevel?: unknown
}): Promise<void> {
  if (opts.remote) return
  try {
    await ensureManagerConfig(opts.installPath, {
      useChineseMirrors: settings.get('useChineseMirrors') === true,
      securityLevel: isManagerSecurityLevel(opts.securityLevel) ? opts.securityLevel : undefined
    })
  } catch (err) {
    console.warn('Failed to reconcile ComfyUI-Manager config:', err)
    telemetry.capture('comfy.desktop.manager.config_seed_failed', {
      ...buildErrorFields(err)
    })
  }
}
