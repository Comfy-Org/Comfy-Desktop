/**
 * ComfyBuilder catalog client - the read side of the functionality library.
 *
 * Lists builds -> versions -> artifacts and resolves an artifact's
 * presigned download URL, over the deployed builder gateway. Every request
 * carries a bearer token from the injected {@link TokenProvider}; the token
 * never leaves this process and is never returned to callers. Failures surface
 * as a typed {@link ComfyBuilderApiError} whose `kind` a caller can branch on.
 */
import type {
  Artifact,
  Distribution,
  DistributionVersion,
  ModelManifest,
  TokenProvider
} from './types'
import { isSecureDownloadUrl, isValidSha256 } from './integrity'

/** Prod builder gateway. Pass `baseUrl` to target staging or a mock. */
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

/** Best-effort `: reason` suffix from an error response body, so a gateway's
 *  `{ message: '...' }` reaches logs and the UI instead of being discarded.
 *  Never throws; a missing/non-JSON/shapeless body yields an empty string. */
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
  /** Gateway base URL including the `/builder` mount. Defaults to prod. */
  baseUrl?: string
  /** Auth seam: the UI's token source. */
  auth: TokenProvider
  /** Per-request timeout in ms. Defaults to 30s. */
  timeoutMs?: number
}

interface DistributionsResponse {
  builds?: Distribution[]
}
interface VersionsResponse {
  versions?: DistributionVersion[]
}
interface VersionDetailResponse {
  version?: number
  artifacts?: Artifact[]
}
interface SignedDownloadResponse {
  downloadUrl?: string
}

/** The catalog + download-resolve surface the UI calls to populate its tiles. */
export class ComfyBuilderClient {
  private readonly baseUrl: string
  private readonly auth: TokenProvider
  private readonly timeoutMs: number

  constructor(options: ComfyBuilderClientOptions) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.auth = options.auth
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  /** Every build visible to the signed-in workspace. */
  async listDistributions(): Promise<Distribution[]> {
    const body = await this.get<DistributionsResponse>('/v1/builds')
    return body.builds ?? []
  }

  /** Versions (build history) of one build. */
  async listVersions(distributionId: string): Promise<DistributionVersion[]> {
    const body = await this.get<VersionsResponse>(
      `/v1/builds/${encodeURIComponent(distributionId)}/versions`
    )
    return body.versions ?? []
  }

  /** One version's per-target artifacts (plus its version number). */
  async getVersion(
    versionId: string
  ): Promise<{ version: number | undefined; artifacts: Artifact[] }> {
    const body = await this.get<VersionDetailResponse>(
      `/v1/build-versions/${encodeURIComponent(versionId)}`
    )
    return { version: body.version, artifacts: body.artifacts ?? [] }
  }

  /**
   * A version's models + runtime policies, projected from its sealed manifest.
   * Each model carries a ready-to-GET `downloadUrl` and its target model
   * directory; a client stages these before starting ComfyUI. An empty `models`
   * array is normal (a version may declare none).
   */
  async fetchModelManifest(versionId: string): Promise<ModelManifest> {
    const body = await this.get<Partial<ModelManifest>>(
      `/v1/build-versions/${encodeURIComponent(versionId)}/manifest`
    )
    if (!Array.isArray(body.models)) {
      throw new ComfyBuilderApiError(
        'server',
        `Manifest for version ${versionId} has no model list`
      )
    }
    if (body.models.some((model) => !isValidSha256(model.sha256))) {
      throw new ComfyBuilderApiError(
        'server',
        `Manifest for version ${versionId} contains a model without a valid SHA-256`
      )
    }
    return {
      models: body.models,
      modelPolicy: body.modelPolicy ?? null,
      partnerNodePolicy: body.partnerNodePolicy ?? null
    }
  }

  /** Resolve an artifact's short-lived presigned archive URL. */
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

  private async get<T>(path: string): Promise<T> {
    const token = await this.auth.getAccessToken()
    if (!token) throw new ComfyBuilderApiError('unauthorized', 'Not signed in to ComfyBuilder')

    let res: Response
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(this.timeoutMs)
      })
    } catch (err) {
      // `AbortSignal.timeout` rejects with a TimeoutError DOMException; name
      // the timeout budget so a slow gateway reads differently from a dead
      // socket. Both remain kind 'network' - callers branch the same way.
      const e = err as Error
      const detail = e.name === 'TimeoutError' ? `timed out after ${this.timeoutMs}ms` : e.message
      throw new ComfyBuilderApiError('network', `Request to ${path} failed: ${detail}`)
    }

    // 401 = dead token: prompt re-auth. 403 = authenticated but lacks access to
    // this resource; a single forbidden item must NOT sign the user out.
    if (!res.ok) {
      const reason = await errorReason(res)
      if (res.status === 401) {
        try {
          this.auth.onUnauthorized?.(token)
        } catch {
          /* an injected callback must not mask the typed error */
        }
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

    // A 2xx with an empty / non-JSON / null body must surface as a typed error,
    // never a raw SyntaxError or a downstream `body.foo` TypeError.
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
