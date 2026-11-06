import type { BuildInstallationResult } from '../../types/ipc'
import type { FieldOption, SourcePlugin } from '../types/sources'
import { t } from './i18n'

/** Throws the source's own error; for callers that already reject on failure. */
export function buildInstallationData(
  source: SourcePlugin,
  selections: Record<string, FieldOption | undefined>
): Record<string, unknown> {
  return {
    sourceId: source.id,
    sourceLabel: source.label,
    ...source.buildInstallation(selections)
  }
}

/** Keep source validation failures inside each caller's result/error convention,
 * including IPC, where throwing would wrap the localized message in an Electron error. */
export function tryBuildInstallation(
  source: SourcePlugin | undefined,
  selections: Record<string, FieldOption | undefined>
): BuildInstallationResult {
  if (!source) return { ok: false, message: t('errors.unknownSource') }
  try {
    return { ok: true, data: buildInstallationData(source, selections) }
  } catch (error) {
    console.warn(`[buildInstallation] ${source.id} rejected selections:`, error)
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, message: message || t('errors.buildFailed') }
  }
}
