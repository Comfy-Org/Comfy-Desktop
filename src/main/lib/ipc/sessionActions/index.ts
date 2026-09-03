import { _broadcastToRenderer } from '../broadcast'
import type { ActionContext, ActionResult } from './types'
import { handleRemove, handleOpenFolder, handleRename } from './basic'
import { handleDelete } from './delete'
import { handleCopy, handleCopyUpdate, handleCopyChangePytorch, handleReleaseUpdate } from './copy'
import { handleMigrateToStandalone } from './migrate'
import { handleLaunch } from './launch'
import { handleDelegateToSource } from './delegate'

export type { ActionContext, ActionResult } from './types'
export { handleRemove, handleOpenFolder, handleRename } from './basic'
export { handleDelete } from './delete'
export { handleCopy, handleCopyUpdate, handleCopyChangePytorch, handleReleaseUpdate } from './copy'
export { handleMigrateToStandalone } from './migrate'
export { handleLaunch } from './launch'
export { handleDelegateToSource } from './delegate'
export { withAbortableSessionAction } from './withAbortable'

// Action ids handled directly here; anything else delegates to the source plugin.
const SESSION_ACTION_IDS = [
  'remove',
  'rename',
  'open-folder',
  'delete',
  'copy',
  'copy-update',
  'copy-pytorch',
  'release-update',
  'migrate-to-standalone',
  'launch'
] as const

export type SessionActionId = (typeof SESSION_ACTION_IDS)[number]

const SESSION_ACTION_ID_SET: ReadonlySet<string> = new Set(SESSION_ACTION_IDS)

function isSessionActionId(id: string): id is SessionActionId {
  return SESSION_ACTION_ID_SET.has(id)
}

// Exhaustive over SessionActionId so a new union member fails to compile here.
function dispatchToSessionHandler(
  ctx: ActionContext,
  actionId: SessionActionId
): Promise<ActionResult> {
  switch (actionId) {
    case 'remove':
      return handleRemove(ctx)
    case 'rename':
      return handleRename(ctx)
    case 'open-folder':
      return handleOpenFolder(ctx)
    case 'delete':
      return handleDelete(ctx)
    case 'copy':
      return handleCopy(ctx)
    case 'copy-update':
      return handleCopyUpdate(ctx)
    case 'copy-pytorch':
      return handleCopyChangePytorch(ctx)
    case 'release-update':
      return handleReleaseUpdate(ctx)
    case 'migrate-to-standalone':
      return handleMigrateToStandalone(ctx)
    case 'launch':
      return handleLaunch(ctx)
    default: {
      const _exhaustive: never = actionId
      throw new Error(`Unhandled session action: ${String(_exhaustive)}`)
    }
  }
}

// Live registry of the action currently running per install, mirrored to every
// window through the `operation-changed` broadcast and the
// `get-active-operations` snapshot. This is how a window that did NOT start an
// operation (e.g. the dashboard, while an update runs from the picker popup)
// still knows one is in flight. In-memory only: an app restart clears it, so a
// crash mid-operation can never leave a stale "busy" state behind.
const _activeActions = new Map<string, { actionId: string }>()

/** Snapshot of installs with an action currently in flight (id + action id). */
export function _getActiveOperations(): { installationId: string; actionId: string }[] {
  return Array.from(_activeActions, ([installationId, { actionId }]) => ({
    installationId,
    actionId
  }))
}

// Single dispatch point for run-action and the picker's background-op path:
// session ids route to the switch above, everything else to the source.
export async function dispatchSessionAction(
  ctx: ActionContext,
  actionId: string
): Promise<ActionResult> {
  const { installationId } = ctx
  // Only the outermost action per install owns the registry entry - a handler
  // that dispatches a nested action must not clear its parent's entry (or
  // re-announce over it) when the inner one finishes.
  const owned = !_activeActions.has(installationId)
  if (owned) {
    _activeActions.set(installationId, { actionId })
    _broadcastToRenderer('operation-changed', { installationId, actionId, active: true })
  }
  try {
    if (isSessionActionId(actionId)) {
      return await dispatchToSessionHandler(ctx, actionId)
    }
    return await handleDelegateToSource(ctx, actionId)
  } finally {
    if (owned) {
      _activeActions.delete(installationId)
      _broadcastToRenderer('operation-changed', { installationId, actionId, active: false })
    }
  }
}
