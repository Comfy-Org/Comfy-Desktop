export type SignInFailureReason =
  | 'cancelled'
  | 'timeout'
  | 'idp_error'
  | 'server_error'
  | 'network'
  | 'browser_unavailable'

export class SignInFailure extends Error {
  override readonly name = 'SignInFailure'
  readonly reason: SignInFailureReason
  readonly httpStatus: number | undefined
  readonly oauthError: string | undefined

  constructor(
    message: string,
    reason: SignInFailureReason,
    options: { httpStatus?: number; oauthError?: string; cause?: unknown } = {}
  ) {
    super(message, { cause: options.cause })
    this.reason = reason
    this.httpStatus = options.httpStatus
    this.oauthError = options.oauthError
  }
}

const DECLINED_OAUTH_ERRORS: ReadonlySet<string> = new Set(['access_denied'])

export function idpCallbackFailure(oauthError: string): SignInFailure {
  return new SignInFailure(
    oauthError,
    DECLINED_OAUTH_ERRORS.has(oauthError) ? 'cancelled' : 'idp_error',
    { oauthError }
  )
}

const REPORTABLE_OAUTH_ERRORS: ReadonlySet<string> = new Set([
  'access_denied',
  'invalid_client',
  'invalid_grant',
  'invalid_request',
  'invalid_resource',
  'invalid_scope',
  'invalid_target',
  'login_required',
  'server_error',
  'temporarily_unavailable',
  'unauthorized_client',
  'unsupported_grant_type',
  'unsupported_response_type'
])
const UNLISTED_OAUTH_ERROR = 'other'

export interface SignInFailureReport {
  reason: SignInFailureReason | 'unknown'
  http_status?: number
  oauth_error?: string
}

export function signInFailureReport(error: unknown): SignInFailureReport {
  if (!(error instanceof SignInFailure)) return { reason: 'unknown' }
  const { reason, httpStatus, oauthError } = error
  return {
    reason,
    ...(httpStatus === undefined ? {} : { http_status: httpStatus }),
    ...(oauthError === undefined
      ? {}
      : {
          oauth_error: REPORTABLE_OAUTH_ERRORS.has(oauthError) ? oauthError : UNLISTED_OAUTH_ERROR
        })
  }
}
