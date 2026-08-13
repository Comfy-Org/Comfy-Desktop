import type { ScannedNode } from '../nodes'
import type { SnapshotTorchStack } from '../../sources/standalone/torchStackTypes'

/** How a snapshot is applied to an install.
 *  - `exact`: reproduce the recorded state precisely. An unavailable PyTorch
 *    stack aborts the restore; nothing is substituted.
 *  - `compatible`: reach the closest working state on this machine. An
 *    unavailable PyTorch stack keeps the local stack (disclosed in the result),
 *    and node requirements are repaired after the exact pip sync so the sync
 *    can never strip packages nodes need. A substituted/repaired result never
 *    commits an imported envelope to history — the post-restore snapshot of
 *    the actual state does. */
export type RestoreMode = 'exact' | 'compatible'

export interface Snapshot {
  /** 1 = legacy (no torch stack data); 2 = adds `torchStack`. New snapshots
   *  are written as v2; v1 snapshots remain readable. */
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
  /** When true, pip packages are recorded for info only and NOT force-synced during restore. */
  skipPipSync?: boolean
  pythonVersion?: string
  updateChannel?: string
  /** v2: identity of the PyTorch stack at capture time. `managed` = exact
   *  catalog stack (restorable); `observed` = unknown provenance (info only). */
  torchStack?: SnapshotTorchStack
}

export interface SnapshotEntry {
  filename: string
  snapshot: Snapshot
}

export interface SnapshotExportEnvelope {
  type: 'comfyui-desktop-2-snapshot'
  /** 2 since torch stack data was added. Older Desktop versions reject v2
   *  instead of importing it and silently skipping the torch restore. */
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

export interface SnapshotDiffSummary {
  nodesAdded: number
  nodesRemoved: number
  nodesChanged: number
  pipsAdded: number
  pipsRemoved: number
  pipsChanged: number
  comfyuiChanged: boolean
  updateChannelChanged: boolean
}

export interface SnapshotSummary {
  filename: string
  createdAt: string
  trigger: 'boot' | 'restart' | 'manual' | 'pre-update' | 'post-update' | 'post-restore'
  label: string | null
  comfyuiVersion: string
  nodeCount: number
  pipPackageCount: number
  diffVsPrevious?: SnapshotDiffSummary
}

export interface SnapshotDetailData {
  filename: string
  createdAt: string
  trigger: string
  label: string | null
  comfyuiVersion: string
  comfyui: {
    ref: string
    commit: string | null
    releaseTag: string
    variant: string
  }
  pythonVersion?: string
  updateChannel?: string
  customNodes: ScannedNode[]
  pipPackageCount: number
  pipPackages: Record<string, string>
}

export interface SnapshotDiffData {
  mode: 'previous' | 'current'
  baseLabel: string
  diff: SnapshotDiff
  empty: boolean
}

export interface RestoreResult {
  installed: string[]
  removed: string[]
  changed: Array<{ name: string; from: string; to: string }>
  protectedSkipped: string[]
  failed: string[]
  errors: string[]
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
