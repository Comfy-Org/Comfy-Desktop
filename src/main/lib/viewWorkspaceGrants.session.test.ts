// @vitest-environment node
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import type { WebContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronState = vi.hoisted(() => ({ userData: '' }))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => electronState.userData) },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) => Buffer.from(value, 'utf-8')),
    decryptString: vi.fn((value: Buffer) => value.toString('utf-8'))
  },
  shell: { openExternal: vi.fn(() => Promise.resolve()) }
}))
vi.mock('../cloud/oauth', () => ({
  signIn: vi.fn(),
  refresh: vi.fn(),
  openAuthorizePage: vi.fn(() => Promise.resolve())
}))
vi.mock('../devplatform/session', () => ({ getCloudSession: () => ({}) }))
vi.mock('./telemetry', () => ({ emit: vi.fn() }))
vi.mock('./workspaceMintSwitchFlag', () => ({
  isWorkspaceMintSwitchEnabled: vi.fn(async () => true)
}))

import { CLOUD_CONFIG } from '../cloud/config'
import { openAuthorizePage, refresh, signIn } from '../cloud/oauth'
import { CloudSession } from '../cloud/session'
import { _resetForTest, clearTokens, saveGrant } from '../cloud/tokenStore'
import type { AuthTokens } from '../cloud/types'
import { ViewWorkspaceGrants } from './viewWorkspaceGrants'
import { isWorkspaceMintSwitchEnabled } from './workspaceMintSwitchFlag'

const FUTURE = Date.now() + 3_600_000
const view = { id: 'view' } as unknown as WebContents

function jwt(claims: Record<string, unknown>): string {
  const b64 = (value: unknown): string =>
    Buffer.from(JSON.stringify(value), 'utf-8').toString('base64url')
  return `${b64({ alg: 'RS256' })}.${b64(claims)}.sig`
}

const GRANT: AuthTokens = {
  accessToken: jwt({ sub: 'user-1', workspace_id: 'w1', scope: CLOUD_CONFIG.scope }),
  refreshToken: 'refresh-w1',
  expiresAt: FUTURE
}

function mintedJwt(workspaceId: string): string {
  return jwt({ sub: 'user-1', workspace_id: workspaceId })
}

let session: CloudSession
let grants: ViewWorkspaceGrants
let mintReply: (workspaceId: string) => Response
let mintRequests: string[]

function kill(): void {
  vi.mocked(isWorkspaceMintSwitchEnabled).mockResolvedValue(false)
}

beforeEach(() => {
  electronState.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'view-grants-session-'))
  _resetForTest()
  vi.mocked(isWorkspaceMintSwitchEnabled).mockResolvedValue(true)
  mintRequests = []
  mintReply = (workspaceId) =>
    new Response(
      JSON.stringify({
        token: mintedJwt(workspaceId),
        expires_at: new Date(FUTURE).toISOString()
      }),
      { status: 200 }
    )
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const workspaceId = (JSON.parse(String(init.body)) as { workspace_id: string }).workspace_id
      mintRequests.push(workspaceId)
      return mintReply(workspaceId)
    })
  )
  saveGrant(GRANT)
  session = new CloudSession()
  grants = new ViewWorkspaceGrants(session)
})

afterEach(() => {
  vi.useRealTimers()
  clearTokens()
  _resetForTest()
  fs.rmSync(electronState.userData, { recursive: true, force: true })
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

async function activeOnW2(): Promise<void> {
  await session.switchWorkspace('w2')
  grants.allowDesktop('w2')
  mintRequests = []
}

describe('view token path through a real session', () => {
  it('mints a non-anchor workspace while the mint switch is on', async () => {
    await activeOnW2()

    await expect(grants.tokenFor(view, 'w2')).resolves.toBe(mintedJwt('w2'))

    expect(mintRequests).toEqual(['w2'])
  })

  it('the ops flag off refuses a view mint for a non-anchor workspace, with no browser', async () => {
    await activeOnW2()
    kill()

    await expect(grants.tokenFor(view, 'w2')).resolves.toBeNull()

    expect(mintRequests).toEqual([])
    expect(signIn).not.toHaveBeenCalled()
    expect(openAuthorizePage).not.toHaveBeenCalled()
  })

  it('the ops flag off leaves a mint for the anchor working', async () => {
    kill()

    await expect(grants.tokenFor(view, 'w1')).resolves.toBe(mintedJwt('w1'))

    expect(mintRequests).toEqual(['w1'])
    expect(signIn).not.toHaveBeenCalled()
  })

  it('refuses to deliver or cache a token that is already expired', async () => {
    const expired = (workspaceId: string): Response =>
      new Response(
        JSON.stringify({
          token: mintedJwt(workspaceId),
          expires_at: new Date(Date.now() - 1000).toISOString()
        }),
        { status: 200 }
      )
    const good = mintReply
    await activeOnW2()
    mintReply = expired

    await expect(grants.tokenFor(view, 'w2')).resolves.toBeNull()

    mintReply = good
    await expect(grants.tokenFor(view, 'w2')).resolves.toBe(mintedJwt('w2'))
    expect(mintRequests).toEqual(['w2', 'w2'])
  })

  it('refuses to deliver or cache a real JWT whose deadline passed in transit', async () => {
    await activeOnW2()
    const good = mintReply
    vi.useFakeTimers({ toFake: ['Date'] })
    mintReply = (workspaceId) => {
      const now = Math.floor(Date.now() / 1000)
      const reply = new Response(
        JSON.stringify({
          token: jwt({ sub: 'user-1', workspace_id: workspaceId, iat: now, exp: now + 30 }),
          expires_at: new Date(Date.now() + 30_000).toISOString()
        }),
        { status: 200 }
      )
      vi.setSystemTime(Date.now() + 60_000)
      return reply
    }

    await expect(grants.tokenFor(view, 'w2')).resolves.toBeNull()

    mintReply = good
    await expect(grants.tokenFor(view, 'w2')).resolves.toBe(mintedJwt('w2'))
    expect(mintRequests).toEqual(['w2', 'w2'])
  })

  it('a clock an hour ahead of the server still delivers a view token, with one mint', async () => {
    await activeOnW2()
    vi.useFakeTimers({ toFake: ['Date'] })
    const serverNow = Date.now()
    vi.setSystemTime(serverNow + 3_600_000)
    saveGrant({ ...GRANT, expiresAt: Date.now() + 3_600_000 })
    const token = jwt({
      sub: 'user-1',
      workspace_id: 'w2',
      iat: Math.floor(serverNow / 1000),
      exp: Math.floor(serverNow / 1000) + 900
    })
    mintReply = () =>
      new Response(
        JSON.stringify({ token, expires_at: new Date(serverNow + 900_000).toISOString() }),
        { status: 200 }
      )

    await expect(grants.tokenFor(view, 'w2')).resolves.toBe(token)
    await expect(grants.tokenFor(view, 'w2')).resolves.toBe(token)

    expect(mintRequests).toEqual(['w2'])
  })

  it('a token the view already holds keeps working through a kill until it expires', async () => {
    await activeOnW2()
    await grants.tokenFor(view, 'w2')
    mintRequests = []
    kill()

    await expect(grants.tokenFor(view, 'w2')).resolves.toBe(mintedJwt('w2'))

    expect(mintRequests).toEqual([])
  })

  it('a view mint told the grant ended never lets the grant be refreshed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    mintReply = () => new Response(JSON.stringify({ code: 'oauth_grant_ended' }), { status: 401 })

    await expect(grants.tokenFor(view, 'w1')).resolves.toBeNull()
    vi.setSystemTime(GRANT.expiresAt + 1)
    await expect(grants.tokenFor(view, 'w1')).resolves.toBeNull()

    expect(refresh).not.toHaveBeenCalled()
    expect(signIn).not.toHaveBeenCalled()
    expect(openAuthorizePage).not.toHaveBeenCalled()
  })

  it('a partner-node mint told the grant ended never lets the grant be refreshed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    mintReply = () => new Response(JSON.stringify({ code: 'oauth_grant_ended' }), { status: 401 })

    await expect(grants.partnerNodeTokenFor(view, 'w1')).resolves.toBeNull()
    vi.setSystemTime(GRANT.expiresAt + 1)
    await expect(grants.partnerNodeTokenFor(view, 'w1')).resolves.toBeNull()

    expect(refresh).not.toHaveBeenCalled()
    expect(signIn).not.toHaveBeenCalled()
    expect(openAuthorizePage).not.toHaveBeenCalled()
  })

  it('a server kill refuses a view mint with no browser', async () => {
    await activeOnW2()
    mintReply = () =>
      new Response(JSON.stringify({ code: 'oauth_workspace_mint_disabled' }), { status: 503 })

    await expect(grants.tokenFor(view, 'w2')).resolves.toBeNull()

    expect(signIn).not.toHaveBeenCalled()
    expect(openAuthorizePage).not.toHaveBeenCalled()
  })

  it('a newer switch while the policy is read drops the view request', async () => {
    await activeOnW2()
    let release: (enabled: boolean) => void = () => {}
    vi.mocked(isWorkspaceMintSwitchEnabled).mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve
      })
    )
    const pending = grants.tokenFor(view, 'w2')
    await vi.waitFor(() => expect(isWorkspaceMintSwitchEnabled).toHaveBeenCalled())
    await session.switchWorkspace('w1')
    release(true)

    await expect(pending).resolves.toBeNull()
    expect(mintRequests).toEqual([])
  })

  it('keeps the partner-node session across a refresh and starts a new one after a new sign-in', async () => {
    const grantIn = (family: string): AuthTokens => ({
      ...GRANT,
      accessToken: jwt({
        sub: 'user-1',
        workspace_id: 'w1',
        scope: CLOUD_CONFIG.scope,
        fam: family
      })
    })
    mintReply = (workspaceId) =>
      new Response(
        JSON.stringify({
          token: mintedJwt(workspaceId),
          expires_at: new Date(Date.now() + 90 * 60_000).toISOString()
        }),
        { status: 200 }
      )
    saveGrant(grantIn('fam-1'))
    await grants.partnerNodeTokenFor(view, 'w1')
    saveGrant({ ...grantIn('fam-1'), refreshToken: 'refreshed' })
    await grants.partnerNodeTokenFor(view, 'w1')
    expect(mintRequests).toEqual(['w1'])

    saveGrant(grantIn('fam-2'))

    await expect(grants.partnerNodeTokenFor(view, 'w1')).resolves.toBe(mintedJwt('w1'))
    expect(mintRequests).toEqual(['w1', 'w1'])
    expect(session.currentGrantFamily()).toBe('fam-2')
  })
})
