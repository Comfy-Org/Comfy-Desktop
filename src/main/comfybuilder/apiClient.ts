/**
 * ComfyBuilder REST client — main process only.
 *
 * Lists pipelines and deployments from the ComfyBuilder API with a Bearer
 * access token pulled from {@link loadTokens}. The token NEVER crosses the IPC
 * boundary: the renderer calls these functions indirectly and can neither pass
 * a token in nor read one out.
 *
 * On a 401 the client performs a single refresh-and-retry: it exchanges the
 * refresh token via {@link refresh}, persists the rotated tokens with
 * {@link saveTokens}, and replays the original request exactly once. It never
 * retries more than once, so a persistently rejecting server cannot loop.
 *
 * Failures surface as a typed {@link ComfyBuilderApiError} whose `kind`
 * discriminates the four failure classes callers care about.
 */
import { COMFYBUILDER_API_BASE } from './config'
import type { Deployment, Pipeline } from './dto'
import { parseDeployments, parsePipelines } from './dto'
import { refresh } from './oauth'
import { loadTokens, saveTokens } from './tokenStore'
import type { AuthTokens } from './types'

/** The failure classes a caller can branch on. */
export type ComfyBuilderErrorKind = 'unauthorized' | 'notFound' | 'network' | 'server'

/**
 * Typed error thrown by every client call. `kind` maps HTTP status codes and
 * transport failures onto the four classes above; `message` is safe to surface
 * (it never contains tokens or `Authorization` headers).
 */
export class ComfyBuilderApiError extends Error {
  override name = 'ComfyBuilderApiError'
  readonly kind: ComfyBuilderErrorKind

  constructor(kind: ComfyBuilderErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}

/**
 * Test/override seams. Production leaves these unset and inherits
 * {@link COMFYBUILDER_API_BASE} and the default timeout; tests point `apiBase`
 * at the mock Builder API.
 */
export interface ApiClientOptions {
  /** Base URL including `/api/v1`. Defaults to {@link COMFYBUILDER_API_BASE}. */
  apiBase?: string
  /** Per-request timeout in ms. Defaults to 30s. */
  timeoutMs?: number
}

/** Abort a stalled request rather than hang the caller. */
const DEFAULT_TIMEOUT_MS = 30_000

/** Cap same-host redirect hops so a redirect cycle can't spin forever. */
const MAX_REDIRECTS = 5

/** List every pipeline visible to the signed-in workspace. */
export async function listPipelines(options: ApiClientOptions = {}): Promise<Pipeline[]> {
  return parsePipelines(await requestJson('/pipelines', options))
}

/** List the deployments (build history) for a single pipeline. */
export async function listDeployments(
  pipelineId: string,
  options: ApiClientOptions = {},
): Promise<Deployment[]> {
  const path = `/pipelines/${encodeURIComponent(pipelineId)}/deployments`
  return parseDeployments(await requestJson(path, options))
}

/**
 * Perform an authenticated GET and return the parsed JSON body. On a 401 it
 * refreshes once and replays the request a single time before giving up.
 */
async function requestJson(path: string, options: ApiClientOptions): Promise<unknown> {
  const tokens = loadTokens()
  if (!tokens) {
    throw new ComfyBuilderApiError('unauthorized', 'Not signed in to ComfyBuilder')
  }

  const apiBase = options.apiBase ?? COMFYBUILDER_API_BASE
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const url = `${apiBase}${path}`

  const first = await sendRequest(url, tokens.accessToken, timeoutMs)
  if (first.status !== 401) {
    return readResult(first)
  }

  // Exactly one refresh-and-retry on 401 — never more.
  const refreshed = await refreshTokens(tokens)
  saveTokens(refreshed)

  const retry = await sendRequest(url, refreshed.accessToken, timeoutMs)
  if (retry.status === 401) {
    throw new ComfyBuilderApiError(
      'unauthorized',
      'ComfyBuilder rejected the request after a token refresh',
    )
  }
  return readResult(retry)
}

/** Exchange the refresh token for fresh tokens, mapping any failure to `unauthorized`. */
async function refreshTokens(tokens: AuthTokens): Promise<AuthTokens> {
  if (!tokens.refreshToken) {
    throw new ComfyBuilderApiError(
      'unauthorized',
      'ComfyBuilder session expired and no refresh token is available',
    )
  }
  try {
    return await refresh(tokens.refreshToken)
  } catch {
    throw new ComfyBuilderApiError(
      'unauthorized',
      'ComfyBuilder session expired and the token refresh failed',
    )
  }
}

/**
 * Fetch `url` with a Bearer token, a hard timeout, and same-host-only redirect
 * following. Transport failures (including the timeout abort) surface as a
 * `network` {@link ComfyBuilderApiError}; every other error is re-thrown as-is.
 */
async function sendRequest(url: string, accessToken: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await followSameHostRedirects(url, accessToken, controller.signal)
  } catch (err) {
    if (err instanceof ComfyBuilderApiError) throw err
    throw new ComfyBuilderApiError('network', networkErrorMessage(err))
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Drive the request manually so redirects are only followed when they stay on
 * the same host — a cross-host `Location` is refused rather than replayed with
 * the `Authorization` header attached.
 */
async function followSameHostRedirects(
  url: string,
  accessToken: string,
  signal: AbortSignal,
): Promise<Response> {
  let currentUrl = url
  for (let redirects = 0; ; redirects += 1) {
    const currentHost = new URL(currentUrl).host
    const resp = await fetch(currentUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      redirect: 'manual',
      signal,
    })

    if (!isRedirectStatus(resp.status)) return resp

    const location = resp.headers.get('location')
    if (!location) return resp

    if (redirects >= MAX_REDIRECTS) {
      throw new ComfyBuilderApiError('network', 'ComfyBuilder API redirected too many times')
    }
    const next = new URL(location, currentUrl)
    if (next.host !== currentHost) {
      throw new ComfyBuilderApiError(
        'network',
        'Refusing to follow a cross-host redirect from the ComfyBuilder API',
      )
    }
    currentUrl = next.toString()
  }
}

/** Parse a 2xx JSON body, or map a non-2xx status onto a typed error. */
async function readResult(resp: Response): Promise<unknown> {
  if (resp.ok) {
    try {
      return (await resp.json()) as unknown
    } catch {
      throw new ComfyBuilderApiError('server', 'ComfyBuilder API returned an unreadable response body')
    }
  }
  throw new ComfyBuilderApiError(kindForStatus(resp.status), await describeHttpError(resp))
}

/** Map an HTTP status onto a failure class. */
function kindForStatus(status: number): ComfyBuilderErrorKind {
  if (status === 401 || status === 403) return 'unauthorized'
  if (status === 404) return 'notFound'
  return 'server'
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

/** Build a safe error message from the server's `{ code, message }` body when present. */
async function describeHttpError(resp: Response): Promise<string> {
  const body = await resp.text().catch(() => '')
  try {
    const parsed = JSON.parse(body) as { code?: unknown; message?: unknown }
    if (parsed && typeof parsed.message === 'string' && parsed.message) {
      return `ComfyBuilder API error (${resp.status}): ${parsed.message}`
    }
    if (parsed && typeof parsed.code === 'string' && parsed.code) {
      return `ComfyBuilder API error (${resp.status} ${parsed.code})`
    }
  } catch {
    // Non-JSON error body — fall through to the status-only message.
  }
  return `ComfyBuilder API request failed with status ${resp.status}`
}

/** Distinguish a timeout abort from a generic transport failure. */
function networkErrorMessage(err: unknown): string {
  if (err instanceof Error && err.name === 'AbortError') {
    return 'ComfyBuilder API request timed out'
  }
  return 'Unable to reach the ComfyBuilder API'
}
