import type { InstallationRecord } from '../../installations'

/** A fresh install in flight (status 'installing') stays hidden until it
 *  settles; every other record, including an in-place update (status
 *  'updating'), is shown. Legacy mid-update records that still carry
 *  'installing' are rewritten to 'updating' on load (see migrateRecord). */
export function isInstallationVisibleToRenderer(installation: InstallationRecord): boolean {
  return installation.status !== 'installing'
}
