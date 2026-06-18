import fs from 'fs'
import path from 'path'
import * as settings from '../../settings'
import { download } from '../../lib/download'
import { stripQueryParams } from '../../lib/comfyDownloadManager'
import { loadTemplateJson } from './templateModels'
import { TEMPLATE_INPUT_BASE } from './curatedTemplates'
import type { InstallationRecord } from '../../installations'

/**
 * A single sample input file a template's `LoadImage`/`LoadVideo`/`LoadAudio`
 * node references, ready to download into the install's `input/` dir.
 *
 * The filename is derived from the workflow JSON (not hand-maintained) and the
 * bytes are fetched from the templates repo's root `input/` dir at install time,
 * so a template's input node resolves on first open without us shipping or
 * tracking any binary.
 */
export interface TemplateInputAsset {
  /** Bare on-disk filename, placed at `<inputDir>/<filename>`. */
  filename: string
  /** Source URL under the repo's `input/` dir. */
  url: string
}

/** Node types whose first widget value is an `input/` filename. Mirrors the
 *  loader nodes the workflow templates use for sample media. */
const LOAD_NODE_TYPES = new Set(['LoadImage', 'LoadImageMask', 'LoadAudio', 'LoadVideo', 'VHS_LoadVideo'])

/** Media extensions we'll place in `input/`. Excludes model/script types so a
 *  crafted widget value can't pull an arbitrary payload through this path. */
const ALLOWED_INPUT_EXTENSIONS = [
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp',
  '.mp4', '.webm', '.mov',
  '.mp3', '.wav', '.flac', '.ogg', '.m4a',
]

/** A template-declared input filename must be a bare name (no separator, no
 *  `..`) with an allowed media extension, so it can't escape the input dir or
 *  pull a non-media payload. */
function isSafeInputAsset(name: string): boolean {
  if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) return false
  const lower = name.toLowerCase()
  return ALLOWED_INPUT_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

/** Collect the first widget value (the filename) of every Load* node. */
function walkLoadNodes(nodes: unknown, out: string[]): void {
  if (!Array.isArray(nodes)) return
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue
    const n = node as { type?: unknown; widgets_values?: unknown; nodes?: unknown }
    if (typeof n.type === 'string' && LOAD_NODE_TYPES.has(n.type) && Array.isArray(n.widgets_values)) {
      const first = n.widgets_values[0]
      if (typeof first === 'string') out.push(first)
    }
    if (Array.isArray(n.nodes)) walkLoadNodes(n.nodes, out)
  }
}

/**
 * Extract the de-duplicated, validated set of sample input assets a template
 * needs. Scans every Load* node (including subgraph definitions), keeps only
 * bare media filenames, and points each at the repo's `input/` dir. Returns `[]`
 * for templates with no image/media input or when the JSON can't be resolved.
 */
export async function resolveTemplateInputAssets(
  installation: InstallationRecord,
  templateId: string,
): Promise<TemplateInputAsset[]> {
  const json = await loadTemplateJson(installation, templateId)
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
    if (!isSafeInputAsset(filename) || seen.has(filename)) continue
    seen.add(filename)
    result.push({ filename, url: `${TEMPLATE_INPUT_BASE}/${encodeURIComponent(filename)}` })
  }
  return result
}

/**
 * Resolve the `input/` dir ComfyUI reads at launch for this install — the same
 * precedence the launch args + session migration use: shared (global settings)
 * → per-install override → `<installPath>/ComfyUI/input`.
 */
export function resolveInputDir(installation: InstallationRecord): string {
  if (installation.useSharedInputOutput !== false) {
    return settings.get('inputDir') || settings.defaults.inputDir
  }
  return installation.inputDir || path.join(installation.installPath, 'ComfyUI', 'input')
}

export interface PlacedInputAsset {
  filename: string
  /** `false` when the file already existed on disk (download skipped). */
  downloaded: boolean
}

/**
 * Download a template's sample input asset(s) into the install's `input/` dir so
 * its Load* node resolves on first open. Best-effort: a resolve/download/write
 * error is logged and skipped (ComfyUI's missing-input prompt is the final
 * safety net), never throwing. Idempotent — an asset already on disk is left
 * untouched.
 */
export async function downloadTemplateInputAssets(
  installation: InstallationRecord,
  templateId: string,
  log: (text: string) => void,
  signal?: AbortSignal,
): Promise<PlacedInputAsset[]> {
  const assets = await resolveTemplateInputAssets(installation, templateId)
  if (assets.length === 0) return []

  let destDir: string
  try {
    destDir = resolveInputDir(installation)
    await fs.promises.mkdir(destDir, { recursive: true })
  } catch (err) {
    log(`[templates] Could not prepare the input dir; skipping input assets: ${(err as Error).message}\n`)
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
    } catch {
      // not present — download it
    }
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
