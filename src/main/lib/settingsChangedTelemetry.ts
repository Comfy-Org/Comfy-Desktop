import * as telemetry from './telemetry'

/** `comfy.desktop.settings.changed`: a user's own setting edit, global or per-install.
 *  Sends the key and, for booleans, the new value - never a path or other value. */
export function captureSettingChanged(
  key: string,
  before: unknown,
  after: unknown,
  installId?: string
): void {
  if (JSON.stringify(before) === JSON.stringify(after)) return
  telemetry.capture('comfy.desktop.settings.changed', {
    install_id: installId, // per-install only; `installation_id` is the default device id
    setting_key: key,
    bool_value: typeof after === 'boolean' ? after : undefined
  })
}
