/**
 * Install: the write side of the functionality library.
 *
 * Given a chosen {@link Artifact}, turn it into a runnable install directory:
 * resolve the presigned URL, download, verify sha256, extract, validate the
 * layout. The archive is what comfy-builder tars: a top-level `venv/` +
 * `ComfyUI/` (a ready, relocatable env), so there is no post-extract env build;
 * launch drives that `venv/` directly (see `./launch`).
 *
 * Integrity: when the artifact carries an `outputSha256` the bytes must match or
 * nothing is extracted. A MISSING hash is currently installed unverified because
 * the builder does not populate it yet (see the TODO in `installArtifact`); that
 * becomes fail-closed once it does. The archive downloads to a per-run temp under `cacheDir`
 * so concurrent installs of the same artifact cannot corrupt each other, and on
 * any failure only files THIS run created are cleaned up: a failed re-install
 * never destroys a previously-working environment.
 */
import { createHash, randomBytes } from 'crypto'
import fs from 'fs'
import { createReadStream } from 'fs'
import path from 'path'

import { download } from '../lib/download'
import type { DownloadProgress } from '../lib/download'
import { extractNested } from '../lib/extract'
import type { ExtractProgress } from '../lib/extract'
import type { ComfyBuilderClient } from './client'
import type { Artifact, InstallProgress } from './types'

/** The directories every well-formed archive extracts to. */
const ARTIFACT_DIRS = ['venv', 'ComfyUI'] as const

export type ComfyBuilderInstallErrorKind = 'invalid-artifact' | 'invalid-layout' | 'checksum-mismatch'

export class ComfyBuilderInstallError extends Error {
  override name = 'ComfyBuilderInstallError'
  readonly kind: ComfyBuilderInstallErrorKind
  constructor(kind: ComfyBuilderInstallErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}

export interface InstallArtifactOptions {
  artifact: Artifact
  /** Resolves the presigned download URL. */
  client: Pick<ComfyBuilderClient, 'resolveDownloadUrl'>
  /** Directory the archive extracts into (becomes the runnable install). */
  installPath: string
  /** Scratch dir for the download; the temp archive is removed after extraction. */
  cacheDir: string
  onProgress?: (p: InstallProgress) => void
  signal?: AbortSignal
}

/** A real directory (not a symlink). Rejecting a symlinked layout dir guards
 *  against a `venv -> /` style archive escaping `installPath`. */
function isRealDir(p: string): boolean {
  try {
    return fs.lstatSync(p).isDirectory()
  } catch {
    return false
  }
}

/** Cache-folder-safe slug for an artifact id (which may contain path chars). */
function cacheSlug(artifactId: string): string {
  return artifactId.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    // 'close' (not 'end'): the fd is released, so a following rmSync on a
    // mismatch won't hit EBUSY on Windows.
    stream.on('close', () => resolve(hash.digest('hex')))
  })
}

function assertLayout(installPath: string): void {
  for (const dir of ARTIFACT_DIRS) {
    if (!isRealDir(path.join(installPath, dir))) {
      throw new ComfyBuilderInstallError('invalid-layout', `Extracted artifact is missing a real ${dir}/ directory.`)
    }
  }
}

/** Remove only entries created this run, so a failed install never deletes a
 *  pre-existing environment or unrelated contents of a shared directory. */
async function cleanupCreated(installPath: string, preexisting: ReadonlySet<string>): Promise<void> {
  const entries = await fs.promises.readdir(installPath).catch(() => [] as string[])
  await Promise.all(
    entries
      .filter((e) => !preexisting.has(e))
      .map((e) => fs.promises.rm(path.join(installPath, e), { recursive: true, force: true }).catch(() => {})),
  )
}

/**
 * Download + verify + extract + validate an artifact into `installPath`. Throws
 * {@link ComfyBuilderInstallError} on a bad artifact, a checksum mismatch, or a
 * bad extracted layout. A missing hash is a warning, not an error: see above.
 */
export async function installArtifact(opts: InstallArtifactOptions): Promise<void> {
  const { artifact, client, installPath, cacheDir, onProgress, signal } = opts
  if (!artifact?.id) throw new ComfyBuilderInstallError('invalid-artifact', 'No artifact id was provided.')

  // A hash that IS present is always enforced (see the compare below).
  // TODO: fail closed on a missing hash too. The builder does not populate
  // outputSha256 yet, so for the initial rollout a missing hash installs
  // unverified rather than blocking every install.
  const expected = artifact.outputSha256?.replace(/^sha256:/i, '').trim().toLowerCase()
  if (!expected) {
    console.warn('[comfybuilder] artifact has no outputSha256; installing without integrity verification')
  }

  onProgress?.({ phase: 'resolve', percent: 0 })
  const url = await client.resolveDownloadUrl(artifact.id)

  // Per-run temp: isolates concurrent installs of the same artifact and is
  // removed after extraction (cacheDir is scratch, not a persistent cache).
  fs.mkdirSync(cacheDir, { recursive: true })
  const archivePath = path.join(cacheDir, `comfybuilder_${cacheSlug(artifact.id)}_${randomBytes(6).toString('hex')}.tar.gz`)

  try {
    onProgress?.({ phase: 'download', percent: 0 })
    await download(url, archivePath, (p: DownloadProgress) => onProgress?.({ phase: 'download', percent: p.percent, detail: `${p.receivedMB} / ${p.totalMB} MB` }), signal ? { signal } : {})

    if (expected) {
      const actual = await sha256File(archivePath)
      if (actual !== expected) {
        throw new ComfyBuilderInstallError('checksum-mismatch', `Artifact checksum mismatch: expected ${expected}, got ${actual}`)
      }
    }

    if (signal?.aborted) throw new Error('Cancelled')
    fs.mkdirSync(installPath, { recursive: true })
    const preexisting = new Set<string>(await fs.promises.readdir(installPath).catch(() => [] as string[]))
    try {
      onProgress?.({ phase: 'extract', percent: 0 })
      await extractNested(archivePath, installPath, (p: ExtractProgress) => onProgress?.({ phase: 'extract', percent: p.percent }), signal ? { signal } : {})
      assertLayout(installPath)
    } catch (err) {
      await cleanupCreated(installPath, preexisting)
      throw err
    }
  } finally {
    await fs.promises.rm(archivePath, { force: true }).catch(() => {})
  }
}
