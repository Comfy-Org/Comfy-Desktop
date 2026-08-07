/**
 * Model staging: the models half of a distribution install.
 *
 * A distribution archive carries only code and the environment (`venv/` +
 * `ComfyUI/`), never model weights. After the archive extracts, this stages the
 * distribution's declared models into the install's own ComfyUI model tree so
 * they are present before ComfyUI starts, mirroring how comfy-deploy provisions
 * weights onto a volume before boot.
 *
 * Placement is `<installPath>/ComfyUI/models/<type>/<filename>`, the install's
 * built-in model root. That root is always on ComfyUI's model search path, so a
 * staged model is found whether or not the user shares a global model library.
 *
 * Integrity mirrors archive install: a model whose manifest carries a sha256 is
 * verified byte-for-byte and a mismatch fails the install; a model with no hash
 * installs unverified (the source, typically a public URL, supplied none). Each
 * model downloads to a `.partial` sibling that is renamed into place only after
 * it verifies, so an interrupted install never leaves a truncated model looking
 * complete, and a re-run resumes or re-fetches rather than trusting bad bytes.
 */
import fs from 'fs'
import path from 'path'

import { download } from '../lib/download'
import type { DownloadProgress } from '../lib/download'
import { sha256File, normalizeSha256 } from './install'
import type { ModelDescriptor, StageProgress } from './types'

export type StageModelsErrorKind = 'invalid-model' | 'model-checksum-mismatch'

export class StageModelsError extends Error {
  override name = 'StageModelsError'
  readonly kind: StageModelsErrorKind
  constructor(kind: StageModelsErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}

/** The download surface used, narrowed so a test can inject a fake. */
type DownloadFn = (
  url: string,
  destPath: string,
  onProgress: ((p: DownloadProgress) => void) | null,
  options?: { signal?: AbortSignal }
) => Promise<string>

export interface StageModelsOptions {
  models: readonly ModelDescriptor[]
  /** The install root (the dir that contains `ComfyUI/`). */
  installPath: string
  onProgress?: (p: StageProgress) => void
  signal?: AbortSignal
  /** Injectable download for tests; defaults to the real primitive. */
  download?: DownloadFn
}

/** A single path segment that cannot escape its parent: no separators, no `..`,
 *  no drive/absolute markers. Guards `models/<type>/<filename>` against a
 *  manifest that tries to traverse out of the model tree. */
function isSafeSegment(seg: string): boolean {
  if (!seg || seg === '.' || seg === '..') return false
  if (seg.includes('/') || seg.includes('\\') || seg.includes('\0')) return false
  if (path.isAbsolute(seg) || /^[a-zA-Z]:/.test(seg)) return false
  return true
}

/** A model URL must be https, or http to loopback. A remote plaintext (or
 *  downgradeable) source is MITM-substitutable, and a substituted `.pth`/`.ckpt`
 *  is arbitrary-code on load, so it is enforced independently of the sha256.
 *  Loopback http carries no network and never leaves the machine, so it is
 *  allowed (a local model cache or the test server). */
function isAllowedUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol === 'https:') return true
    return u.protocol === 'http:' && ['127.0.0.1', '::1', 'localhost'].includes(u.hostname)
  } catch {
    return false
  }
}

/** The real path of `dir` is inside `root` (defends against a symlinked model
 *  subdir in the extracted archive redirecting a write outside the install). */
function isContained(root: string, dir: string): boolean {
  try {
    const realRoot = fs.realpathSync(root)
    const realDir = fs.realpathSync(dir)
    return realDir === realRoot || realDir.startsWith(realRoot + path.sep)
  } catch {
    return false
  }
}

/** The install's built-in ComfyUI models root, `<installPath>/ComfyUI/models`. */
export function installModelsRoot(installPath: string): string {
  return path.join(installPath, 'ComfyUI', 'models')
}

/**
 * Download + verify + place each model under `<installPath>/ComfyUI/models`.
 * Throws {@link StageModelsError} on an unsafe path or a checksum mismatch. A
 * model already present with a matching hash is skipped, so a resumed or
 * repeated install does not re-download what is already staged.
 */
export async function stageModels(opts: StageModelsOptions): Promise<void> {
  const { models, installPath, onProgress, signal } = opts
  const doDownload = opts.download ?? download
  const total = models.length
  const modelsRoot = installModelsRoot(installPath)

  for (let i = 0; i < total; i++) {
    if (signal?.aborted) throw new Error('Cancelled')
    const model = models[i]!
    const index = i + 1

    if (!isSafeSegment(model.type) || !isSafeSegment(model.filename)) {
      throw new StageModelsError(
        'invalid-model',
        `Model ${model.type}/${model.filename} has an unsafe path.`
      )
    }
    if (!isAllowedUrl(model.downloadUrl)) {
      throw new StageModelsError(
        'invalid-model',
        `Model ${model.type}/${model.filename} download URL must be https.`
      )
    }

    const destDir = path.join(modelsRoot, model.type)
    // Create the target dir first, then confirm it really resolves inside the
    // install: a malicious archive can ship `ComfyUI/models/<type>` as a symlink
    // pointing outside, and writing through it would escape the install.
    fs.mkdirSync(destDir, { recursive: true })
    if (!isContained(installPath, destDir)) {
      throw new StageModelsError(
        'invalid-model',
        `Model directory ${model.type} escapes the install.`
      )
    }

    const dest = path.join(destDir, model.filename)
    const expected = normalizeSha256(model.sha256)

    // Already staged: a byte-verified file (or, when the manifest gave no hash,
    // any existing file) is left as-is so a re-run is cheap and idempotent.
    if (fs.existsSync(dest)) {
      if (!expected || (await sha256File(dest)) === expected) {
        onProgress?.({ index, total, filename: model.filename, percent: 100 })
        continue
      }
      // Present but wrong: drop it and re-fetch rather than trust bad bytes.
      await fs.promises.rm(dest, { force: true }).catch(() => {})
    }

    // Download to a sibling, verify, then rename into place: an interrupted
    // transfer never leaves a truncated model at the real name, and the rename
    // is atomic on the same filesystem. Drop a symlinked leftover partial so a
    // pre-planted link can't redirect the write; a plain partial resumes.
    const partial = `${dest}.partial`
    if (fs.existsSync(partial) && fs.lstatSync(partial).isSymbolicLink()) {
      await fs.promises.rm(partial, { force: true }).catch(() => {})
    }
    onProgress?.({ index, total, filename: model.filename, percent: 0 })
    await doDownload(
      model.downloadUrl,
      partial,
      (p: DownloadProgress) =>
        onProgress?.({ index, total, filename: model.filename, percent: p.percent }),
      signal ? { signal } : {}
    )

    if (expected) {
      const actual = await sha256File(partial)
      if (actual !== expected) {
        await fs.promises.rm(partial, { force: true }).catch(() => {})
        throw new StageModelsError(
          'model-checksum-mismatch',
          `Model ${model.type}/${model.filename} checksum mismatch: expected ${expected}, got ${actual}`
        )
      }
    }
    await fs.promises.rename(partial, dest)
    onProgress?.({ index, total, filename: model.filename, percent: 100 })
  }
}
