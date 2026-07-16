import fs from 'fs'
import os from 'os'
import crypto from 'crypto'
import path from 'path'
import { isSafePathComponent } from '../cnr'
import { snapshotsDir, formatTimestamp } from './store'
import * as telemetry from '../telemetry'
import type { Snapshot, SnapshotEntry, SnapshotExportEnvelope } from './types'

export function buildExportEnvelope(
  installationName: string,
  entries: SnapshotEntry[]
): SnapshotExportEnvelope {
  return {
    type: 'comfyui-desktop-2-snapshot',
    version: 1,
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

function isValidSnapshot(s: unknown): s is Snapshot {
  if (!s || typeof s !== 'object') return false
  const obj = s as Record<string, unknown>
  if (obj.version !== 1) return false
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
  if (obj.version !== 1) throw new Error(`Unsupported snapshot version: ${obj.version}`)
  if (!Array.isArray(obj.snapshots) || obj.snapshots.length === 0)
    throw new Error('File contains no snapshots')
  for (let i = 0; i < obj.snapshots.length; i++) {
    if (!isValidSnapshot(obj.snapshots[i])) throw new Error(`Invalid snapshot at index ${i}`)
  }
  return obj as unknown as SnapshotExportEnvelope
}

/**
 * Commit an imported envelope into the install's live snapshot history. Only
 * call after a restore from the envelope has succeeded; to make an envelope
 * available as a restore target, stage it with `stageSnapshotEnvelope` instead.
 */
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

// --- Staged restore targets ---
//
// An imported envelope is staged to a token-keyed temp file (never loaded by a
// renderer-supplied path) and only committed to history via `importSnapshots`
// once a restore from it succeeds; failed restores leave live history untouched.

const STAGING_SUBDIR = 'comfyui-desktop-2-staged-restores'
// Tokens are hex strings; the strict shape doubles as path-traversal defense
// when resolving the staged file back from a token.
const STAGE_TOKEN_RE = /^[a-f0-9]{32}$/
// Bound the temp leak from failed-then-dismissed imports (no dismiss IPC):
// prune staged files older than this whenever a new one is staged.
const STAGE_MAX_AGE_MS = 24 * 60 * 60 * 1000

function stagingDir(): string {
  // Per-user suffix so installs run by different OS users on a shared machine
  // don't fight over ownership of one temp directory.
  let user = 'default'
  try {
    user = os.userInfo().username.replace(/[^\w.-]/g, '_')
  } catch {}
  return path.join(os.tmpdir(), `${STAGING_SUBDIR}-${user}`)
}

function resolveStagedPath(token: string): string | null {
  if (!STAGE_TOKEN_RE.test(token)) return null
  return path.join(stagingDir(), `${token}.json`)
}

async function pruneStaleStaged(dir: string): Promise<void> {
  try {
    const files = await fs.promises.readdir(dir)
    const cutoff = Date.now() - STAGE_MAX_AGE_MS
    await Promise.all(
      files
        .filter((f) => f.endsWith('.json'))
        .map(async (f) => {
          try {
            const stat = await fs.promises.stat(path.join(dir, f))
            if (stat.mtimeMs < cutoff) await fs.promises.unlink(path.join(dir, f))
          } catch {}
        })
    )
  } catch {}
}

/** Stage an envelope as a restore target and return its opaque token. */
export async function stageSnapshotEnvelope(envelope: SnapshotExportEnvelope): Promise<string> {
  const dir = stagingDir()
  await fs.promises.mkdir(dir, { recursive: true })
  await pruneStaleStaged(dir)
  const token = crypto.randomBytes(16).toString('hex')
  const filePath = path.join(dir, `${token}.json`)
  const tmpPath = `${filePath}.tmp`
  await fs.promises.writeFile(tmpPath, JSON.stringify(envelope))
  await fs.promises.rename(tmpPath, filePath)
  return token
}

/** Load a previously staged envelope by token. Throws if the token is invalid. */
export async function loadStagedSnapshotEnvelope(
  token: string
): Promise<SnapshotExportEnvelope> {
  const filePath = resolveStagedPath(token)
  if (!filePath) throw new Error('Invalid staged snapshot token')
  const content = await fs.promises.readFile(filePath, 'utf-8')
  return validateExportEnvelope(JSON.parse(content))
}

/** Delete a staged envelope. Safe to call with an unknown/invalid token. */
export async function releaseStagedSnapshotEnvelope(token: string): Promise<void> {
  const filePath = resolveStagedPath(token)
  if (!filePath) return
  await fs.promises.unlink(filePath).catch(() => {})
}
