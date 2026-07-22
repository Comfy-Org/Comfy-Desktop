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
 *   4. Validate the extracted layout + `manifest.json`; on failure the partial
 *      files are removed and a typed {@link ComfyBuilderInstallError} is thrown.
 *
 * A ComfyBuilder artifact unpacks to the same `standalone-env/` + `ComfyUI/`
 * layout as a standalone install, so the post-extract phases (env create →
 * package copy) are the standalone source's `postInstall`, reused verbatim and
 * wired onto the source in `./index` — never duplicated here.
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
import { MANIFEST_FILE } from '../standalone/envPaths'
import type { InstallTools } from '../../types/sources'

/**
 * The archive-layout contract. A future builder that ships a `venv/` instead of
 * a pre-extracted `standalone-env/`, or drops the in-tar manifest, is a one-line
 * change here — nothing else in the install path assumes the layout.
 */
const ARTIFACT_DIRS = ['standalone-env', 'ComfyUI'] as const
const REQUIRED_MANIFEST_FIELDS = ['id', 'version', 'comfyui_ref', 'python_version'] as const

/** Why an install failed, so callers can branch on `kind`. */
export type ComfyBuilderInstallErrorKind = 'invalid-artifact' | 'invalid-manifest'

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
}

function isExistingDir(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory()
  } catch {
    return false
  }
}

/** Read + JSON-parse the extracted `manifest.json`, throwing a typed error when
 *  it is missing, unreadable, or not a JSON object. */
function readManifest(installPath: string): Record<string, unknown> {
  const manifestPath = path.join(installPath, MANIFEST_FILE)
  let raw: string
  try {
    raw = fs.readFileSync(manifestPath, 'utf8')
  } catch {
    throw new ComfyBuilderInstallError('invalid-manifest', `Extracted artifact is missing ${MANIFEST_FILE}.`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new ComfyBuilderInstallError('invalid-manifest', `${MANIFEST_FILE} is not valid JSON.`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ComfyBuilderInstallError('invalid-manifest', `${MANIFEST_FILE} must be a JSON object.`)
  }
  return parsed as Record<string, unknown>
}

/** Assert the extracted tree matches the archive-layout contract:
 *  `standalone-env/`, `ComfyUI/`, and a well-formed `manifest.json`. */
function validateExtractedArtifact(installPath: string): void {
  for (const dir of ARTIFACT_DIRS) {
    if (!isExistingDir(path.join(installPath, dir))) {
      throw new ComfyBuilderInstallError('invalid-manifest', `Extracted artifact is missing the ${dir}/ directory.`)
    }
  }
  const manifest = readManifest(installPath)
  for (const field of REQUIRED_MANIFEST_FIELDS) {
    const value = manifest[field]
    if (typeof value !== 'string' || value.length === 0) {
      throw new ComfyBuilderInstallError('invalid-manifest', `${MANIFEST_FILE} is missing a valid "${field}".`)
    }
  }
}

/** Remove the extracted artifact roots so a failed install leaves nothing behind. */
async function cleanupPartialInstall(installPath: string): Promise<void> {
  const entries: readonly string[] = [...ARTIFACT_DIRS, MANIFEST_FILE]
  await Promise.all(
    entries.map((entry) =>
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
  const { installation, artifact, tools, signedUrl, baseUrl } = params
  const { sendProgress, cache, signal } = tools
  const { installPath } = installation

  if (!artifact || typeof artifact.id !== 'string' || artifact.id.length === 0) {
    throw new ComfyBuilderInstallError('invalid-artifact', 'No artifact id was provided for this install.')
  }
  if (!signedUrl && !baseUrl) {
    throw new ComfyBuilderInstallError('invalid-artifact', 'A signedUrl or baseUrl is required to download the artifact.')
  }
  // Integrity is mandatory: without an expected hash the download cannot be
  // verified, so refuse rather than install unverified bytes.
  if (typeof artifact.outputSha256 !== 'string' || artifact.outputSha256.length === 0) {
    throw new ComfyBuilderInstallError('invalid-artifact', 'artifact is missing outputSha256; refusing to install unverified bytes')
  }

  // 1. Resolve the presigned archive URL (skipped when one was passed in).
  const resolvedUrl =
    signedUrl ?? (await resolveSignedDownloadUrl(artifact.id, { baseUrl: baseUrl!, ...(signal ? { signal } : {}) }))

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
    expectedSha256: artifact.outputSha256,
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
  await installArtifact({
    installation,
    artifact,
    tools: { sendProgress, cache, ...(signal ? { signal } : {}) },
    ...(signedUrl ? { signedUrl } : {}),
    ...(baseUrl ? { baseUrl } : {}),
  })
}
