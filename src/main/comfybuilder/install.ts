import { randomBytes } from 'crypto'
import fs from 'fs'
import path from 'path'

import { download } from '../lib/download'
import type { DownloadProgress } from '../lib/download'
import { extractNested } from '../lib/extract'
import type { ExtractProgress } from '../lib/extract'
import { sha256File } from '../lib/modelDownloadStaging'
import { formatDownloadDetail } from '../lib/util'
import type { ComfyBuilderClient } from './client'
import { isSecureDownloadUrl, normalizeSha256 } from './integrity'
import type { Artifact, InstallProgress } from './types'

const ARTIFACT_DIRS = ['venv', 'ComfyUI'] as const

export type ComfyBuilderInstallErrorKind =
  | 'invalid-artifact'
  | 'invalid-layout'
  | 'checksum-mismatch'

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
  client: Pick<ComfyBuilderClient, 'resolveDownloadUrl'>
  installPath: string
  cacheDir: string
  onProgress?: (p: InstallProgress) => void
  signal?: AbortSignal
}

function isRealDir(p: string): boolean {
  try {
    return fs.lstatSync(p).isDirectory()
  } catch {
    return false
  }
}

function cacheSlug(artifactId: string): string {
  return artifactId.replace(/[^a-zA-Z0-9._-]/g, '_')
}

export { sha256File }

function assertLayout(installPath: string): void {
  for (const dir of ARTIFACT_DIRS) {
    if (!isRealDir(path.join(installPath, dir))) {
      throw new ComfyBuilderInstallError(
        'invalid-layout',
        `Extracted artifact is missing a real ${dir}/ directory.`
      )
    }
  }
}

async function cleanupCreated(
  installPath: string,
  preexisting: ReadonlySet<string>
): Promise<void> {
  const entries = await fs.promises.readdir(installPath).catch(() => [] as string[])
  await Promise.all(
    entries
      .filter((e) => !preexisting.has(e))
      .map((e) =>
        fs.promises.rm(path.join(installPath, e), { recursive: true, force: true }).catch(() => {})
      )
  )
}

export async function installArtifact(opts: InstallArtifactOptions): Promise<void> {
  const { artifact, client, installPath, cacheDir, onProgress, signal } = opts
  if (!artifact?.id)
    throw new ComfyBuilderInstallError('invalid-artifact', 'No artifact id was provided.')

  const expected = normalizeSha256(artifact.archiveSha256)
  if (!expected) {
    throw new ComfyBuilderInstallError(
      'invalid-artifact',
      'The artifact has no SHA-256 integrity value.'
    )
  }

  onProgress?.({ phase: 'resolve', percent: 0 })
  const url = await client.resolveDownloadUrl(artifact.id)

  fs.mkdirSync(cacheDir, { recursive: true })
  const archivePath = path.join(
    cacheDir,
    `comfybuilder_${cacheSlug(artifact.id)}_${randomBytes(6).toString('hex')}.tar.gz`
  )

  try {
    onProgress?.({ phase: 'download', percent: 0 })
    await download(
      url,
      archivePath,
      (p: DownloadProgress) =>
        onProgress?.({
          phase: 'download',
          percent: p.percent,
          detail: formatDownloadDetail(p)
        }),
      { ...(signal ? { signal } : {}), validateUrl: isSecureDownloadUrl }
    )

    const actual = await sha256File(archivePath)
    if (actual !== expected) {
      throw new ComfyBuilderInstallError(
        'checksum-mismatch',
        `Artifact checksum mismatch: expected ${expected}, got ${actual}`
      )
    }

    if (signal?.aborted) throw new Error('Cancelled')
    fs.mkdirSync(installPath, { recursive: true })
    const preexisting = new Set<string>(
      await fs.promises.readdir(installPath).catch(() => [] as string[])
    )
    try {
      onProgress?.({ phase: 'extract', percent: 0 })
      await extractNested(
        archivePath,
        installPath,
        (p: ExtractProgress) => onProgress?.({ phase: 'extract', percent: p.percent }),
        signal ? { signal } : {}
      )
      assertLayout(installPath)
    } catch (err) {
      await cleanupCreated(installPath, preexisting)
      throw err
    }
  } finally {
    await fs.promises.rm(archivePath, { force: true }).catch(() => {})
  }
}
