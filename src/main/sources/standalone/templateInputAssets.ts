import fs from 'fs'
import path from 'path'
import * as settings from '../../settings'
import { getBundledTemplateAssetPath } from '../../lib/bundledScript'
import { BUNDLED_TEMPLATES } from './bundledTemplates'
import type { InstallationRecord } from '../../installations'

/**
 * Resolve the `input/` directory ComfyUI will actually read at launch for this
 * install — the same precedence the launch args + session migration use:
 * shared (global settings) → per-install override → `<installPath>/ComfyUI/input`.
 */
export function resolveInputDir(installation: InstallationRecord): string {
  const useShared = installation.useSharedInputOutput !== false
  if (useShared) {
    return settings.get('inputDir') || settings.defaults.inputDir
  }
  return installation.inputDir || path.join(installation.installPath, 'ComfyUI', 'input')
}

/** Drop any path-y `inputAssets` entry: a template-declared filename must be a
 *  bare name (no separator, no `..`) so it can't write outside the input dir. */
function isSafeAssetName(name: string): boolean {
  return name.length > 0 && !name.includes('/') && !name.includes('\\') && !name.includes('..')
}

export interface CopiedInputAsset {
  filename: string
  /** `false` when the file already existed (skipped) — copy was a no-op. */
  copied: boolean
}

/**
 * Copy a template's bundled `LoadImage` input asset(s) into the install's
 * `input/` dir so the node resolves on first open. Best-effort: a missing
 * bundled file or write error is logged and skipped (ComfyUI's missing-input
 * prompt is the final safety net), never throwing.
 *
 * Idempotent — an asset already present on disk is left untouched.
 */
export async function copyTemplateInputAssets(
  installation: InstallationRecord,
  templateId: string,
  log: (text: string) => void,
): Promise<CopiedInputAsset[]> {
  const template = BUNDLED_TEMPLATES.find((t) => t.id === templateId)
  const assets = template?.inputAssets ?? []
  if (assets.length === 0) return []

  let destDir: string
  try {
    destDir = resolveInputDir(installation)
  } catch (err) {
    log(`[templates] Could not resolve the input dir; skipping input images: ${(err as Error).message}\n`)
    return []
  }
  const results: CopiedInputAsset[] = []

  for (const name of assets) {
    if (!isSafeAssetName(name)) {
      log(`[templates] Skipping unsafe input asset name "${name}".\n`)
      continue
    }
    const destPath = path.join(destDir, name)
    try {
      await fs.promises.stat(destPath)
      results.push({ filename: name, copied: false })
      log(`[templates] Input image ${name} already present, skipping.\n`)
      continue
    } catch {
      // not present — copy it in
    }
    const srcPath = getBundledTemplateAssetPath(name)
    try {
      await fs.promises.access(srcPath)
    } catch {
      log(`[templates] Bundled input image ${name} not found; skipping.\n`)
      continue
    }
    try {
      await fs.promises.mkdir(destDir, { recursive: true })
      await fs.promises.copyFile(srcPath, destPath)
      results.push({ filename: name, copied: true })
      log(`[templates] Copied input image ${name} into ${destDir}.\n`)
    } catch (err) {
      log(`[templates] Could not place input image ${name}: ${(err as Error).message}\n`)
    }
  }
  return results
}
