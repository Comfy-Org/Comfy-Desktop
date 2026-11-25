import { randomUUID } from 'node:crypto'
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
  type InjectOutcome,
  releaseFirebaseSessionInjection
} from '../firebaseBridge/inject'
import {
  claimPartitionSignIn,
  PARTITION_LOCK_TIMEOUT_MS,
  partitionEpoch,
  runOnPartition,
  trackPartitionCleanup
} from '../firebaseBridge/partitionCoordinator'
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
  type RemoveDesktopSessionOutcome,
  serializeMarker
} from './pageState'

export const CLOUD_VIEW_SESSION_EVENT = 'comfy.desktop.auth.cloud_view_session'

const PROD_CLOUD_ORIGIN = 'https://cloud.comfy.org'
const MAX_SUPERSEDED_RETRIES = 3
const DECLINE_RETRY_MS = 5 * 60_000
const LASTING_DECLINE_RETRY_MS = 60 * 60_000
const ENDPOINT_MISSING_STATUS = 404

const LASTING_DECLINE_CODES: ReadonlySet<string> = new Set([
  'desktop_web_session_disabled',
  'rate_limited'
])

const REPORTABLE_ERROR_CODES: ReadonlySet<string> = new Set([
  'account_outside_organization',
  'credential_unsupported',
  'desktop_web_session_disabled',
  'insufficient_scope',
  'invalid_credential',
  'invalid_token',
  'oauth_grant_ended',
  'rate_limited',
  'service_unavailable',
  'sso_required',
  'token_revoked',
  'unauthorized',
  'web_session_unavailable'
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
  if (uid && marker?.state === 'active' && marker.uid === uid) {
    if (!desktop.signedIn || desktop.sub !== marker.sub) return { kind: 'sign_out', uid }
    return desktop.fam === marker.fam
      ? { kind: 'none' }
      : { kind: 'write_marker', marker: { ...marker, fam: desktop.fam } }
  }

  if (marker && sameGrant(desktop, marker)) {
    return marker.state === 'active'
      ? { kind: 'write_marker', marker: { ...marker, state: 'declined' } }
      : { kind: 'none' }
  }
  if (uid || !desktop.signedIn) {
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

const reportedGrantOutcomes = new Set<string>()

function reportOncePerGrant(
  outcome: string,
  sub: string,
  fam: string | null,
  extra: mainTelemetry.TelemetryContext = {}
): void {
  const key = JSON.stringify([outcome, sub, fam, extra])
  if (reportedGrantOutcomes.has(key)) return
  reportedGrantOutcomes.add(key)
  report(outcome, extra)
}

const declinedGrantRetryAt = new Map<string, number>()

function grantKey(sub: string, fam: string | null): string {
  return JSON.stringify([sub, fam])
}

function declineRetryMs(status: number | null, code?: string): number {
  const lasting =
    status === ENDPOINT_MISSING_STATUS || (code !== undefined && LASTING_DECLINE_CODES.has(code))
  return lasting ? LASTING_DECLINE_RETRY_MS : DECLINE_RETRY_MS
}

function isWaitingOutDecline(sub: string, fam: string | null): boolean {
  return (declinedGrantRetryAt.get(grantKey(sub, fam)) ?? 0) > Date.now()
}

const UNSETTLED = Symbol('unsettled')

function settledWithin<T>(work: Promise<T>, timeoutMs: number): Promise<T | typeof UNSETTLED> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(UNSETTLED), timeoutMs)
    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err: unknown) => {
        clearTimeout(timer)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    )
  })
}

function reportPageScriptTimeout(): void {
  report('failed', { reason: 'page_script_timeout' })
}

async function runPageScript(contents: WebContents, script: string): Promise<unknown> {
  const result = await settledWithin(
    contents.executeJavaScript(script, true).catch(() => null),
    PARTITION_LOCK_TIMEOUT_MS
  )
  if (result !== UNSETTLED) return result
  reportPageScriptTimeout()
  return null
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
): Promise<InjectOutcome | typeof UNSETTLED> {
  const injection = beginFirebaseSessionInjection(contents)
  try {
    return await settledWithin(
      injectFirebaseSession(injection, origin, user, apiKey, {
        onlyIfSignedOut: true,
        marker: { key: DESKTOP_SESSION_MARKER_KEY, value: serializeMarker(marker) }
      }),
      PARTITION_LOCK_TIMEOUT_MS
    )
  } finally {
    releaseFirebaseSessionInjection(injection)
  }
}

async function signInView(target: ViewTarget): Promise<void> {
  const release = claimPartitionSignIn(target.contents)
  if (!release) return
  try {
    await signInClaimedView(target)
  } finally {
    release()
  }
}

async function signInClaimedView(target: ViewTarget): Promise<void> {
  const { contents, origin, env } = target
  const session = getCloudSession()
  const generation = session.currentAuthGeneration()
  const sub = session.currentSubject()
  const fam = session.currentGrantFamily()
  const unchanged = (): boolean =>
    session.currentAuthGeneration() === generation &&
    session.currentSubject() === sub &&
    currentOrigin(contents) === origin
  if (!sub || isWaitingOutDecline(sub, fam)) return

  const accessToken = await session.getGrantAccessToken()
  if (!accessToken || !unchanged()) return
  if (!holdsWebSessionScope(accessToken)) {
    reportOncePerGrant('scope_missing', sub, fam)
    return
  }
  if (!keepsTokensInOsKeychain()) {
    reportOncePerGrant('weak_storage', sub, fam)
    return
  }

  const minted = await requestWebSessionToken(accessToken)
  if (minted.kind === 'declined') {
    declinedGrantRetryAt.set(
      grantKey(sub, fam),
      Date.now() + declineRetryMs(minted.status, minted.code)
    )
    reportOncePerGrant('declined', sub, fam, declinedReport(minted.status, minted.code))
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
  if (injected === UNSETTLED) {
    reportPageScriptTimeout()
    return
  }
  if (injected === 'marker_unsaved') {
    report('marker_unsaved')
    return
  }
  if (injected !== 'injected') {
    report('kept_existing')
    return
  }
  bindSignedInUser(user, contents, { via: 'desktop_web_session' })
  report('signed_in')
}

type SettledStep = 'done' | 'sign_in' | 'superseded'

async function removeDesktopSession(
  { contents, origin, apiKey }: ViewTarget,
  uid: string,
  marker: DesktopSessionMarker | null,
  epoch: number
): Promise<SettledStep> {
  if (partitionEpoch(contents) !== epoch || currentOrigin(contents) !== origin) return 'superseded'
  const token = randomUUID()
  const untrack = trackPartitionCleanup(contents, token)
  try {
    const outcome = (await runPageScript(
      contents,
      buildRemoveDesktopSessionScript(apiKey, origin, uid, marker, token)
    )) as RemoveDesktopSessionOutcome | null
    if (outcome === 'signed_out') report('signed_out')
    return outcome === 'superseded' ? 'superseded' : 'done'
  } finally {
    untrack()
  }
}

async function settleOnPartition(target: ViewTarget): Promise<SettledStep> {
  const { contents, origin, apiKey } = target
  const epoch = partitionEpoch(contents)
  const state = parseState(await runPageScript(contents, buildReadStateScript(apiKey, origin)))
  if (!state || currentOrigin(contents) !== origin) return 'done'

  const decision = decideCloudViewSession(state, desktopIdentity())
  switch (decision.kind) {
    case 'none':
      return 'done'
    case 'write_marker':
      await runPageScript(contents, buildWriteMarkerScript(origin, decision.marker, state.marker))
      return 'done'
    case 'sign_out':
      return await removeDesktopSession(target, decision.uid, state.marker, epoch)
    case 'sign_in':
      return 'sign_in'
  }
}

async function reconcileOnce(contents: WebContents): Promise<SettledStep> {
  if (contents.isDestroyed() || !isTrustedCloudUrl(contents.getURL())) return 'done'
  const expected = issuerOrigin()
  const origin = currentOrigin(contents)
  if (!expected || origin !== expected) return 'done'
  const env = firebaseEnvForIssuer(expected)
  const target: ViewTarget = { contents, origin, apiKey: getFirebaseConfig(env).apiKey, env }

  const step = await runOnPartition(contents, () => settleOnPartition(target))
  if (step === 'sign_in') await signInView(target)
  return step
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
  let supersededRetries = 0
  try {
    while (run.again && !contents.isDestroyed()) {
      run.again = false
      try {
        const step = await reconcileOnce(contents)
        if (step === 'superseded' && supersededRetries < MAX_SUPERSEDED_RETRIES) {
          supersededRetries += 1
          run.again = true
        }
      } catch (err) {
        report('failed', { reason: mainTelemetry.bucketError(String(err)) })
      }
    }
  } finally {
    running.delete(contents)
  }
}
