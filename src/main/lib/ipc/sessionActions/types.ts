import type { InstallationRecord } from '../shared'
import type { BlockingSession } from '../../../../types/ipc'

export interface ActionContext {
  event: Electron.IpcMainInvokeEvent
  installationId: string
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
  newInstallationId?: string
  blockingSessions?: BlockingSession[]
}
