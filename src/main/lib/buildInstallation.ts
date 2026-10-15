import type { BuildInstallationResult } from '../../types/ipc'
import type { FieldOption, SourcePlugin } from '../types/sources'
import { t } from './i18n'

/** Keep source validation failures inside each caller's result/error convention,
 * including IPC, where throwing would wrap the localized message in an Electron error. */
export function tryBuildInstallation(
  source: SourcePlugin | undefined,
  selections: Record<string, FieldOption | undefined>
): BuildInstallationResult {
  if (!source) return { ok: false, message: t('errors.unknownSource') }
  try {
    return {
      ok: true,
      data: {
        sourceId: source.id,
        sourceLabel: source.label,
        ...source.buildInstallation(selections)
      }
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}
