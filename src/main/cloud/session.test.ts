import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronState = vi.hoisted(() => ({ userData: '' }))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => electronState.userData) },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) =>
      Buffer.from(`enc:${Buffer.from(value, 'utf-8').toString('base64')}`, 'utf-8')
    ),
    decryptString: vi.fn((value: Buffer) => {
      const text = value.toString('utf-8')
      if (!text.startsWith('enc:')) throw new Error('not encrypted')
      return Buffer.from(text.slice(4), 'base64').toString('utf-8')
    })
  },
  shell: { openExternal: vi.fn(() => Promise.resolve()) }
}))
vi.mock('./oauth', () => ({
  signIn: vi.fn(),
  refresh: vi.fn(),
  openAuthorizePage: vi.fn(() => Promise.resolve())
}))
vi.mock('./workspaces', () => ({
  listWorkspaces: vi.fn(async () => [{ id: 'w-1', name: 'One', type: 'team', role: 'member' }]),
  listWorkspaceMembers: vi.fn(async () => [{ id: 'user-1', name: 'One' }])
}))
vi.mock('../lib/telemetry', () => ({ emit: vi.fn() }))
vi.mock('../lib/workspaceMintSwitchFlag', () => ({
  isWorkspaceMintSwitchEnabled: vi.fn(async () => true)
}))

import { safeStorage } from 'electron'

import * as mainTelemetry from '../lib/telemetry'
import { isWorkspaceMintSwitchEnabled } from '../lib/workspaceMintSwitchFlag'
import { statusFromAccessToken } from './claims'
import { CLOUD_CONFIG } from './config'
import { openAuthorizePage, refresh, signIn } from './oauth'
import {
  CloudSession,
  MINT_SCOPE_NOT_GRANTED_EVENT,
  WORKSPACE_RETURNED_TO_ANCHOR_EVENT,
  WORKSPACE_SWITCH_BROWSER_EVENT,
  WORKSPACE_SWITCH_EVENT
} from './session'
import { SignInFailure } from './signInFailure'
import { _resetForTest, clearTokens, saveGrant, saveWorkspaceToken } from './tokenStore'
import type { AuthTokens } from './types'
import { listWorkspaceMembers, listWorkspaces } from './workspaces'

const mocked = vi.mocked
const FUTURE = Date.now() + 3_600_000
const PAST = Date.now() - 1_000
const READ_ONLY_SCOPE = 'comfy-cloud:user:read'

function jwt(claims: Record<string, unknown>): string {
  const b64 = (value: unknown): string =>
    Buffer.from(JSON.stringify(value), 'utf-8').toString('base64url')
  return `${b64({ alg: 'RS256' })}.${b64(claims)}.sig`
}

interface GrantOptions {
  expiresAt?: number
  scope?: string
  revision?: string
  subject?: string
}

function grantOn(workspaceId: string, options: GrantOptions = {}): AuthTokens {
  const {
    expiresAt = FUTURE,
    scope = CLOUD_CONFIG.scope,
    revision = '',
    subject = 'user-1'
  } = options
  return {
    accessToken: jwt({
      sub: subject,
      email: `${subject}@example.com`,
      workspace_id: workspaceId,
      workspace_type: 'team',
      role: 'owner',
      scope,
      revision
    }),
    refreshToken: `refresh-${workspaceId}${revision}`,
    expiresAt
  }
}

function mintedJwt(workspaceId: string, subject = 'user-1'): string {
  return jwt({
    sub: subject,
    email: `${subject}@example.com`,
    workspace_id: workspaceId,
    workspace_type: 'team',
    role: 'member'
  })
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers })
}

function minted(workspaceId: string, expiresAt = FUTURE): Response {
  return json(200, {
    token: mintedJwt(workspaceId),
    expires_at: new Date(expiresAt).toISOString()
  })
}

interface MintRequest {
  workspaceId: string
  bearer: string
}

type MintReply = (request: MintRequest) => Response | Promise<Response>

let mintReply: MintReply
let mintRequests: MintRequest[]

function signedInResult(tokens: AuthTokens): Awaited<ReturnType<typeof signIn>> {
  return { tokens, status: statusFromAccessToken(tokens.accessToken) }
}

function browserSignInReturns(result: Awaited<ReturnType<typeof signIn>>): void {
  mocked(signIn).mockImplementation(async (options) => {
    options?.onAuthorizeUrl?.('https://cloud.test/authorize')
    return result
  })
}

function browserSignInReturnsOnce(result: Awaited<ReturnType<typeof signIn>>): void {
  mocked(signIn).mockImplementationOnce(async (options) => {
    options?.onAuthorizeUrl?.('https://cloud.test/authorize')
    return result
  })
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function switchEvents(): unknown[] {
  return mocked(mainTelemetry.emit)
    .mock.calls.filter(([event]) => event === WORKSPACE_SWITCH_EVENT)
    .map(([, context]) => context)
}

function mintScopeNotGrantedEvents(): unknown[] {
  return mocked(mainTelemetry.emit).mock.calls.filter(
    ([event]) => event === MINT_SCOPE_NOT_GRANTED_EVENT
  )
}

function browserEvents(): unknown[] {
  return mocked(mainTelemetry.emit)
    .mock.calls.filter(([event]) => event === WORKSPACE_SWITCH_BROWSER_EVENT)
    .map(([, context]) => context)
}

function mintDisabled(): Response {
  return json(503, { code: 'oauth_workspace_mint_disabled' })
}

function killMintSwitch(): void {
  mocked(isWorkspaceMintSwitchEnabled).mockResolvedValue(false)
}

function refreshRefused(oauthError = 'invalid_grant', httpStatus = 400): SignInFailure {
  return new SignInFailure('refresh refused', 'server_error', { httpStatus, oauthError })
}

function refreshFailure(kind: 'network' | 'timeout' | 'http', httpStatus?: number): SignInFailure {
  if (kind === 'http') {
    return new SignInFailure('refresh failed', 'server_error', { httpStatus })
  }
  return new SignInFailure('refresh failed', kind)
}

function vaultOnDisk(): Record<string, unknown> {
  return JSON.parse(
    safeStorage.decryptString(
      fs.readFileSync(path.join(electronState.userData, 'comfy-cloud-auth.bin'))
    )
  ) as Record<string, unknown>
}

beforeEach(() => {
  electronState.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'comfy-cloud-session-'))
  _resetForTest()
  mintRequests = []
  mintReply = ({ workspaceId }) => minted(workspaceId)
  mocked(isWorkspaceMintSwitchEnabled).mockResolvedValue(true)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const request = {
        workspaceId: (JSON.parse(String(init.body)) as { workspace_id: string }).workspace_id,
        bearer: new Headers(init.headers).get('Authorization')?.replace('Bearer ', '') ?? ''
      }
      mintRequests.push(request)
      return mintReply(request)
    })
  )
})

afterEach(() => {
  vi.useRealTimers()
  clearTokens()
  _resetForTest()
  fs.rmSync(electronState.userData, { recursive: true, force: true })
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  mocked(signIn).mockReset()
  mocked(refresh).mockReset()
})

describe('CloudSession access tokens', () => {
  it('returns null when signed out and the grant token while active on the anchor', async () => {
    const session = new CloudSession()
    await expect(session.getAccessToken()).resolves.toBeNull()

    const grant = grantOn('w1')
    saveGrant(grant)

    await expect(session.getAccessToken()).resolves.toBe(grant.accessToken)
    expect(refresh).not.toHaveBeenCalled()
    expect(mintRequests).toEqual([])
  })

  it('single-flights and persists a grant refresh rotation', async () => {
    const stale = grantOn('w1', { expiresAt: PAST })
    const fresh = grantOn('w1', { revision: '-fresh' })
    saveGrant(stale)
    const rotation = deferred<AuthTokens>()
    mocked(refresh).mockReturnValue(rotation.promise)
    const session = new CloudSession()

    const calls = [
      session.getAccessToken(),
      session.getAccessToken(),
      session.getGrantAccessToken()
    ]
    rotation.resolve(fresh)

    await expect(Promise.all(calls)).resolves.toEqual([
      fresh.accessToken,
      fresh.accessToken,
      fresh.accessToken
    ])
    expect(refresh).toHaveBeenCalledExactlyOnceWith(stale.refreshToken)
    expect(vaultOnDisk().grant).toEqual(fresh)
  })

  it('does not let a refresh completion restore credentials after logout', async () => {
    saveGrant(grantOn('w1', { expiresAt: PAST }))
    const rotation = deferred<AuthTokens>()
    mocked(refresh).mockReturnValue(rotation.promise)
    const session = new CloudSession()

    const request = session.getAccessToken()
    session.logout()
    rotation.resolve(grantOn('w1', { revision: '-fresh' }))

    await expect(request).resolves.toBeNull()
    expect(session.isSignedIn()).toBe(false)
  })

  it('keeps a grant rotation that lands after a switch but activates nothing', async () => {
    saveGrant(grantOn('w1', { expiresAt: PAST }))
    const fresh = grantOn('w1', { revision: '-fresh' })
    const rotation = deferred<AuthTokens>()
    mocked(refresh).mockReturnValue(rotation.promise)
    const session = new CloudSession()

    const oldRequest = session.getAccessToken()
    const switching = session.switchWorkspace('w2')
    rotation.resolve(fresh)

    await expect(switching).resolves.toMatchObject({ workspaceId: 'w2' })
    await expect(oldRequest).resolves.toBeNull()
    expect(session.currentWorkspaceId()).toBe('w2')
    expect(vaultOnDisk().grant).toEqual(fresh)
  })

  it('returns no token for API calls while a refresh fails for a transient reason', async () => {
    saveGrant(grantOn('w1', { expiresAt: PAST }))
    mocked(refresh).mockRejectedValue(refreshFailure('network'))

    await expect(new CloudSession().getAccessToken()).resolves.toBeNull()
  })

  it('returns the stale grant token after a definitive refusal so the 401 ends the session', async () => {
    const stale = grantOn('w1', { expiresAt: PAST })
    saveGrant(stale)
    mocked(refresh).mockRejectedValue(refreshRefused())

    await expect(new CloudSession().getAccessToken()).resolves.toBe(stale.accessToken)
  })

  it('re-mints a minted token near expiry once for concurrent callers, with no browser', async () => {
    saveGrant(grantOn('w1'))
    mintReply = ({ workspaceId }) => minted(workspaceId, Date.now() + 30_000)
    const session = new CloudSession()
    await session.switchWorkspace('w2')
    mintRequests = []
    mintReply = ({ workspaceId }) => minted(workspaceId)

    const tokens = await Promise.all([session.getAccessToken(), session.getAccessToken()])

    expect(tokens).toEqual([mintedJwt('w2'), mintedJwt('w2')])
    expect(mintRequests).toHaveLength(1)
    expect(signIn).not.toHaveBeenCalled()
  })

  it('keeps a still valid minted token when its re-mint fails', async () => {
    saveGrant(grantOn('w1'))
    mintReply = ({ workspaceId }) => minted(workspaceId, Date.now() + 30_000)
    const session = new CloudSession()
    await session.switchWorkspace('w2')
    mintReply = () => json(500, {})

    await expect(session.getAccessToken()).resolves.toBe(mintedJwt('w2'))
    expect(signIn).not.toHaveBeenCalled()
  })
})

describe('CloudSession background token reads never open the browser', () => {
  async function activeOnMintedToken(expiresAt = PAST): Promise<CloudSession> {
    saveGrant(grantOn('w1'))
    const session = new CloudSession()
    await session.switchWorkspace('w2')
    saveWorkspaceToken('w2', { accessToken: mintedJwt('w2'), expiresAt })
    mintRequests = []
    return session
  }

  function returnedToAnchorEvents(): unknown[] {
    return mocked(mainTelemetry.emit)
      .mock.calls.filter(([event]) => event === WORKSPACE_RETURNED_TO_ANCHOR_EVENT)
      .map(([, context]) => context)
  }

  it.each<[string, () => void, string]>([
    ['the server kill switch', () => (mintReply = mintDisabled), 'mint_disabled'],
    ['the Desktop ops flag', killMintSwitch, 'mint_disabled'],
    ['a lost membership', () => (mintReply = () => json(404, {})), 'unavailable'],
    [
      'a refused mint',
      () => (mintReply = () => json(403, { code: 'workspace_access_denied' })),
      'refused'
    ],
    ['an SSO policy', () => (mintReply = () => json(403, { code: 'sso_required' })), 'sso_required']
  ])('%s returns active B to the anchor and announces it, once', async (_name, arrange, reason) => {
    const session = await activeOnMintedToken()
    const onReturned = vi.fn()
    session.setReturnedToAnchorHandler(onReturned)
    arrange()
    const grant = grantOn('w1')

    await expect(
      Promise.all([session.getAccessToken(), session.getAccessToken()])
    ).resolves.toEqual([null, null])

    expect(signIn).not.toHaveBeenCalled()
    expect(openAuthorizePage).not.toHaveBeenCalled()
    expect(onReturned).toHaveBeenCalledOnce()
    expect(session.currentWorkspaceId()).toBe('w1')
    expect(session.status()).toMatchObject({ workspaceId: 'w1' })
    expect(returnedToAnchorEvents()).toEqual([{ reason }])
    await expect(session.getAccessToken()).resolves.toBe(grant.accessToken)
  })

  it('an ended grant returns to the anchor, whose 401 then ends the session as today', async () => {
    const session = await activeOnMintedToken()
    const onReturned = vi.fn()
    session.setReturnedToAnchorHandler(onReturned)
    mintReply = () => json(401, { code: 'oauth_grant_ended' })
    mocked(refresh).mockRejectedValue(refreshRefused())

    await expect(session.getAccessToken()).resolves.toBeNull()

    expect(refresh).not.toHaveBeenCalled()
    expect(signIn).not.toHaveBeenCalled()
    expect(onReturned).toHaveBeenCalledOnce()
    expect(session.currentWorkspaceId()).toBe('w1')
    const onSignedOut = vi.fn()
    session.asTokenProvider(onSignedOut).onUnauthorized?.(grantOn('w1').accessToken)
    expect(onSignedOut).toHaveBeenCalledOnce()
  })

  it('a plain second 401 on a token read stays on B', async () => {
    const session = await activeOnMintedToken()
    const onReturned = vi.fn()
    session.setReturnedToAnchorHandler(onReturned)
    mintReply = () => json(401, {})
    mocked(refresh).mockResolvedValue(grantOn('w1', { revision: '-fresh' }))

    await expect(session.getAccessToken()).resolves.toBeNull()

    expect(onReturned).not.toHaveBeenCalled()
    expect(session.currentWorkspaceId()).toBe('w2')
  })

  it.each<[string, () => Response]>([
    ['a rate limit', () => json(429, {})],
    ['an outage', () => json(500, {})],
    ['a 503 of another kind', () => json(503, { code: 'maintenance' })]
  ])('%s stays on B with no token, no browser and no announcement', async (_name, reply) => {
    const session = await activeOnMintedToken()
    const onReturned = vi.fn()
    session.setReturnedToAnchorHandler(onReturned)
    mintReply = reply

    await expect(session.getAccessToken()).resolves.toBeNull()

    expect(signIn).not.toHaveBeenCalled()
    expect(onReturned).not.toHaveBeenCalled()
    expect(session.currentWorkspaceId()).toBe('w2')
  })

  it('keeps using a still valid token through a kill, then returns once it expires', async () => {
    const session = await activeOnMintedToken(Date.now() + 30_000)
    const onReturned = vi.fn()
    session.setReturnedToAnchorHandler(onReturned)
    killMintSwitch()

    await expect(session.getAccessToken()).resolves.toBe(mintedJwt('w2'))

    expect(onReturned).not.toHaveBeenCalled()
    expect(session.currentWorkspaceId()).toBe('w2')
    expect(signIn).not.toHaveBeenCalled()
  })

  it('a re-mint that lands after a newer switch does not move the active workspace', async () => {
    const session = await activeOnMintedToken()
    const onReturned = vi.fn()
    session.setReturnedToAnchorHandler(onReturned)
    const slow = deferred<Response>()
    mintReply = () => slow.promise

    const request = session.getAccessToken()
    await vi.waitFor(() => expect(mintRequests).toHaveLength(1))
    mintReply = ({ workspaceId }) => minted(workspaceId)
    await session.switchWorkspace('w3')
    slow.resolve(mintDisabled())

    await expect(request).resolves.toBeNull()
    expect(onReturned).not.toHaveBeenCalled()
    expect(session.currentWorkspaceId()).toBe('w3')
  })
})

describe('CloudSession browser sign-in', () => {
  it('single-flights repeated login requests', async () => {
    const pending = deferred<Awaited<ReturnType<typeof signIn>>>()
    mocked(signIn).mockReturnValue(pending.promise)
    const session = new CloudSession()

    const first = session.login()
    const second = session.login()
    pending.resolve(signedInResult(grantOn('w1')))

    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(signIn).toHaveBeenCalledOnce()
    expect(session.currentWorkspaceId()).toBe('w1')
  })

  it('moves to the consented workspace on a fresh login', async () => {
    saveGrant(grantOn('w1'))
    browserSignInReturns(signedInResult(grantOn('w3')))
    const session = new CloudSession()
    await session.switchWorkspace('w2')

    await session.login()

    expect(session.currentWorkspaceId()).toBe('w3')
  })

  it('reopens the pending sign-in page when login is requested again', async () => {
    mocked(signIn).mockImplementation(async (options) => {
      options?.onAuthorizeUrl?.('https://cloud.test/authorize?state=s1')
      return new Promise(() => {})
    })
    const session = new CloudSession()

    void session.login()
    await vi.waitFor(() => expect(signIn).toHaveBeenCalledOnce())
    void session.login()

    expect(signIn).toHaveBeenCalledOnce()
    expect(openAuthorizePage).toHaveBeenCalledExactlyOnceWith(
      'https://cloud.test/authorize?state=s1'
    )
  })

  it('does not reopen a sign-in page after logout', async () => {
    mocked(signIn).mockImplementation(async (options) => {
      options?.onAuthorizeUrl?.('https://cloud.test/authorize?state=s1')
      return new Promise(() => {})
    })
    const session = new CloudSession()

    void session.login()
    await vi.waitFor(() => expect(signIn).toHaveBeenCalledOnce())
    session.logout()
    void session.login()

    expect(signIn).toHaveBeenCalledTimes(2)
    expect(openAuthorizePage).not.toHaveBeenCalled()
  })

  it('does not persist browser auth that finishes after logout', async () => {
    const pending = deferred<Awaited<ReturnType<typeof signIn>>>()
    mocked(signIn).mockReturnValue(pending.promise)
    const session = new CloudSession()

    const login = session.login()
    session.logout()
    pending.resolve(signedInResult(grantOn('w1')))

    await expect(login).resolves.toEqual({ signedIn: false })
    expect(session.isSignedIn()).toBe(false)
  })
})

describe('CloudSession.switchWorkspace with no browser', () => {
  it('T-V1: A to B to C to A signs in once and each new workspace is one mint', async () => {
    browserSignInReturns(signedInResult(grantOn('wA')))
    const session = new CloudSession()
    await session.login()

    await expect(session.switchWorkspace('wB')).resolves.toMatchObject({ workspaceId: 'wB' })
    await expect(session.switchWorkspace('wC')).resolves.toMatchObject({ workspaceId: 'wC' })
    await expect(session.switchWorkspace('wA')).resolves.toMatchObject({ workspaceId: 'wA' })
    await expect(session.switchWorkspace('wB')).resolves.toMatchObject({ workspaceId: 'wB' })

    expect(signIn).toHaveBeenCalledOnce()
    expect(openAuthorizePage).not.toHaveBeenCalled()
    expect(mintRequests.map(({ workspaceId }) => workspaceId)).toEqual(['wB', 'wC'])
    expect(switchEvents()).toEqual([
      { outcome: 'minted' },
      { outcome: 'minted' },
      { outcome: 'anchor' },
      { outcome: 'cached' }
    ])
    expect(browserEvents()).toEqual([])
  })

  it('stores minted tokens without a refresh token and API calls use them', async () => {
    const grant = grantOn('w1')
    saveGrant(grant)
    const session = new CloudSession()

    await session.switchWorkspace('w2')

    expect(mintRequests).toEqual([{ workspaceId: 'w2', bearer: grant.accessToken }])
    await expect(session.getAccessToken()).resolves.toBe(mintedJwt('w2'))
    await expect(session.getGrantAccessToken()).resolves.toBe(grant.accessToken)
    expect(session.currentSubject()).toBe('user-1')
    expect(vaultOnDisk()).toMatchObject({
      version: 2,
      activeWorkspaceId: 'w2',
      grant,
      workspaceTokens: { w2: { accessToken: mintedJwt('w2') } }
    })
    expect((vaultOnDisk().workspaceTokens as Record<string, AuthTokens>).w2).not.toHaveProperty(
      'refreshToken'
    )
  })

  it('refuses a mint reply that is already expired: nothing is stored or activated', async () => {
    saveGrant(grantOn('w1'))
    mintReply = ({ workspaceId }) => minted(workspaceId, PAST)
    const session = new CloudSession()

    await expect(session.switchWorkspace('w2')).resolves.toMatchObject({
      workspaceId: 'w1',
      workspaceSwitchFailure: 'retryable'
    })

    expect(session.currentWorkspaceId()).toBe('w1')
    expect(vaultOnDisk().workspaceTokens).toEqual({})
    expect(signIn).not.toHaveBeenCalled()
  })

  it('a clock an hour ahead of the server still switches and keeps the token, with one mint', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const serverNow = Date.now()
    vi.setSystemTime(serverNow + 3_600_000)
    saveGrant(grantOn('w1', { expiresAt: Date.now() + 3_600_000 }))
    const token = jwt({
      sub: 'user-1',
      workspace_id: 'w2',
      iat: Math.floor(serverNow / 1000),
      exp: Math.floor(serverNow / 1000) + 900
    })
    mintReply = () => json(200, { token, expires_at: new Date(serverNow + 900_000).toISOString() })
    const session = new CloudSession()

    await expect(session.switchWorkspace('w2')).resolves.toMatchObject({ workspaceId: 'w2' })
    await expect(session.getAccessToken()).resolves.toBe(token)

    expect(mintRequests).toHaveLength(1)
    expect(signIn).not.toHaveBeenCalled()
  })

  it('refuses a real JWT whose deadline passed in transit: nothing is stored or activated', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    saveGrant(grantOn('w1', { expiresAt: Date.now() + 3_600_000 }))
    mintReply = ({ workspaceId }) => {
      const now = Math.floor(Date.now() / 1000)
      const reply = json(200, {
        token: jwt({ sub: 'user-1', workspace_id: workspaceId, iat: now, exp: now + 30 }),
        expires_at: new Date(Date.now() + 30_000).toISOString()
      })
      vi.setSystemTime(Date.now() + 60_000)
      return reply
    }
    const session = new CloudSession()

    await expect(session.switchWorkspace('w2')).resolves.toMatchObject({
      workspaceId: 'w1',
      workspaceSwitchFailure: 'retryable'
    })

    expect(session.currentWorkspaceId()).toBe('w1')
    expect(vaultOnDisk().workspaceTokens).toEqual({})
    expect(signIn).not.toHaveBeenCalled()
  })

  it('re-mints an expired minted token on the next switch, with no browser', async () => {
    saveGrant(grantOn('w1'))
    const session = new CloudSession()
    await session.switchWorkspace('w2')
    await session.switchWorkspace('w1')
    saveWorkspaceToken('w2', { accessToken: mintedJwt('w2'), expiresAt: PAST })

    await expect(session.switchWorkspace('w2')).resolves.toMatchObject({ workspaceId: 'w2' })

    expect(mintRequests).toHaveLength(2)
    expect(signIn).not.toHaveBeenCalled()
  })

  it('refreshes an expired grant before minting', async () => {
    const stale = grantOn('w1', { expiresAt: PAST })
    const fresh = grantOn('w1', { revision: '-fresh' })
    saveGrant(stale)
    mocked(refresh).mockResolvedValue(fresh)

    await expect(new CloudSession().switchWorkspace('w2')).resolves.toMatchObject({
      workspaceId: 'w2'
    })

    expect(mintRequests).toEqual([{ workspaceId: 'w2', bearer: fresh.accessToken }])
    expect(signIn).not.toHaveBeenCalled()
  })

  it('shares one flight between concurrent switches to the same workspace', async () => {
    saveGrant(grantOn('w1', { scope: READ_ONLY_SCOPE }))
    browserSignInReturns(signedInResult(grantOn('w2')))
    const session = new CloudSession()

    await Promise.all([session.switchWorkspace('w2'), session.switchWorkspace('w2')])

    expect(signIn).toHaveBeenCalledOnce()
  })

  it.each<[string, () => Response, string, string]>([
    ['T-V2: non-member 404', () => json(404, { code: 'NOT_FOUND' }), 'unavailable', 'unavailable'],
    [
      'account_outside_organization',
      () => json(403, { code: 'account_outside_organization' }),
      'refused',
      'unavailable'
    ],
    [
      'personal_workspace_disabled',
      () => json(403, { code: 'personal_workspace_disabled' }),
      'refused',
      'unavailable'
    ],
    [
      'insufficient_scope',
      () => json(403, { code: 'insufficient_scope' }),
      'refused',
      'unavailable'
    ],
    ['a rate limit', () => json(429, {}, { 'Retry-After': '60' }), 'retryable', 'retryable'],
    ['a server error', () => json(500, {}), 'retryable', 'retryable'],
    ['a malformed 200', () => json(200, { token: '' }), 'retryable', 'retryable']
  ])(
    '%s stays on the current workspace with no browser',
    async (_name, reply, outcome, failure) => {
      saveGrant(grantOn('w1'))
      mintReply = reply
      const session = new CloudSession()

      await expect(session.switchWorkspace('w2')).resolves.toMatchObject({
        workspaceId: 'w1',
        workspaceSwitchFailure: failure
      })

      expect(signIn).not.toHaveBeenCalled()
      expect(openAuthorizePage).not.toHaveBeenCalled()
      expect(session.currentWorkspaceId()).toBe('w1')
      expect(switchEvents()).toEqual([{ outcome }])
      expect(browserEvents()).toEqual([])
    }
  )

  it('a network failure stays on the current workspace with no browser', async () => {
    saveGrant(grantOn('w1'))
    mintReply = () => {
      throw new TypeError('offline')
    }

    await expect(new CloudSession().switchWorkspace('w2')).resolves.toMatchObject({
      workspaceId: 'w1',
      workspaceSwitchFailure: 'retryable'
    })

    expect(signIn).not.toHaveBeenCalled()
  })

  it('respects Retry-After instead of asking Cloud again', async () => {
    saveGrant(grantOn('w1'))
    mintReply = () => json(429, {}, { 'Retry-After': '60' })
    const session = new CloudSession()

    await session.switchWorkspace('w2')
    await expect(session.switchWorkspace('w3')).resolves.toMatchObject({
      workspaceSwitchFailure: 'retryable'
    })

    expect(mintRequests).toHaveLength(1)
  })

  it('a late 429 from before logout does not throttle the next account', async () => {
    saveGrant(grantOn('w1'))
    const late = deferred<Response>()
    mintReply = () => late.promise
    const session = new CloudSession()
    const stale = session.switchWorkspace('w2')
    await vi.waitFor(() => expect(mintRequests).toHaveLength(1))

    session.logout()
    saveGrant(grantOn('w5', { subject: 'user-2' }))
    late.resolve(json(429, {}, { 'Retry-After': '3600' }))
    await stale
    mintReply = () => json(404, {})
    await session.switchWorkspace('w6')

    expect(mintRequests).toHaveLength(2)
  })

  it('a late 429 from before logout does not throttle the same account signing back in', async () => {
    saveGrant(grantOn('w1'))
    const late = deferred<Response>()
    mintReply = () => late.promise
    const session = new CloudSession()
    const stale = session.switchWorkspace('w2')
    await vi.waitFor(() => expect(mintRequests).toHaveLength(1))

    session.logout()
    saveGrant(grantOn('w1'))
    late.resolve(json(429, {}, { 'Retry-After': '3600' }))
    await stale
    mintReply = ({ workspaceId }) => minted(workspaceId)

    await expect(session.switchWorkspace('w3')).resolves.toMatchObject({ workspaceId: 'w3' })
    expect(mintRequests).toHaveLength(2)
  })

  it('a late 429 from a previous account in the same generation does not throttle the new one', async () => {
    saveGrant(grantOn('w1'))
    const held = new CloudSession()
    await held.switchWorkspace('w2')
    saveWorkspaceToken('w2', { accessToken: mintedJwt('w2'), expiresAt: PAST })
    const late = deferred<Response>()
    const pendingSignIn = deferred<Awaited<ReturnType<typeof signIn>>>()
    mocked(signIn).mockReturnValue(pendingSignIn.promise)
    mintRequests = []
    mintReply = ({ workspaceId }) =>
      workspaceId === 'w3' ? json(403, { code: 'sso_required' }) : late.promise

    const switching = held.switchWorkspace('w3')
    await vi.waitFor(() => expect(signIn).toHaveBeenCalledOnce())
    const read = held.getAccessToken()
    await vi.waitFor(() => expect(mintRequests).toHaveLength(2))
    pendingSignIn.resolve(signedInResult(grantOn('w3', { subject: 'user-2' })))
    await switching
    late.resolve(json(429, {}, { 'Retry-After': '3600' }))
    await read
    mintRequests = []
    mintReply = () => json(404, {})

    await held.switchWorkspace('w6')

    expect(mintRequests).toHaveLength(1)
  })

  describe('a token read pending while a consent changes the account in the same generation', () => {
    async function readPendingWhileAccountChanges(lateReply: () => Response | Promise<Response>) {
      saveGrant(grantOn('w1'))
      const session = new CloudSession()
      await session.switchWorkspace('w2')
      saveWorkspaceToken('w2', { accessToken: mintedJwt('w2'), expiresAt: Date.now() + 30_000 })
      const late = deferred<void>()
      const pendingSignIn = deferred<Awaited<ReturnType<typeof signIn>>>()
      mocked(signIn).mockReturnValue(pendingSignIn.promise)
      mintRequests = []
      mintReply = async ({ workspaceId }) => {
        if (workspaceId === 'w3') return json(403, { code: 'sso_required' })
        await late.promise
        return lateReply()
      }

      const switching = session.switchWorkspace('w3')
      await vi.waitFor(() => expect(signIn).toHaveBeenCalledOnce())
      const read = session.getAccessToken()
      await vi.waitFor(() => expect(mintRequests).toHaveLength(2))
      pendingSignIn.resolve(signedInResult(grantOn('w3', { subject: 'user-2' })))
      await switching
      late.resolve()
      return { session, read }
    }

    it.each<[string, () => Response]>([
      ['a 429', () => json(429, {})],
      ['a 500', () => json(500, {})],
      [
        'a network failure',
        () => {
          throw new TypeError('offline')
        }
      ],
      ['a refusal', () => json(404, {})],
      ['a mint for the old account', () => minted('w2')]
    ])('%s does not hand back the old account token', async (_name, reply) => {
      const { session, read } = await readPendingWhileAccountChanges(reply)

      await expect(read).resolves.toBeNull()

      expect(session.currentSubject()).toBe('user-2')
      expect(session.currentWorkspaceId()).toBe('w3')
    })

    it('the new account landing on the same workspace id does not get the old account token', async () => {
      saveGrant(grantOn('w1'))
      const session = new CloudSession()
      await session.switchWorkspace('w2')
      saveWorkspaceToken('w2', { accessToken: mintedJwt('w2'), expiresAt: Date.now() + 30_000 })
      const late = deferred<void>()
      const pendingSignIn = deferred<Awaited<ReturnType<typeof signIn>>>()
      mocked(signIn).mockReturnValue(pendingSignIn.promise)
      let w3Replies = 0
      mintRequests = []
      mintReply = async ({ workspaceId }) => {
        if (workspaceId === 'w3') {
          return w3Replies++ === 0 ? json(403, { code: 'sso_required' }) : json(404, {})
        }
        await late.promise
        return json(429, {})
      }

      const switching = session.switchWorkspace('w3')
      await vi.waitFor(() => expect(signIn).toHaveBeenCalledOnce())
      const read = session.getAccessToken()
      await vi.waitFor(() => expect(mintRequests).toHaveLength(2))
      pendingSignIn.resolve(signedInResult(grantOn('w2', { subject: 'user-2' })))
      await switching
      late.resolve()

      await expect(read).resolves.toBeNull()
      expect(session.currentSubject()).toBe('user-2')
      expect(session.currentWorkspaceId()).toBe('w2')
    })

    it('a refresh landing after the account changed returns null from both token reads', async () => {
      saveGrant(grantOn('w1', { expiresAt: Date.now() + 30_000 }))
      const session = new CloudSession()
      const rotation = deferred<AuthTokens>()
      mocked(refresh).mockReturnValue(rotation.promise)

      const anchorRead = session.getAccessToken()
      const grantRead = session.getGrantAccessToken()
      saveGrant(grantOn('w3', { subject: 'user-2' }))
      rotation.resolve(grantOn('w1', { revision: '-fresh' }))

      await expect(anchorRead).resolves.toBeNull()
      await expect(grantRead).resolves.toBeNull()
    })

    it('a mint flight waiting on the policy never posts with the new account grant', async () => {
      saveGrant(grantOn('w1'))
      const session = new CloudSession()
      await session.switchWorkspace('w2')
      saveWorkspaceToken('w2', { accessToken: mintedJwt('w2'), expiresAt: PAST })
      const pendingSignIn = deferred<Awaited<ReturnType<typeof signIn>>>()
      mocked(signIn).mockReturnValue(pendingSignIn.promise)
      mintRequests = []
      mintReply = ({ workspaceId }) =>
        workspaceId === 'w3' ? json(403, { code: 'sso_required' }) : minted(workspaceId)
      const switching = session.switchWorkspace('w3')
      await vi.waitFor(() => expect(signIn).toHaveBeenCalledOnce())
      const policy = deferred<boolean>()
      mocked(isWorkspaceMintSwitchEnabled).mockReturnValueOnce(policy.promise)

      const read = session.getAccessToken()
      const newAccount = grantOn('w3', { subject: 'user-2' })
      pendingSignIn.resolve(signedInResult(newAccount))
      await switching
      policy.resolve(true)

      await expect(read).resolves.toBeNull()
      expect(mintRequests).not.toContainEqual({
        workspaceId: 'w2',
        bearer: newAccount.accessToken
      })
    })
  })

  it('a token read does not return the old workspace token after the same account moved on', async () => {
    saveGrant(grantOn('w1'))
    const session = new CloudSession()
    await session.switchWorkspace('w2')
    saveWorkspaceToken('w2', { accessToken: mintedJwt('w2'), expiresAt: Date.now() + 30_000 })
    const slowB = deferred<Response>()
    const slowC = deferred<Response>()
    mintRequests = []
    mintReply = ({ workspaceId }) => (workspaceId === 'w2' ? slowB.promise : slowC.promise)

    const switching = session.switchWorkspace('w3')
    await vi.waitFor(() => expect(mintRequests).toHaveLength(1))
    const read = session.getAccessToken()
    await vi.waitFor(() => expect(mintRequests).toHaveLength(2))
    slowC.resolve(minted('w3'))
    await switching
    slowB.resolve(json(429, {}))

    await expect(read).resolves.toBeNull()
    expect(session.currentWorkspaceId()).toBe('w3')
  })

  it('rejects a minted token for another workspace or account', async () => {
    saveGrant(grantOn('w1'))
    mintReply = () =>
      json(200, { token: mintedJwt('w9'), expires_at: new Date(FUTURE).toISOString() })
    const session = new CloudSession()

    await expect(session.switchWorkspace('w2')).resolves.toMatchObject({
      workspaceId: 'w1',
      workspaceSwitchFailure: 'retryable'
    })

    mintReply = () =>
      json(200, { token: mintedJwt('w2', 'user-2'), expires_at: new Date(FUTURE).toISOString() })
    await expect(session.switchWorkspace('w2')).resolves.toMatchObject({
      workspaceId: 'w1',
      workspaceSwitchFailure: 'retryable'
    })
  })

  it('does not attach a failure to a successful switch', async () => {
    saveGrant(grantOn('w1'))

    const reply = await new CloudSession().switchWorkspace('w2')

    expect(reply).not.toHaveProperty('workspaceSwitchFailure')
  })
})

describe('CloudSession.switchWorkspace reauthorize', () => {
  it.each<[string, () => void, string]>([
    ['the server kill switch', () => (mintReply = mintDisabled), 'mint_disabled'],
    ['the Desktop ops flag', killMintSwitch, 'mint_disabled'],
    [
      'an SSO policy',
      () => (mintReply = () => json(403, { code: 'sso_required' })),
      'sso_required'
    ],
    [
      'an ended grant',
      () => {
        mintReply = () => json(401, { code: 'oauth_grant_ended' })
        mocked(refresh).mockRejectedValue(refreshRefused())
      },
      'grant_ended'
    ]
  ])('a restored switch stays put for %s and opens no browser', async (_name, arrange, reason) => {
    saveGrant(grantOn('w1'))
    const session = new CloudSession()
    arrange()

    const reply = await session.switchWorkspace('w2', 'restored')

    expect(signIn).not.toHaveBeenCalled()
    expect(reply).toMatchObject({ workspaceId: 'w1', workspaceSwitchFailure: 'retryable' })
    expect(switchEvents()).toEqual([{ outcome: 'retryable', reauthorize_reason: reason }])
    expect(browserEvents()).toEqual([])
  })

  it('a person joining a restored switch still gets the browser the switch needs', async () => {
    saveGrant(grantOn('w1'))
    const session = new CloudSession()
    const late = deferred<Response>()
    mintReply = () => late.promise
    mocked(signIn).mockResolvedValue({
      tokens: grantOn('w2'),
      status: { signedIn: true, workspaceId: 'w2' }
    })

    const restoring = session.switchWorkspace('w2', 'restored')
    const joining = session.switchWorkspace('w2', 'chosen')
    late.resolve(json(403, { code: 'sso_required' }))
    await Promise.all([restoring, joining])

    expect(signIn).toHaveBeenCalledOnce()
  })

  it('a person retrying after a restored switch reaches sign-in for a grant with no mint scope', async () => {
    saveGrant(grantOn('w1', { scope: 'comfy-cloud:user:read' }))
    const session = new CloudSession()
    mocked(signIn).mockResolvedValue({
      tokens: grantOn('w2'),
      status: { signedIn: true, workspaceId: 'w2' }
    })

    await expect(session.switchWorkspace('w2', 'restored')).resolves.toMatchObject({
      workspaceSwitchFailure: 'retryable'
    })
    expect(signIn).not.toHaveBeenCalled()

    await session.switchWorkspace('w2', 'chosen')

    expect(signIn).toHaveBeenCalledOnce()
  })

  it('T-V4: sso_required opens one browser carrying B and then succeeds', async () => {
    saveGrant(grantOn('w1'))
    mintReply = () => json(403, { code: 'sso_required' })
    const sso = grantOn('w2', { revision: '-sso' })
    browserSignInReturns(signedInResult(sso))
    const session = new CloudSession()

    await expect(session.switchWorkspace('w2')).resolves.toMatchObject({ workspaceId: 'w2' })

    expect(signIn).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ workspaceId: 'w2' }))
    expect(vaultOnDisk().grant).toEqual(sso)
    expect(switchEvents()).toEqual([{ outcome: 'browser', reauthorize_reason: 'sso_required' }])
    expect(browserEvents()).toEqual([{ reauthorize_reason: 'sso_required' }])
  })

  it('consent picking another workspace still ends on B with one mint', async () => {
    saveGrant(grantOn('w1'))
    let replies = 0
    mintReply = ({ workspaceId }) =>
      replies++ === 0 ? json(403, { code: 'sso_required' }) : minted(workspaceId)
    const consented = grantOn('w3')
    browserSignInReturns(signedInResult(consented))
    const session = new CloudSession()

    await expect(session.switchWorkspace('w2')).resolves.toMatchObject({ workspaceId: 'w2' })

    expect(signIn).toHaveBeenCalledOnce()
    expect(mintRequests).toHaveLength(2)
    expect(mintRequests[1]).toEqual({ workspaceId: 'w2', bearer: consented.accessToken })
    expect(vaultOnDisk().grant).toEqual(consented)
  })

  it('T-V9: 401 with refresh refused runs one reauthorize, then switching works', async () => {
    saveGrant(grantOn('w1'))
    let replies = 0
    mintReply = ({ workspaceId }) =>
      replies++ === 0
        ? json(401, { message: 'workspace membership not found' })
        : minted(workspaceId)
    mocked(refresh).mockRejectedValue(refreshRefused('invalid_client'))
    browserSignInReturns(signedInResult(grantOn('w3')))
    const session = new CloudSession()

    await expect(session.switchWorkspace('w2')).resolves.toMatchObject({ workspaceId: 'w2' })
    await expect(session.switchWorkspace('w4')).resolves.toMatchObject({ workspaceId: 'w4' })

    expect(refresh).toHaveBeenCalledOnce()
    expect(signIn).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ workspaceId: 'w2' }))
    expect(browserEvents()).toEqual([{ reauthorize_reason: 'grant_ended' }])
  })

  it('401 with a good refresh retries the mint once with no browser', async () => {
    const fresh = grantOn('w1', { revision: '-fresh' })
    saveGrant(grantOn('w1'))
    let replies = 0
    mintReply = ({ workspaceId }) => (replies++ === 0 ? json(401, {}) : minted(workspaceId))
    mocked(refresh).mockResolvedValue(fresh)

    await expect(new CloudSession().switchWorkspace('w2')).resolves.toMatchObject({
      workspaceId: 'w2'
    })

    expect(mintRequests[1]).toMatchObject({ bearer: fresh.accessToken })
    expect(signIn).not.toHaveBeenCalled()
  })

  it('a second oauth_grant_ended 401 after a good refresh is reauthorize', async () => {
    saveGrant(grantOn('w1'))
    let replies = 0
    mintReply = () => (replies++ === 0 ? json(401, {}) : json(401, { code: 'oauth_grant_ended' }))
    mocked(refresh).mockResolvedValue(grantOn('w1', { revision: '-fresh' }))
    browserSignInReturns(signedInResult(grantOn('w2')))

    await expect(new CloudSession().switchWorkspace('w2')).resolves.toMatchObject({
      workspaceId: 'w2'
    })

    expect(mintRequests).toHaveLength(2)
    expect(signIn).toHaveBeenCalledOnce()
  })

  it.each<[string, SignInFailure]>([
    ['network', refreshFailure('network')],
    ['timeout', refreshFailure('timeout')],
    ['HTTP 500', refreshFailure('http', 500)],
    ['HTTP 503', refreshFailure('http', 503)],
    ['HTTP 429', refreshFailure('http', 429)],
    ['plain HTTP 400', refreshFailure('http', 400)],
    ['plain HTTP 401', refreshFailure('http', 401)],
    ['HTTP 400 with another OAuth error', refreshRefused('invalid_request')],
    ['HTTP 500 carrying invalid_grant', refreshRefused('invalid_grant', 500)]
  ])('a %s refresh failure after a 401 reports retryable with no browser', async (_name, error) => {
    saveGrant(grantOn('w1'))
    mintReply = () => json(401, {})
    mocked(refresh).mockRejectedValue(error)

    await expect(new CloudSession().switchWorkspace('w2')).resolves.toMatchObject({
      workspaceId: 'w1',
      workspaceSwitchFailure: 'retryable'
    })

    expect(signIn).not.toHaveBeenCalled()
    expect(switchEvents()).toEqual([{ outcome: 'retryable' }])
  })

  it.each<[string, SignInFailure]>([
    ['network', refreshFailure('network')],
    ['HTTP 500', refreshFailure('http', 500)]
  ])(
    'a %s refresh failure on an expired grant never mints or opens the browser',
    async (_name, error) => {
      saveGrant(grantOn('w1', { expiresAt: PAST }))
      mocked(refresh).mockRejectedValue(error)

      await expect(new CloudSession().switchWorkspace('w2')).resolves.toMatchObject({
        workspaceSwitchFailure: 'retryable'
      })

      expect(mintRequests).toEqual([])
      expect(signIn).not.toHaveBeenCalled()
    }
  )

  it.each<[string]>([['invalid_grant'], ['invalid_client']])(
    'a %s refresh refusal on an expired grant opens one browser',
    async (oauthError) => {
      saveGrant(grantOn('w1', { expiresAt: PAST }))
      mocked(refresh).mockRejectedValue(refreshRefused(oauthError))
      browserSignInReturns(signedInResult(grantOn('w2')))

      await expect(new CloudSession().switchWorkspace('w2')).resolves.toMatchObject({
        workspaceId: 'w2'
      })

      expect(signIn).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ workspaceId: 'w2' }))
    }
  )

  it('a plain second 401 after a good refresh reports retryable with no browser', async () => {
    saveGrant(grantOn('w1'))
    mintReply = () => json(401, { message: 'workspace membership not found' })
    mocked(refresh).mockResolvedValue(grantOn('w1', { revision: '-fresh' }))

    await expect(new CloudSession().switchWorkspace('w2')).resolves.toMatchObject({
      workspaceId: 'w1',
      workspaceSwitchFailure: 'retryable'
    })

    expect(mintRequests).toHaveLength(2)
    expect(refresh).toHaveBeenCalledOnce()
    expect(signIn).not.toHaveBeenCalled()
  })

  it('an oauth_grant_ended 401 asks for one sign-in without refreshing the ended grant', async () => {
    const ended = grantOn('w1')
    saveGrant(ended)
    mintReply = ({ workspaceId, bearer }) =>
      bearer === ended.accessToken ? json(401, { code: 'oauth_grant_ended' }) : minted(workspaceId)
    mocked(refresh).mockResolvedValue(grantOn('w1', { revision: '-fresh' }))
    browserSignInReturns(signedInResult(grantOn('w3')))
    const session = new CloudSession()

    await expect(session.switchWorkspace('w2')).resolves.toMatchObject({ workspaceId: 'w2' })
    await expect(session.switchWorkspace('w4')).resolves.toMatchObject({ workspaceId: 'w4' })

    expect(refresh).not.toHaveBeenCalled()
    expect(signIn).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ workspaceId: 'w2' }))
    expect(browserEvents()).toEqual([{ reauthorize_reason: 'grant_ended' }])
  })

  it('an oauth_grant_ended 401 also ends a rotation of the grant stored while the mint was out', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const ended = grantOn('w1')
    const rotated = grantOn('w1', { revision: '-fresh', expiresAt: ended.expiresAt + 3_600_000 })
    saveGrant(ended)
    const late = deferred<Response>()
    mintReply = () => late.promise
    mocked(refresh).mockResolvedValue(rotated)
    const session = new CloudSession()

    const switching = session.switchWorkspace('w2', 'restored')
    await vi.waitFor(() => expect(mintRequests).toHaveLength(1))
    vi.setSystemTime(ended.expiresAt + 1)
    await expect(session.getAccessToken()).resolves.toBe(rotated.accessToken)
    late.resolve(json(401, { code: 'oauth_grant_ended' }))
    await switching
    vi.setSystemTime(rotated.expiresAt + 1)

    await expect(session.getAccessToken()).resolves.toBe(rotated.accessToken)
    expect(refresh).toHaveBeenCalledExactlyOnceWith(ended.refreshToken)
    expect(vaultOnDisk().grant).not.toHaveProperty('refreshToken')
  })

  it('an oauth_grant_ended 401 leaves no refresh token, so the ended grant is never refreshed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const ended = grantOn('w1')
    saveGrant(ended)
    mintReply = () => json(401, { code: 'oauth_grant_ended' })
    mocked(refresh).mockResolvedValue(grantOn('w1', { revision: '-fresh' }))
    const session = new CloudSession()

    await expect(session.switchWorkspace('w2', 'restored')).resolves.toMatchObject({
      workspaceId: 'w1',
      workspaceSwitchFailure: 'retryable'
    })
    vi.setSystemTime(ended.expiresAt + 1)

    await expect(session.getAccessToken()).resolves.toBe(ended.accessToken)
    await expect(session.switchWorkspace('w1', 'restored')).resolves.toMatchObject({
      workspaceSwitchFailure: 'retryable'
    })
    expect(refresh).not.toHaveBeenCalled()
    expect(vaultOnDisk().grant).not.toHaveProperty('refreshToken')
    expect(signIn).not.toHaveBeenCalled()
  })

  it('switching to the anchor with a refused refresh opens one browser', async () => {
    saveGrant(grantOn('w1', { expiresAt: PAST }))
    mocked(refresh).mockRejectedValue(refreshRefused())
    browserSignInReturns(signedInResult(grantOn('w1', { revision: '-new' })))

    await expect(new CloudSession().switchWorkspace('w1')).resolves.toMatchObject({
      workspaceId: 'w1'
    })

    expect(signIn).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ workspaceId: 'w1' }))
  })

  it('switching to an expired anchor during a refresh outage stays put and reports retryable', async () => {
    saveGrant(grantOn('w1', { expiresAt: PAST }))
    mocked(refresh).mockResolvedValueOnce(grantOn('w1', { expiresAt: PAST, revision: '-2' }))
    const session = new CloudSession()
    await session.switchWorkspace('w2')
    mocked(refresh).mockRejectedValue(refreshFailure('network'))

    await expect(session.switchWorkspace('w1')).resolves.toMatchObject({
      workspaceId: 'w2',
      workspaceSwitchFailure: 'retryable'
    })

    expect(session.currentWorkspaceId()).toBe('w2')
    expect(signIn).not.toHaveBeenCalled()
    expect(switchEvents().at(-1)).toEqual({ outcome: 'retryable' })
  })

  it('switching to a still valid anchor during a refresh outage works and its token is usable', async () => {
    const grant = grantOn('w1', { expiresAt: Date.now() + 30_000 })
    saveGrant(grant)
    mocked(refresh).mockRejectedValue(refreshFailure('network'))
    const session = new CloudSession()

    const reply = await session.switchWorkspace('w1')

    expect(reply).toMatchObject({ workspaceId: 'w1' })
    expect(reply).not.toHaveProperty('workspaceSwitchFailure')
    await expect(session.getAccessToken()).resolves.toBe(grant.accessToken)
    expect(signIn).not.toHaveBeenCalled()
  })

  it('a still valid grant keeps minting during a refresh outage', async () => {
    const grant = grantOn('w1', { expiresAt: Date.now() + 30_000 })
    saveGrant(grant)
    mocked(refresh).mockRejectedValue(refreshFailure('network'))

    await expect(new CloudSession().switchWorkspace('w2')).resolves.toMatchObject({
      workspaceId: 'w2'
    })

    expect(mintRequests).toEqual([{ workspaceId: 'w2', bearer: grant.accessToken }])
    expect(signIn).not.toHaveBeenCalled()
  })

  it('a second refusal after the browser trip does not open another', async () => {
    saveGrant(grantOn('w1'))
    mintReply = () => json(403, { code: 'sso_required' })
    browserSignInReturns(signedInResult(grantOn('w3')))

    await expect(new CloudSession().switchWorkspace('w2')).resolves.toMatchObject({
      workspaceSwitchFailure: 'retryable'
    })

    expect(signIn).toHaveBeenCalledOnce()
  })

  it('a workspace refused after the browser trip reports unavailable', async () => {
    saveGrant(grantOn('w1'))
    let replies = 0
    mintReply = () => (replies++ === 0 ? json(403, { code: 'sso_required' }) : json(404, {}))
    browserSignInReturns(signedInResult(grantOn('w3')))

    await expect(new CloudSession().switchWorkspace('w2')).resolves.toMatchObject({
      workspaceSwitchFailure: 'unavailable'
    })
  })

  it('a sign-in that fails before the browser opens reports no browser trip', async () => {
    saveGrant(grantOn('w1'))
    mintReply = () => json(403, { code: 'sso_required' })
    mocked(signIn).mockRejectedValue(new SignInFailure('address in use', 'network'))

    await expect(new CloudSession().switchWorkspace('w2')).resolves.toMatchObject({
      workspaceId: 'w1',
      workspaceSwitchFailure: 'retryable'
    })

    expect(browserEvents()).toEqual([])
    expect(switchEvents()).toEqual([{ outcome: 'retryable', reauthorize_reason: 'sso_required' }])
  })

  it('a sign-in cancelled after the browser opened counts as one browser trip', async () => {
    saveGrant(grantOn('w1'))
    mintReply = () => json(403, { code: 'sso_required' })
    mocked(signIn).mockImplementation(async (options) => {
      options?.onAuthorizeUrl?.('https://cloud.test/authorize')
      throw new SignInFailure('access_denied', 'cancelled')
    })

    await new CloudSession().switchWorkspace('w2')

    expect(browserEvents()).toEqual([{ reauthorize_reason: 'sso_required' }])
    expect(switchEvents()).toEqual([{ outcome: 'browser', reauthorize_reason: 'sso_required' }])
  })

  it('a cancelled browser trip stays put and reports retryable', async () => {
    saveGrant(grantOn('w1'))
    mintReply = () => json(403, { code: 'sso_required' })
    mocked(signIn).mockRejectedValue(new SignInFailure('access_denied', 'cancelled'))

    await expect(new CloudSession().switchWorkspace('w2')).resolves.toMatchObject({
      workspaceId: 'w1',
      workspaceSwitchFailure: 'retryable'
    })
  })

  it('a different account in the browser replaces the vault', async () => {
    saveGrant(grantOn('w1'))
    const held = new CloudSession()
    await held.switchWorkspace('w2')
    mintRequests = []
    mintReply = () => json(403, { code: 'sso_required' })
    browserSignInReturns(signedInResult(grantOn('w9', { subject: 'user-2' })))

    await held.switchWorkspace('w3')

    expect(held.currentSubject()).toBe('user-2')
    expect(held.currentWorkspaceId()).toBe('w9')
    expect(vaultOnDisk().workspaceTokens).toEqual({})
  })
})

describe('CloudSession mint kill switches', () => {
  it('a server 503 disabled opens one browser carrying B, which activates with no further mint', async () => {
    saveGrant(grantOn('w1'))
    mintReply = mintDisabled
    const consented = grantOn('w2')
    browserSignInReturns(signedInResult(consented))
    const session = new CloudSession()

    await expect(session.switchWorkspace('w2')).resolves.toMatchObject({ workspaceId: 'w2' })

    expect(signIn).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ workspaceId: 'w2' }))
    expect(mintRequests).toHaveLength(1)
    expect(vaultOnDisk().grant).toEqual(consented)
    expect(switchEvents()).toEqual([{ outcome: 'browser', reauthorize_reason: 'mint_disabled' }])
    expect(browserEvents()).toEqual([{ reauthorize_reason: 'mint_disabled' }])
  })

  it('a 503 of any other kind stays retryable with no browser', async () => {
    saveGrant(grantOn('w1'))
    mintReply = () => json(503, { code: 'maintenance' })

    await expect(new CloudSession().switchWorkspace('w2')).resolves.toMatchObject({
      workspaceId: 'w1',
      workspaceSwitchFailure: 'retryable'
    })

    expect(signIn).not.toHaveBeenCalled()
  })

  it('no loop: consent on another workspace and a second 503 stays on the current one', async () => {
    const original = grantOn('w1')
    saveGrant(original)
    mintReply = mintDisabled
    browserSignInReturns(signedInResult(grantOn('w3')))
    const session = new CloudSession()

    await expect(session.switchWorkspace('w2')).resolves.toMatchObject({
      workspaceId: 'w1',
      workspaceSwitchFailure: 'retryable'
    })

    expect(signIn).toHaveBeenCalledOnce()
    expect(mintRequests).toHaveLength(2)
    await expect(session.getAccessToken()).resolves.toBe(original.accessToken)
  })

  it('the ops flag off skips the mint and opens one browser carrying B', async () => {
    saveGrant(grantOn('w1'))
    killMintSwitch()
    browserSignInReturns(signedInResult(grantOn('w2')))
    const session = new CloudSession()

    await expect(session.switchWorkspace('w2')).resolves.toMatchObject({ workspaceId: 'w2' })

    expect(mintRequests).toEqual([])
    expect(signIn).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ workspaceId: 'w2' }))
    expect(browserEvents()).toEqual([{ reauthorize_reason: 'mint_disabled' }])
  })

  it('no loop: the ops flag off and consent on another workspace opens no second browser', async () => {
    saveGrant(grantOn('w1'))
    killMintSwitch()
    browserSignInReturns(signedInResult(grantOn('w3')))
    const session = new CloudSession()

    await expect(session.switchWorkspace('w2')).resolves.toMatchObject({
      workspaceId: 'w1',
      workspaceSwitchFailure: 'retryable'
    })

    expect(mintRequests).toEqual([])
    expect(signIn).toHaveBeenCalledOnce()
  })

  it('the ops flag off still activates a valid minted token and the anchor with no browser', async () => {
    saveGrant(grantOn('w1'))
    const session = new CloudSession()
    await session.switchWorkspace('w2')
    await session.switchWorkspace('w1')
    mintRequests = []
    killMintSwitch()

    await expect(session.switchWorkspace('w2')).resolves.toMatchObject({ workspaceId: 'w2' })
    await expect(session.switchWorkspace('w1')).resolves.toMatchObject({ workspaceId: 'w1' })

    expect(mintRequests).toEqual([])
    expect(signIn).not.toHaveBeenCalled()
  })

  it('degraded mode: each workspace is one browser, and the previous anchor stays reachable', async () => {
    saveGrant(grantOn('w1'))
    killMintSwitch()
    mocked(signIn).mockImplementation(async (options) =>
      signedInResult(grantOn(options?.workspaceId ?? 'w1'))
    )
    const session = new CloudSession()

    await expect(session.switchWorkspace('w2')).resolves.toMatchObject({ workspaceId: 'w2' })
    await expect(session.switchWorkspace('w1')).resolves.toMatchObject({ workspaceId: 'w1' })

    expect(signIn).toHaveBeenCalledOnce()
    expect(mintRequests).toEqual([])
  })
})

describe('CloudSession regressions', () => {
  it('a version 1 vault on first launch is a scopeless grant: one browser, then it mints', async () => {
    const legacy = grantOn('w1', { scope: READ_ONLY_SCOPE })
    fs.writeFileSync(
      path.join(electronState.userData, 'comfy-cloud-auth.bin'),
      safeStorage.encryptString(
        JSON.stringify({
          version: 1,
          activeKey: 'workspace:w1',
          subject: 'user-1',
          bundles: {
            'workspace:w1': legacy,
            'workspace:w2': grantOn('w2', { scope: READ_ONLY_SCOPE })
          }
        })
      )
    )
    _resetForTest()
    browserSignInReturns(signedInResult(grantOn('w3')))
    const session = new CloudSession()

    expect(session.status()).toMatchObject({ signedIn: true, workspaceId: 'w1' })
    await expect(session.switchWorkspace('w2')).resolves.toMatchObject({ workspaceId: 'w2' })

    expect(signIn).toHaveBeenCalledOnce()
    expect(vaultOnDisk().version).toBe(2)
  })

  it('sign-out during a mint leaves nothing behind and opens no browser', async () => {
    saveGrant(grantOn('w1'))
    const reply = deferred<Response>()
    mintReply = () => reply.promise
    const session = new CloudSession()

    const switching = session.switchWorkspace('w2')
    await vi.waitFor(() => expect(mintRequests).toHaveLength(1))
    session.logout()
    reply.resolve(mintDisabled())

    await expect(switching).resolves.toEqual({ signedIn: false })
    expect(signIn).not.toHaveBeenCalled()
  })

  it('sign-out then a new switch does not join the signed-out flight', async () => {
    saveGrant(grantOn('w1'))
    const reply = deferred<Response>()
    mintReply = () => reply.promise
    const session = new CloudSession()

    const stale = session.switchWorkspace('w2')
    await vi.waitFor(() => expect(mintRequests).toHaveLength(1))
    session.logout()
    saveGrant(grantOn('w1'))
    mintReply = ({ workspaceId }) => minted(workspaceId)

    await expect(session.switchWorkspace('w2')).resolves.toMatchObject({ workspaceId: 'w2' })
    reply.resolve(minted('w2'))
    await stale

    expect(mintRequests).toHaveLength(2)
  })
})

describe('CloudSession grants without the mint scope (T-V29)', () => {
  it('opens exactly one browser, asks Cloud nothing first, and then mints', async () => {
    saveGrant(grantOn('w1', { scope: READ_ONLY_SCOPE }))
    browserSignInReturns(signedInResult(grantOn('w3')))
    const session = new CloudSession()

    await expect(session.switchWorkspace('w2')).resolves.toMatchObject({ workspaceId: 'w2' })

    expect(signIn).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ workspaceId: 'w2' }))
    expect(mintRequests).toHaveLength(1)
    expect(browserEvents()).toEqual([{ reauthorize_reason: 'mint_scope_missing' }])
  })

  it('needs no browser to reach its own anchor', async () => {
    saveGrant(grantOn('w1', { scope: READ_ONLY_SCOPE }))

    await expect(new CloudSession().switchWorkspace('w1')).resolves.toMatchObject({
      workspaceId: 'w1'
    })

    expect(signIn).not.toHaveBeenCalled()
  })

  it('cannot loop: a sign-in that returns no scope stays put, reports retryable and is telemetered', async () => {
    saveGrant(grantOn('w1', { scope: READ_ONLY_SCOPE }))
    browserSignInReturns(
      signedInResult(grantOn('w1', { scope: READ_ONLY_SCOPE, revision: '-again' }))
    )
    const session = new CloudSession()

    await expect(session.switchWorkspace('w2')).resolves.toMatchObject({
      workspaceId: 'w1',
      workspaceSwitchFailure: 'retryable'
    })

    expect(signIn).toHaveBeenCalledOnce()
    expect(mintRequests).toEqual([])
    expect(switchEvents()).toEqual([
      { outcome: 'browser', reauthorize_reason: 'mint_scope_missing' },
      { outcome: 'retryable', reauthorize_reason: 'scope_not_granted' }
    ])
    expect(browserEvents()).toEqual([{ reauthorize_reason: 'mint_scope_missing' }])
  })

  it('a second and third switch after a scopeless sign-in stay put with no browser', async () => {
    saveGrant(grantOn('w1', { scope: READ_ONLY_SCOPE }))
    browserSignInReturns(
      signedInResult(grantOn('w1', { scope: READ_ONLY_SCOPE, revision: '-again' }))
    )
    const session = new CloudSession()
    await session.switchWorkspace('w2')
    const browserTrips = browserEvents().length

    for (const workspaceId of ['w2', 'w3']) {
      await expect(session.switchWorkspace(workspaceId)).resolves.toMatchObject({
        workspaceId: 'w1',
        workspaceSwitchFailure: 'retryable'
      })
    }

    expect(signIn).toHaveBeenCalledOnce()
    expect(browserEvents()).toHaveLength(browserTrips)
    expect(mintRequests).toEqual([])
    expect(switchEvents().at(-1)).toEqual({
      outcome: 'retryable',
      reauthorize_reason: 'scope_not_granted'
    })
  })

  it('a scopeless grant on B reaches its anchor and asks no browser for the next workspace', async () => {
    saveGrant(grantOn('w1', { scope: READ_ONLY_SCOPE }))
    browserSignInReturns(signedInResult(grantOn('w2', { scope: READ_ONLY_SCOPE })))
    const session = new CloudSession()
    await session.switchWorkspace('w2')

    await expect(session.switchWorkspace('w3')).resolves.toMatchObject({
      workspaceId: 'w2',
      workspaceSwitchFailure: 'retryable'
    })

    expect(signIn).toHaveBeenCalledOnce()
  })

  it('an explicit sign-in with the scope lifts the hold and switching mints again', async () => {
    saveGrant(grantOn('w1', { scope: READ_ONLY_SCOPE }))
    browserSignInReturnsOnce(
      signedInResult(grantOn('w1', { scope: READ_ONLY_SCOPE, revision: '-again' }))
    )
    const session = new CloudSession()
    await session.switchWorkspace('w2')
    browserSignInReturnsOnce(signedInResult(grantOn('w1', { revision: '-scoped' })))

    await session.login()
    await expect(session.switchWorkspace('w2')).resolves.toMatchObject({ workspaceId: 'w2' })

    expect(signIn).toHaveBeenCalledTimes(2)
    expect(mintRequests).toHaveLength(1)
  })

  it('a grant that can mint lifts the hold, so one that later narrows can ask again', async () => {
    saveGrant(grantOn('w1', { scope: READ_ONLY_SCOPE }))
    browserSignInReturnsOnce(
      signedInResult(grantOn('w1', { scope: READ_ONLY_SCOPE, revision: '-again' }))
    )
    const session = new CloudSession()
    await session.switchWorkspace('w2')
    browserSignInReturnsOnce(
      signedInResult(grantOn('w1', { expiresAt: PAST, revision: '-scoped' }))
    )
    await session.login()
    mocked(refresh).mockResolvedValue(
      grantOn('w1', { scope: READ_ONLY_SCOPE, revision: '-narrow' })
    )
    mintReply = () => json(403, { code: 'insufficient_scope' })
    await session.switchWorkspace('w2')
    browserSignInReturnsOnce(signedInResult(grantOn('w3')))

    await expect(session.switchWorkspace('w3')).resolves.toMatchObject({ workspaceId: 'w3' })

    expect(signIn).toHaveBeenCalledTimes(3)
  })

  it('an explicit sign-in that also returns no scope keeps ordinary switches off the browser', async () => {
    saveGrant(grantOn('w1', { scope: READ_ONLY_SCOPE }))
    browserSignInReturns(
      signedInResult(grantOn('w1', { scope: READ_ONLY_SCOPE, revision: '-again' }))
    )
    const session = new CloudSession()

    await session.login()
    await expect(session.switchWorkspace('w2')).resolves.toMatchObject({
      workspaceSwitchFailure: 'retryable'
    })

    expect(signIn).toHaveBeenCalledOnce()
  })

  it('logout resets the hold', async () => {
    saveGrant(grantOn('w1', { scope: READ_ONLY_SCOPE }))
    browserSignInReturns(
      signedInResult(grantOn('w1', { scope: READ_ONLY_SCOPE, revision: '-again' }))
    )
    const session = new CloudSession()
    await session.switchWorkspace('w2')

    session.logout()
    saveGrant(grantOn('w1', { scope: READ_ONLY_SCOPE }))
    await session.switchWorkspace('w2')

    expect(signIn).toHaveBeenCalledTimes(2)
  })

  it('a restart keeps the hold: no second browser across sessions', async () => {
    saveGrant(grantOn('w1', { scope: READ_ONLY_SCOPE }))
    browserSignInReturns(
      signedInResult(grantOn('w1', { scope: READ_ONLY_SCOPE, revision: '-again' }))
    )
    await new CloudSession().switchWorkspace('w2')
    _resetForTest()

    await expect(new CloudSession().switchWorkspace('w2')).resolves.toMatchObject({
      workspaceId: 'w1',
      workspaceSwitchFailure: 'retryable'
    })

    expect(signIn).toHaveBeenCalledOnce()
    expect(vaultOnDisk().mintScopeWithheld).toBe(true)
  })

  it('a pre-upgrade grant gets its one trip on first launch, then the hold survives restarts', async () => {
    fs.writeFileSync(
      path.join(electronState.userData, 'comfy-cloud-auth.bin'),
      safeStorage.encryptString(
        JSON.stringify({
          version: 1,
          activeKey: 'workspace:w1',
          subject: 'user-1',
          bundles: { 'workspace:w1': grantOn('w1', { scope: READ_ONLY_SCOPE }) }
        })
      )
    )
    _resetForTest()
    browserSignInReturns(
      signedInResult(grantOn('w1', { scope: READ_ONLY_SCOPE, revision: '-again' }))
    )
    expect(vaultOnDisk().mintScopeWithheld).toBeUndefined()

    await new CloudSession().switchWorkspace('w2')
    expect(signIn).toHaveBeenCalledOnce()
    _resetForTest()
    await new CloudSession().switchWorkspace('w2')

    expect(signIn).toHaveBeenCalledOnce()
  })

  it('a restart with a scoped sign-in in between mints: the grant that can mint cleared the hold', async () => {
    saveGrant(grantOn('w1', { scope: READ_ONLY_SCOPE }))
    browserSignInReturnsOnce(
      signedInResult(grantOn('w1', { scope: READ_ONLY_SCOPE, revision: '-again' }))
    )
    const session = new CloudSession()
    await session.switchWorkspace('w2')
    browserSignInReturnsOnce(signedInResult(grantOn('w1', { revision: '-scoped' })))
    await session.login()
    _resetForTest()

    await expect(new CloudSession().switchWorkspace('w2')).resolves.toMatchObject({
      workspaceId: 'w2'
    })

    expect(signIn).toHaveBeenCalledTimes(2)
    expect(vaultOnDisk()).not.toHaveProperty('mintScopeWithheld')
  })

  it('an explicit sign-in can still try after a restart', async () => {
    saveGrant(grantOn('w1', { scope: READ_ONLY_SCOPE }))
    browserSignInReturns(
      signedInResult(grantOn('w1', { scope: READ_ONLY_SCOPE, revision: '-again' }))
    )
    await new CloudSession().switchWorkspace('w2')
    _resetForTest()

    await new CloudSession().login()

    expect(signIn).toHaveBeenCalledTimes(2)
  })

  it('emits one mint_scope_not_granted for a switch sign-in, and none for the later held switches', async () => {
    saveGrant(grantOn('w1', { scope: READ_ONLY_SCOPE }))
    browserSignInReturns(signedInResult(grantOn('w1', { scope: READ_ONLY_SCOPE, revision: '-b' })))
    const session = new CloudSession()

    await session.switchWorkspace('w2')
    await session.switchWorkspace('w3')

    expect(mintScopeNotGrantedEvents()).toHaveLength(1)
  })

  it('emits one mint_scope_not_granted for an explicit sign-in with no scope', async () => {
    browserSignInReturns(signedInResult(grantOn('w1', { scope: READ_ONLY_SCOPE })))

    await new CloudSession().login()

    expect(mintScopeNotGrantedEvents()).toHaveLength(1)
  })

  it('emits no mint_scope_not_granted when a sign-in returns the scope', async () => {
    browserSignInReturns(signedInResult(grantOn('w1')))
    const session = new CloudSession()

    await session.login()

    expect(mintScopeNotGrantedEvents()).toEqual([])
  })

  it('emits none for a scopeless sign-in dropped after logout', async () => {
    const pending = deferred<Awaited<ReturnType<typeof signIn>>>()
    mocked(signIn).mockReturnValue(pending.promise)
    const session = new CloudSession()

    const login = session.login()
    session.logout()
    pending.resolve(signedInResult(grantOn('w1', { scope: READ_ONLY_SCOPE })))
    await login

    expect(mintScopeNotGrantedEvents()).toEqual([])
  })

  it('reports scope_not_granted when an sso sign-in narrows a grant that could mint', async () => {
    saveGrant(grantOn('w1'))
    mintReply = () => json(403, { code: 'sso_required' })
    browserSignInReturns(signedInResult(grantOn('w1', { scope: READ_ONLY_SCOPE })))

    await expect(new CloudSession().switchWorkspace('w2')).resolves.toMatchObject({
      workspaceSwitchFailure: 'retryable'
    })

    expect(signIn).toHaveBeenCalledOnce()
    expect(switchEvents()).toContainEqual({
      outcome: 'retryable',
      reauthorize_reason: 'scope_not_granted'
    })
    expect(browserEvents()).toEqual([{ reauthorize_reason: 'sso_required' }])
  })

  it('a scopeless grant consented on B activates B, since an anchor needs no mint', async () => {
    saveGrant(grantOn('w1', { scope: READ_ONLY_SCOPE }))
    browserSignInReturns(signedInResult(grantOn('w2', { scope: READ_ONLY_SCOPE })))

    const reply = await new CloudSession().switchWorkspace('w2')

    expect(reply).toMatchObject({ workspaceId: 'w2' })
    expect(reply).not.toHaveProperty('workspaceSwitchFailure')
    expect(signIn).toHaveBeenCalledOnce()
    expect(switchEvents()).toContainEqual({
      outcome: 'anchor',
      reauthorize_reason: 'scope_not_granted'
    })
    expect(browserEvents()).toEqual([{ reauthorize_reason: 'mint_scope_missing' }])
  })
})

describe('CloudSession fencing (T-V27)', () => {
  it('drops a mint reply that lands after logout', async () => {
    saveGrant(grantOn('w1'))
    const reply = deferred<Response>()
    mintReply = () => reply.promise
    const session = new CloudSession()

    const switching = session.switchWorkspace('w2')
    await vi.waitFor(() => expect(mintRequests).toHaveLength(1))
    session.logout()
    reply.resolve(minted('w2'))

    await expect(switching).resolves.toEqual({ signedIn: false })
    expect(session.isSignedIn()).toBe(false)
    expect(fs.existsSync(path.join(electronState.userData, 'comfy-cloud-auth.bin'))).toBe(false)
  })

  it('drops a mint reply that lands after a newer switch, activating and storing nothing', async () => {
    saveGrant(grantOn('w1'))
    const slow = deferred<Response>()
    mintReply = ({ workspaceId }) => (workspaceId === 'w2' ? slow.promise : minted(workspaceId))
    const session = new CloudSession()

    const older = session.switchWorkspace('w2')
    await vi.waitFor(() => expect(mintRequests).toHaveLength(1))
    await session.switchWorkspace('w3')
    slow.resolve(minted('w2'))
    await older

    expect(session.currentWorkspaceId()).toBe('w3')
    expect(Object.keys(vaultOnDisk().workspaceTokens as object)).toEqual(['w3'])
    expect(switchEvents()).toEqual([{ outcome: 'minted' }])
  })

  it('a mint from before A to B to A does not satisfy the later switch to the same workspace', async () => {
    saveGrant(grantOn('w1'))
    const slow = deferred<Response>()
    const replies = [slow.promise]
    mintReply = ({ workspaceId }) => replies.shift() ?? minted(workspaceId)
    const session = new CloudSession()

    const first = session.switchWorkspace('w2')
    await vi.waitFor(() => expect(mintRequests).toHaveLength(1))
    await session.switchWorkspace('w1')
    const second = session.switchWorkspace('w2')
    await vi.waitFor(() => expect(mintRequests).toHaveLength(2))
    await second
    slow.resolve(json(500, {}))
    await first

    expect(session.currentWorkspaceId()).toBe('w2')
  })

  it('drops a sign-in that finishes after a newer switch', async () => {
    saveGrant(grantOn('w1'))
    mintReply = ({ workspaceId }) =>
      workspaceId === 'w2' ? json(403, { code: 'sso_required' }) : minted(workspaceId)
    const pending = deferred<Awaited<ReturnType<typeof signIn>>>()
    mocked(signIn).mockReturnValue(pending.promise)
    const original = grantOn('w1')
    const session = new CloudSession()

    const older = session.switchWorkspace('w2')
    await vi.waitFor(() => expect(signIn).toHaveBeenCalledOnce())
    await session.switchWorkspace('w3')
    pending.resolve(signedInResult(grantOn('w2', { revision: '-late' })))
    await older

    expect(session.currentWorkspaceId()).toBe('w3')
    expect(vaultOnDisk().grant).toEqual(original)
  })

  it('drops a sign-in that finishes after logout', async () => {
    saveGrant(grantOn('w1'))
    mintReply = () => json(403, { code: 'sso_required' })
    const pending = deferred<Awaited<ReturnType<typeof signIn>>>()
    mocked(signIn).mockReturnValue(pending.promise)
    const session = new CloudSession()

    const switching = session.switchWorkspace('w2')
    await vi.waitFor(() => expect(signIn).toHaveBeenCalledOnce())
    session.logout()
    pending.resolve(signedInResult(grantOn('w2')))

    await expect(switching).resolves.toEqual({ signedIn: false })
    expect(session.isSignedIn()).toBe(false)
  })

  it('does not let a re-mint from before logout reach the next account', async () => {
    saveGrant(grantOn('w1'))
    mintReply = ({ workspaceId }) => minted(workspaceId, Date.now() + 30_000)
    const session = new CloudSession()
    await session.switchWorkspace('w2')
    const slow = deferred<Response>()
    mintReply = () => slow.promise

    const request = session.getAccessToken()
    await vi.waitFor(() => expect(mintRequests).toHaveLength(2))
    session.logout()
    saveGrant(grantOn('w1', { subject: 'user-2' }))
    slow.resolve(minted('w2'))

    await expect(request).resolves.toBeNull()
    expect(vaultOnDisk().workspaceTokens).toEqual({})
  })
})

describe('CloudSession status and catalog', () => {
  it('reports the active workspace from the minted token, stale claims included', async () => {
    saveGrant(grantOn('w1'))
    const session = new CloudSession()

    await session.switchWorkspace('w2')
    saveWorkspaceToken('w2', { accessToken: mintedJwt('w2'), expiresAt: PAST })

    expect(session.status()).toMatchObject({
      signedIn: true,
      workspaceId: 'w2',
      workspaceType: 'team',
      role: 'member',
      email: 'user-1@example.com'
    })
    expect(session.currentWorkspaceId()).toBe('w2')
  })

  it('lists workspaces with the grant and members with the active token', async () => {
    const grant = grantOn('w1')
    saveGrant(grant)
    const session = new CloudSession()
    await session.switchWorkspace('w2')

    await session.listWorkspaces()
    await session.listWorkspaceMembers()

    expect(listWorkspaces).toHaveBeenCalledExactlyOnceWith(grant.accessToken)
    expect(listWorkspaceMembers).toHaveBeenCalledExactlyOnceWith(mintedJwt('w2'))
  })
})

describe('CloudSession token provider', () => {
  it('logs out when the grant token is rejected', () => {
    const grant = grantOn('w1')
    saveGrant(grant)
    const session = new CloudSession()
    const onSignedOut = vi.fn()

    session.asTokenProvider(onSignedOut).onUnauthorized?.(grant.accessToken)

    expect(session.isSignedIn()).toBe(false)
    expect(onSignedOut).toHaveBeenCalledOnce()
  })

  it('drops only a rejected minted token, stays signed in, and re-mints with no browser', async () => {
    saveGrant(grantOn('w1'))
    const session = new CloudSession()
    await session.switchWorkspace('w2')
    const onSignedOut = vi.fn()
    const provider = session.asTokenProvider(onSignedOut)

    provider.onUnauthorized?.(mintedJwt('w2'))

    expect(onSignedOut).not.toHaveBeenCalled()
    expect(session.status()).toMatchObject({ signedIn: true, workspaceId: 'w2' })
    await expect(provider.getAccessToken()).resolves.toBe(mintedJwt('w2'))
    expect(mintRequests).toHaveLength(2)
    expect(signIn).not.toHaveBeenCalled()
  })

  it('ignores a rejected token it no longer holds', () => {
    saveGrant(grantOn('w1'))
    const session = new CloudSession()
    const onSignedOut = vi.fn()

    session.asTokenProvider(onSignedOut).onUnauthorized?.('older-token')

    expect(session.isSignedIn()).toBe(true)
    expect(onSignedOut).not.toHaveBeenCalled()
  })
})
