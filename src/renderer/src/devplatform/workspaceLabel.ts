/**
 * The one place a workspace turns into a human label.
 *
 * Two surfaces name the same workspace — the account chip and the chooser's
 * workspace shelf — and they must agree exactly, so the shelf header reads as
 * the same thing the chip says you're signed into. The claims carry no human
 * name (backend gap), so the name is looked up in the loaded workspace list and
 * falls back to the raw id until that list arrives.
 */
import type { AuthStatus, Workspace } from '../../../types/ipc'

/** Human label for one workspace row. Personal workspaces get the product name. */
export function workspaceLabel(
  ws: Pick<Workspace, 'name' | 'type'>,
  personalLabel: string
): string {
  return ws.type === 'team' ? ws.name : personalLabel
}

/** Label for the workspace the session is currently scoped to. Empty when
 *  signed out — callers use that to decide whether the surface exists at all. */
export function currentWorkspaceLabel(
  status: AuthStatus,
  workspaces: readonly Workspace[],
  personalLabel: string
): string {
  if (!status.signedIn) return ''
  if (status.workspaceType === 'team' && status.workspaceId) {
    return workspaces.find((w) => w.id === status.workspaceId)?.name ?? status.workspaceId
  }
  return personalLabel
}
