/**
 * ComfyBuilder source plugin.
 *
 * A ComfyBuilder artifact unpacks to a ready `venv/` + `ComfyUI/` at the install
 * root, so the download/extract/validate stage (`./install`) and the env
 * consumption (`./launch`: no-op postInstall + launch the archive's `venv/`) are
 * bespoke. The dashboard/list/probe glue is still reused from the standalone
 * source, which is layout-agnostic for those paths.
 *
 * Intentionally minimal: no list UI, no OAuth, no version picker. `hidden` keeps
 * it out of the install wizard; records are created programmatically from a
 * chosen artifact.
 */
import { standalone } from '../standalone'
import { install } from './install'
import { getLaunchCommand, postInstall } from './launch'
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

  // Env-reshape: the archive ships a ready `venv/`, so post-extract is a no-op
  // and launch drives that venv directly (NOT the standalone `.venv` rebuild).
  postInstall,
  getLaunchCommand,
  probeInstallation: standalone.probeInstallation,
  getDetailSections: standalone.getDetailSections,
  getListActions: standalone.getListActions,
  handleAction: standalone.handleAction,
}
