/**
 * Typed client for the ingest desktop-login-code endpoints.
 * Talks to the same origin that serves the Cloud frontend — the load
 * balancer routes `/api/*` to ingest — so there is no separate API base
 * URL to configure.
 */

const REQUEST_TIMEOUT_MS = 8000

/**
 * Classified failure from the desktop-login-code endpoints. `retryable`
 * drives the poll loop: 5xx / network / timeout may clear up within the
 * code's TTL, while 403 (verifier mismatch) and 404 (unknown or expired
 * code) are final verdicts.
 */
export class DesktopLoginCodeError extends Error {
  /** HTTP status, when the server responded at all. */
  readonly status?: number
  readonly retryable: boolean

  constructor(message: string, opts: { status?: number; retryable?: boolean } = {}) {
    super(message)
    this.name = 'DesktopLoginCodeError'
    this.status = opts.status
    this.retryable = opts.retryable ?? false
  }
}

export interface CreateDesktopLoginCodeRequest {
  /** Telemetry machine hash; included only when consent is granted. */
  installation_id?: string
  platform: string
  app_version: string
  /** S256 challenge for the desktop-held code verifier. */
  code_challenge: string
}

/** 201 payload. Field names mirror the wire format. */
export interface DesktopLoginCodeGrant {
  code: string
  /** Seconds until the code expires — the polling deadline. */
  expires_in: number
  /** Seconds to wait between exchange polls. */
  poll_interval: number
}

export type DesktopLoginCodeExchange =
  | { status: 'pending' }
  | { status: 'complete'; custom_token: string }

export interface RequestOpts {
  signal?: AbortSignal
  timeoutMs?: number
}

export interface JsonPostResponse {
  ok: boolean
  status: number
  statusText: string
  data: unknown
  bodyText: string
}

function isRetryableStatus(status: number): boolean {
  return status >= 500
}

/**
 * JSON POST with a hard timeout. A caller abort propagates untouched so
 * the poll loop can tell cancellation apart from failure; timeouts and
 * network errors come back as retryable DesktopLoginCodeErrors.
 * Transport-error messages never include request or response bodies (which
 * may hold the code, verifier, or token).
 */
export async function postJson(
  url: string,
  body: unknown,
  opts: RequestOpts
): Promise<JsonPostResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? REQUEST_TIMEOUT_MS)
  const forwardAbort = (): void => controller.abort()
  if (opts.signal?.aborted) controller.abort()
  else opts.signal?.addEventListener('abort', forwardAbort, { once: true })
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    })
    // Fetch resolves when response headers arrive. Consume the body before
    // clearing the timer so a headers-only response cannot stall auth forever.
    const bodyText = await resp.text()
    let data: unknown = null
    try {
      data = JSON.parse(bodyText)
    } catch {
      // Callers classify malformed JSON according to their endpoint contract.
    }
    return {
      ok: resp.ok,
      status: resp.status,
      statusText: resp.statusText,
      data,
      bodyText: resp.ok ? '' : bodyText
    }
  } catch (err) {
    if (opts.signal?.aborted) throw err
    if (controller.signal.aborted) {
      throw new DesktopLoginCodeError('desktop login code request timed out', { retryable: true })
    }
    throw new DesktopLoginCodeError('desktop login code request failed to reach the server', {
      retryable: true
    })
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', forwardAbort)
  }
}

/**
 * Mint a short-lived login code bound to the PKCE challenge. Expects a
 * 201 grant; any failure means the flow can't start, so callers fall back
 * to the legacy loopback bridge.
 */
export async function createDesktopLoginCode(
  apiOrigin: string,
  request: CreateDesktopLoginCodeRequest,
  opts: RequestOpts = {}
): Promise<DesktopLoginCodeGrant> {
  const resp = await postJson(
    new URL('/api/auth/desktop-login-codes', apiOrigin).href,
    request,
    opts
  )
  if (!resp.ok) {
    throw new DesktopLoginCodeError(`desktop login code create failed: ${resp.status}`, {
      status: resp.status,
      retryable: isRetryableStatus(resp.status)
    })
  }
  const data = resp.data as {
    code?: unknown
    expires_in?: unknown
    poll_interval?: unknown
  } | null
  // Non-positive timings would spin the poll loop (interval) or expire the
  // code before the user can sign in (deadline) — reject them here, where
  // the caller can still fall back to the legacy bridge.
  if (
    !data ||
    typeof data.code !== 'string' ||
    data.code.length === 0 ||
    typeof data.expires_in !== 'number' ||
    data.expires_in <= 0 ||
    typeof data.poll_interval !== 'number' ||
    data.poll_interval <= 0
  ) {
    throw new DesktopLoginCodeError('desktop login code create returned an unexpected payload', {
      status: resp.status
    })
  }
  return {
    code: data.code,
    expires_in: data.expires_in,
    poll_interval: data.poll_interval
  }
}

/**
 * Poll the exchange endpoint with the code + verifier. `pending` until the
 * user redeems the code in their browser; `complete` exactly once with the
 * one-time Firebase custom token.
 */
export async function exchangeDesktopLoginCode(
  apiOrigin: string,
  request: { code: string; code_verifier: string },
  opts: RequestOpts = {}
): Promise<DesktopLoginCodeExchange> {
  const resp = await postJson(
    new URL('/api/auth/desktop-login-codes/exchange', apiOrigin).href,
    request,
    opts
  )
  if (!resp.ok) {
    throw new DesktopLoginCodeError(`desktop login code exchange failed: ${resp.status}`, {
      status: resp.status,
      retryable: isRetryableStatus(resp.status)
    })
  }
  const data = resp.data as {
    status?: unknown
    custom_token?: unknown
  } | null
  if (data?.status === 'pending') return { status: 'pending' }
  if (
    data?.status === 'complete' &&
    typeof data.custom_token === 'string' &&
    data.custom_token.length > 0
  ) {
    return { status: 'complete', custom_token: data.custom_token }
  }
  throw new DesktopLoginCodeError('desktop login code exchange returned an unexpected payload', {
    status: resp.status,
    retryable: true
  })
}
