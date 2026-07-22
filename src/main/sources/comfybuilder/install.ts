/**
 * ComfyBuilder install glue — main process only.
 *
 * Drives the artifact stage of a ComfyBuilder pipeline install:
 *
 *   1. Block-at-install: an un-installable pipeline throws a typed error before
 *      any network I/O (no download requests are made).
 *   2. Download the resolved deployment's artifact through the token-aware
 *      `downloadPipelineArtifact` helper.
 *   3. Extract the `.tar.gz` (via the shared nested-extract path) into the
 *      install directory.
 *   4. Validate the extracted layout + `manifest.json`; on failure the partial
 *      extracted files are removed and a typed error is thrown.
 *
 * A ComfyBuilder distribution unpacks to the same `standalone-env/` + `ComfyUI/`
 * layout as a standalone install, so the post-extract phases (env create ->
 * package copy -> torch sync) are the standalone source's `postInstall`, reused
 * verbatim and wired onto the source in `./index` — never duplicated here.
 */
import fs from 'fs'
import path from 'path'
import { downloadPipelineArtifact } from '../../comfybuilder/artifactDownload'
import { extractNested } from '../../lib/extract'
import { MANIFEST_FILE } from '../standalone/envPaths'
import type { DownloadProgress } from '../../lib/download'
import type { ExtractProgress } from '../../lib/extract'
import type { Cache } from '../../lib/cache'
import type { Artifact } from '../../comfybuilder/dto'
import type { PipelineInstallReason } from '../../comfybuilder/latestArtifact'
import type { PipelineOptionMeta } from './index'
import type { InstallationRecord } from '../../installations'
import type { InstallTools } from '../../types/sources'

/** Why an install could not proceed. Mirrors the pipeline card's block reasons
 *  plus a post-extract manifest failure. */
export type ComfyBuilderInstallErrorKind = PipelineInstallReason | 'invalid-manifest'

/** Typed install failure so callers can branch on `kind` (block vs. bad artifact). */
export class ComfyBuilderInstallError extends Error {
  readonly kind: ComfyBuilderInstallErrorKind
  constructor(kind: ComfyBuilderInstallErrorKind, message: string) {
    super(message)
    this.name = 'ComfyBuilderInstallError'
    this.kind = kind
  }
}

/** Tools the artifact stage needs — a subset of the standard install tool
 *  bundle the install handler already has on hand. */
export interface InstallPipelineTools {
  sendProgress: (step: string, data: { percent: number; status: string }) => void
  cache: Cache
  signal?: AbortSignal
}

export interface InstallPipelineParams {
  installation: InstallationRecord
  /** The selected pipeline card's install metadata (from `data.meta`). */
  meta: PipelineOptionMeta
  tools: InstallPipelineTools
  /** Overrides `COMFYBUILDER_BASE_URL` when resolving the artifact URL; tests
   *  point this at the mock Builder API. */
  baseUrl?: string
}

/** Directories every well-formed ComfyBuilder artifact must contain. */
const ARTIFACT_DIRS = ['standalone-env', 'ComfyUI'] as const

/** Manifest fields required for the install to be considered well-formed. */
const REQUIRED_MANIFEST_FIELDS = ['id', 'version', 'comfyui_ref', 'python_version'] as const

/** Human-readable reason shown when a blocked pipeline is asked to install. */
function blockMessage(reason: PipelineInstallReason): string {
  return reason === 'platform-mismatch'
    ? 'This ComfyBuilder pipeline has no build for your platform yet.'
    : 'This ComfyBuilder pipeline has no successful build to install yet.'
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

/** Assert the extracted tree has `standalone-env/`, `ComfyUI/`, and a well-formed
 *  `manifest.json` (string `id`, `version`, `comfyui_ref`, `python_version`). */
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

/**
 * Install a ComfyBuilder pipeline's latest succeeded artifact end to end.
 *
 * Throws {@link ComfyBuilderInstallError} for a blocked pipeline (before any
 * network call) or an invalid manifest (after cleaning up partial files).
 */
export async function installComfyBuilderPipeline(params: InstallPipelineParams): Promise<void> {
  const { installation, meta, tools, baseUrl } = params
  const { sendProgress, cache, signal } = tools
  const { installPath } = installation

  // 1. Block-at-install: refuse an un-installable pipeline before any network I/O.
  if (!meta.installable) {
    const reason: PipelineInstallReason = meta.reason ?? 'no-successful-build'
    throw new ComfyBuilderInstallError(reason, blockMessage(reason))
  }

  // An installable pipeline always resolved a deployment + artifact upstream.
  const { artifact, deploymentId } = meta
  if (!artifact || !deploymentId) {
    throw new ComfyBuilderInstallError(
      'no-successful-build',
      'No installable build artifact was resolved for this pipeline.',
    )
  }
  const pipelineId = typeof installation.pipelineId === 'string' ? installation.pipelineId : ''

  // 2. Download the artifact tarball into the download cache.
  const cacheBase = cache.getCachePath(`comfybuilder_${pipelineId}_${deploymentId}`)
  fs.mkdirSync(cacheBase, { recursive: true })
  const archivePath = path.join(cacheBase, artifact.filename)

  sendProgress('download', { percent: 0, status: 'Downloading pipeline artifact…' })
  await downloadPipelineArtifact({
    pipelineId,
    deploymentId,
    artifact,
    destPath: archivePath,
    onProgress: (p: DownloadProgress) =>
      sendProgress('download', { percent: p.percent, status: `Downloading… ${p.receivedMB} / ${p.totalMB} MB` }),
    ...(meta.targetId ? { targetId: meta.targetId } : {}),
    ...(signal ? { signal } : {}),
    ...(baseUrl ? { baseUrl } : {}),
  })

  // 3. Extract (.tar.gz -> nested tar -> files) into the install directory.
  if (signal?.aborted) throw new Error('Cancelled')
  fs.mkdirSync(installPath, { recursive: true })
  sendProgress('extract', { percent: 0, status: 'Extracting…' })
  await extractNested(
    archivePath,
    installPath,
    (p: ExtractProgress) => sendProgress('extract', { percent: p.percent, status: `Extracting… ${p.percent}%` }),
    signal ? { signal } : {},
  )

  // 4. Validate the extracted layout + manifest; abort + clean up on failure.
  try {
    validateExtractedArtifact(installPath)
  } catch (err) {
    await cleanupPartialInstall(installPath)
    throw err
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Rebuild the {@link PipelineOptionMeta} the artifact stage consumes from the
 * flattened fields `buildInstallation` persisted onto the install record.
 */
function readInstallMeta(installation: InstallationRecord): PipelineOptionMeta {
  const reason: PipelineInstallReason | undefined =
    installation.reason === 'platform-mismatch' || installation.reason === 'no-successful-build'
      ? installation.reason
      : undefined
  const deploymentId =
    typeof installation.deploymentId === 'string' ? installation.deploymentId : undefined
  const targetId = typeof installation.targetId === 'string' ? installation.targetId : undefined
  const version = typeof installation.version === 'string' ? installation.version : undefined
  const downloadUrl = asString(installation.downloadUrl)
  const artifact: Artifact | undefined = downloadUrl
    ? {
        artifact_id: asString(installation.artifactId),
        filename: asString(installation.artifactFilename),
        download_url: downloadUrl,
        checksum: asString(installation.artifactChecksum),
        size_bytes:
          typeof installation.artifactSizeBytes === 'number' ? installation.artifactSizeBytes : 0,
      }
    : undefined
  return {
    installable: installation.installable === true,
    ...(reason ? { reason } : {}),
    ...(deploymentId ? { deploymentId } : {}),
    ...(targetId ? { targetId } : {}),
    ...(version ? { version } : {}),
    ...(artifact ? { artifact } : {}),
  }
}

/**
 * Source-plugin install entry point. Reconstructs the pipeline metadata
 * `buildInstallation` stored on the record, then runs the block/download/
 * extract/validate stage. The venv/package/torch phases run afterwards via the
 * source's reused standalone `postInstall`.
 */
export async function install(installation: InstallationRecord, tools: InstallTools): Promise<void> {
  const { sendProgress, cache, signal } = tools
  await installComfyBuilderPipeline({
    installation,
    meta: readInstallMeta(installation),
    tools: { sendProgress, cache, ...(signal ? { signal } : {}) },
  })
}
