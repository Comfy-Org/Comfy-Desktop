import { net } from 'electron'

const REQUEST_TIMEOUT_MS = 8000

const MIN_POLL_INTERVAL_SEC = 1
const MAX_POLL_INTERVAL_SEC = 30
const MAX_EXPIRES_IN_SEC = 1800

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

export class DesktopLoginCodeError extends Error {
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
  installation_id?: string
  platform: string
  app_version: string
  code_challenge: string
}

export interface DesktopLoginCodeGrant {
  code: string
  expires_in: number
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
  return status >= 500 || status === 408 || status === 429
}

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
    const resp = await net.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
      credentials: 'omit'
    })
    const bodyText = await resp.text()
    let data: unknown = null
    try {
      data = JSON.parse(bodyText)
    } catch {}
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
  if (
    !data ||
    typeof data.code !== 'string' ||
    data.code.length === 0 ||
    !isIntegerInRange(data.expires_in, 1, MAX_EXPIRES_IN_SEC) ||
    !isIntegerInRange(data.poll_interval, MIN_POLL_INTERVAL_SEC, MAX_POLL_INTERVAL_SEC)
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
