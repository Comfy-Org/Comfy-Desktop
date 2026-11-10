import fs from 'fs'
import os from 'os'
import crypto from 'crypto'
import path from 'path'
import { isSafePathComponent } from '../cnr'
import { isValidAmdMultiArchSource } from '../../sources/standalone/torchStackTypes'
import type { TorchStackPackages } from '../../sources/standalone/torchStackTypes'
import { snapshotsDir, formatTimestamp } from './store'
import * as telemetry from '../telemetry'
import { VALID_PIP_NAME } from '../pip'
import type { Snapshot, SnapshotEntry, SnapshotExportEnvelope } from './types'

export function buildExportEnvelope(
  installationName: string,
  entries: SnapshotEntry[]
): SnapshotExportEnvelope {
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

function isValidCustomNode(n: unknown): boolean {
  if (!n || typeof n !== 'object') return false
  const node = n as Record<string, unknown>
  if (typeof node.dirName !== 'string' || !isSafePathComponent(node.dirName)) return false
  if (typeof node.id !== 'string' || !node.id) return false
  if (typeof node.type !== 'string' || !['cnr', 'git', 'file'].includes(node.type)) return false
  return true
}

const VALID_VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/

function isVersionValid(val: unknown): boolean {
  return typeof val === 'string' && VALID_VERSION.test(val)
}

function isValidTorchStack(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false
  const obj = v as Record<string, unknown>
  if (obj.kind === 'observed') {
    if (obj.torchVersion !== null && !isVersionValid(obj.torchVersion)) return false
    for (const opt of ['torchvisionVersion', 'torchaudioVersion'] as const) {
      const val = obj[opt]
      if (val !== undefined && val !== null && !isVersionValid(val)) return false
    }
    return typeof obj.observedAt === 'string'
  }
  if (obj.kind !== 'managed') return false
  const ref = obj.ref as Record<string, unknown> | undefined
  if (!ref || typeof ref !== 'object') return false
  if (
    typeof ref.stackId !== 'string' ||
    typeof ref.variant !== 'string' ||
    typeof ref.pythonVersion !== 'string'
  )
    return false
  const packages = ref.packages as Record<string, unknown> | undefined
  if (!packages || typeof packages !== 'object') return false
  if (!isVersionValid(packages.torch)) return false
  for (const opt of ['torchvision', 'torchaudio'] as const) {
    if (packages[opt] !== undefined && !isVersionValid(packages[opt])) return false
  }
  const source = ref.source as Record<string, unknown> | undefined
  if (!source || typeof source !== 'object') return false
  if (source.kind === 'comfy-bundle') {
    return typeof source.variant === 'string' && typeof source.bundleTag === 'string'
  }
  if (source.kind === 'pytorch-index') {
    return (
      ['cuda', 'xpu', 'rocm', 'cpu'].includes(source.backend as string) &&
      typeof source.indexTag === 'string' &&
      /^[a-z0-9.]+$/.test(source.indexTag as string)
    )
  }
  if (source.kind === 'amd-multi-arch-index') {
    return isValidAmdMultiArchSource(source, packages as unknown as TorchStackPackages, ref.stackId)
  }
  if (source.kind === 'pypi') return source.backend === 'mps'
  return false
}

function isValidSnapshot(s: unknown): s is Snapshot {
  if (!s || typeof s !== 'object') return false
  const obj = s as Record<string, unknown>
  if (obj.version !== 1 && obj.version !== 2) return false
  if (obj.torchStack !== undefined && (obj.version !== 2 || !isValidTorchStack(obj.torchStack)))
    return false
  if (typeof obj.createdAt !== 'string' || isNaN(Date.parse(obj.createdAt))) return false
  if (typeof obj.trigger !== 'string' || !VALID_TRIGGERS.has(obj.trigger)) return false
  if (obj.comfyui == null || typeof obj.comfyui !== 'object') return false
  if (!Array.isArray(obj.customNodes)) return false
  if (obj.pipPackages == null || typeof obj.pipPackages !== 'object') return false

  for (const node of obj.customNodes) {
    if (!isValidCustomNode(node)) return false
  }

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
  if (obj.version !== 1 && obj.version !== 2) {
    if (typeof obj.version === 'number' && Number.isInteger(obj.version) && obj.version > 2)
      throw new Error(
        `Unsupported snapshot version: ${obj.version}. This file was created by a newer version of Comfy Desktop; updating the app will likely allow importing it.`
      )
    throw new Error(`Unsupported snapshot version: ${obj.version}`)
  }
  if (!Array.isArray(obj.snapshots) || obj.snapshots.length === 0)
    throw new Error('File contains no snapshots')
  for (let i = 0; i < obj.snapshots.length; i++) {
    if (!isValidSnapshot(obj.snapshots[i])) throw new Error(`Invalid snapshot at index ${i}`)
    if ((obj.snapshots[i] as Snapshot).version > (obj.version as number))
      throw new Error(`Invalid snapshot at index ${i}: snapshot version exceeds envelope version`)
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
      for (const written of filenames) {
        await fs.promises.unlink(path.join(dir, written)).catch(() => {})
      }
      throw err
    }
    filenames.push(filename)

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

const STAGING_SUBDIR = 'comfyui-desktop-2-staged-restores'
const STAGE_TOKEN_RE = /^[a-f0-9]{32}$/
const STAGE_MAX_AGE_MS = 24 * 60 * 60 * 1000

function stagingDir(): string {
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

export async function stageSnapshotEnvelope(
  envelope: SnapshotExportEnvelope,
  installationId: string
): Promise<string> {
  const dir = stagingDir()
  await fs.promises.mkdir(dir, { recursive: true })
  await pruneStaleStaged(dir)
  const token = crypto.randomBytes(16).toString('hex')
  const filePath = path.join(dir, `${token}.json`)
  const tmpPath = `${filePath}.tmp`
  await fs.promises.writeFile(tmpPath, JSON.stringify({ installationId, envelope }))
  await fs.promises.rename(tmpPath, filePath)
  return token
}

export async function loadStagedSnapshotEnvelope(
  token: string,
  installationId: string
): Promise<SnapshotExportEnvelope> {
  const filePath = resolveStagedPath(token)
  if (!filePath) throw new Error('Invalid staged snapshot token')
  const content = await fs.promises.readFile(filePath, 'utf-8')
  const staged = JSON.parse(content) as { installationId?: unknown; envelope?: unknown }
  if (staged.installationId !== installationId) throw new Error('Invalid staged snapshot token')
  return validateExportEnvelope(staged.envelope)
}

export async function releaseStagedSnapshotEnvelope(token: string): Promise<void> {
  const filePath = resolveStagedPath(token)
  if (!filePath) return
  await fs.promises.unlink(filePath).catch(() => {})
}
