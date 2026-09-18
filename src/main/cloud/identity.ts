import { CLOUD_CONFIG } from './config'

/** Canonical authorization identity and optional original Firebase identity. */
export interface CloudUserIdentity {
  userId: string
  /** Absent on legacy/non-Firebase OAuth grants. Never substitute userId here. */
  firebaseUid?: string
}

export interface UserIdentityOptions {
  apiBase?: string
  timeoutMs?: number
  signal?: AbortSignal
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value
}

/** Resolve identity through the authenticated server, rather than decoded JWT claims. */
export async function getUserIdentity(
  accessToken: string,
  options: UserIdentityOptions = {}
): Promise<CloudUserIdentity | null> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 10_000)
  const response = await fetch(
    `${(options.apiBase ?? CLOUD_CONFIG.apiBase).replace(/\/+$/, '')}/user`,
    {
      headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
      signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
      redirect: 'error'
    }
  )
  if (response.status === 401 || response.status === 403) return null
  if (!response.ok) throw new Error(`User identity unavailable: HTTP ${response.status}`)
  const body: unknown = await response.json()
  if (!body || typeof body !== 'object' || !('id' in body) || !isIdentifier(body.id)) {
    throw new Error('Invalid user identity response')
  }
  const firebaseUid = 'firebase_uid' in body ? body.firebase_uid : undefined
  if (firebaseUid !== undefined && (!isIdentifier(firebaseUid) || firebaseUid.length > 128)) {
    throw new Error('Invalid Firebase identity response')
  }
  return { userId: body.id, ...(firebaseUid === undefined ? {} : { firebaseUid }) }
}
