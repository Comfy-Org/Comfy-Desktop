// @vitest-environment node
import { Buffer } from 'node:buffer'

import type { WebContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../devplatform/session', () => ({
  getCloudSession: () => ({}),
  rejectAccessToken: vi.fn()
}))
vi.mock('./telemetry', () => ({ emit: vi.fn() }))

import { CLOUD_CONFIG } from '../cloud/config'
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

function minted(workspaceId: string): WorkspaceTokenMint {
  return {
    kind: 'minted',
    token: `minted-${workspaceId}`,
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
let mint: ReturnType<
  typeof vi.fn<(token: string, workspaceId: string) => Promise<WorkspaceTokenMint>>
>
let grants: ViewWorkspaceGrants
let rejected: string[]

function signInAt(workspaceId: string | null): void {
  current = workspaceId
}

beforeEach(() => {
  vi.mocked(mainTelemetry.emit).mockClear()
  user = 'user-1'
  signInAt('ws-1')
  mint = vi.fn(async (_token: string, workspaceId: string) => minted(workspaceId))
  rejected = []
  grants = new ViewWorkspaceGrants(
    {
      currentWorkspaceId: () => current,
      currentSubject: () => (current ? user : null),
      getAccessToken: async () => (current ? accessToken(current) : null)
    },
    mint,
    (token) => rejected.push(token)
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

    expect(token).toBe('minted-ws-1')
    expect(mint).toHaveBeenCalledWith(accessToken('ws-1'), 'ws-1')
  })

  it('signs Desktop out when Cloud rejects the grant at the mint, and not for other failures', async () => {
    mint.mockResolvedValueOnce({ kind: 'failed', status: 403 })
    await grants.tokenFor(viewA, 'ws-1')
    expect(rejected).toEqual([])

    mint.mockResolvedValueOnce({ kind: 'failed', status: 401 })
    expect(await grants.tokenFor(viewA, 'ws-1')).toBeNull()

    expect(rejected).toEqual([accessToken('ws-1')])
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

    expect(tokens).toEqual(['minted-ws-1', 'minted-ws-1'])
    expect(mint).toHaveBeenCalledOnce()
  })

  it('refuses a workspace that is not Desktop current one', async () => {
    await expect(grants.tokenFor(viewA, 'ws-2')).resolves.toBeNull()
    expect(mint).not.toHaveBeenCalled()
  })

  it('gives a view a workspace it switched to, but not a view that did not', async () => {
    grants.allowView(viewA, 'ws-2')
    signInAt('ws-2')

    await expect(grants.tokenFor(viewA, 'ws-2')).resolves.toBe('minted-ws-2')
    await expect(grants.tokenFor(viewB, 'ws-2')).resolves.toBeNull()
  })

  it('gives every view a workspace Desktop UI chose', async () => {
    grants.allowDesktop('ws-2')
    signInAt('ws-2')

    await expect(grants.tokenFor(viewA, 'ws-2')).resolves.toBe('minted-ws-2')
    await expect(grants.tokenFor(viewB, 'ws-2')).resolves.toBe('minted-ws-2')
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

  it('hands out the grant itself, without asking Cloud, when it cannot mint', async () => {
    grants = new ViewWorkspaceGrants(
      {
        currentWorkspaceId: () => 'ws-1',
        currentSubject: () => user,
        getAccessToken: async () => accessToken('ws-1', 'comfy-cloud:user:read')
      },
      mint
    )

    await expect(grants.tokenFor(viewA, 'ws-1')).resolves.toBe(
      accessToken('ws-1', 'comfy-cloud:user:read')
    )
    expect(mint).not.toHaveBeenCalled()
  })

  it('never hands one account a token minted for another account in the same workspace', async () => {
    await grants.tokenFor(viewA, 'ws-1')
    user = 'user-2'

    await expect(grants.tokenFor(viewA, 'ws-1')).resolves.toBe('minted-ws-1')
    expect(mint).toHaveBeenCalledTimes(2)
    expect(mint).toHaveBeenLastCalledWith(accessToken('ws-1'), 'ws-1')
  })

  it('does not let a request from before sign-out start a mint the next session joins', async () => {
    const before = deferred<string | null>()
    let reads = 0
    grants = new ViewWorkspaceGrants(
      {
        currentWorkspaceId: () => current,
        currentSubject: () => (current ? user : null),
        getAccessToken: () =>
          reads++ === 0 ? before.promise : Promise.resolve(accessToken('ws-1'))
      },
      mint
    )
    const stale = grants.tokenFor(viewA, 'ws-1')
    const firstUserToken = accessToken('ws-1')
    grants.endAll()
    grants.allowDesktop('ws-1')
    user = 'user-2'
    before.resolve(firstUserToken)

    await expect(stale).resolves.toBeNull()
    await expect(grants.tokenFor(viewA, 'ws-1')).resolves.toBe('minted-ws-1')
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
      {
        currentWorkspaceId: () => current,
        currentSubject: () => (current ? user : null),
        getAccessToken: () => (reads++ === 0 ? Promise.resolve(firstUserToken) : slowRead.promise)
      },
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
