// @vitest-environment node
import { Buffer } from 'node:buffer'

import type { WebContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../devplatform/session', () => ({ getCloudSession: () => ({}) }))

import type { WorkspaceTokenMint } from '../cloud/workspaceToken'
import { ViewWorkspaceGrants } from './viewWorkspaceGrants'

function jwt(claims: Record<string, unknown>): string {
  const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${b64({ alg: 'ES256' })}.${b64(claims)}.sig`
}

function accessToken(workspaceId: string, scope = 'comfy-cloud:user:read'): string {
  return jwt({ sub: 'user-1', workspace_id: workspaceId, scope })
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
let mint: ReturnType<
  typeof vi.fn<(token: string, workspaceId: string) => Promise<WorkspaceTokenMint>>
>
let grants: ViewWorkspaceGrants

function signInAt(workspaceId: string | null): void {
  current = workspaceId
}

beforeEach(() => {
  signInAt('ws-1')
  mint = vi.fn(async (_token: string, workspaceId: string) => minted(workspaceId))
  grants = new ViewWorkspaceGrants(
    {
      currentWorkspaceId: () => current,
      getAccessToken: async () => (current ? accessToken(current) : null)
    },
    mint
  )
})

describe('ViewWorkspaceGrants', () => {
  it('hands a view the minted token for the workspace Desktop started in, never the access token', async () => {
    const token = await grants.tokenFor(viewA, 'ws-1')

    expect(token).toBe('minted-ws-1')
    expect(mint).toHaveBeenCalledWith(accessToken('ws-1'), 'ws-1')
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

  it.each([
    ['a failed mint', { kind: 'failed', status: 503 } as const],
    ['an unavailable workspace', { kind: 'failed', status: 404 } as const]
  ])('hands out nothing after %s', async (_name, result) => {
    mint.mockResolvedValueOnce(result)

    await expect(grants.tokenFor(viewA, 'ws-1')).resolves.toBeNull()
  })

  describe('while Cloud refuses to mint for this grant', () => {
    beforeEach(() => {
      mint.mockResolvedValue({ kind: 'refused' })
    })

    it('keeps handing the pinned access token, and stops asking Cloud', async () => {
      await expect(grants.tokenFor(viewA, 'ws-1')).resolves.toBe(accessToken('ws-1'))
      await expect(grants.tokenFor(viewA, 'ws-1')).resolves.toBe(accessToken('ws-1'))
      expect(mint).toHaveBeenCalledOnce()
    })

    it('never hands an access token holding scopes this build did not ask for', async () => {
      grants = new ViewWorkspaceGrants(
        {
          currentWorkspaceId: () => 'ws-1',
          getAccessToken: async () => accessToken('ws-1', 'comfy-cloud:user:read mint')
        },
        mint
      )

      await expect(grants.tokenFor(viewA, 'ws-1')).resolves.toBeNull()
    })
  })
})
