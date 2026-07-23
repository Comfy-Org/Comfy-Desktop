/**
 * ComfyBuilder install glue — main process only.
 *
 * Given a chosen ComfyBuilder artifact, download → extract → validate into the
 * install directory:
 *
 *   1. Resolve the artifact's presigned archive URL (unless one was passed in).
 *   2. Download the archive into the download cache (sha256-verified against the
 *      artifact's required `outputSha256`).
 *   3. Extract the archive (shared nested-extract path) into the install dir.
 *   4. Validate the extracted layout; on failure the partial files are removed
 *      and a typed {@link ComfyBuilderInstallError} is thrown.
 *
 * The archive is what comfy-builder actually tars (buildexec/assemble.go): a
 * top-level `venv/` + `ComfyUI/` (plus a lockfile, and `syslib/` when present).
 * The manifest is NOT in the archive — comfy-builder seals it into the DB/GCS
 * (freeze.go), so the version metadata Desktop needs rides on the artifact/version
 * record from the API, not on a file inside the tarball.
 */
import fs from 'fs'
import path from 'path'

import { downloadArtifact, resolveSignedDownloadUrl } from '../../comfybuilder/artifactDownload'
import type { Artifact } from '../../comfybuilder/types'
import type { InstallationRecord } from '../../installations'
import type { Cache } from '../../lib/cache'
import type { DownloadProgress } from '../../lib/download'
import { extractNested } from '../../lib/extract'
import type { ExtractProgress } from '../../lib/extract'
import type { InstallTools } from '../../types/sources'

/**
 * The archive-layout contract: the two directories comfy-builder tars at the
 * top level. Isolated to one constant so a builder rename is a one-line change.
 *
 * NOTE (env-reshape follow-up): the reused standalone `postInstall`/launch still
 * expect a `standalone-env/` master env to copy into `ComfyUI/.venv`, whereas the
 * builder ships a single ready `venv/`. Bridging the two (and bundling `uv` into
 * the venv) is a separate change that needs a real builder archive to validate;
 * this stage only lands + validates the download.
 */
const ARTIFACT_DIRS = ['venv', 'ComfyUI'] as const

/** Why an install failed, so callers can branch on `kind`. */
export type ComfyBuilderInstallErrorKind = 'invalid-artifact' | 'invalid-layout'

/** Typed install failure (bad artifact record vs. bad extracted contents). */
export class ComfyBuilderInstallError extends Error {
  readonly kind: ComfyBuilderInstallErrorKind
  constructor(kind: ComfyBuilderInstallErrorKind, message: string) {
    super(message)
    this.name = 'ComfyBuilderInstallError'
    this.kind = kind
  }
}

/** Tools the artifact stage needs — a subset of the standard install bundle. */
export interface InstallArtifactTools {
  sendProgress: (step: string, data: { percent: number; status: string }) => void
  cache: Cache
  signal?: AbortSignal
}

export interface InstallArtifactParams {
  installation: InstallationRecord
  /** The chosen artifact (OpenAPI shape). */
  artifact: Artifact
  tools: InstallArtifactTools
  /** Presigned URL to download; skips the resolve step when set (e.g. tests). */
  signedUrl?: string
  /** ComfyBuilder API base for resolving the signed URL; required when `signedUrl` is absent. */
  baseUrl?: string
  /** Cloud JWT for the deployed builder gateway (the resolve endpoint is auth-gated). */
  authToken?: string
}

function isExistingDir(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory()
  } catch {
    return false
  }
}

/** Assert the extracted tree matches the archive-layout contract:
 *  `venv/` + `ComfyUI/`. */
function validateExtractedArtifact(installPath: string): void {
  for (const dir of ARTIFACT_DIRS) {
    if (!isExistingDir(path.join(installPath, dir))) {
      throw new ComfyBuilderInstallError('invalid-layout', `Extracted artifact is missing the ${dir}/ directory.`)
    }
  }
}

/** Remove the extracted artifact roots so a failed install leaves nothing behind. */
async function cleanupPartialInstall(installPath: string): Promise<void> {
  await Promise.all(
    ARTIFACT_DIRS.map((entry) =>
      fs.promises.rm(path.join(installPath, entry), { recursive: true, force: true }).catch(() => {}),
    ),
  )
}

/** Cache-folder-safe slug for an artifact id (which may contain path chars). */
function cacheSlug(artifactId: string): string {
  return artifactId.replace(/[^a-zA-Z0-9._-]/g, '_')
}

/**
 * Install a chosen ComfyBuilder artifact end to end (resolve → download →
 * extract → validate). Throws {@link ComfyBuilderInstallError} on an invalid
 * artifact record (before any network I/O) or invalid extracted contents (after
 * cleaning up partial files). The venv/package phases run afterwards via the
 * source's reused standalone `postInstall`.
 */
export async function installArtifact(params: InstallArtifactParams): Promise<void> {
  const { installation, artifact, tools, signedUrl, baseUrl, authToken } = params
  const { sendProgress, cache, signal } = tools
  const { installPath } = installation

  if (!artifact || typeof artifact.id !== 'string' || artifact.id.length === 0) {
    throw new ComfyBuilderInstallError('invalid-artifact', 'No artifact id was provided for this install.')
  }
  if (!signedUrl && !baseUrl) {
    throw new ComfyBuilderInstallError('invalid-artifact', 'A signedUrl or baseUrl is required to download the artifact.')
  }
  // e2e ONLY (do NOT graduate to PR #1288): the staging build-artifacts API does
  // not yet expose an archive-bytes sha256, so integrity is verify-if-present here.
  // Production must restore the mandatory-sha once the builder exposes the hash.
  const expectedSha256 = typeof artifact.outputSha256 === 'string' && artifact.outputSha256.length > 0
    ? artifact.outputSha256
    : undefined
  if (!expectedSha256) {
    console.warn('comfybuilder(e2e): artifact has no outputSha256; downloading without integrity verification')
  }

  // 1. Resolve the presigned archive URL (skipped when one was passed in).
  const resolvedUrl =
    signedUrl ??
    (await resolveSignedDownloadUrl(artifact.id, {
      baseUrl: baseUrl!,
      ...(signal ? { signal } : {}),
      ...(authToken ? { authToken } : {}),
    }))

  // 2. Download the archive into the download cache.
  const cacheBase = cache.getCachePath(`comfybuilder_${cacheSlug(artifact.id)}`)
  fs.mkdirSync(cacheBase, { recursive: true })
  const archivePath = path.join(cacheBase, 'artifact.tar.gz')

  sendProgress('download', { percent: 0, status: 'Downloading artifact…' })
  await downloadArtifact({
    signedUrl: resolvedUrl,
    destPath: archivePath,
    onProgress: (p: DownloadProgress) =>
      sendProgress('download', { percent: p.percent, status: `Downloading… ${p.receivedMB} / ${p.totalMB} MB` }),
    ...(signal ? { signal } : {}),
    ...(expectedSha256 ? { expectedSha256 } : {}),
  })

  // 3+4. Extract (.tar.gz -> nested tar -> files) then validate the layout +
  // manifest. Any failure in either phase cleans up the extracted roots so a
  // retry starts from a clean install dir.
  if (signal?.aborted) throw new Error('Cancelled')
  fs.mkdirSync(installPath, { recursive: true })
  try {
    sendProgress('extract', { percent: 0, status: 'Extracting…' })
    await extractNested(
      archivePath,
      installPath,
      (p: ExtractProgress) => sendProgress('extract', { percent: p.percent, status: `Extracting… ${p.percent}%` }),
      signal ? { signal } : {},
    )
    validateExtractedArtifact(installPath)
  } catch (err) {
    await cleanupPartialInstall(installPath)
    throw err
  }
}

/** Read the {@link Artifact} the wizard/creator flattened onto the record. */
function readArtifact(installation: InstallationRecord): Artifact {
  const artifact = installation.artifact
  if (!artifact || typeof artifact !== 'object' || typeof (artifact as Artifact).id !== 'string') {
    throw new ComfyBuilderInstallError('invalid-artifact', 'This install has no ComfyBuilder artifact to install.')
  }
  return artifact as Artifact
}

/**
 * Source-plugin install entry point. Unpacks the artifact + resolve inputs the
 * creator stored on the record, then runs the download/extract/validate stage.
 */
export async function install(installation: InstallationRecord, tools: InstallTools): Promise<void> {
  const { sendProgress, cache, signal } = tools
  const artifact = readArtifact(installation)
  const baseUrl = typeof installation.comfybuilderBaseUrl === 'string' ? installation.comfybuilderBaseUrl : undefined
  const signedUrl = typeof installation.signedUrl === 'string' ? installation.signedUrl : undefined
  const authToken = typeof installation.comfybuilderAuthToken === 'string' ? installation.comfybuilderAuthToken : undefined
  await installArtifact({
    installation,
    artifact,
    tools: { sendProgress, cache, ...(signal ? { signal } : {}) },
    ...(signedUrl ? { signedUrl } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(authToken ? { authToken } : {}),
  })
}
