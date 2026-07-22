/**
 * ComfyBuilder source plugin.
 *
 * A ComfyBuilder artifact unpacks to the same `standalone-env/` + `ComfyUI/.venv`
 * layout as a standalone install, so everything past the artifact download is the
 * standalone source, reused verbatim: `postInstall` (env create + package copy),
 * `getLaunchCommand`, `getTerminalEnv` (its default), and `probeInstallation`.
 * Only the download/extract/validate stage (`./install`) is bespoke.
 *
 * Intentionally minimal: no list UI, no OAuth, no version picker. `hidden` keeps
 * it out of the install wizard; records are created programmatically from a
 * chosen artifact.
 */
import { standalone } from '../standalone'
import { install } from './install'
import type { FieldOption, SourcePlugin } from '../../types/sources'

export const comfybuilder: SourcePlugin = {
  id: 'comfybuilder',
  label: 'ComfyBuilder',
  category: 'local',
  hidden: true,
  fields: [],

  // Reuse the standalone install stepper (download → extract → setup → cleanup);
  // the artifact ships a pinned env, so there is no post-install auto-update.
  get installSteps() {
    return standalone.installSteps?.filter((step) => step.phase !== 'update')
  },

  getDefaults() {
    return { launchMode: 'window', portConflict: 'auto' }
  },

  buildInstallation(selections: Record<string, FieldOption | undefined>): Record<string, unknown> {
    // The chosen artifact rides on the selection's `data`; the creator flattens
    // `artifact` + `comfybuilderBaseUrl` onto the record for `install` to read.
    const data = (selections.artifact?.data ?? {}) as Record<string, unknown>
    return { launchMode: 'window', ...data }
  },

  // Bespoke artifact download/extract/validate.
  install,

  // Everything past the download is identical to a standalone install.
  postInstall: standalone.postInstall,
  getLaunchCommand: standalone.getLaunchCommand,
  probeInstallation: standalone.probeInstallation,
  getDetailSections: standalone.getDetailSections,
  getListActions: standalone.getListActions,
  handleAction: standalone.handleAction,
}
