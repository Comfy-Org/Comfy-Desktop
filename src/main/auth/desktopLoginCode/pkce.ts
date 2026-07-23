import { createHash, randomBytes } from 'node:crypto'

/**
 * RFC 7636 code verifier: 32 random bytes base64url-encode to 43 chars,
 * the spec's minimum length. The verifier never leaves this machine
 * except in the exchange request body.
 */
export function createCodeVerifier(): string {
  return randomBytes(32).toString('base64url')
}

/** S256 code challenge: base64url(SHA-256(verifier)). */
export function codeChallengeS256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}
