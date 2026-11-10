// @vitest-environment node
import { Buffer } from 'node:buffer'

import type { WebContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../devplatform/session', () => ({ getCloudSession: () => ({}) }))
vi.mock('./telemetry', () => ({ emit: vi.fn() }))

import { CLOUD_CONFIG, WORKSPACE_MINT_SCOPE } from '../cloud/config'
import type { WorkspaceTokenMint } from '../cloud/workspaceToken'
import * as mainTelemetry from './telemetry'
import {
  VIEW_TOKEN_MINT_FAILED_EVENT,
  VIEW_TOKEN_MINTED_EVENT,
  ViewWorkspaceGrants
} from './viewWorkspaceGrants'

function jwt(claims: Record<string, unknown>): string {
  const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${b64({ alg: 'ES256' })}.${b64(claims)}.sig`
}

function accessToken(workspaceId: string, scope: string = CLOUD_CONFIG.scope): string {
  return jwt({ sub: user, workspace_id: workspaceId, scope })
}

function mintedToken(workspaceId: string): string {
  return jwt({ sub: user, workspace_id: workspaceId })
}

function staleToken(workspaceId: string): string {
  return jwt({ sub: user, workspace_id: workspaceId, stale: true })
}

function minted(workspaceId: string): WorkspaceTokenMint {
  return {
    kind: 'minted',
    token: mintedToken(workspaceId),
    expiresAt: Date.now() + 15 * 60_000
  }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const viewA = { id: 'a' } as unknown as WebContents
const viewB = { id: 'b' } as unknown as WebContents

let current: string | null
let user: string
let generation: number
let mint: ReturnType<
  typeof vi.fn<(token: string, workspaceId: string) => Promise<WorkspaceTokenMint>>
>
let grants: ViewWorkspaceGrants

function signInAt(workspaceId: string | null): void {
  current = workspaceId
  generation += 1
}

function grantSession(
  getGrantAccessToken: () => Promise<string | null>
): ConstructorParameters<typeof ViewWorkspaceGrants>[0] {
  return {
    currentWorkspaceId: () => current,
    currentSubject: () => (current ? user : null),
    currentGrantFamily: () => null,
    currentAuthGeneration: () => generation,
    getGrantAccessToken,
    isWorkspaceMintAllowed: async () => true
  }
}

beforeEach(() => {
  vi.mocked(mainTelemetry.emit).mockClear()
  user = 'user-1'
  generation = 0
  signInAt('ws-1')
  mint = vi.fn(async (_token: string, workspaceId: string) => minted(workspaceId))
  grants = new ViewWorkspaceGrants(
    grantSession(async () => (current ? accessToken('ws-1') : null)),
    mint
  )
})

describe('ViewWorkspaceGrants', () => {
  it('reports one minted event for views sharing a mint and none for a cached token', async () => {
    await Promise.all([grants.tokenFor(viewA, 'ws-1'), grants.tokenFor(viewB, 'ws-1')])
    await grants.tokenFor(viewA, 'ws-1')

    expect(vi.mocked(mainTelemetry.emit).mock.calls).toEqual([[VIEW_TOKEN_MINTED_EVENT]])
  })

  it.each([
    [{ kind: 'failed', status: 403 } as const, { reason: 'http', http_status: 403 }],
    [{ kind: 'failed', status: null } as const, { reason: 'network' }]
  ])('reports a failed mint %j', async (result, properties) => {
    mint.mockResolvedValueOnce(result)

    expect(await grants.tokenFor(viewA, 'ws-1')).toBeNull()

    expect(mainTelemetry.emit).toHaveBeenCalledWith(VIEW_TOKEN_MINT_FAILED_EVENT, properties)
  })

  it('hands a view the minted token for the workspace Desktop started in, never the access token', async () => {
    const token = await grants.tokenFor(viewA, 'ws-1')

    expect(token).toBe(mintedToken('ws-1'))
    expect(mint).toHaveBeenCalledWith(accessToken('ws-1'), 'ws-1')
  })

  it('mints a workspace other than the grant anchor from the grant token', async () => {
    grants.allowView(viewA, 'ws-2')
    signInAt('ws-2')

    await expect(grants.tokenFor(viewA, 'ws-2')).resolves.toBe(mintedToken('ws-2'))
    expect(mint).toHaveBeenCalledExactlyOnceWith(accessToken('ws-1'), 'ws-2')
  })

  it.each<[string, () => string]>([
    ['another workspace', () => jwt({ sub: user, workspace_id: 'ws-9' })],
    ['another account', () => jwt({ sub: 'user-9', workspace_id: 'ws-1' })],
    ['a token with no claims', () => 'opaque-token']
  ])('refuses and does not cache a minted token for %s', async (_name, token) => {
    mint.mockResolvedValueOnce({ kind: 'minted', token: token(), expiresAt: Date.now() + 900_000 })

    await expect(grants.tokenFor(viewA, 'ws-1')).resolves.toBeNull()
    await expect(grants.tokenFor(viewA, 'ws-1')).resolves.toBe(mintedToken('ws-1'))

    expect(mint).toHaveBeenCalledTimes(2)
  })

  it('reuses a minted token until it nears expiry', async () => {
    await grants.tokenFor(viewA, 'ws-1')
    await grants.tokenFor(viewB, 'ws-1')

    expect(mint).toHaveBeenCalledOnce()
  })

  it('mints once for concurrent requests', async () => {
    const tokens = await Promise.all([
      grants.tokenFor(viewA, 'ws-1'),
      grants.tokenFor(viewA, 'ws-1')
    ])

    expect(tokens).toEqual([mintedToken('ws-1'), mintedToken('ws-1')])
    expect(mint).toHaveBeenCalledOnce()
  })

  it('refuses a workspace that is not Desktop current one', async () => {
    await expect(grants.tokenFor(viewA, 'ws-2')).resolves.toBeNull()
    expect(mint).not.toHaveBeenCalled()
  })

  it('gives a view a workspace it switched to, but not a view that did not', async () => {
    grants.allowView(viewA, 'ws-2')
    signInAt('ws-2')

    await expect(grants.tokenFor(viewA, 'ws-2')).resolves.toBe(mintedToken('ws-2'))
    await expect(grants.tokenFor(viewB, 'ws-2')).resolves.toBeNull()
  })

  it('gives every view a workspace Desktop UI chose', async () => {
    grants.allowDesktop('ws-2')
    signInAt('ws-2')

    await expect(grants.tokenFor(viewA, 'ws-2')).resolves.toBe(mintedToken('ws-2'))
    await expect(grants.tokenFor(viewB, 'ws-2')).resolves.toBe(mintedToken('ws-2'))
  })

  it('stops handing out a workspace once the view moved on', async () => {
    grants.allowView(viewA, 'ws-2')
    signInAt('ws-2')
    await grants.tokenFor(viewA, 'ws-2')
    grants.allowView(viewA, 'ws-3')
    signInAt('ws-3')

    await expect(grants.tokenFor(viewA, 'ws-2')).resolves.toBeNull()
  })

  it('drops a mint reply that lands after a newer switch', async () => {
    const reply = deferred<WorkspaceTokenMint>()
    mint.mockReturnValueOnce(reply.promise)
    const pending = grants.tokenFor(viewA, 'ws-1')
    grants.allowView(viewA, 'ws-2')
    signInAt('ws-2')
    reply.resolve(minted('ws-1'))

    await expect(pending).resolves.toBeNull()
  })

  it('T-V27: drops a mint reply for A that lands after A to B to A, and does not cache it', async () => {
    grants.allowView(viewA, 'ws-2')
    const stale = deferred<WorkspaceTokenMint>()
    mint.mockReturnValueOnce(stale.promise)
    const pending = grants.tokenFor(viewA, 'ws-1')
    await vi.waitFor(() => expect(mint).toHaveBeenCalledOnce())
    signInAt('ws-2')
    signInAt('ws-1')
    stale.resolve({
      kind: 'minted',
      token: staleToken('ws-1'),
      expiresAt: Date.now() + 15 * 60_000
    })

    await expect(pending).resolves.toBeNull()
    await expect(grants.tokenFor(viewA, 'ws-1')).resolves.toBe(mintedToken('ws-1'))
    expect(mint).toHaveBeenCalledTimes(2)
  })

  it('T-V27: a request after A to B to A does not join the mint from before the switch', async () => {
    const stale = deferred<WorkspaceTokenMint>()
    mint.mockReturnValueOnce(stale.promise)
    const older = grants.tokenFor(viewA, 'ws-1')
    await vi.waitFor(() => expect(mint).toHaveBeenCalledOnce())
    signInAt('ws-2')
    signInAt('ws-1')

    await expect(grants.tokenFor(viewA, 'ws-1')).resolves.toBe(mintedToken('ws-1'))
    stale.resolve({
      kind: 'minted',
      token: staleToken('ws-1'),
      expiresAt: Date.now() + 15 * 60_000
    })

    await expect(older).resolves.toBeNull()
    await expect(grants.tokenFor(viewA, 'ws-1')).resolves.toBe(mintedToken('ws-1'))
    expect(mint).toHaveBeenCalledTimes(2)
  })

  it('drops a grant read that lands after A to B to A', async () => {
    const slowRead = deferred<string | null>()
    grants = new ViewWorkspaceGrants(
      grantSession(() => slowRead.promise),
      mint
    )
    const pending = grants.tokenFor(viewA, 'ws-1')
    signInAt('ws-2')
    signInAt('ws-1')
    slowRead.resolve(accessToken('ws-1'))

    await expect(pending).resolves.toBeNull()
    expect(mint).not.toHaveBeenCalled()
  })

  it('drops a mint reply that lands after sign-out, and forgets its token', async () => {
    const reply = deferred<WorkspaceTokenMint>()
    mint.mockReturnValueOnce(reply.promise)
    const pending = grants.tokenFor(viewA, 'ws-1')
    await vi.waitFor(() => expect(mint).toHaveBeenCalledOnce())
    signInAt(null)
    grants.endAll()
    reply.resolve(minted('ws-1'))

    await expect(pending).resolves.toBeNull()
    signInAt('ws-1')
    grants.allowDesktop('ws-1')
    await grants.tokenFor(viewA, 'ws-1')
    expect(mint).toHaveBeenCalledTimes(2)
  })

  it('forgets every view allowlist at sign-out', async () => {
    grants.allowView(viewA, 'ws-2')
    grants.endAll()
    signInAt('ws-2')

    await expect(grants.tokenFor(viewA, 'ws-2')).resolves.toBeNull()
  })

  it.each<[string, number | null]>([
    ['a refused grant', 403],
    ['an SSO-enforced workspace', 403],
    ['an unavailable workspace', 404],
    ['a rate limit', 429],
    ['a server error', 503],
    ['a network error', null]
  ])('hands out nothing after %s', async (_name, status) => {
    mint.mockResolvedValue({ kind: 'failed', status })

    await expect(grants.tokenFor(viewA, 'ws-1')).resolves.toBeNull()
  })

  it('hands out nothing, and does not ask Cloud, for a grant without the mint scope', async () => {
    grants = new ViewWorkspaceGrants(
      grantSession(async () => accessToken('ws-1', 'comfy-cloud:user:read')),
      mint
    )

    await expect(grants.tokenFor(viewA, 'ws-1')).resolves.toBeNull()
    expect(mint).not.toHaveBeenCalled()
  })

  it('never hands one account a token minted for another account in the same workspace', async () => {
    await grants.tokenFor(viewA, 'ws-1')
    user = 'user-2'

    await expect(grants.tokenFor(viewA, 'ws-1')).resolves.toBe(mintedToken('ws-1'))
    expect(mint).toHaveBeenCalledTimes(2)
    expect(mint).toHaveBeenLastCalledWith(accessToken('ws-1'), 'ws-1')
  })

  it('does not let a request from before sign-out start a mint the next session joins', async () => {
    const before = deferred<string | null>()
    let reads = 0
    grants = new ViewWorkspaceGrants(
      grantSession(() => (reads++ === 0 ? before.promise : Promise.resolve(accessToken('ws-1')))),
      mint
    )
    const stale = grants.tokenFor(viewA, 'ws-1')
    const firstUserToken = accessToken('ws-1')
    await vi.waitFor(() => expect(reads).toBe(1))
    grants.endAll()
    grants.allowDesktop('ws-1')
    user = 'user-2'
    before.resolve(firstUserToken)

    await expect(stale).resolves.toBeNull()
    await expect(grants.tokenFor(viewA, 'ws-1')).resolves.toBe(mintedToken('ws-1'))
    expect(mint).toHaveBeenCalledOnce()
    expect(mint).toHaveBeenCalledWith(accessToken('ws-1'), 'ws-1')
  })

  it('drops a mint reply that lands after another account signed in to the same workspace', async () => {
    const reply = deferred<WorkspaceTokenMint>()
    mint.mockReturnValueOnce(reply.promise)
    const pending = grants.tokenFor(viewA, 'ws-1')
    await vi.waitFor(() => expect(mint).toHaveBeenCalledOnce())
    user = 'user-2'
    reply.resolve(minted('ws-1'))

    await expect(pending).resolves.toBeNull()
    await grants.tokenFor(viewA, 'ws-1')
    expect(mint).toHaveBeenCalledTimes(2)
  })

  it('does not hand a cached token to an account that signed in while it was being read', async () => {
    const firstUserToken = accessToken('ws-1')
    const slowRead = deferred<string | null>()
    let reads = 0
    grants = new ViewWorkspaceGrants(
      grantSession(() => (reads++ === 0 ? Promise.resolve(firstUserToken) : slowRead.promise)),
      mint
    )
    await grants.tokenFor(viewA, 'ws-1')
    const pending = grants.tokenFor(viewA, 'ws-1')
    user = 'user-2'
    slowRead.resolve(firstUserToken)

    await expect(pending).resolves.toBeNull()
    expect(mint).toHaveBeenCalledOnce()
  })
})

describe('ViewWorkspaceGrants partner-node tokens', () => {
  let partnerMint: ReturnType<
    typeof vi.fn<(token: string, workspaceId: string) => Promise<WorkspaceTokenMint>>
  >
  let partnerRenew: ReturnType<typeof vi.fn<(token: string) => Promise<WorkspaceTokenMint>>>
  let mintScopeAllowed: boolean

  function partnerToken(workspaceId: string, session = 'sid-1', round = 0): string {
    return jwt({
      sub: user,
      workspace_id: workspaceId,
      aud: 'comfy-partner-node',
      sid: session,
      round
    })
  }

  function partnerMinted(token: string, lifetimeMs = 90 * 60_000): WorkspaceTokenMint {
    return { kind: 'minted', token, expiresAt: Date.now() + lifetimeMs }
  }

  function build(scope: string = CLOUD_CONFIG.scope): ViewWorkspaceGrants {
    return new ViewWorkspaceGrants(
      {
        ...grantSession(async () => (current ? accessToken('ws-1', scope) : null)),
        isWorkspaceMintAllowed: async () => mintScopeAllowed
      },
      mint,
      { mint: partnerMint, renew: partnerRenew }
    )
  }

  beforeEach(() => {
    mintScopeAllowed = true
    partnerMint = vi.fn(async (_token: string, workspaceId: string) =>
      partnerMinted(partnerToken(workspaceId))
    )
    partnerRenew = vi.fn(async () => partnerMinted(partnerToken('ws-1', 'sid-1', 1)))
    grants = build()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('T-V7: hands the view a partner-node token minted from the grant, never the grant or the workspace token', async () => {
    const token = await grants.partnerNodeTokenFor(viewA, 'ws-1')

    expect(token).toBe(partnerToken('ws-1'))
    expect(token).not.toBe(accessToken('ws-1'))
    expect(token).not.toBe(mintedToken('ws-1'))
    expect(partnerMint).toHaveBeenCalledExactlyOnceWith(accessToken('ws-1'), 'ws-1')
    expect(mint).not.toHaveBeenCalled()
  })

  it('T-V6: a view switched to B gets a partner-node token for B, and a view that did not switch gets none', async () => {
    await grants.partnerNodeTokenFor(viewA, 'ws-1')
    grants.allowView(viewA, 'ws-2')
    signInAt('ws-2')

    await expect(grants.partnerNodeTokenFor(viewA, 'ws-2')).resolves.toBe(partnerToken('ws-2'))
    await expect(grants.partnerNodeTokenFor(viewB, 'ws-2')).resolves.toBeNull()
    await expect(grants.partnerNodeTokenFor(viewA, 'ws-1')).resolves.toBeNull()
    expect(partnerMint).toHaveBeenLastCalledWith(accessToken('ws-1'), 'ws-2')
  })

  it('mints once for concurrent requests and reuses the token while it has over an hour left', async () => {
    await Promise.all([
      grants.partnerNodeTokenFor(viewA, 'ws-1'),
      grants.partnerNodeTokenFor(viewB, 'ws-1')
    ])
    await grants.partnerNodeTokenFor(viewA, 'ws-1')

    expect(partnerMint).toHaveBeenCalledOnce()
    expect(partnerRenew).not.toHaveBeenCalled()
  })

  it('renews in the same session before expiry and hands the view only the renewed token', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    await grants.partnerNodeTokenFor(viewA, 'ws-1')
    vi.setSystemTime(Date.now() + 31 * 60_000)

    await expect(grants.partnerNodeTokenFor(viewA, 'ws-1')).resolves.toBe(
      partnerToken('ws-1', 'sid-1', 1)
    )
    await grants.partnerNodeTokenFor(viewA, 'ws-1')

    expect(partnerRenew).toHaveBeenCalledExactlyOnceWith(partnerToken('ws-1'))
    expect(partnerMint).toHaveBeenCalledOnce()
  })

  it.each<[string, () => WorkspaceTokenMint]>([
    [
      'a session that ended',
      () => ({ kind: 'failed', status: 403, code: 'partner_node_session_ended' })
    ],
    [
      'a revoked session',
      () => ({ kind: 'failed', status: 403, code: 'partner_node_session_revoked' })
    ],
    ['an unknown session', () => ({ kind: 'failed', status: 401 })],
    [
      'a session in its last hour',
      () => partnerMinted(partnerToken('ws-1', 'sid-1', 1), 20 * 60_000)
    ]
  ])('starts a new session after %s', async (_name, renewal) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    await grants.partnerNodeTokenFor(viewA, 'ws-1')
    vi.setSystemTime(Date.now() + 31 * 60_000)
    partnerRenew.mockResolvedValueOnce(renewal())
    partnerMint.mockResolvedValueOnce(partnerMinted(partnerToken('ws-1', 'sid-2')))

    await expect(grants.partnerNodeTokenFor(viewA, 'ws-1')).resolves.toBe(
      partnerToken('ws-1', 'sid-2')
    )
    expect(partnerMint).toHaveBeenCalledTimes(2)
  })

  it('drops the held token when its session was refused and no new session could start', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    await grants.partnerNodeTokenFor(viewA, 'ws-1')
    vi.setSystemTime(Date.now() + 31 * 60_000)
    partnerRenew.mockResolvedValueOnce({
      kind: 'failed',
      status: 403,
      code: 'partner_node_session_ended'
    })
    partnerMint.mockResolvedValueOnce({ kind: 'failed', status: 401, code: 'oauth_grant_ended' })

    await expect(grants.partnerNodeTokenFor(viewA, 'ws-1')).resolves.toBeNull()
  })

  it.each<[string, number | null]>([
    ['a network error', null],
    ['a rate limit', 429],
    ['a server error', 503]
  ])(
    'hands out nothing when the session was refused and the new mint met %s',
    async (_name, status) => {
      vi.useFakeTimers({ toFake: ['Date'] })
      await grants.partnerNodeTokenFor(viewA, 'ws-1')
      vi.setSystemTime(Date.now() + 31 * 60_000)
      partnerRenew.mockResolvedValueOnce({
        kind: 'failed',
        status: 403,
        code: 'partner_node_session_revoked'
      })
      partnerMint.mockResolvedValueOnce({ kind: 'failed', status })

      await expect(grants.partnerNodeTokenFor(viewA, 'ws-1')).resolves.toBeNull()
      await expect(grants.partnerNodeTokenFor(viewA, 'ws-1')).resolves.toBeNull()
    }
  )

  it.each<[string, number | null]>([
    ['a rate limit', 429],
    ['a server error', 500],
    ['a network error', null]
  ])('keeps handing out the current token after %s on renewal', async (_name, status) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    await grants.partnerNodeTokenFor(viewA, 'ws-1')
    vi.setSystemTime(Date.now() + 31 * 60_000)
    partnerRenew.mockResolvedValueOnce({ kind: 'failed', status })

    await expect(grants.partnerNodeTokenFor(viewA, 'ws-1')).resolves.toBe(partnerToken('ws-1'))
    expect(partnerMint).toHaveBeenCalledOnce()
  })

  it.each<[string, WorkspaceTokenMint]>([
    ['the mint switched off', { kind: 'failed', status: 503, code: 'partner_node_token_disabled' }],
    ['a client not allowed', { kind: 'failed', status: 403, code: 'oauth_token_mint_refused' }],
    ['a grant without jobs:write', { kind: 'failed', status: 403, code: 'insufficient_scope' }],
    ['a network error', { kind: 'failed', status: null }]
  ])(
    'hands out nothing after %s, so the view keeps the workspace token',
    async (_name, refusal) => {
      partnerMint.mockResolvedValueOnce(refusal)

      await expect(grants.partnerNodeTokenFor(viewA, 'ws-1')).resolves.toBeNull()
      await expect(grants.tokenFor(viewA, 'ws-1')).resolves.toBe(mintedToken('ws-1'))
    }
  )

  it('hands out nothing, and does not ask Cloud, for a grant from before jobs:write', async () => {
    grants = build(`comfy-cloud:user:read ${WORKSPACE_MINT_SCOPE}`)

    await expect(grants.partnerNodeTokenFor(viewA, 'ws-1')).resolves.toBeNull()
    await expect(grants.tokenFor(viewA, 'ws-1')).resolves.toBe(mintedToken('ws-1'))
    expect(partnerMint).not.toHaveBeenCalled()
  })

  it('hands out nothing for another workspace while the mint switch is off', async () => {
    mintScopeAllowed = false

    await expect(grants.partnerNodeTokenFor(viewA, 'ws-1')).resolves.toBeNull()
    expect(partnerMint).not.toHaveBeenCalled()
  })

  it.each<[string, () => string]>([
    ['another workspace', () => partnerToken('ws-9')],
    ['another account', () => jwt({ sub: 'user-9', workspace_id: 'ws-1', sid: 'sid-1' })]
  ])('refuses a partner-node token minted for %s', async (_name, token) => {
    partnerMint.mockResolvedValueOnce(partnerMinted(token()))

    await expect(grants.partnerNodeTokenFor(viewA, 'ws-1')).resolves.toBeNull()
  })

  it('T-V27: drops a mint reply that lands after a switch to B', async () => {
    const reply = deferred<WorkspaceTokenMint>()
    partnerMint.mockReturnValueOnce(reply.promise)
    const pending = grants.partnerNodeTokenFor(viewA, 'ws-1')
    await vi.waitFor(() => expect(partnerMint).toHaveBeenCalledOnce())
    grants.allowView(viewA, 'ws-2')
    signInAt('ws-2')
    reply.resolve(partnerMinted(partnerToken('ws-1')))

    await expect(pending).resolves.toBeNull()
  })

  it('T-V27: drops a mint reply that lands after sign-out, and does not keep its token', async () => {
    const reply = deferred<WorkspaceTokenMint>()
    partnerMint.mockReturnValueOnce(reply.promise)
    const pending = grants.partnerNodeTokenFor(viewA, 'ws-1')
    await vi.waitFor(() => expect(partnerMint).toHaveBeenCalledOnce())
    signInAt(null)
    grants.endAll()
    reply.resolve(partnerMinted(partnerToken('ws-1', 'stale')))

    await expect(pending).resolves.toBeNull()
    signInAt('ws-1')
    grants.allowDesktop('ws-1')
    await expect(grants.partnerNodeTokenFor(viewA, 'ws-1')).resolves.toBe(partnerToken('ws-1'))
    expect(partnerMint).toHaveBeenCalledTimes(2)
  })

  it('T-V28: drops a renewal that lands after sign-out, and does not renew a token from before it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    await grants.partnerNodeTokenFor(viewA, 'ws-1')
    vi.setSystemTime(Date.now() + 31 * 60_000)
    const renewal = deferred<WorkspaceTokenMint>()
    partnerRenew.mockReturnValueOnce(renewal.promise)
    const pending = grants.partnerNodeTokenFor(viewA, 'ws-1')
    await vi.waitFor(() => expect(partnerRenew).toHaveBeenCalledOnce())
    signInAt(null)
    grants.endAll()
    renewal.resolve(partnerMinted(partnerToken('ws-1', 'sid-1', 1)))

    await expect(pending).resolves.toBeNull()
    signInAt('ws-1')
    grants.allowDesktop('ws-1')
    await expect(grants.partnerNodeTokenFor(viewA, 'ws-1')).resolves.toBe(partnerToken('ws-1'))
    expect(partnerRenew).toHaveBeenCalledOnce()
  })

  it('does not ask Cloud again until Retry-After passes after a rate-limited renewal', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    await grants.partnerNodeTokenFor(viewA, 'ws-1')
    vi.setSystemTime(Date.now() + 31 * 60_000)
    partnerRenew.mockResolvedValueOnce({ kind: 'failed', status: 429, retryAfterSeconds: 120 })
    await grants.partnerNodeTokenFor(viewA, 'ws-1')
    vi.setSystemTime(Date.now() + 90_000)

    await expect(grants.partnerNodeTokenFor(viewA, 'ws-1')).resolves.toBe(partnerToken('ws-1'))
    expect(partnerRenew).toHaveBeenCalledOnce()

    vi.setSystemTime(Date.now() + 31_000)
    await expect(grants.partnerNodeTokenFor(viewA, 'ws-1')).resolves.toBe(
      partnerToken('ws-1', 'sid-1', 1)
    )
    expect(partnerRenew).toHaveBeenCalledTimes(2)
  })

  it('does not ask Cloud again for a minute after a refused mint', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    partnerMint.mockResolvedValueOnce({
      kind: 'failed',
      status: 503,
      code: 'partner_node_token_disabled'
    })
    await grants.partnerNodeTokenFor(viewA, 'ws-1')

    await expect(grants.partnerNodeTokenFor(viewA, 'ws-1')).resolves.toBeNull()
    expect(partnerMint).toHaveBeenCalledOnce()

    vi.setSystemTime(Date.now() + 61_000)
    await expect(grants.partnerNodeTokenFor(viewA, 'ws-1')).resolves.toBe(partnerToken('ws-1'))
    expect(partnerMint).toHaveBeenCalledTimes(2)
  })

  it.each<[string, WorkspaceTokenMint, string | null]>([
    ['refused', { kind: 'failed', status: 403, code: 'oauth_token_mint_refused' }, null],
    ['switched off', { kind: 'failed', status: 503, code: 'partner_node_token_disabled' }, null],
    ['unreachable', { kind: 'failed', status: null }, 'held']
  ])(
    'does not hand out a last-hour renewal when the new session is %s',
    async (_name, refusal, expected) => {
      vi.useFakeTimers({ toFake: ['Date'] })
      await grants.partnerNodeTokenFor(viewA, 'ws-1')
      vi.setSystemTime(Date.now() + 31 * 60_000)
      partnerRenew.mockResolvedValueOnce(
        partnerMinted(partnerToken('ws-1', 'sid-1', 1), 20 * 60_000)
      )
      partnerMint.mockResolvedValueOnce(refusal)

      await expect(grants.partnerNodeTokenFor(viewA, 'ws-1')).resolves.toBe(
        expected === 'held' ? partnerToken('ws-1') : null
      )
    }
  )

  it('does not start a new session for a renewal refused after sign-out', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    await grants.partnerNodeTokenFor(viewA, 'ws-1')
    vi.setSystemTime(Date.now() + 31 * 60_000)
    const renewal = deferred<WorkspaceTokenMint>()
    partnerRenew.mockReturnValueOnce(renewal.promise)
    const pending = grants.partnerNodeTokenFor(viewA, 'ws-1')
    await vi.waitFor(() => expect(partnerRenew).toHaveBeenCalledOnce())
    signInAt(null)
    grants.endAll()
    renewal.resolve({ kind: 'failed', status: 403, code: 'partner_node_session_revoked' })

    await expect(pending).resolves.toBeNull()
    expect(partnerMint).toHaveBeenCalledOnce()
  })

  it('starts a new session when a renewal comes back already expired', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    await grants.partnerNodeTokenFor(viewA, 'ws-1')
    vi.setSystemTime(Date.now() + 31 * 60_000)
    const renewal = deferred<WorkspaceTokenMint>()
    partnerRenew.mockReturnValueOnce(renewal.promise)
    partnerMint.mockImplementationOnce(async () => partnerMinted(partnerToken('ws-1', 'sid-2')))
    const pending = grants.partnerNodeTokenFor(viewA, 'ws-1')
    await vi.waitFor(() => expect(partnerRenew).toHaveBeenCalledOnce())
    const renewed = partnerMinted(partnerToken('ws-1', 'sid-1', 1), 70 * 60_000)
    vi.setSystemTime(Date.now() + 2 * 60 * 60_000)
    renewal.resolve(renewed)

    await expect(pending).resolves.toBe(partnerToken('ws-1', 'sid-2'))
  })

  it('renews a token for A again after A to B to A, and gives B its own session', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    grants.allowView(viewA, 'ws-2')
    await grants.partnerNodeTokenFor(viewA, 'ws-1')
    signInAt('ws-2')
    await expect(grants.partnerNodeTokenFor(viewA, 'ws-2')).resolves.toBe(partnerToken('ws-2'))
    signInAt('ws-1')
    vi.setSystemTime(Date.now() + 31 * 60_000)

    await expect(grants.partnerNodeTokenFor(viewA, 'ws-1')).resolves.toBe(
      partnerToken('ws-1', 'sid-1', 1)
    )
    expect(partnerRenew).toHaveBeenCalledExactlyOnceWith(partnerToken('ws-1'))
    expect(partnerMint.mock.calls.map(([, workspaceId]) => workspaceId)).toEqual(['ws-1', 'ws-2'])
  })

  it('starts over after the same account signs in again', async () => {
    await grants.partnerNodeTokenFor(viewA, 'ws-1')
    grants.endAll()
    signInAt('ws-1')
    grants.allowDesktop('ws-1')
    partnerMint.mockResolvedValueOnce(partnerMinted(partnerToken('ws-1', 'sid-2')))

    await expect(grants.partnerNodeTokenFor(viewA, 'ws-1')).resolves.toBe(
      partnerToken('ws-1', 'sid-2')
    )
    expect(partnerRenew).not.toHaveBeenCalled()
  })

  describe('when a new sign-in replaces the grant for the same account', () => {
    let family: string

    beforeEach(() => {
      family = 'fam-1'
      grants = new ViewWorkspaceGrants(
        {
          ...grantSession(async () =>
            jwt({ sub: user, workspace_id: 'ws-1', scope: CLOUD_CONFIG.scope, fam: family })
          ),
          currentGrantFamily: () => family
        },
        mint,
        { mint: partnerMint, renew: partnerRenew }
      )
    })

    it('starts a new session instead of reusing the old grant one', async () => {
      await grants.partnerNodeTokenFor(viewA, 'ws-1')
      family = 'fam-2'
      partnerMint.mockResolvedValueOnce(partnerMinted(partnerToken('ws-1', 'sid-2')))

      await expect(grants.partnerNodeTokenFor(viewA, 'ws-1')).resolves.toBe(
        partnerToken('ws-1', 'sid-2')
      )
      expect(partnerMint).toHaveBeenCalledTimes(2)
    })

    it('drops a mint reply from the old grant that lands after the new sign-in', async () => {
      const reply = deferred<WorkspaceTokenMint>()
      partnerMint.mockReturnValueOnce(reply.promise)
      const pending = grants.partnerNodeTokenFor(viewA, 'ws-1')
      await vi.waitFor(() => expect(partnerMint).toHaveBeenCalledOnce())
      family = 'fam-2'
      reply.resolve(partnerMinted(partnerToken('ws-1', 'old-grant')))

      await expect(pending).resolves.toBeNull()
    })

    it('drops a workspace token reply from the old grant that lands after the new sign-in', async () => {
      const reply = deferred<WorkspaceTokenMint>()
      mint.mockReturnValueOnce(reply.promise)
      const pending = grants.tokenFor(viewA, 'ws-1')
      await vi.waitFor(() => expect(mint).toHaveBeenCalledOnce())
      family = 'fam-2'
      reply.resolve({ kind: 'minted', token: staleToken('ws-1'), expiresAt: Date.now() + 900_000 })

      await expect(pending).resolves.toBeNull()
      await expect(grants.tokenFor(viewA, 'ws-1')).resolves.toBe(mintedToken('ws-1'))
    })
  })

  it('forgets a token whose renewal was refused after a switch, so A to B to A does not hand it out', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    grants.allowView(viewA, 'ws-2')
    await grants.partnerNodeTokenFor(viewA, 'ws-1')
    vi.setSystemTime(Date.now() + 31 * 60_000)
    const renewal = deferred<WorkspaceTokenMint>()
    partnerRenew.mockReturnValueOnce(renewal.promise)
    const pending = grants.partnerNodeTokenFor(viewA, 'ws-1')
    await vi.waitFor(() => expect(partnerRenew).toHaveBeenCalledOnce())
    signInAt('ws-2')
    renewal.resolve({ kind: 'failed', status: 403, code: 'partner_node_session_revoked' })
    await expect(pending).resolves.toBeNull()
    signInAt('ws-1')

    await expect(grants.partnerNodeTokenFor(viewA, 'ws-1')).resolves.toBeNull()
    expect(partnerRenew).toHaveBeenCalledOnce()
    expect(partnerMint).toHaveBeenCalledOnce()
  })

  it('keeps the Retry-After of a renewal that lands after a switch, once back on A', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    grants.allowView(viewA, 'ws-2')
    await grants.partnerNodeTokenFor(viewA, 'ws-1')
    vi.setSystemTime(Date.now() + 31 * 60_000)
    const renewal = deferred<WorkspaceTokenMint>()
    partnerRenew.mockReturnValueOnce(renewal.promise)
    const pending = grants.partnerNodeTokenFor(viewA, 'ws-1')
    await vi.waitFor(() => expect(partnerRenew).toHaveBeenCalledOnce())
    signInAt('ws-2')
    renewal.resolve({ kind: 'failed', status: 429, retryAfterSeconds: 120 })
    await expect(pending).resolves.toBeNull()
    signInAt('ws-1')

    await expect(grants.partnerNodeTokenFor(viewA, 'ws-1')).resolves.toBe(partnerToken('ws-1'))
    expect(partnerRenew).toHaveBeenCalledOnce()
  })

  it('forgets the held token when a new session is refused after a switch, once back on A', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    grants.allowView(viewA, 'ws-2')
    await grants.partnerNodeTokenFor(viewA, 'ws-1')
    vi.setSystemTime(Date.now() + 31 * 60_000)
    partnerRenew.mockResolvedValueOnce(partnerMinted(partnerToken('ws-1', 'sid-1', 1), 20 * 60_000))
    const reply = deferred<WorkspaceTokenMint>()
    partnerMint.mockReturnValueOnce(reply.promise)
    const pending = grants.partnerNodeTokenFor(viewA, 'ws-1')
    await vi.waitFor(() => expect(partnerMint).toHaveBeenCalledTimes(2))
    signInAt('ws-2')
    reply.resolve({ kind: 'failed', status: 503, code: 'partner_node_token_disabled' })
    await expect(pending).resolves.toBeNull()
    signInAt('ws-1')

    await expect(grants.partnerNodeTokenFor(viewA, 'ws-1')).resolves.toBeNull()
  })

  it('keeps the longer of two retry deadlines when a shorter failure lands later', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const older = deferred<WorkspaceTokenMint>()
    partnerMint.mockReturnValueOnce(older.promise)
    grants.allowView(viewA, 'ws-2')
    const stale = grants.partnerNodeTokenFor(viewA, 'ws-1')
    await vi.waitFor(() => expect(partnerMint).toHaveBeenCalledOnce())
    signInAt('ws-2')
    signInAt('ws-1')
    partnerMint.mockResolvedValueOnce({ kind: 'failed', status: 429, retryAfterSeconds: 3600 })
    await grants.partnerNodeTokenFor(viewA, 'ws-1')
    older.resolve({ kind: 'failed', status: 503 })
    await stale
    vi.setSystemTime(Date.now() + 61_000)

    await expect(grants.partnerNodeTokenFor(viewA, 'ws-1')).resolves.toBeNull()
    expect(partnerMint).toHaveBeenCalledTimes(2)
  })

  it('keeps the held token when a renewal reply could not be read', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    await grants.partnerNodeTokenFor(viewA, 'ws-1')
    vi.setSystemTime(Date.now() + 31 * 60_000)
    partnerRenew.mockResolvedValueOnce({ kind: 'failed', status: 200 })

    await expect(grants.partnerNodeTokenFor(viewA, 'ws-1')).resolves.toBe(partnerToken('ws-1'))
    expect(partnerMint).toHaveBeenCalledOnce()
  })

  it('keeps a newer token when a refusal for the older one lands late', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    grants.allowView(viewA, 'ws-2')
    await grants.partnerNodeTokenFor(viewA, 'ws-1')
    vi.setSystemTime(Date.now() + 31 * 60_000)
    const late = deferred<WorkspaceTokenMint>()
    partnerRenew.mockReturnValueOnce(late.promise)
    const stale = grants.partnerNodeTokenFor(viewA, 'ws-1')
    await vi.waitFor(() => expect(partnerRenew).toHaveBeenCalledOnce())
    signInAt('ws-2')
    signInAt('ws-1')
    await expect(grants.partnerNodeTokenFor(viewA, 'ws-1')).resolves.toBe(
      partnerToken('ws-1', 'sid-1', 1)
    )
    late.resolve({ kind: 'failed', status: 403, code: 'partner_node_session_revoked' })
    await expect(stale).resolves.toBeNull()

    await expect(grants.partnerNodeTokenFor(viewA, 'ws-1')).resolves.toBe(
      partnerToken('ws-1', 'sid-1', 1)
    )
    expect(partnerRenew).toHaveBeenCalledTimes(2)
  })
})
