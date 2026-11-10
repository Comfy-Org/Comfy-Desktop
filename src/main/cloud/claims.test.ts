// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  canMintPartnerNodeTokens,
  identityOf,
  statusFromAccessToken,
  subjectOf,
  workspaceIdOf
} from './claims'
import { CLOUD_CONFIG, WORKSPACE_MINT_SCOPE } from './config'

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'RS256' })}.${b64(payload)}.sig`
}

describe('claims', () => {
  it('decodes identity + workspace from an access token', () => {
    const s = statusFromAccessToken(
      jwt({ email: 'a@b.co', workspace_id: 'w-9', workspace_type: 'team', role: 'owner' })
    )
    expect(s).toEqual({
      signedIn: true,
      email: 'a@b.co',
      workspaceId: 'w-9',
      workspaceType: 'team',
      role: 'owner'
    })
  })

  it('a malformed token is still signed in, identity unset', () => {
    expect(statusFromAccessToken('not-a-jwt')).toEqual({
      signedIn: true,
      email: undefined,
      workspaceId: undefined,
      workspaceType: undefined,
      role: undefined
    })
  })

  it('workspaceIdOf reads the scope', () => {
    expect(workspaceIdOf(jwt({ workspace_id: 'w-42' }))).toBe('w-42')
    expect(workspaceIdOf('garbage')).toBeNull()
  })

  it('subjectOf reads the account identity', () => {
    expect(subjectOf(jwt({ sub: 'user-7' }))).toBe('user-7')
    expect(subjectOf('garbage')).toBeNull()
  })

  it('reads the identity the hosted view needs, or null without a subject', () => {
    expect(identityOf(jwt({ sub: 'u-1', email: 'a@b.co', workspace_id: 'w-9' }))).toEqual({
      userId: 'u-1',
      email: 'a@b.co',
      workspaceId: 'w-9'
    })
    expect(identityOf(jwt({ sub: 'u-1' }))).toEqual({ userId: 'u-1' })
    expect(identityOf(jwt({ email: 'a@b.co' }))).toBeNull()
    expect(identityOf('not-a-jwt')).toBeNull()
  })

  it.each([
    ['a grant from a sign-in Desktop requests today', CLOUD_CONFIG.scope, true],
    ['a grant from before jobs:write', `comfy-cloud:user:read ${WORKSPACE_MINT_SCOPE}`, false],
    ['a grant without the mint scope', 'comfy-cloud:user:read comfy-cloud:jobs:write', false],
    ['a token with no scope', undefined, false]
  ])('canMintPartnerNodeTokens for %s', (_name, scope, expected) => {
    expect(canMintPartnerNodeTokens(jwt({ sub: 'u', ...(scope ? { scope } : {}) }))).toBe(expected)
  })
})
