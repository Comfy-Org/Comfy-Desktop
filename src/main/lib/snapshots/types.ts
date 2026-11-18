import type { ScannedNode } from '../nodes'
import type { SnapshotTorchStack } from '../../sources/standalone/torchStackTypes'

export type {
  SnapshotDetailData,
  SnapshotDiffData,
  SnapshotDiffSummary,
  SnapshotSummary
} from '../../../types/ipc'

export type RestoreMode = 'exact' | 'compatible'

export interface Snapshot {
  version: 1 | 2
  createdAt: string
  trigger: 'boot' | 'restart' | 'manual' | 'pre-update' | 'post-update' | 'post-restore'
  label: string | null
  comfyui: {
    ref: string
    commit: string | null
    releaseTag: string
    variant: string
    baseTag?: string
    commitsAhead?: number
  }
  customNodes: ScannedNode[]
  pipPackages: Record<string, string>
  skipPipSync?: boolean
  pythonVersion?: string
  updateChannel?: string
  torchStack?: SnapshotTorchStack
}

export interface SnapshotEntry {
  filename: string
  snapshot: Snapshot
}

export interface SnapshotExportEnvelope {
  type: 'comfyui-desktop-2-snapshot'
  version: 1 | 2
  exportedAt: string
  installationName: string
  snapshots: Snapshot[]
}

export interface SnapshotDiff {
  comfyuiChanged: boolean
  comfyui?: {
    from: {
      ref: string
      commit: string | null
      baseTag?: string
      commitsAhead?: number
      formattedVersion: string
    }
    to: {
      ref: string
      commit: string | null
      baseTag?: string
      commitsAhead?: number
      formattedVersion: string
    }
  }
  updateChannelChanged: boolean
  updateChannel?: { from: string; to: string }
  nodesAdded: ScannedNode[]
  nodesRemoved: ScannedNode[]
  nodesChanged: Array<{
    id: string
    type: string
    from: { version?: string; commit?: string; enabled: boolean }
    to: { version?: string; commit?: string; enabled: boolean }
  }>
  pipsAdded: Array<{ name: string; version: string }>
  pipsRemoved: Array<{ name: string; version: string }>
  pipsChanged: Array<{ name: string; from: string; to: string }>
}

export interface RestoreRevertOutcome {
  reason: 'cancelled' | 'failures'
  uninstalled: string[]
  keptPreexisting: string[]
  restoredFromBackup: boolean
  complete: boolean
}

export interface RestoreResult {
  installed: string[]
  removed: string[]
  changed: Array<{ name: string; from: string; to: string }>
  protectedSkipped: string[]
  failed: string[]
  errors: string[]
  revert?: RestoreRevertOutcome
}

export interface NodeRestoreResult {
  installed: string[]
  switched: string[]
  enabled: string[]
  disabled: string[]
  removed: string[]
  skipped: string[]
  failed: Array<{ id: string; error: string }>
  unreportable: string[]
}
