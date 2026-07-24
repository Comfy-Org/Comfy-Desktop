import * as settings from '../settings'
import * as telemetry from './telemetry'
import { buildErrorFields } from '../../shared/errorEvent'
import { ensureManagerConfig, type ManagerSecurityLevel } from './managerConfig'

/** Reconcile ComfyUI-Manager's config.ini with Desktop settings before a
 *  local launch. Remote instances have no local install to reconcile. A
 *  failure is reported to telemetry but never blocks the launch. */
export async function reconcileManagerConfigForLaunch(opts: {
  remote: boolean
  installPath: string
}): Promise<void> {
  if (opts.remote) return
  try {
    await ensureManagerConfig(opts.installPath, {
      useChineseMirrors: settings.get('useChineseMirrors') === true,
      securityLevel: settings.get('managerSecurityLevel') as ManagerSecurityLevel | undefined
    })
  } catch (err) {
    console.warn('Failed to reconcile ComfyUI-Manager config:', err)
    telemetry.capture('comfy.desktop.manager.config_seed_failed', {
      ...buildErrorFields(err)
    })
  }
}
