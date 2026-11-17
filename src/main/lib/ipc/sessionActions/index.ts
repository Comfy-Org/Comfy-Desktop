import { _broadcastToRenderer } from '../broadcast'
import type { ActionContext, ActionResult } from './types'
import { handleRemove, handleOpenFolder, handleRename } from './basic'
import { handleDelete } from './delete'
import { handleCopy, handleCopyUpdate, handleCopyChangePytorch, handleReleaseUpdate } from './copy'
import { handleMigrateToStandalone } from './migrate'
import { handleLaunch } from './launch'
import { handleDelegateToSource } from './delegate'
import { occupiesInstall } from './occupiesInstall'

export type { ActionContext, ActionResult } from './types'
export { handleRemove, handleOpenFolder, handleRename } from './basic'
export { handleDelete } from './delete'
export { handleCopy, handleCopyUpdate, handleCopyChangePytorch, handleReleaseUpdate } from './copy'
export { handleMigrateToStandalone } from './migrate'
export { handleLaunch } from './launch'
export { handleDelegateToSource } from './delegate'
export { withAbortableSessionAction } from './withAbortable'

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

interface ActiveAction {
  actionId: string
  ready?: Promise<void>
}

const _activeActions = new Map<string, ActiveAction>()

export interface SessionActionObserver {
  before(installationId: string, actionId: string): Promise<void>
  after(installationId: string, actionId: string): void
}

let observer: SessionActionObserver | null = null

export function setSessionActionObserver(next: SessionActionObserver | null): void {
  observer = next
}

export function _getActiveOperations(): { installationId: string; actionId: string }[] {
  return Array.from(_activeActions, ([installationId, { actionId }]) => ({
    installationId,
    actionId
  }))
}

export async function dispatchSessionAction(
  ctx: ActionContext,
  actionId: string
): Promise<ActionResult> {
  const { installationId } = ctx
  const running = _activeActions.get(installationId)
  const takesOverFromLookup =
    running !== undefined && occupiesInstall(actionId) && !occupiesInstall(running.actionId)
  const owned = running === undefined || takesOverFromLookup
  const entry: ActiveAction = { actionId }
  if (owned) {
    _activeActions.set(installationId, entry)
    _broadcastToRenderer('operation-changed', { installationId, actionId, active: true })
  }
  try {
    if (owned) entry.ready = observer?.before(installationId, actionId).catch(() => {})
    const ready = owned ? entry.ready : running?.ready
    if (ready) await ready
    if (isSessionActionId(actionId)) {
      return await dispatchToSessionHandler(ctx, actionId)
    }
    return await handleDelegateToSource(ctx, actionId)
  } finally {
    if (owned && _activeActions.get(installationId) === entry) {
      _activeActions.delete(installationId)
      _broadcastToRenderer('operation-changed', { installationId, actionId, active: false })
    }
    if (owned) observer?.after(installationId, actionId)
  }
}
