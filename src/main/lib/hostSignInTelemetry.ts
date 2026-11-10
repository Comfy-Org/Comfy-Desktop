import type { ComfyDesktop2AuthState } from '../../types/comfyDesktopBridge'
import { SignInFailure } from '../cloud/signInFailure'
import type { SignInFailureReason } from '../cloud/signInFailure'
import * as mainTelemetry from './telemetry'

export const HOST_SIGN_IN_EVENT = 'comfy.desktop.auth.host_sign_in'

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
