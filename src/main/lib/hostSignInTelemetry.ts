/**
 * `app:host_sign_in`: the hosted ComfyUI view's sign-in through
 * `__comfyDesktop2.Auth`, reported for the shared SSO funnel. Named in the
 * `app:` family, not `comfy.desktop.*`, so it sits beside the Cloud SSO events.
 * Carries a reason code and HTTP status only: no email, name or IdP text.
 */
import type { ComfyDesktop2AuthState } from '../../types/comfyDesktopBridge'
import { SignInFailure } from '../cloud/signInFailure'
import type { SignInFailureReason } from '../cloud/signInFailure'
import * as mainTelemetry from './telemetry'

export const HOST_SIGN_IN_EVENT = 'app:host_sign_in'

/** `superseded`: a sign-out or workspace switch replaced the sign-in before it finished. */
export type HostSignInFailureReason = SignInFailureReason | 'superseded' | 'unknown'

type HostSignInOutcome =
  | { stage: 'requested' | 'completed' }
  | { stage: 'failed'; reason: HostSignInFailureReason; httpStatus?: number }

function report(outcome: HostSignInOutcome): void {
  const properties: mainTelemetry.TelemetryContext = { stage: outcome.stage, host: 'desktop' }
  if (outcome.stage === 'failed') {
    properties.reason = outcome.reason
    if (outcome.httpStatus !== undefined) properties.http_status = outcome.httpStatus
  }
  mainTelemetry.emit(HOST_SIGN_IN_EVENT, properties)
}

function failureOf(error: unknown): HostSignInOutcome {
  if (!(error instanceof SignInFailure)) return { stage: 'failed', reason: 'unknown' }
  return { stage: 'failed', reason: error.reason, httpStatus: error.httpStatus }
}

/**
 * The sign-in a repeat request joins is still one attempt: only the request
 * that started it reports, so a second click reopens the browser page without
 * counting a second request or outcome.
 */
let attemptInFlight = false

export async function reportHostSignIn(
  signIn: () => Promise<ComfyDesktop2AuthState>
): Promise<ComfyDesktop2AuthState> {
  if (attemptInFlight) return signIn()
  attemptInFlight = true
  report({ stage: 'requested' })
  try {
    const state = await signIn()
    report(
      state.status === 'signed_in'
        ? { stage: 'completed' }
        : { stage: 'failed', reason: 'superseded' }
    )
    return state
  } catch (error) {
    report(failureOf(error))
    throw error
  } finally {
    attemptInFlight = false
  }
}
