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

  constructor(
    message: string,
    reason: SignInFailureReason,
    options: { httpStatus?: number; cause?: unknown } = {}
  ) {
    super(message, { cause: options.cause })
    this.reason = reason
    this.httpStatus = options.httpStatus
  }
}

const DECLINED_OAUTH_ERRORS: ReadonlySet<string> = new Set(['access_denied'])

export function idpCallbackFailure(oauthError: string): SignInFailure {
  return new SignInFailure(
    oauthError,
    DECLINED_OAUTH_ERRORS.has(oauthError) ? 'cancelled' : 'idp_error'
  )
}
