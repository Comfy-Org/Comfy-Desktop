import type { ChildProcess } from 'child_process'
import type { AcceleratorSnapshot } from '../hardwareTap'
import type { ComfyFolders } from '../outputFolders'
import type { BetaArgView } from '../../../types/ipc'

export interface SessionInfo {
  proc: ChildProcess | null
  port: number
  url?: string
  mode: string
  installationName: string
  sourceInstallationId?: string
  startedAt: number
  hadWindow?: boolean
  flushTelemetry?: () => void
  getAcceleratorInfo?: () => AcceleratorSnapshot | null
  coreBetaArgs?: readonly BetaArgView[]
  launchFolders?: ComfyFolders
}

export const _runningSessions = new Map<string, SessionInfo>()
