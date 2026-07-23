/**
 * ComfyBuilder artifact download helpers — main process only.
 *
 * Two steps, both auth-free: the ComfyBuilder API returns a short-lived
 * presigned URL whose signature carries its own authorization, so neither the
 * resolve request nor the download itself sends a bearer token.
 *
 *   1. `resolveSignedDownloadUrl` — GET the signed download link for an artifact.
 *   2. `downloadArtifact` — stream that link to disk via main's `download()`,
 *      with an optional post-download sha256 integrity check.
 */
import { createHash } from 'crypto'
import { createReadStream, rmSync } from 'fs'

import { download } from '../lib/download'
import type { DownloadProgress } from '../lib/download'
import type { SignedDownload } from './types'

export interface ResolveSignedDownloadOptions {
  /** ComfyBuilder API base, e.g. `https://platformapi.comfy.org/builder`. */
  baseUrl: string
  signal?: AbortSignal
  /** Cloud JWT for the deployed builder gateway. The resolve endpoint sits behind
   *  auth (the returned presigned URL is what's auth-free, not this call). */
  authToken?: string
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

/** Cap the resolve request so a hung API cannot stall the install forever. */
const RESOLVE_TIMEOUT_MS = 30_000

/**
 * Resolve an artifact's presigned archive URL:
 * `GET {baseUrl}/v1/build-artifacts/{id}/download` → `downloadUrl`.
 */
export async function resolveSignedDownloadUrl(
  artifactId: string,
  { baseUrl, signal, authToken }: ResolveSignedDownloadOptions,
): Promise<string> {
  const url = `${trimTrailingSlash(baseUrl)}/v1/build-artifacts/${encodeURIComponent(artifactId)}/download`
  const timeout = AbortSignal.timeout(RESOLVE_TIMEOUT_MS)
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (authToken) headers.Authorization = `Bearer ${authToken}`
  const response = await fetch(url, {
    method: 'GET',
    headers,
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  })
  if (!response.ok) {
    throw new Error(`Failed to resolve signed download URL for artifact ${artifactId}: HTTP ${response.status}`)
  }
  const body = (await response.json()) as Partial<SignedDownload>
  if (!body || typeof body.downloadUrl !== 'string' || body.downloadUrl.length === 0) {
    throw new Error(`Signed download response for artifact ${artifactId} did not include a downloadUrl.`)
  }
  return body.downloadUrl
}

export interface DownloadArtifactParams {
  /** Presigned URL from {@link resolveSignedDownloadUrl}. */
  signedUrl: string
  destPath: string
  onProgress?: (progress: DownloadProgress) => void
  signal?: AbortSignal
  /** Expected archive sha256 (hex, optionally `sha256:`-prefixed). Verified when set. */
  expectedSha256?: string
}

/** Normalize a sha256 to bare lowercase hex (drops an optional `sha256:` prefix). */
function normalizeSha256(value: string): string {
  return value.replace(/^sha256:/i, '').trim().toLowerCase()
}

function computeSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

/**
 * Download an artifact archive to `destPath` via main's `download()`, then
 * (when `expectedSha256` is set) verify the bytes match, throwing on mismatch.
 */
export async function downloadArtifact({
  signedUrl,
  destPath,
  onProgress,
  signal,
  expectedSha256,
}: DownloadArtifactParams): Promise<string> {
  await download(signedUrl, destPath, onProgress ?? null, signal ? { signal } : {})

  if (expectedSha256) {
    const expected = normalizeSha256(expectedSha256)
    const actual = await computeSha256(destPath)
    if (actual !== expected) {
      // Drop the tainted bytes so a retry cannot reuse them from the cache.
      rmSync(destPath, { force: true })
      throw new Error(`Artifact checksum mismatch: expected sha256 ${expected}, got ${actual}`)
    }
  }
  return destPath
}
