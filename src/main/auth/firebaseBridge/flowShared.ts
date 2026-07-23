import type { BrowserWindow, WebContents } from 'electron'

import { bindMainVerifiedFirebaseUser } from '../../lib/firebaseAuthIdentity'
import * as mainTelemetry from '../../lib/telemetry'
import { extractErrorClass } from '../../../shared/errorEvent'

export type FirebaseAuthFlow = 'desktop_login_code' | 'loopback_bridge'

export interface SignInFailureContext extends mainTelemetry.TelemetryContext {
  provider: string
  error_class: string
  error_bucket: string
  flow: FirebaseAuthFlow
  /** HTTP status when the failure came from an HTTP response. */
  error_status?: number
  retried_poll_errors?: number
}

/** Origin of a URL, or null when it isn't parseable (e.g. a view with no page). */
export function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/**
 * True when `contents` is still on `expectedOrigin`. Guards the IndexedDB
 * injection, which writes the Firebase refresh token into whatever page is
 * currently loaded — a view that navigated away must never receive it.
 */
export function isOnOrigin(contents: WebContents, expectedOrigin: string): boolean {
  const current = originOf(contents.getURL())
  return current !== null && current === originOf(expectedOrigin)
}

export function emitSignInFailure(
  provider: string,
  flow: FirebaseAuthFlow,
  error: Error,
  extra: Partial<Pick<SignInFailureContext, 'retried_poll_errors'>> = {}
): SignInFailureContext {
  const failure: SignInFailureContext = {
    provider,
    error_class: extractErrorClass(error),
    error_bucket: mainTelemetry.bucketError(error.message),
    flow,
    ...extra
  }
  // The raw message stays out (it can carry response bodies), but the HTTP
  // status is not sensitive and is the only thing that separates an old
  // backend (404) from a verifier mismatch (403) from a 5xx. Without it every
  // failure collapses into one error_class/error_bucket pair.
  const status = (error as { status?: unknown }).status
  if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599) {
    failure.error_status = status
  }
  mainTelemetry.emit('comfy.desktop.auth.sign_in_failed', failure)
  return failure
}

/** Bind the anonymous installation to the resolved Firebase user. */
export function bindSignedInUser(user: Record<string, unknown>): void {
  try {
    const uid = typeof user.uid === 'string' && user.uid.length > 0 ? user.uid : null
    if (!uid) return
    const email = typeof user.email === 'string' && user.email.length > 0 ? user.email : null
    const at = email ? email.lastIndexOf('@') : -1
    const emailDomain = at >= 0 ? email!.slice(at + 1).toLowerCase() : null
    const properties: Record<string, string | number> = {
      signed_in_via: 'desktop_2',
      signed_in_at_ms: Date.now()
    }
    if (email) properties.email = email
    if (emailDomain) properties.email_domain = emailDomain
    bindMainVerifiedFirebaseUser(uid, properties)
  } catch {
    // Telemetry must never break the auth flow.
  }
}

export interface HandleFirebasePopupOpts {
  /** Window restored after sign-in completes. */
  parentWindow?: BrowserWindow
  onError?: (failure: SignInFailureContext) => void
}

/** Keep in sync with the countdown rendered by the legacy bridge page. */
export const POST_SIGNIN_HOLD_MS = 3000
