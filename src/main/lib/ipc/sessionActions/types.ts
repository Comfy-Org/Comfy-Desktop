import type { DbLockOffer } from '../../../../types/ipc'
import type { InstallationRecord } from '../shared'

export interface ActionContext {
  event: Electron.IpcMainInvokeEvent
  installationId: string
  /** Runtime identity when one installation owns an isolated secondary session. */
  sessionId?: string
  inst: InstallationRecord
  actionData?: Record<string, unknown>
}

export interface ActionResult {
  ok: boolean
  message?: string
  navigate?: string
  running?: boolean
  cancelled?: boolean
  mode?: string
  port?: number
  url?: string
  portConflict?: Record<string, unknown>
  dbLockHolder?: DbLockOffer
  /** Set by actions producing a new install record so the renderer can open it in its own window. */
  newInstallationId?: string
}
