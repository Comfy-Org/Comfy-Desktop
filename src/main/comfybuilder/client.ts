/**
 * ComfyBuilder catalog client - the read side of the functionality library.
 *
 * Lists distributions -> versions -> artifacts and resolves an artifact's
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
  TokenProvider,
} from './types'

/** Prod builder gateway. Pass `baseUrl` to target staging or a mock. */
export const DEFAULT_BASE_URL = 'https://platformapi.comfy.org/builder'

const DEFAULT_TIMEOUT_MS = 30_000

export type ComfyBuilderErrorKind = 'unauthorized' | 'forbidden' | 'not-found' | 'network' | 'server'

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

export interface ComfyBuilderClientOptions {
  /** Gateway base URL including the `/builder` mount. Defaults to prod. */
  baseUrl?: string
  /** Auth seam: the UI's token source. */
  auth: TokenProvider
  /** Per-request timeout in ms. Defaults to 30s. */
  timeoutMs?: number
}

interface DistributionsResponse { distributions?: Distribution[] }
interface VersionsResponse { versions?: DistributionVersion[] }
interface VersionDetailResponse { version?: number; artifacts?: Artifact[] }
interface SignedDownloadResponse { downloadUrl?: string }

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

  /** Every distribution visible to the signed-in workspace. */
  async listDistributions(): Promise<Distribution[]> {
    const body = await this.get<DistributionsResponse>('/v1/distributions')
    return body.distributions ?? []
  }

  /** Versions (build history) of one distribution. */
  async listVersions(distributionId: string): Promise<DistributionVersion[]> {
    const body = await this.get<VersionsResponse>(`/v1/distributions/${encodeURIComponent(distributionId)}/versions`)
    return body.versions ?? []
  }

  /** One version's per-target artifacts (plus its version number). */
  async getVersion(versionId: string): Promise<{ version: number | undefined; artifacts: Artifact[] }> {
    const body = await this.get<VersionDetailResponse>(`/v1/distribution-versions/${encodeURIComponent(versionId)}`)
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
      `/v1/distribution-versions/${encodeURIComponent(versionId)}/manifest`,
    )
    return {
      models: body.models ?? [],
      modelPolicy: body.modelPolicy ?? null,
      partnerNodePolicy: body.partnerNodePolicy ?? null,
    }
  }

  /** Resolve an artifact's short-lived presigned archive URL. */
  async resolveDownloadUrl(artifactId: string): Promise<string> {
    const body = await this.get<SignedDownloadResponse>(`/v1/build-artifacts/${encodeURIComponent(artifactId)}/download`)
    if (typeof body.downloadUrl !== 'string' || body.downloadUrl.length === 0) {
      throw new ComfyBuilderApiError('server', `No downloadUrl for artifact ${artifactId}`)
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
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (err) {
      throw new ComfyBuilderApiError('network', `Request to ${path} failed: ${(err as Error).message}`)
    }

    // 401 = dead token: prompt re-auth. 403 = authenticated but lacks access to
    // this resource; a single forbidden item must NOT sign the user out.
    if (res.status === 401) {
      try { this.auth.onUnauthorized?.() } catch { /* an injected callback must not mask the typed error */ }
      throw new ComfyBuilderApiError('unauthorized', `Not authorized for ${path}`, 401)
    }
    if (res.status === 403) throw new ComfyBuilderApiError('forbidden', `Forbidden: ${path}`, 403)
    if (res.status === 404) throw new ComfyBuilderApiError('not-found', `${path} not found`, 404)
    if (!res.ok) throw new ComfyBuilderApiError('server', `${path} failed: HTTP ${res.status}`, res.status)

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
