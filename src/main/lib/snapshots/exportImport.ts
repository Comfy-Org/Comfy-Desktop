import fs from 'fs'
import path from 'path'
import { isSafePathComponent } from '../cnr'
import { snapshotsDir, formatTimestamp } from './store'
import * as telemetry from '../telemetry'
import type { Snapshot, SnapshotEntry, SnapshotExportEnvelope } from './types'

export function buildExportEnvelope(
  installationName: string,
  entries: SnapshotEntry[]
): SnapshotExportEnvelope {
  // v2 carries torch stack data. Deliberate compatibility break: older Desktop
  // versions reject a v2 file instead of importing it and silently performing
  // the legacy skip-torch restore.
  return {
    type: 'comfyui-desktop-2-snapshot',
    version: 2,
    exportedAt: new Date().toISOString(),
    installationName,
    snapshots: entries.map((e) => e.snapshot)
  }
}

const VALID_TRIGGERS = new Set([
  'boot',
  'restart',
  'manual',
  'pre-update',
  'post-update',
  'post-restore'
])

// PyPI package names: letters, digits, dots, hyphens, underscores (PEP 508).
// Must not start with '-' to avoid argument injection when passed to uv pip.
const VALID_PIP_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function isValidCustomNode(n: unknown): boolean {
  if (!n || typeof n !== 'object') return false
  const node = n as Record<string, unknown>
  if (typeof node.dirName !== 'string' || !isSafePathComponent(node.dirName)) return false
  if (typeof node.id !== 'string' || !node.id) return false
  if (typeof node.type !== 'string' || !['cnr', 'git', 'file'].includes(node.type)) return false
  return true
}

// Version tuple: PEP 440-ish public version, optionally with a local tag.
const VALID_VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/

/** Strict validation of the v2 `torchStack` discriminated union. Only typed,
 *  allowlisted sources are accepted — an imported snapshot can never smuggle
 *  in an arbitrary URL or expand the protected-package surface. */
function isValidTorchStack(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false
  const obj = v as Record<string, unknown>
  if (obj.kind === 'observed') {
    return (obj.torchVersion === null || typeof obj.torchVersion === 'string') &&
      typeof obj.observedAt === 'string'
  }
  if (obj.kind !== 'managed') return false
  const ref = obj.ref as Record<string, unknown> | undefined
  if (!ref || typeof ref !== 'object') return false
  if (typeof ref.stackId !== 'string' || typeof ref.variant !== 'string' || typeof ref.pythonVersion !== 'string') return false
  const packages = ref.packages as Record<string, unknown> | undefined
  if (!packages || typeof packages !== 'object') return false
  if (typeof packages.torch !== 'string' || !VALID_VERSION.test(packages.torch)) return false
  for (const opt of ['torchvision', 'torchaudio'] as const) {
    if (packages[opt] !== undefined && (typeof packages[opt] !== 'string' || !VALID_VERSION.test(packages[opt] as string))) return false
  }
  const source = ref.source as Record<string, unknown> | undefined
  if (!source || typeof source !== 'object') return false
  if (source.kind === 'comfy-bundle') {
    return typeof source.variant === 'string' && typeof source.bundleTag === 'string'
  }
  if (source.kind === 'pytorch-index') {
    return ['cuda', 'xpu', 'rocm', 'cpu'].includes(source.backend as string) &&
      typeof source.indexTag === 'string' && /^[a-z0-9.]+$/.test(source.indexTag as string)
  }
  if (source.kind === 'pypi') return source.backend === 'mps'
  return false
}

function isValidSnapshot(s: unknown): s is Snapshot {
  if (!s || typeof s !== 'object') return false
  const obj = s as Record<string, unknown>
  if (obj.version !== 1 && obj.version !== 2) return false
  // torchStack is a v2 concept; a v1 snapshot carrying one is malformed.
  if (obj.torchStack !== undefined && (obj.version !== 2 || !isValidTorchStack(obj.torchStack))) return false
  if (typeof obj.createdAt !== 'string' || isNaN(Date.parse(obj.createdAt))) return false
  if (typeof obj.trigger !== 'string' || !VALID_TRIGGERS.has(obj.trigger)) return false
  if (obj.comfyui == null || typeof obj.comfyui !== 'object') return false
  if (!Array.isArray(obj.customNodes)) return false
  if (obj.pipPackages == null || typeof obj.pipPackages !== 'object') return false

  // Validate custom node entries
  for (const node of obj.customNodes) {
    if (!isValidCustomNode(node)) return false
  }

  // Validate pip package names
  const pips = obj.pipPackages as Record<string, unknown>
  for (const name of Object.keys(pips)) {
    if (!VALID_PIP_NAME.test(name)) return false
    if (typeof pips[name] !== 'string') return false
  }

  return true
}

export function validateExportEnvelope(data: unknown): SnapshotExportEnvelope {
  if (!data || typeof data !== 'object') throw new Error('Invalid file: not a JSON object')
  const obj = data as Record<string, unknown>
  if (obj.type !== 'comfyui-desktop-2-snapshot')
    throw new Error('Invalid file: not a Comfy Desktop snapshot export')
  if (obj.version !== 1 && obj.version !== 2)
    throw new Error(`Unsupported snapshot version: ${obj.version}`)
  if (!Array.isArray(obj.snapshots) || obj.snapshots.length === 0)
    throw new Error('File contains no snapshots')
  for (let i = 0; i < obj.snapshots.length; i++) {
    if (!isValidSnapshot(obj.snapshots[i])) throw new Error(`Invalid snapshot at index ${i}`)
  }
  return obj as unknown as SnapshotExportEnvelope
}

export async function importSnapshots(
  installPath: string,
  envelope: SnapshotExportEnvelope,
  installationId: string
): Promise<{ imported: number; filenames: string[] }> {
  const dir = snapshotsDir(installPath)
  await fs.promises.mkdir(dir, { recursive: true })

  const filenames: string[] = []
  // Each imported snapshot gets a fresh timestamp so it lands at the top of the
  // timeline.  Envelope is newest-first (index 0 = newest), so the first entry
  // gets the highest timestamp and later entries get progressively older ones.
  const count = envelope.snapshots.length
  const baseTime = Date.now()

  for (let i = 0; i < count; i++) {
    const snapshot = envelope.snapshots[i]!
    const now = new Date(baseTime + (count - 1 - i))
    const stamped = { ...snapshot, createdAt: now.toISOString() }
    const suffix = Math.random().toString(16).slice(2, 8)
    const filename = `${formatTimestamp(now)}-${snapshot.trigger}-${suffix}.json`
    const filePath = path.join(dir, filename)
    const tmpPath = `${filePath}.${suffix}.tmp`
    try {
      await fs.promises.writeFile(tmpPath, JSON.stringify(stamped, null, 2))
      await fs.promises.rename(tmpPath, filePath)
    } catch (err) {
      // Clean up any files already written
      for (const written of filenames) {
        await fs.promises.unlink(path.join(dir, written)).catch(() => {})
      }
      throw err
    }
    filenames.push(filename)

    // Per-snapshot emit (not a single batch event) so the trigger / size
    // distribution of imported snapshots is queryable the same way as
    // `comfy.desktop.snapshot.created`. `batch_size` + `batch_index` let dashboards
    // recover the import-operation grouping when they care about it.
    //
    // Distinct event from `comfy.desktop.snapshot.created` because the snapshot
    // wasn't *taken* on this install — it was copied in from an export
    // envelope (manual import or standalone migration), and we want the
    // "how often does an install snapshot itself" metric to stay clean.
    telemetry.emit('comfy.desktop.snapshot.imported', {
      installation_id: installationId,
      original_trigger: snapshot.trigger,
      custom_nodes_count: snapshot.customNodes.length,
      pip_packages_count: Object.keys(snapshot.pipPackages).length,
      has_label: !!(snapshot.label && snapshot.label.length > 0),
      batch_size: count,
      batch_index: i
    })
  }

  return { imported: filenames.length, filenames }
}
