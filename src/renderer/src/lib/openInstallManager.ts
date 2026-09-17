import { resolvePickerTab } from './pickerTabs'
import type { Installation } from '../types/ipc'

export interface OpenInstallManagerOptions {
  initialTab?: string
  autoAction?: string | null
}

/** Open the shared instance manager, optionally targeting and firing an action. */
export function openInstallManager(
  installation: Installation,
  opts: OpenInstallManagerOptions = {}
): void {
  const hasSpecialisedOpts =
    opts.initialTab !== undefined || (opts.autoAction !== undefined && opts.autoAction !== null)
  if (!hasSpecialisedOpts) {
    window.api.openInstancePicker({ installationId: installation.id })
    return
  }
  window.api.openInstancePicker({
    installationId: installation.id,
    initialTab: resolvePickerTab(opts.initialTab, 'status'),
    autoAction: opts.autoAction ?? null
  })
}
