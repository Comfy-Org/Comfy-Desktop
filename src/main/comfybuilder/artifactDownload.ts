import { statSync } from 'fs'

import { download } from '../lib/download'
import type { DownloadProgress } from '../lib/download'
import { broadcastAuthChanged } from './authIpc'
import { COMFYBUILDER_BASE_URL } from './config'
import type { Artifact } from './dto'
import { clearTokens, loadTokens } from './tokenStore'

export interface DownloadPipelineArtifactOptions {
  pipelineId: string
  deploymentId: string
  artifact: Artifact
  destPath: string
  onProgress?: (progress: DownloadProgress) => void
  signal?: AbortSignal
  /** Overrides `COMFYBUILDER_BASE_URL` for resolving relative URLs; used by tests. */
  baseUrl?: string
}

interface DownloadTokenResponse {
  token: string
  expires_at?: string
}

const TOKEN_DOWNLOAD_ATTEMPTS = 2

class DownloadAuthError extends Error {
  override name = 'DownloadAuthError'
}

/** Forget the rejected token and broadcast `signedIn: false` so the renderer can prompt for re-auth. */
function signalReauthRequired(): void {
  clearTokens()
  broadcastAuthChanged({ signedIn: false })
}

function resolveDownloadUrl(downloadUrl: string, baseUrl: string): string {
  if (/^https?:\/\//i.test(downloadUrl)) return downloadUrl
  return downloadUrl.startsWith('/') ? `${baseUrl}${downloadUrl}` : `${baseUrl}/${downloadUrl}`
}

function verifyDownloadedSize(destPath: string, sizeBytes: number): void {
  if (!sizeBytes || sizeBytes <= 0) return
  const actual = statSync(destPath).size
  if (actual !== sizeBytes) {
    throw new Error(`Downloaded artifact size mismatch: expected ${sizeBytes} bytes, got ${actual}`)
  }
}

async function mintDownloadToken(
  artifactBase: string,
  accessToken: string | undefined,
  signal?: AbortSignal,
): Promise<string> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  const response = await fetch(`${artifactBase}/download-token`, {
    method: 'POST',
    headers,
    signal,
    redirect: 'manual',
  })
  if (response.status === 401 || response.status === 403) {
    throw new DownloadAuthError(`Not authorized to mint download token: HTTP ${response.status}`)
  }
  if (!response.ok) {
    throw new Error(`Failed to mint download token: HTTP ${response.status}`)
  }
  const body = (await response.json()) as DownloadTokenResponse
  if (!body?.token) {
    throw new Error('Download token response did not include a token')
  }
  return body.token
}

export async function downloadPipelineArtifact(
  options: DownloadPipelineArtifactOptions,
): Promise<void> {
  const { pipelineId, deploymentId, artifact, destPath, onProgress, signal } = options
  const baseUrl = options.baseUrl ?? COMFYBUILDER_BASE_URL
  const progress = onProgress ?? null
  const expectedSize = artifact.size_bytes > 0 ? artifact.size_bytes : undefined

  const directUrl = resolveDownloadUrl(artifact.download_url, baseUrl)
  const artifactBase = `${baseUrl}/api/v1/pipelines/${encodeURIComponent(pipelineId)}/deployments/${encodeURIComponent(deploymentId)}/artifact`

  console.info('[comfybuilder] downloading pipeline artifact', {
    pipelineId,
    deploymentId,
    filename: artifact.filename,
  })

  const accessToken = loadTokens()?.accessToken

  if (accessToken) {
    try {
      await download(directUrl, destPath, progress, {
        signal,
        expectedSize,
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      verifyDownloadedSize(destPath, artifact.size_bytes)
      return
    } catch (error) {
      if (signal?.aborted) throw error
      // Bearer download failed; fall through to the download-token flow below.
    }
  }

  // Download tokens are single-use, so every attempt mints a fresh one.
  let lastError: unknown
  let authFailed = false
  for (let attempt = 0; attempt < TOKEN_DOWNLOAD_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw new Error('Download cancelled')

    let token: string
    try {
      token = await mintDownloadToken(artifactBase, accessToken, signal)
    } catch (error) {
      lastError = error
      authFailed = error instanceof DownloadAuthError
      break
    }

    try {
      const tokenUrl = `${artifactBase}/download?token=${encodeURIComponent(token)}`
      await download(tokenUrl, destPath, progress, { signal, expectedSize })
      verifyDownloadedSize(destPath, artifact.size_bytes)
      return
    } catch (error) {
      lastError = error
      if (signal?.aborted) throw error
    }
  }

  if (authFailed) signalReauthRequired()
  throw lastError instanceof Error ? lastError : new Error('Failed to download pipeline artifact')
}
