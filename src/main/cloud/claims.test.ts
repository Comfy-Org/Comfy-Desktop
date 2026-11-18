import { describe, expect, it } from 'vitest'
import {
  canMintWorkspaceTokens,
  holdsPartnerNodeScope,
  identityOf,
  statusFromAccessToken,
  subjectOf,
  workspaceIdOf
} from './claims'

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

  it.each<[string, unknown, boolean, boolean]>([
    [
      'both scopes',
      'comfy-cloud:user:read comfy-cloud:jobs:write comfy-cloud:workspace-token:mint',
      true,
      true
    ],
    ['only the mint scope', 'comfy-cloud:user:read comfy-cloud:workspace-token:mint', true, false],
    ['only the partner-node scope', 'comfy-cloud:jobs:write', false, true],
    ['a scope that only starts like one', 'comfy-cloud:jobs:write:all', false, false],
    ['no scope claim', undefined, false, false],
    ['a scope claim that is not text', ['comfy-cloud:jobs:write'], false, false]
  ])('reads the mint and partner-node scopes from %s', (_name, scope, canMint, partnerNode) => {
    const token = jwt({ sub: 'u-1', scope })

    expect(canMintWorkspaceTokens(token)).toBe(canMint)
    expect(holdsPartnerNodeScope(token)).toBe(partnerNode)
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
})
