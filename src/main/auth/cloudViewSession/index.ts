import type { WebContents } from 'electron'

import { holdsWebSessionScope } from '../../cloud/claims'
import { CLOUD_CONFIG } from '../../cloud/config'
import { getCloudSession } from '../../devplatform/session'
import * as mainTelemetry from '../../lib/telemetry'
import { isTrustedCloudUrl } from '../../lib/trustedCloudUrl'
import {
  buildPersistedUserFromCustomToken,
  lookupAccount,
  signInWithCustomToken
} from '../desktopLoginCode/customTokenSignIn'
import { getFirebaseConfig, type FirebaseEnv } from '../firebaseBridge/config'
import { bindSignedInUser } from '../firebaseBridge/flowShared'
import {
  beginFirebaseSessionInjection,
  hasActiveFirebaseSessionInjection,
  injectFirebaseSession,
  releaseFirebaseSessionInjection
} from '../firebaseBridge/inject'
import { requestWebSessionToken } from './client'
import { keepsTokensInOsKeychain } from './storageStrength'
import {
  buildReadStateScript,
  buildRemoveDesktopSessionScript,
  buildWriteMarkerScript,
  type CloudViewAuthState,
  DESKTOP_SESSION_MARKER_KEY,
  type DesktopSessionMarker,
  parseMarker,
  serializeMarker
} from './pageState'

export const CLOUD_VIEW_SESSION_EVENT = 'comfy.desktop.auth.cloud_view_session'

const PROD_CLOUD_ORIGIN = 'https://cloud.comfy.org'

const REPORTABLE_ERROR_CODES: ReadonlySet<string> = new Set([
  'account_outside_organization',
  'desktop_web_session_disabled',
  'insufficient_scope',
  'invalid_token',
  'oauth_grant_ended',
  'rate_limited',
  'sso_required',
  'token_revoked',
  'unauthorized'
])

export type DesktopIdentity =
  { signedIn: false } | { signedIn: true; sub: string; fam: string | null }

export type CloudViewDecision =
  | { kind: 'none' }
  | { kind: 'sign_in' }
  | { kind: 'sign_out'; uid: string }
  | { kind: 'write_marker'; marker: DesktopSessionMarker | null }

function sameGrant(desktop: DesktopIdentity, marker: DesktopSessionMarker): boolean {
  return desktop.signedIn && desktop.sub === marker.sub && desktop.fam === marker.fam
}

export function decideCloudViewSession(
  state: CloudViewAuthState,
  desktop: DesktopIdentity
): CloudViewDecision {
  const { uid, marker } = state
  if (uid) {
    if (marker?.state === 'active' && marker.uid === uid) {
      return desktop.signedIn && desktop.sub === marker.sub
        ? { kind: 'none' }
        : { kind: 'sign_out', uid }
    }
    return marker ? { kind: 'write_marker', marker: null } : { kind: 'none' }
  }

  if (marker && sameGrant(desktop, marker)) {
    return marker.state === 'active'
      ? { kind: 'write_marker', marker: { ...marker, state: 'declined' } }
      : { kind: 'none' }
  }
  if (!desktop.signedIn) {
    return marker ? { kind: 'write_marker', marker: null } : { kind: 'none' }
  }
  return { kind: 'sign_in' }
}

function firebaseEnvForIssuer(issuerOrigin: string): FirebaseEnv {
  return issuerOrigin === PROD_CLOUD_ORIGIN ? 'prod' : 'dev'
}

function issuerOrigin(): string | null {
  try {
    return new URL(CLOUD_CONFIG.issuer).origin
  } catch {
    return null
  }
}

function currentOrigin(contents: WebContents): string | null {
  if (contents.isDestroyed()) return null
  try {
    return new URL(contents.getURL()).origin
  } catch {
    return null
  }
}

function desktopIdentity(): DesktopIdentity {
  const session = getCloudSession()
  const sub = session.isSignedIn() ? session.currentSubject() : null
  return sub ? { signedIn: true, sub, fam: session.currentGrantFamily() } : { signedIn: false }
}

function parseState(raw: unknown): CloudViewAuthState | null {
  if (!raw || typeof raw !== 'object') return null
  const { uid, marker } = raw as { uid?: unknown; marker?: unknown }
  if (uid !== null && (typeof uid !== 'string' || uid === '')) return null
  return { uid, marker: parseMarker(marker) }
}

function report(outcome: string, extra: mainTelemetry.TelemetryContext = {}): void {
  mainTelemetry.emit(CLOUD_VIEW_SESSION_EVENT, { outcome, ...extra })
}

function declinedReport(status: number | null, code?: string): mainTelemetry.TelemetryContext {
  if (status === null) return { reason: 'network' }
  const known = code && REPORTABLE_ERROR_CODES.has(code) ? code : code ? 'other' : undefined
  return known
    ? { reason: 'http', http_status: status, error_code: known }
    : { reason: 'http', http_status: status }
}

interface ViewTarget {
  contents: WebContents
  origin: string
  apiKey: string
  env: FirebaseEnv
}

async function injectIntoSignedOutView(
  { contents, origin, apiKey }: ViewTarget,
  user: Record<string, unknown>,
  marker: DesktopSessionMarker
): Promise<boolean> {
  const injection = beginFirebaseSessionInjection(contents)
  try {
    return await injectFirebaseSession(injection, origin, user, apiKey, {
      onlyIfSignedOut: true,
      marker: { key: DESKTOP_SESSION_MARKER_KEY, value: serializeMarker(marker) }
    })
  } finally {
    releaseFirebaseSessionInjection(injection)
  }
}

async function signInView(target: ViewTarget): Promise<void> {
  const { contents, origin, env } = target
  const session = getCloudSession()
  const generation = session.currentAuthGeneration()
  const sub = session.currentSubject()
  const fam = session.currentGrantFamily()
  const unchanged = (): boolean =>
    session.currentAuthGeneration() === generation &&
    session.currentSubject() === sub &&
    currentOrigin(contents) === origin
  if (!sub) return

  const accessToken = await session.getGrantAccessToken()
  if (!accessToken || !unchanged()) return
  if (!holdsWebSessionScope(accessToken)) {
    report('scope_missing')
    return
  }
  if (!keepsTokensInOsKeychain()) {
    report('weak_storage')
    return
  }

  const minted = await requestWebSessionToken(accessToken)
  if (minted.kind === 'declined') {
    report('declined', declinedReport(minted.status, minted.code))
    return
  }
  if (!unchanged()) return

  const config = getFirebaseConfig(env)
  const signIn = await signInWithCustomToken(config.apiKey, minted.customToken)
  const account = await lookupAccount(config.apiKey, signIn.idToken)
  const user = buildPersistedUserFromCustomToken(config, signIn, account)
  if (!unchanged() || hasActiveFirebaseSessionInjection()) return

  const marker: DesktopSessionMarker = { v: 1, uid: account.localId, sub, fam, state: 'active' }
  const injected = await injectIntoSignedOutView(target, user, marker)
  if (!injected) {
    report('kept_existing')
    return
  }
  bindSignedInUser(user, contents, { via: 'desktop_web_session' })
  report('signed_in')
}

async function reconcileOnce(contents: WebContents): Promise<void> {
  if (contents.isDestroyed() || !isTrustedCloudUrl(contents.getURL())) return
  const expected = issuerOrigin()
  const origin = currentOrigin(contents)
  if (!expected || origin !== expected) return
  const env = firebaseEnvForIssuer(expected)
  const apiKey = getFirebaseConfig(env).apiKey

  const raw: unknown = await contents
    .executeJavaScript(buildReadStateScript(apiKey, origin), true)
    .catch(() => null)
  const state = parseState(raw)
  if (!state || currentOrigin(contents) !== origin) return

  const decision = decideCloudViewSession(state, desktopIdentity())
  switch (decision.kind) {
    case 'none':
      return
    case 'write_marker':
      await contents
        .executeJavaScript(buildWriteMarkerScript(origin, decision.marker), true)
        .catch(() => false)
      return
    case 'sign_out': {
      const removed: unknown = await contents
        .executeJavaScript(buildRemoveDesktopSessionScript(apiKey, origin, decision.uid), true)
        .catch(() => false)
      if (removed === true) report('signed_out')
      return
    }
    case 'sign_in':
      await signInView({ contents, origin, apiKey, env })
  }
}

const running = new Map<WebContents, { again: boolean }>()

export async function reconcileCloudViewSession(contents: WebContents): Promise<void> {
  const current = running.get(contents)
  if (current) {
    current.again = true
    return
  }
  const run = { again: true }
  running.set(contents, run)
  try {
    while (run.again && !contents.isDestroyed()) {
      run.again = false
      try {
        await reconcileOnce(contents)
      } catch (err) {
        report('failed', { reason: mainTelemetry.bucketError(String(err)) })
      }
    }
  } finally {
    running.delete(contents)
  }
}
