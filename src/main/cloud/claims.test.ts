// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { statusFromAccessToken, workspaceIdOf } from './claims'

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'RS256' })}.${b64(payload)}.sig`
}

describe('claims', () => {
  it('decodes identity + workspace from an access token', () => {
    const s = statusFromAccessToken(jwt({ email: 'a@b.co', workspace_id: 'w-9', workspace_type: 'team', role: 'owner' }))
    expect(s).toEqual({ signedIn: true, email: 'a@b.co', workspaceId: 'w-9', workspaceType: 'team', role: 'owner' })
  })

  it('a malformed token is still signed in, identity unset', () => {
    expect(statusFromAccessToken('not-a-jwt')).toEqual({ signedIn: true, email: undefined, workspaceId: undefined, workspaceType: undefined, role: undefined })
  })

  it('workspaceIdOf reads the scope', () => {
    expect(workspaceIdOf(jwt({ workspace_id: 'w-42' }))).toBe('w-42')
    expect(workspaceIdOf('garbage')).toBeNull()
  })
})
