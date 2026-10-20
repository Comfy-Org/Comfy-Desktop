// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./oauth', () => ({
  refresh: vi.fn(),
  openAuthorizePage: vi.fn(() => Promise.resolve())
}))
vi.mock('./accountSession', () => ({
  signInAccount: vi.fn(),
  mintWorkspaceToken: vi.fn(),
  mintPartnerNodeToken: vi.fn(),
  revokeAccountSession: vi.fn(async () => {})
}))
vi.mock('./tokenStore', () => ({
  activateWorkspace: vi.fn(),
  clearTokens: vi.fn(),
  getAuthStatus: vi.fn(),
  loadTokens: vi.fn(),
  loadWorkspaceTokens: vi.fn(),
  replaceWorkspaceTokens: vi.fn(),
  saveTokens: vi.fn(),
  saveWorkspaceNames: vi.fn()
}))
vi.mock('./workspaces', () => ({
  listWorkspaces: vi.fn(async () => [{ id: 'w-1' }]),
  listWorkspaceMembers: vi.fn(async () => [{ id: 'user-1', name: 'One' }])
}))

import { statusFromAccessToken, workspaceIdOf } from './claims'
import { openAuthorizePage, refresh } from './oauth'
import {
  signInAccount,
  mintWorkspaceToken,
  mintPartnerNodeToken,
  revokeAccountSession
} from './accountSession'
import { SignInFailure } from './signInFailure'
import { CloudSession } from './session'
import {
  activateWorkspace,
  clearTokens,
  getAuthStatus,
  loadTokens,
  loadWorkspaceTokens,
  replaceWorkspaceTokens,
  saveTokens,
  saveWorkspaceNames
} from './tokenStore'
import type { AuthTokens } from './types'
import { listWorkspaceMembers, listWorkspaces } from './workspaces'

const mocked = vi.mocked
const future = Date.now() + 3_600_000
const past = Date.now() - 1_000

let active: AuthTokens | null
let bundles: Map<string, AuthTokens>

function jwt(workspaceId: string, suffix = ''): string {
  const b64 = (value: unknown): string =>
    Buffer.from(JSON.stringify(value), 'utf-8').toString('base64url')
  return `${b64({ alg: 'RS256' })}.${b64({ sub: 'user-1', workspace_id: workspaceId })}.sig${suffix}`
}

function makeTokens(workspaceId: string, expiresAt = future, suffix = ''): AuthTokens {
  return {
    accessToken: jwt(workspaceId, suffix),
    refreshToken: `refresh-${workspaceId}${suffix}`,
    expiresAt
  }
}

function cache(tokens: AuthTokens, makeActive = false): void {
  const workspaceId = workspaceIdOf(tokens.accessToken)
  if (workspaceId) bundles.set(workspaceId, tokens)
  if (makeActive) active = tokens
}

beforeEach(() => {
  active = null
  bundles = new Map()
  mocked(loadTokens).mockImplementation(() => active)
  mocked(loadWorkspaceTokens).mockImplementation((workspaceId) =>
    workspaceId ? (bundles.get(workspaceId) ?? null) : null
  )
  mocked(activateWorkspace).mockImplementation((workspaceId) => {
    const tokens = bundles.get(workspaceId) ?? null
    if (tokens) active = tokens
    return tokens
  })
  mocked(saveTokens).mockImplementation((tokens) => cache(tokens, true))
  mocked(replaceWorkspaceTokens).mockImplementation(
    (workspaceId, expectedAccessToken, expectedRefreshToken, tokens) => {
      if (!workspaceId) return false
      const current = bundles.get(workspaceId)
      if (
        !current ||
        current.accessToken !== expectedAccessToken ||
        current.refreshToken !== expectedRefreshToken
      ) {
        return false
      }
      bundles.set(workspaceId, tokens)
      if (active?.accessToken === expectedAccessToken) active = tokens
      return true
    }
  )
  mocked(clearTokens).mockImplementation(() => {
    active = null
    bundles.clear()
  })
  mocked(getAuthStatus).mockImplementation(() =>
    active ? statusFromAccessToken(active.accessToken) : { signedIn: false }
  )
})

afterEach(() => vi.clearAllMocks())

describe('CloudSession access tokens', () => {
  it('returns null when signed out and an unexpired token without refreshing', async () => {
    const session = new CloudSession()
    await expect(session.getAccessToken()).resolves.toBeNull()

    const tokens = makeTokens('w1')
    cache(tokens, true)
    await expect(session.getAccessToken()).resolves.toBe(tokens.accessToken)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('single-flights and persists a refresh rotation', async () => {
    const stale = makeTokens('w1', past)
    const fresh = makeTokens('w1', future, '-fresh')
    cache(stale, true)
    let finishRefresh!: (tokens: AuthTokens) => void
    mocked(refresh).mockReturnValue(
      new Promise((resolve) => {
        finishRefresh = resolve
      })
    )
    const session = new CloudSession()

    const calls = [session.getAccessToken(), session.getAccessToken(), session.getAccessToken()]
    finishRefresh(fresh)

    await expect(Promise.all(calls)).resolves.toEqual([
      fresh.accessToken,
      fresh.accessToken,
      fresh.accessToken
    ])
    expect(refresh).toHaveBeenCalledOnce()
    expect(replaceWorkspaceTokens).toHaveBeenCalledExactlyOnceWith(
      'w1',
      stale.accessToken,
      stale.refreshToken,
      fresh
    )
  })

  it('isolates concurrent refresh rotations for different workspaces', async () => {
    const staleOne = makeTokens('w1', past)
    const freshOne = makeTokens('w1', future, '-fresh')
    const staleTwo = makeTokens('w2', past)
    const freshTwo = makeTokens('w2', future, '-fresh')
    cache(staleOne, true)
    cache(staleTwo)
    const refreshes = new Map<string, (tokens: AuthTokens) => void>()
    mocked(refresh).mockImplementation(
      (refreshToken) =>
        new Promise((resolve) => {
          refreshes.set(refreshToken, resolve)
        })
    )
    const session = new CloudSession()

    const oldRequest = session.getAccessToken()
    const switching = session.switchWorkspace('w2')
    expect(refresh).toHaveBeenCalledTimes(2)
    refreshes.get(staleTwo.refreshToken!)!(freshTwo)
    await expect(switching).resolves.toMatchObject({ workspaceId: 'w2' })
    refreshes.get(staleOne.refreshToken!)!(freshOne)

    await expect(oldRequest).resolves.toBeNull()
    expect(active).toEqual(freshTwo)
    expect(bundles.get('w1')).toEqual(freshOne)
  })

  it('does not let a refresh completion restore credentials after logout', async () => {
    const stale = makeTokens('w1', past)
    const fresh = makeTokens('w1', future, '-fresh')
    cache(stale, true)
    let finishRefresh!: (tokens: AuthTokens) => void
    mocked(refresh).mockReturnValue(
      new Promise((resolve) => {
        finishRefresh = resolve
      })
    )
    const session = new CloudSession()

    const request = session.getAccessToken()
    session.logout()
    finishRefresh(fresh)

    await expect(request).resolves.toBeNull()
    expect(active).toBeNull()
    expect(replaceWorkspaceTokens).toHaveReturnedWith(false)
  })
})

describe('CloudSession browser auth', () => {
  it('single-flights repeated login requests', async () => {
    let finishLogin!: (value: Awaited<ReturnType<typeof signInAccount>>) => void
    mocked(signInAccount).mockReturnValue(
      new Promise((resolve) => {
        finishLogin = resolve
      })
    )
    const session = new CloudSession()

    const first = session.login()
    const second = session.login()
    const tokens = makeTokens('w1')
    finishLogin(tokens)

    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(signInAccount).toHaveBeenCalledOnce()
    expect(saveTokens).toHaveBeenCalledExactlyOnceWith(tokens)
  })

  it('reopens the pending sign-in page when login is requested again', async () => {
    mocked(signInAccount).mockImplementation(async (onAuthorizeUrl) => {
      onAuthorizeUrl('https://cloud.test/authorize?state=s1')
      return new Promise(() => {})
    })
    const session = new CloudSession()

    void session.login()
    await vi.waitFor(() => expect(signInAccount).toHaveBeenCalledOnce())
    void session.login()

    expect(signInAccount).toHaveBeenCalledOnce()
    expect(openAuthorizePage).toHaveBeenCalledExactlyOnceWith(
      'https://cloud.test/authorize?state=s1'
    )
  })

  it('does not reopen a sign-in page after logout', async () => {
    mocked(signInAccount).mockImplementation(async (onAuthorizeUrl) => {
      onAuthorizeUrl('https://cloud.test/authorize?state=s1')
      return new Promise(() => {})
    })
    const session = new CloudSession()

    void session.login()
    await vi.waitFor(() => expect(signInAccount).toHaveBeenCalledOnce())
    session.logout()
    void session.login()

    expect(signInAccount).toHaveBeenCalledTimes(2)
    expect(openAuthorizePage).not.toHaveBeenCalled()
  })

  it('does not persist browser auth that finishes after logout', async () => {
    let finishLogin!: (value: Awaited<ReturnType<typeof signInAccount>>) => void
    mocked(signInAccount).mockReturnValue(
      new Promise((resolve) => {
        finishLogin = resolve
      })
    )
    const session = new CloudSession()

    const login = session.login()
    session.logout()
    const tokens = makeTokens('w1')
    finishLogin(tokens)

    await expect(login).resolves.toEqual({ signedIn: false })
    expect(saveTokens).not.toHaveBeenCalled()
  })
})

describe('CloudSession workspaces', () => {
  it('switches A to B to A from cache without browser auth', async () => {
    const workspaceOne = makeTokens('w1')
    const workspaceTwo = makeTokens('w2')
    cache(workspaceOne, true)
    cache(workspaceTwo)
    const session = new CloudSession()

    await expect(session.switchWorkspace('w2')).resolves.toMatchObject({ workspaceId: 'w2' })
    await expect(session.switchWorkspace('w1')).resolves.toMatchObject({ workspaceId: 'w1' })

    expect(activateWorkspace).toHaveBeenNthCalledWith(1, 'w2')
    expect(activateWorkspace).toHaveBeenNthCalledWith(2, 'w1')
    expect(signInAccount).not.toHaveBeenCalled()
  })

  it('refreshes an expired cached workspace independently before activating it', async () => {
    const workspaceOne = makeTokens('w1')
    const staleTwo = makeTokens('w2', past)
    const freshTwo = makeTokens('w2', future, '-fresh')
    cache(workspaceOne, true)
    cache(staleTwo)
    mocked(refresh).mockResolvedValue(freshTwo)

    await expect(new CloudSession().switchWorkspace('w2')).resolves.toMatchObject({
      workspaceId: 'w2'
    })

    expect(refresh).toHaveBeenCalledExactlyOnceWith(staleTwo.refreshToken)
    expect(activateWorkspace).toHaveBeenCalledExactlyOnceWith('w2')
    expect(signInAccount).not.toHaveBeenCalled()
  })

  it('uses browser auth when the active workspace can no longer refresh', async () => {
    const stale = makeTokens('w1', past)
    const authorized = makeTokens('w1', future, '-authorized')
    cache(stale, true)
    mocked(refresh).mockRejectedValue(new Error('revoked'))
    mocked(signInAccount).mockResolvedValue(authorized)

    await expect(new CloudSession().switchWorkspace('w1')).resolves.toMatchObject({
      workspaceId: 'w1'
    })

    expect(refresh).toHaveBeenCalledExactlyOnceWith(stale.refreshToken)
    expect(signInAccount).toHaveBeenCalledExactlyOnceWith(
      expect.any(Function),
      expect.any(AbortSignal)
    )
    expect(saveTokens).toHaveBeenCalledExactlyOnceWith(authorized)
  })

  it('keeps the active workspace when the backend refuses another workspace', async () => {
    const workspaceOne = { ...makeTokens('w1'), sessionToken: 'comfy-session-root' }
    cache(workspaceOne, true)
    mocked(mintWorkspaceToken).mockRejectedValue(
      new SignInFailure('denied', 'server_error', { httpStatus: 404 })
    )
    await expect(new CloudSession().switchWorkspace('w2')).rejects.toMatchObject({
      httpStatus: 404
    })
    expect(active).toEqual(workspaceOne)
    expect(signInAccount).not.toHaveBeenCalled()
  })

  it('checks membership on each workspace switch without browser auth', async () => {
    const root = 'comfy-session-root'
    cache({ ...makeTokens('w1'), sessionToken: root }, true)
    mocked(mintWorkspaceToken).mockImplementation(async (_, workspaceId) => ({
      ...makeTokens(workspaceId!),
      refreshToken: undefined,
      sessionToken: root
    }))
    const session = new CloudSession()
    for (const workspace of ['w2', 'w1', 'w2']) {
      await expect(session.switchWorkspace(workspace)).resolves.toMatchObject({
        workspaceId: workspace
      })
      expect(mintWorkspaceToken).toHaveBeenLastCalledWith(root, workspace)
    }
    expect(signInAccount).not.toHaveBeenCalled()
  })

  it('discards a workspace response that arrives after sign-out', async () => {
    const tokens = { ...makeTokens('w1'), sessionToken: 'comfy-session-root' }
    cache(tokens, true)
    const response = Promise.withResolvers<AuthTokens>()
    mocked(mintWorkspaceToken).mockReturnValue(response.promise)
    const session = new CloudSession()
    const switching = session.switchWorkspace('w2')
    session.logout()
    response.resolve({ ...makeTokens('w2'), sessionToken: tokens.sessionToken })
    await expect(switching).resolves.toEqual({ signedIn: false })
    expect(saveTokens).not.toHaveBeenCalled()
    expect(revokeAccountSession).toHaveBeenCalledWith(tokens.sessionToken)
  })

  it('obtains partner-node access only for the active workspace', async () => {
    const tokens = { ...makeTokens('w1'), sessionToken: 'comfy-session-root' }
    cache(tokens, true)
    mocked(mintPartnerNodeToken).mockResolvedValue({
      accessToken: 'partner-token',
      expiresAt: future,
      sessionToken: tokens.sessionToken
    })
    const session = new CloudSession()
    await expect(session.getPartnerNodeToken('w2')).resolves.toBeNull()
    await expect(
      Promise.all([session.getPartnerNodeToken('w1'), session.getPartnerNodeToken('w1')])
    ).resolves.toEqual(['partner-token', 'partner-token'])
    await expect(session.getPartnerNodeToken('w1')).resolves.toBe('partner-token')
    expect(mintPartnerNodeToken).toHaveBeenCalledExactlyOnceWith(tokens.sessionToken, 'w1')
  })

  it('listWorkspaces and the provider use only the active token', async () => {
    const tokens = makeTokens('w1')
    cache(tokens, true)
    const session = new CloudSession()
    await session.listWorkspaces()
    expect(listWorkspaces).toHaveBeenCalledWith(tokens.accessToken)
    expect(saveWorkspaceNames).toHaveBeenCalledExactlyOnceWith(tokens.accessToken, [{ id: 'w-1' }])

    const onSignedOut = vi.fn()
    const provider = session.asTokenProvider(onSignedOut)
    await expect(provider.getAccessToken()).resolves.toBe(tokens.accessToken)
    provider.onUnauthorized?.(tokens.accessToken)
    expect(clearTokens).toHaveBeenCalledOnce()
    expect(onSignedOut).toHaveBeenCalledOnce()
  })

  it('lists members using only the active workspace token', async () => {
    const tokens = makeTokens('w1')
    cache(tokens, true)

    await expect(new CloudSession().listWorkspaceMembers()).resolves.toEqual([
      { id: 'user-1', name: 'One' }
    ])
    expect(listWorkspaceMembers).toHaveBeenCalledExactlyOnceWith(tokens.accessToken)
  })
})
