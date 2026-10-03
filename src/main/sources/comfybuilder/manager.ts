/** The manager answer launch uses, shared by the plugin and its detail
 *  sections; separate module so the two don't import each other in a cycle. */
import { managerAllowedByGovernance, readGovernance } from '../../comfybuilder'
import type { InstallationRecord } from '../../installations'

/** Record field: false when the installed release's author turned
 *  ComfyUI-Manager off, or its governance policy governs custom nodes (an
 *  allowlist or a blocklist). Written once the release's environment has landed. */
export const MANAGER_ALLOWED_FIELD = 'comfybuilderManagerAllowed'

/**
 * Whether this install launches with ComfyUI-Manager on: the record's answer,
 * and the governance policy on disk. The record can lag the installed archive
 * (a record written before Desktop dropped the manager under a blocklist, an
 * update interrupted before its last write), so the policy is read each time.
 * Records written before the field existed have no answer and count as Yes.
 */
export function managerAllowedAtLaunch(installation: InstallationRecord): boolean {
  return (
    installation[MANAGER_ALLOWED_FIELD] !== false &&
    managerAllowedByGovernance(readGovernance(installation.installPath))
  )
}
