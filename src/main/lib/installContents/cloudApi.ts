import { CLOUD_ISSUER } from '../../cloud/config'
import { getCloudSession } from '../../devplatform/session'
import * as i18n from '../i18n'

export type CloudResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; signedOut?: true; status?: number }

/** A slow Cloud must not leave a tab loading forever. */
const CLOUD_TIMEOUT_MS = 15_000

/** A page of Cloud's `/api/assets`. */
export interface CloudAssetPage<A> {
  assets: A[]
  total?: number
  has_more?: boolean
  next_cursor?: string | null
}

export function isAssetPage<A>(data: unknown): data is CloudAssetPage<A> {
  return Array.isArray((data as { assets?: unknown } | null)?.assets)
}

export function cloudSignedOut(): { ok: false; signedOut: true; message: string } {
  return { ok: false, signedOut: true, message: i18n.t('installContents.signedOut') }
}

/**
 * GET a Comfy Cloud API route as the signed-in user, for the session's active
 * workspace. The token never leaves main. A body that fails `isExpected` is
 * an error, so callers can rely on its shape.
 */
export async function cloudGet<T>(
  pathname: string,
  params: Record<string, string>,
  isExpected: (data: unknown) => data is T
): Promise<CloudResult<T>> {
  const session = getCloudSession()
  if (!session.isSignedIn()) return cloudSignedOut()
  const token = await session.getAccessToken()
  if (!token) return cloudSignedOut()
  const url = new URL(pathname, CLOUD_ISSUER)
  url.search = new URLSearchParams(params).toString()
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(CLOUD_TIMEOUT_MS)
    })
    if (res.status === 401) return cloudSignedOut()
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        message: i18n.t('installContents.cloudError', { status: res.status })
      }
    }
    const data: unknown = await res.json()
    if (!isExpected(data)) {
      return { ok: false, message: i18n.t('installContents.cloudUnexpected') }
    }
    return { ok: true, data }
  } catch (err) {
    console.warn('[install-contents] Cloud request failed:', (err as Error).message)
    return { ok: false, message: i18n.t('installContents.cloudUnreachable') }
  }
}
