import type { BrowserWindow } from 'electron'

import * as mainTelemetry from '../../lib/telemetry'
import { extractErrorClass } from '../../../shared/errorEvent'

export function emitSignInFailure(
  provider: string,
  flow: string,
  error: Error,
  extra: Record<string, string | number> = {}
): void {
  mainTelemetry.emit('comfy.desktop.auth.sign_in_failed', {
    ...extra,
    provider,
    error_class: extractErrorClass(error),
    error_bucket: mainTelemetry.bucketError(error.message),
    flow
  })
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
    mainTelemetry.bindUserId(uid, properties)
  } catch {
    // Telemetry must never break the auth flow.
  }
}

export interface HandleFirebasePopupOpts {
  /** Window restored after sign-in completes. */
  parentWindow?: BrowserWindow
  onError?: (err: Error) => void
}

/** Keep in sync with the countdown rendered by the legacy bridge page. */
export const POST_SIGNIN_HOLD_MS = 3000
