import fs from 'fs'
import path from 'path'
import * as settings from '../../settings'
import { download } from '../../lib/download'
import { stripQueryParams } from '../../lib/downloadFilename'
import { loadTemplateJson } from './templateModels'
import { TEMPLATE_INPUT_BASE } from './curatedTemplates'
import type { InstallationRecord } from '../../installations'

export interface TemplateInputAsset {
  assetId: string
  filename: string
  mediaType: 'image' | 'video' | 'audio'
  previewUrl: string
  url: string
}

const LOAD_NODE_TYPES = new Set([
  'LoadImage',
  'LoadImageMask',
  'LoadAudio',
  'LoadVideo',
  'VHS_LoadVideo'
])

type TemplateInputMediaType = TemplateInputAsset['mediaType']

const MEDIA_TYPE_BY_EXTENSION: Readonly<Record<string, TemplateInputMediaType>> = {
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.webp': 'image',
  '.gif': 'image',
  '.bmp': 'image',
  '.mp4': 'video',
  '.webm': 'video',
  '.mov': 'video',
  '.mp3': 'audio',
  '.wav': 'audio',
  '.flac': 'audio',
  '.ogg': 'audio',
  '.m4a': 'audio'
}

function mediaTypeForFilename(filename: string): TemplateInputMediaType | undefined {
  return MEDIA_TYPE_BY_EXTENSION[path.extname(filename).toLowerCase()]
}

function isSafeInputAsset(name: string): boolean {
  if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) return false
  return mediaTypeForFilename(name) !== undefined
}

function walkLoadNodes(nodes: unknown, out: string[]): void {
  if (!Array.isArray(nodes)) return
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue
    const n = node as { type?: unknown; widgets_values?: unknown; nodes?: unknown }
    if (
      typeof n.type === 'string' &&
      LOAD_NODE_TYPES.has(n.type) &&
      Array.isArray(n.widgets_values)
    ) {
      const first = n.widgets_values[0]
      if (typeof first === 'string') out.push(first)
    }
    if (Array.isArray(n.nodes)) walkLoadNodes(n.nodes, out)
  }
}

const SNAPSHOT_TTL_MS = 30_000
const snapshotCache = new Map<
  string,
  { expiresAt: number; snapshot: Promise<TemplateInputAsset[] | null> }
>()

export async function resolveTemplateInputAssetSnapshot(
  installation: InstallationRecord,
  templateId: string
): Promise<TemplateInputAsset[] | null> {
  const key = `${installation.id}\u0000${templateId}`
  const now = Date.now()
  const cached = snapshotCache.get(key)
  if (cached && cached.expiresAt > now) return cached.snapshot

  const snapshot = (async () => {
    const json = await loadTemplateJson(installation, templateId)
    return json && typeof json === 'object' ? resolveTemplateInputAssetsFromJson(json) : null
  })()
  const entry = { expiresAt: now + SNAPSHOT_TTL_MS, snapshot }
  snapshotCache.set(key, entry)
  void snapshot.then((value) => {
    if (value === null && snapshotCache.get(key) === entry) snapshotCache.delete(key)
  })
  return snapshot
}

export async function resolveTemplateInputAssets(
  installation: InstallationRecord,
  templateId: string
): Promise<TemplateInputAsset[]> {
  const json = await loadTemplateJson(installation, templateId)
  return resolveTemplateInputAssetsFromJson(json)
}

function resolveTemplateInputAssetsFromJson(json: unknown): TemplateInputAsset[] {
  if (!json || typeof json !== 'object') return []

  const doc = json as { nodes?: unknown; definitions?: { subgraphs?: unknown } }
  const names: string[] = []
  walkLoadNodes(doc.nodes, names)
  const subgraphs = doc.definitions?.subgraphs
  if (Array.isArray(subgraphs)) {
    for (const sg of subgraphs) {
      if (sg && typeof sg === 'object') walkLoadNodes((sg as { nodes?: unknown }).nodes, names)
    }
  }

  const seen = new Set<string>()
  const result: TemplateInputAsset[] = []
  for (const raw of names) {
    const filename = stripQueryParams(raw)
    const mediaType = mediaTypeForFilename(filename)
    if (!isSafeInputAsset(filename) || !mediaType || seen.has(filename)) continue
    seen.add(filename)
    const url = `${TEMPLATE_INPUT_BASE}/${encodeURIComponent(filename)}`
    result.push({ assetId: filename, filename, mediaType, previewUrl: url, url })
  }
  return result
}

export function resolveInputDir(installation: InstallationRecord): string {
  if (installation.useSharedInput !== false) {
    return settings.get('inputDir') || settings.defaults.inputDir
  }
  return installation.inputDir || path.join(installation.installPath, 'ComfyUI', 'input')
}

export interface TemplateInputAssetAvailability {
  filename: string
  status: 'present' | 'missing' | 'unknown'
}

interface TemplateInputAssetAvailabilityDependencies {
  access: (filePath: string) => Promise<void>
}

export async function resolveTemplateInputAssetAvailability(
  installation: InstallationRecord,
  filenames: readonly string[],
  { access = fs.promises.access }: Partial<TemplateInputAssetAvailabilityDependencies> = {}
): Promise<TemplateInputAssetAvailability[]> {
  const inputDir = resolveInputDir(installation)
  const seen = new Set<string>()
  const candidates: string[] = []

  for (const filename of filenames) {
    if (!isSafeInputAsset(filename) || seen.has(filename)) continue
    seen.add(filename)
    candidates.push(filename)
  }

  return Promise.all(
    candidates.map(async (filename) => {
      try {
        await access(path.join(inputDir, filename))
        return { filename, status: 'present' as const }
      } catch (error) {
        return {
          filename,
          status:
            (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
              ? ('missing' as const)
              : ('unknown' as const)
        }
      }
    })
  )
}

export interface PlacedInputAsset {
  filename: string
  downloaded: boolean
}

export async function downloadTemplateInputAssets(
  installation: InstallationRecord,
  templateId: string,
  log: (text: string) => void,
  signal?: AbortSignal,
  workflowJson?: unknown
): Promise<PlacedInputAsset[]> {
  const assets = workflowJson
    ? resolveTemplateInputAssetsFromJson(workflowJson)
    : await resolveTemplateInputAssets(installation, templateId)
  if (assets.length === 0) return []

  let destDir: string
  try {
    destDir = resolveInputDir(installation)
    await fs.promises.mkdir(destDir, { recursive: true })
  } catch (err) {
    log(
      `[templates] Could not prepare the input dir; skipping input assets: ${(err as Error).message}\n`
    )
    return []
  }

  const results: PlacedInputAsset[] = []
  for (const asset of assets) {
    if (signal?.aborted) break
    const destPath = path.join(destDir, asset.filename)
    try {
      await fs.promises.access(destPath)
      results.push({ filename: asset.filename, downloaded: false })
      log(`[templates] Input asset ${asset.filename} already present, skipping.\n`)
      continue
    } catch {}
    try {
      await download(asset.url, destPath, null, { signal })
      results.push({ filename: asset.filename, downloaded: true })
      log(`[templates] Downloaded input asset ${asset.filename}.\n`)
    } catch (err) {
      if (signal?.aborted || (err as Error)?.message === 'Download cancelled') break
      log(`[templates] Could not fetch input asset ${asset.filename}: ${(err as Error).message}\n`)
    }
  }
  return results
}
