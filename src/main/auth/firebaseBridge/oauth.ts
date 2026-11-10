import { net } from 'electron'

import type { FirebaseProjectConfig } from './config'
import type { SupportedProvider } from './intercept'

const IDP_BASE = 'https://identitytoolkit.googleapis.com/v1'

interface CreateAuthUriResponse {
  authUri: string
  sessionId: string
  providerId: string
}

export interface ProviderUserInfo {
  providerId?: string
  rawId?: string
  email?: string
  displayName?: string
  photoUrl?: string
}

interface SignInWithIdpResponse {
  idToken: string
  refreshToken: string
  expiresIn: string
  localId: string
  email?: string
  emailVerified?: boolean
  displayName?: string
  photoUrl?: string
  providerId?: string
  rawUserInfo?: string
  oauthAccessToken?: string
  oauthIdToken?: string
  federatedId?: string
  rawId?: string
  isNewUser?: boolean
  providerUserInfo?: ProviderUserInfo[]
}

export async function createOauthAuthUri(
  apiKey: string,
  providerId: SupportedProvider,
  continueUri: string
): Promise<CreateAuthUriResponse> {
  const oauthScope = providerId === 'github.com' ? 'read:user user:email' : 'profile email'
  const resp = await net.fetch(`${IDP_BASE}/accounts:createAuthUri?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerId, continueUri, oauthScope }),
    credentials: 'omit'
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`createAuthUri ${resp.status}: ${text || resp.statusText}`)
  }
  const data = (await resp.json()) as CreateAuthUriResponse
  if (!data.authUri || !data.sessionId) {
    throw new Error('createAuthUri returned without authUri/sessionId')
  }
  return data
}

export async function signInWithIdpExchange(
  apiKey: string,
  providerId: SupportedProvider,
  requestUri: string,
  sessionId: string
): Promise<SignInWithIdpResponse> {
  const queryStart = requestUri.indexOf('?')
  const queryParams = queryStart >= 0 ? requestUri.slice(queryStart + 1) : ''
  const postBody = `${queryParams}&providerId=${encodeURIComponent(providerId)}`
  const resp = await net.fetch(`${IDP_BASE}/accounts:signInWithIdp?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      postBody,
      requestUri,
      sessionId,
      returnIdpCredential: true,
      returnSecureToken: true
    }),
    credentials: 'omit'
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`signInWithIdp ${resp.status}: ${text || resp.statusText}`)
  }
  return (await resp.json()) as SignInWithIdpResponse
}

export interface PersistedProviderData {
  providerId: string
  uid: string
  displayName: string | null
  email: string | null
  phoneNumber: null
  photoURL: string | null
}

export function mapProviderUserInfo(
  list: ProviderUserInfo[] | undefined,
  fallbackProviderId: string,
  fallbackUid: string
): PersistedProviderData[] {
  return (list ?? []).map((p) => ({
    providerId: p.providerId ?? fallbackProviderId,
    uid: p.rawId ?? fallbackUid,
    displayName: p.displayName ?? null,
    email: p.email ?? null,
    phoneNumber: null,
    photoURL: p.photoUrl ?? null
  }))
}

export function expiresInSecondsOrDefault(expiresIn: string | undefined): number {
  const parsed = Number(expiresIn)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3600
}

export interface PersistedUserProfile {
  uid: string
  email: string | null
  emailVerified: boolean
  displayName: string | null
  photoURL: string | null
  providerData: PersistedProviderData[]
  refreshToken: string
  idToken: string
  expirationTime: number
  createdAt: string
  lastLoginAt: string
}

export function assemblePersistedUser(
  apiKey: string,
  profile: PersistedUserProfile
): Record<string, unknown> {
  return {
    uid: profile.uid,
    email: profile.email,
    emailVerified: profile.emailVerified,
    displayName: profile.displayName,
    isAnonymous: false,
    photoURL: profile.photoURL,
    phoneNumber: null,
    tenantId: null,
    providerData: profile.providerData,
    stsTokenManager: {
      refreshToken: profile.refreshToken,
      accessToken: profile.idToken,
      expirationTime: profile.expirationTime
    },
    createdAt: profile.createdAt,
    lastLoginAt: profile.lastLoginAt,
    apiKey,
    appName: '[DEFAULT]'
  }
}

export function buildPersistedUser(
  config: FirebaseProjectConfig,
  resp: SignInWithIdpResponse,
  providerId: SupportedProvider
): Record<string, unknown> {
  const nowMs = Date.now()
  const expiresInSec = expiresInSecondsOrDefault(resp.expiresIn)
  const providerData: PersistedProviderData[] =
    resp.providerUserInfo && resp.providerUserInfo.length > 0
      ? mapProviderUserInfo(resp.providerUserInfo, providerId, resp.localId)
      : [
          {
            providerId,
            uid: resp.federatedId ?? resp.rawId ?? resp.localId,
            displayName: resp.displayName ?? null,
            email: resp.email ?? null,
            phoneNumber: null,
            photoURL: resp.photoUrl ?? null
          }
        ]

  return assemblePersistedUser(config.apiKey, {
    uid: resp.localId,
    email: resp.email ?? null,
    emailVerified: resp.emailVerified ?? false,
    displayName: resp.displayName ?? null,
    photoURL: resp.photoUrl ?? null,
    providerData,
    refreshToken: resp.refreshToken,
    idToken: resp.idToken,
    expirationTime: nowMs + expiresInSec * 1000,
    createdAt: String(nowMs),
    lastLoginAt: String(nowMs)
  })
}
