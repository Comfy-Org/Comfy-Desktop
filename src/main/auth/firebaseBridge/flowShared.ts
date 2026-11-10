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
  error_status?: number
  retried_poll_errors?: number
}

export function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

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
  const status = (error as { status?: unknown }).status
  if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599) {
    failure.error_status = status
  }
  mainTelemetry.emit('comfy.desktop.auth.sign_in_failed', failure)
  return failure
}

function verifiedIdentityFromUser(user: Record<string, unknown>): {
  uid: string
  properties: Record<string, string | number>
} | null {
  const uid = typeof user.uid === 'string' && user.uid.length > 0 ? user.uid : null
  if (!uid) return null
  const email = typeof user.email === 'string' && user.email.length > 0 ? user.email : null
  const at = email ? email.lastIndexOf('@') : -1
  const emailDomain = at >= 0 ? email!.slice(at + 1).toLowerCase() : null
  const properties: Record<string, string | number> = {
    signed_in_via: 'desktop_2',
    signed_in_at_ms: Date.now()
  }
  if (email) properties.email = email
  if (emailDomain) properties.email_domain = emailDomain
  return { uid, properties }
}

export function bindSignedInUser(
  user: Record<string, unknown>,
  source: WebContents,
  attribution: mainTelemetry.TelemetryContext | null = null
): void {
  try {
    const identity = verifiedIdentityFromUser(user)
    if (!identity) return
    bindMainVerifiedFirebaseUser(identity.uid, identity.properties, source, attribution)
  } catch {}
}

export interface HandleFirebasePopupOpts {
  parentWindow?: BrowserWindow
  onError?: (failure: SignInFailureContext) => void
}

export const POST_SIGNIN_HOLD_MS = 3000
