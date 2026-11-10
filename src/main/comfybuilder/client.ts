import type {
  Artifact,
  Build,
  BuildDraft,
  BuildVersion,
  ModelManifest,
  TokenProvider
} from './types'
import type { SnapshotExportEnvelope } from '../lib/snapshots/types'
import { isSecureDownloadUrl, isValidSha256 } from './integrity'

export const DEFAULT_BASE_URL = 'https://platformapi.comfy.org/builder'

const DEFAULT_TIMEOUT_MS = 30_000

export type ComfyBuilderErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'not-found'
  | 'network'
  | 'server'

export class ComfyBuilderApiError extends Error {
  override name = 'ComfyBuilderApiError'
  readonly kind: ComfyBuilderErrorKind
  readonly status?: number
  constructor(kind: ComfyBuilderErrorKind, message: string, status?: number) {
    super(message)
    this.kind = kind
    if (status !== undefined) this.status = status
  }
}

async function errorReason(res: Response): Promise<string> {
  try {
    const text = (await res.text()).slice(0, 300)
    if (!text) return ''
    const body = JSON.parse(text) as { message?: unknown; error?: unknown }
    const msg =
      typeof body.message === 'string'
        ? body.message
        : typeof body.error === 'string'
          ? body.error
          : ''
    return msg ? `: ${msg}` : ''
  } catch {
    return ''
  }
}

export interface ComfyBuilderClientOptions {
  baseUrl?: string
  auth: TokenProvider
  timeoutMs?: number
}

interface BuildsResponse {
  builds?: Build[]
  nextCursor?: string
}
interface ReleasesResponse {
  releases?: BuildVersion[]
}
interface ReleaseArtifact extends Omit<Artifact, 'accelVariant'> {
  accelVariant?: string
  imageRef?: string
  imageDigest?: string
}
interface ReleaseDetailResponse {
  version?: number
  artifacts?: ReleaseArtifact[]
}
interface SignedDownloadResponse {
  downloadUrl?: string
}
interface SnapshotResolutionResponse {
  definition?: unknown
}
interface CreatedBuildResponse {
  id?: unknown
  workspaceId?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isOpaqueId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 500
}

export class ComfyBuilderClient {
  private readonly baseUrl: string
  private readonly auth: TokenProvider
  private readonly timeoutMs: number

  constructor(options: ComfyBuilderClientOptions) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.auth = options.auth
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  async listBuilds(): Promise<Build[]> {
    const token = await this.accessToken()
    const builds: Build[] = []
    const seenCursors = new Set<string>()
    let cursor: string | undefined
    do {
      const query = new URLSearchParams({ limit: '100' })
      if (cursor) {
        if (seenCursors.has(cursor)) {
          throw new ComfyBuilderApiError('server', 'Builder returned a repeated build cursor')
        }
        seenCursors.add(cursor)
        query.set('cursor', cursor)
      }
      const body = await this.get<BuildsResponse>(`/v1/builds?${query}`, token)
      builds.push(...(body.builds ?? []))
      cursor = body.nextCursor || undefined
    } while (cursor)
    return builds
  }

  async createBuildDraft(snapshot: SnapshotExportEnvelope): Promise<BuildDraft> {
    const name = snapshot.installationName.trim()
    if (!name || name.length > 200 || snapshot.snapshots.length !== 1) {
      throw new ComfyBuilderApiError('server', 'Desktop snapshot cannot be promoted')
    }
    const envelope = { ...snapshot, installationName: name }
    const token = await this.accessToken()
    const resolvedBody = await this.post<SnapshotResolutionResponse>(
      '/v1/snapshots/resolve',
      { snapshot: envelope },
      token
    )
    if (!isRecord(resolvedBody.definition)) {
      throw new ComfyBuilderApiError('server', 'Builder returned an invalid snapshot resolution')
    }

    const created = await this.post<CreatedBuildResponse>(
      '/v1/builds',
      { name, definition: { ...resolvedBody.definition, uiOrigin: 'desktop-snapshot' } },
      token
    )
    if (!isOpaqueId(created.id) || !isOpaqueId(created.workspaceId)) {
      throw new ComfyBuilderApiError('server', 'Builder returned an invalid draft Build')
    }
    const query = new URLSearchParams({
      workspace: created.workspaceId,
      edit: created.id
    })
    return {
      buildId: created.id,
      workspaceId: created.workspaceId,
      editUrl: `/profile/builds/new?${query.toString()}`
    }
  }

  async listVersions(buildId: string): Promise<BuildVersion[]> {
    const token = await this.accessToken()
    const id = encodeURIComponent(buildId)
    const body = await this.get<ReleasesResponse>(`/v1/builds/${id}/releases`, token)
    return body.releases ?? []
  }

  async getVersion(
    versionId: string
  ): Promise<{ version: number | undefined; artifacts: Artifact[] }> {
    const token = await this.accessToken()
    const id = encodeURIComponent(versionId)
    const body = await this.get<ReleaseDetailResponse>(`/v1/releases/${id}`, token)
    const artifacts = (body.artifacts ?? [])
      .filter((artifact) => !artifact.imageRef && !artifact.imageDigest)
      .map((artifact) => ({ ...artifact, accelVariant: artifact.accelVariant ?? '' }))
    return { version: body.version, artifacts }
  }

  async fetchModelManifest(versionId: string): Promise<ModelManifest> {
    const token = await this.accessToken()
    const id = encodeURIComponent(versionId)
    const body = await this.get<Partial<ModelManifest>>(`/v1/releases/${id}/manifest`, token)
    if (!Array.isArray(body.models)) {
      throw new ComfyBuilderApiError(
        'server',
        `Manifest for version ${versionId} has no model list`
      )
    }
    const invalidModel = body.models.find((model) => {
      const sha256 = model.sha256?.trim()
      return Boolean(sha256 && !isValidSha256(sha256))
    })
    if (invalidModel) {
      const rawSha256 = invalidModel.sha256?.trim() ?? ''
      const received = JSON.stringify(
        rawSha256.length > 80 ? `${rawSha256.slice(0, 77)}...` : rawSha256
      )
      throw new ComfyBuilderApiError(
        'server',
        `Manifest for version ${versionId} has invalid model integrity for ${invalidModel.type}/${invalidModel.filename}: expected SHA-256 as 64 hexadecimal characters, optionally prefixed with "sha256:", but received ${received} (${rawSha256.length} characters).`
      )
    }
    return {
      models: body.models,
      modelPolicy: body.modelPolicy ?? null,
      partnerNodePolicy: body.partnerNodePolicy ?? null,
      customNodePolicy: body.customNodePolicy ?? null
    }
  }

  async resolveDownloadUrl(artifactId: string): Promise<string> {
    const body = await this.get<SignedDownloadResponse>(
      `/v1/build-artifacts/${encodeURIComponent(artifactId)}/download`
    )
    if (typeof body.downloadUrl !== 'string' || body.downloadUrl.length === 0) {
      throw new ComfyBuilderApiError('server', `No downloadUrl for artifact ${artifactId}`)
    }
    if (!isSecureDownloadUrl(body.downloadUrl)) {
      throw new ComfyBuilderApiError('server', `Unsafe downloadUrl for artifact ${artifactId}`)
    }
    return body.downloadUrl
  }

  private async get<T>(path: string, token?: string): Promise<T> {
    return this.request<T>('GET', path, undefined, token)
  }

  private async post<T>(path: string, payload: unknown, token?: string): Promise<T> {
    return this.request<T>('POST', path, payload, token)
  }

  private async accessToken(): Promise<string> {
    const token = await this.auth.getAccessToken()
    if (!token) throw new ComfyBuilderApiError('unauthorized', 'Not signed in to ComfyBuilder')
    return token
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    payload: unknown,
    pinnedToken?: string
  ): Promise<T> {
    const token = pinnedToken ?? (await this.accessToken())

    let res: Response
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {})
        },
        ...(method === 'POST' ? { body: JSON.stringify(payload) } : {}),
        signal: AbortSignal.timeout(this.timeoutMs)
      })
    } catch (err) {
      const e = err as Error
      const detail = e.name === 'TimeoutError' ? `timed out after ${this.timeoutMs}ms` : e.message
      throw new ComfyBuilderApiError('network', `Request to ${path} failed: ${detail}`)
    }

    if (!res.ok) {
      const reason = await errorReason(res)
      if (res.status === 401) {
        try {
          this.auth.onUnauthorized?.(token)
        } catch {}
        throw new ComfyBuilderApiError('unauthorized', `Not authorized for ${path}${reason}`, 401)
      }
      if (res.status === 403)
        throw new ComfyBuilderApiError('forbidden', `Forbidden: ${path}${reason}`, 403)
      if (res.status === 404)
        throw new ComfyBuilderApiError('not-found', `${path} not found${reason}`, 404)
      throw new ComfyBuilderApiError(
        'server',
        `${path} failed: HTTP ${res.status}${reason}`,
        res.status
      )
    }

    let body: unknown
    try {
      body = await res.json()
    } catch {
      throw new ComfyBuilderApiError('server', `${path} returned a non-JSON body`)
    }
    if (body === null || typeof body !== 'object') {
      throw new ComfyBuilderApiError('server', `${path} returned an unexpected body`)
    }
    return body as T
  }
}
