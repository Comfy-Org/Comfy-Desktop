import { net } from 'electron'

import { CLOUD_CONFIG } from '../../cloud/config'

const REQUEST_TIMEOUT_MS = 10_000

export const WEB_SESSION_ROUTE = '/auth/desktop-web-session'

export type WebSessionTokenResult =
  | { kind: 'minted'; customToken: string }
  | { kind: 'declined'; status: number | null; code?: string }

export interface WebSessionTokenOptions {
  apiBase?: string
  signal?: AbortSignal
  timeoutMs?: number
}

function errorCodeOf(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined
  const { code } = body as { code?: unknown }
  return typeof code === 'string' && code.length > 0 ? code.toLowerCase() : undefined
}

export async function requestWebSessionToken(
  grantAccessToken: string,
  options: WebSessionTokenOptions = {}
): Promise<WebSessionTokenResult> {
  const base = (options.apiBase ?? CLOUD_CONFIG.apiBase).replace(/\/+$/, '')
  const timeout = AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  let res: Response
  try {
    res = await net.fetch(`${base}${WEB_SESSION_ROUTE}`, {
      method: 'POST',
      headers: { Accept: 'application/json', Authorization: `Bearer ${grantAccessToken}` },
      credentials: 'omit',
      signal
    })
  } catch {
    return { kind: 'declined', status: null }
  }
  const body: unknown = await res.json().catch(() => null)
  if (res.ok) {
    const customToken =
      body && typeof body === 'object' ? (body as { custom_token?: unknown }).custom_token : null
    return typeof customToken === 'string' && customToken.length > 0
      ? { kind: 'minted', customToken }
      : { kind: 'declined', status: res.status }
  }
  const code = errorCodeOf(body)
  return code === undefined
    ? { kind: 'declined', status: res.status }
    : { kind: 'declined', status: res.status, code }
}
