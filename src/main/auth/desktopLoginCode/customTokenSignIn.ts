import type { FirebaseProjectConfig } from '../firebaseBridge/config'
import {
  assemblePersistedUser,
  type PersistedProviderData,
  type ProviderUserInfo
} from '../firebaseBridge/oauth'

const IDP_BASE = 'https://identitytoolkit.googleapis.com/v1'

export interface SignInWithCustomTokenResponse {
  idToken: string
  refreshToken: string
  /** Seconds until idToken expires. Stringified. */
  expiresIn: string
}

/** One entry of accounts:lookup's `users` array. */
export interface LookedUpAccount {
  localId: string
  email?: string
  emailVerified?: boolean
  displayName?: string
  photoUrl?: string
  providerUserInfo?: ProviderUserInfo[]
  /** Stringified ms-epochs. */
  createdAt?: string
  lastLoginAt?: string
}

/**
 * Exchange the backend-minted Firebase custom token for ID/refresh tokens.
 * REST mirror of the SDK's signInWithCustomToken — the main process has no
 * firebase dependency (see oauth.ts for the same pattern).
 */
export async function signInWithCustomToken(
  apiKey: string,
  token: string,
  opts: { signal?: AbortSignal } = {}
): Promise<SignInWithCustomTokenResponse> {
  const resp = await fetch(`${IDP_BASE}/accounts:signInWithCustomToken?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, returnSecureToken: true }),
    signal: opts.signal
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`signInWithCustomToken ${resp.status}: ${text || resp.statusText}`)
  }
  const data = (await resp.json()) as SignInWithCustomTokenResponse
  if (!data.idToken || !data.refreshToken) {
    throw new Error('signInWithCustomToken returned without idToken/refreshToken')
  }
  return data
}

/**
 * Fetch the signed-in user's profile. The custom-token response carries no
 * profile fields, but the persisted-user shape wants them (email,
 * displayName, providerData, metadata) so the rehydrated SDK user matches
 * a normal popup sign-in.
 */
export async function lookupAccount(
  apiKey: string,
  idToken: string,
  opts: { signal?: AbortSignal } = {}
): Promise<LookedUpAccount> {
  const resp = await fetch(`${IDP_BASE}/accounts:lookup?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
    signal: opts.signal
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`accounts:lookup ${resp.status}: ${text || resp.statusText}`)
  }
  const data = (await resp.json()) as { users?: LookedUpAccount[] }
  const account = data.users?.[0]
  if (!account?.localId) {
    throw new Error('accounts:lookup returned no user for the signed-in token')
  }
  return account
}

/**
 * Build the persisted-user record for the custom-token path. Same
 * `User.toJSON()` contract as the OAuth path — see assemblePersistedUser.
 */
export function buildPersistedUserFromCustomToken(
  config: FirebaseProjectConfig,
  signIn: SignInWithCustomTokenResponse,
  account: LookedUpAccount
): Record<string, unknown> {
  const nowMs = Date.now()
  const expiresInSec = Number(signIn.expiresIn || '3600')
  // Custom tokens carry no IdP context, so providerData comes solely from
  // the lookup (empty for a user with no linked providers).
  const providerData: PersistedProviderData[] = (account.providerUserInfo ?? []).map((p) => ({
    providerId: p.providerId ?? 'firebase',
    uid: p.rawId ?? account.localId,
    displayName: p.displayName ?? null,
    email: p.email ?? null,
    phoneNumber: null,
    photoURL: p.photoUrl ?? null
  }))

  return assemblePersistedUser(config.apiKey, {
    uid: account.localId,
    email: account.email ?? null,
    emailVerified: account.emailVerified ?? false,
    displayName: account.displayName ?? null,
    photoURL: account.photoUrl ?? null,
    providerData,
    refreshToken: signIn.refreshToken,
    idToken: signIn.idToken,
    expirationTime: nowMs + expiresInSec * 1000,
    // Lookup metadata when present; else "now", matching the OAuth path.
    createdAt: account.createdAt ?? String(nowMs),
    lastLoginAt: account.lastLoginAt ?? String(nowMs)
  })
}
