/** Why a browser sign-in failed, as a code safe to report: never the IdP's or server's text. */
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
  /** The token endpoint's RFC 6749 `error` code, for decisions only: never report it. */
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

/** OAuth `error` codes (RFC 6749 section 4.1.2.1) that mean the person declined. */
const DECLINED_OAUTH_ERRORS: ReadonlySet<string> = new Set(['access_denied'])

export function idpCallbackFailure(oauthError: string): SignInFailure {
  return new SignInFailure(
    oauthError,
    DECLINED_OAUTH_ERRORS.has(oauthError) ? 'cancelled' : 'idp_error'
  )
}
