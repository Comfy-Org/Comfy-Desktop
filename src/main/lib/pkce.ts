import { createHash, randomBytes } from 'node:crypto'

export function createCodeVerifier(): string {
  return randomBytes(32).toString('base64url')
}

export function codeChallengeS256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}
