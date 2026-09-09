import { createHash, randomBytes } from 'node:crypto'

/** RFC 7636 code verifier: 32 random bytes encoded as 43 base64url characters. */
export function createCodeVerifier(): string {
  return randomBytes(32).toString('base64url')
}

/** S256 code challenge: base64url(SHA-256(verifier)). */
export function codeChallengeS256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}
