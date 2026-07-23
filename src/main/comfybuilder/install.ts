/**
 * Install — the write side of the functionality library.
 *
 * Given a chosen {@link Artifact}, turn it into a runnable install directory:
 * resolve the presigned URL, download (sha256-verified when the artifact carries
 * a hash), extract, and validate the layout. The archive is what comfy-builder
 * tars: a top-level `venv/` + `ComfyUI/` (a ready, relocatable env), so there is
 * no post-extract env build; launch drives that `venv/` directly (see `./launch`).
 */
import { createHash } from 'crypto'
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
  /** Download cache root; the archive is cached per-artifact under here. */
  cacheDir: string
  onProgress?: (p: InstallProgress) => void
  signal?: AbortSignal
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory()
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
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

function assertLayout(installPath: string): void {
  for (const dir of ARTIFACT_DIRS) {
    if (!isDir(path.join(installPath, dir))) {
      throw new ComfyBuilderInstallError('invalid-layout', `Extracted artifact is missing the ${dir}/ directory.`)
    }
  }
}

async function cleanup(installPath: string): Promise<void> {
  await Promise.all(
    ARTIFACT_DIRS.map((d) => fs.promises.rm(path.join(installPath, d), { recursive: true, force: true }).catch(() => {})),
  )
}

/**
 * Download + verify + extract + validate an artifact into `installPath`. Throws
 * {@link ComfyBuilderInstallError} on a bad artifact, checksum mismatch, or bad
 * extracted layout (cleaning up any partial extract first).
 */
export async function installArtifact(opts: InstallArtifactOptions): Promise<void> {
  const { artifact, client, installPath, cacheDir, onProgress, signal } = opts
  if (!artifact?.id) throw new ComfyBuilderInstallError('invalid-artifact', 'No artifact id was provided.')

  onProgress?.({ phase: 'resolve', percent: 0 })
  const url = await client.resolveDownloadUrl(artifact.id)

  const archiveDir = path.join(cacheDir, `comfybuilder_${cacheSlug(artifact.id)}`)
  fs.mkdirSync(archiveDir, { recursive: true })
  const archivePath = path.join(archiveDir, 'artifact.tar.gz')

  onProgress?.({ phase: 'download', percent: 0 })
  await download(url, archivePath, (p: DownloadProgress) => onProgress?.({ phase: 'download', percent: p.percent, detail: `${p.receivedMB} / ${p.totalMB} MB` }), signal ? { signal } : {})

  const expected = artifact.outputSha256?.replace(/^sha256:/i, '').trim().toLowerCase()
  if (expected) {
    const actual = await sha256File(archivePath)
    if (actual !== expected) {
      fs.rmSync(archivePath, { force: true })
      throw new ComfyBuilderInstallError('checksum-mismatch', `Artifact checksum mismatch: expected ${expected}, got ${actual}`)
    }
  }

  if (signal?.aborted) throw new Error('Cancelled')
  fs.mkdirSync(installPath, { recursive: true })
  try {
    onProgress?.({ phase: 'extract', percent: 0 })
    await extractNested(archivePath, installPath, (p: ExtractProgress) => onProgress?.({ phase: 'extract', percent: p.percent }), signal ? { signal } : {})
    assertLayout(installPath)
  } catch (err) {
    await cleanup(installPath)
    throw err
  }
}
