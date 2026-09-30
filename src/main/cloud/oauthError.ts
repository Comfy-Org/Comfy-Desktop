/** A non-2xx answer from the token endpoint, with the RFC 6749 §5.2 `error` code when present. */
export class OAuthTokenError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | undefined
  ) {
    super(message)
    this.name = 'OAuthTokenError'
  }
}

/** The refresh token is dead (revoked, expired, or re-checked out by SSO policy). */
export function isGrantGone(error: unknown): boolean {
  return error instanceof OAuthTokenError && error.code === 'invalid_grant'
}

export function oauthErrorCode(body: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(body)
    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      return typeof parsed.error === 'string' ? parsed.error : undefined
    }
  } catch {
    // Not JSON: no code.
  }
  return undefined
}
