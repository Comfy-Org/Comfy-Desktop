import * as telemetry from './telemetry'

/**
 * `comfy.desktop.settings.changed` - one event per user-driven setting change,
 * global or per-install. Person properties already say what a setting IS; only
 * an event says WHEN it changed, which is what lets a later failure be lined up
 * against the user's own edit.
 *
 * PRIVACY: the key and, for booleans, the new value. Nothing else - folder
 * settings hold paths, and other strings can hold mirror URLs or credentials.
 */
export function captureSettingChanged(
  key: string,
  before: unknown,
  after: unknown,
  installationId?: string
): void {
  if (JSON.stringify(before) === JSON.stringify(after)) return
  telemetry.capture('comfy.desktop.settings.changed', {
    scope: installationId === undefined ? 'global' : 'install',
    installation_id: installationId,
    setting_key: key,
    bool_value: typeof after === 'boolean' ? after : undefined
  })
}
