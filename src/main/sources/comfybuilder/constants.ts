/** Shared by the plugin and its detail sections; separate module so the two
 *  don't import each other in a cycle. */
export const DEFAULT_LAUNCH_ARGS = '--enable-manager'

/** Launch settings stamped on every new ComfyBuilder install record. */
export const COMFYBUILDER_INSTALL_DEFAULTS = {
  launchArgs: DEFAULT_LAUNCH_ARGS,
  launchMode: 'window',
  browserPartition: 'unique'
} as const
