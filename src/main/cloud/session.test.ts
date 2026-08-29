// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./oauth', () => ({ signIn: vi.fn(), refresh: vi.fn() }))
vi.mock('./tokenStore', () => ({
  loadTokens: vi.fn(),
  saveTokens: vi.fn(),
  clearTokens: vi.fn(),
  getAuthStatus: vi.fn(() => ({ signedIn: false }))
}))
vi.mock('./workspaces', () => ({ listWorkspaces: vi.fn(async () => [{ id: 'w-1' }]) }))

import { CloudSession } from './session'
import { refresh, signIn } from './oauth'
import { clearTokens, loadTokens, saveTokens } from './tokenStore'
import { listWorkspaces } from './workspaces'

const mocked = vi.mocked
const future = Date.now() + 3_600_000
const past = Date.now() - 1_000

describe('CloudSession.getAccessToken', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns null when signed out', async () => {
    mocked(loadTokens).mockReturnValue(null)
    expect(await new CloudSession().getAccessToken()).toBeNull()
  })

  it('returns the token without refreshing when it is still valid', async () => {
    mocked(loadTokens).mockReturnValue({
      accessToken: 'good',
      refreshToken: 'r',
      expiresAt: future
    })
    expect(await new CloudSession().getAccessToken()).toBe('good')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('refreshes + persists when expired and a refresh token exists', async () => {
    mocked(loadTokens).mockReturnValue({ accessToken: 'stale', refreshToken: 'r', expiresAt: past })
    mocked(refresh).mockResolvedValue({
      accessToken: 'fresh',
      refreshToken: 'r2',
      expiresAt: future
    })
    expect(await new CloudSession().getAccessToken()).toBe('fresh')
    expect(saveTokens).toHaveBeenCalledWith({
      accessToken: 'fresh',
      refreshToken: 'r2',
      expiresAt: future
    })
  })

  it('falls back to the stale token when refresh fails', async () => {
    mocked(loadTokens).mockReturnValue({ accessToken: 'stale', refreshToken: 'r', expiresAt: past })
    mocked(refresh).mockRejectedValue(new Error('down'))
    expect(await new CloudSession().getAccessToken()).toBe('stale')
  })

  it('does not attempt refresh without a refresh token', async () => {
    mocked(loadTokens).mockReturnValue({ accessToken: 'stale', expiresAt: past })
    expect(await new CloudSession().getAccessToken()).toBe('stale')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('single-flights concurrent refreshes (one rotation, no token-family race)', async () => {
    mocked(loadTokens).mockReturnValue({ accessToken: 'stale', refreshToken: 'r', expiresAt: past })
    let resolveRefresh!: (t: {
      accessToken: string
      refreshToken: string
      expiresAt: number
    }) => void
    mocked(refresh).mockReturnValue(
      new Promise((r) => {
        resolveRefresh = r
      })
    )
    const s = new CloudSession()
    const [p1, p2, p3] = [s.getAccessToken(), s.getAccessToken(), s.getAccessToken()]
    resolveRefresh({ accessToken: 'fresh', refreshToken: 'r2', expiresAt: future })
    expect(await Promise.all([p1, p2, p3])).toEqual(['fresh', 'fresh', 'fresh'])
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('does not let a refresh completion resurrect a logged-out session', async () => {
    const oldTokens = { accessToken: 'stale', refreshToken: 'r', expiresAt: past }
    let current: typeof oldTokens | null = oldTokens
    mocked(loadTokens).mockImplementation(() => current)
    let resolveRefresh!: (t: {
      accessToken: string
      refreshToken: string
      expiresAt: number
    }) => void
    mocked(refresh).mockReturnValue(
      new Promise((resolve) => {
        resolveRefresh = resolve
      })
    )
    const session = new CloudSession()

    const accessToken = session.getAccessToken()
    session.logout()
    current = null
    resolveRefresh({ accessToken: 'resurrected', refreshToken: 'r2', expiresAt: future })

    await expect(accessToken).resolves.toBeNull()
    expect(saveTokens).not.toHaveBeenCalled()
  })

  it('does not let an old refresh overwrite a newer browser login', async () => {
    type Tokens = { accessToken: string; refreshToken?: string; expiresAt: number }
    let current: Tokens | null = { accessToken: 'old', refreshToken: 'old-r', expiresAt: past }
    mocked(loadTokens).mockImplementation(() => current)
    mocked(saveTokens).mockImplementation((tokens) => {
      current = tokens
    })
    let resolveRefresh!: (t: Tokens) => void
    mocked(refresh).mockReturnValue(
      new Promise((resolve) => {
        resolveRefresh = resolve
      })
    )
    mocked(signIn).mockResolvedValue({
      tokens: { accessToken: 'new', refreshToken: 'new-r', expiresAt: future },
      status: { signedIn: true, email: 'new@comfy.org' }
    })
    const session = new CloudSession()

    const accessToken = session.getAccessToken()
    await session.login()
    resolveRefresh({ accessToken: 'old-refreshed', refreshToken: 'old-r2', expiresAt: future })

    await expect(accessToken).resolves.toBe('new')
    expect(saveTokens).toHaveBeenCalledExactlyOnceWith({
      accessToken: 'new',
      refreshToken: 'new-r',
      expiresAt: future
    })
  })
})

describe('CloudSession browser auth', () => {
  afterEach(() => vi.clearAllMocks())

  it('single-flights repeated login requests', async () => {
    let resolveLogin!: (value: Awaited<ReturnType<typeof signIn>>) => void
    mocked(signIn).mockReturnValue(
      new Promise((resolve) => {
        resolveLogin = resolve
      })
    )
    const session = new CloudSession()

    const first = session.login()
    const second = session.login()
    resolveLogin({
      tokens: { accessToken: 'current', expiresAt: future },
      status: { signedIn: true, email: 'current@comfy.org' }
    })

    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(signIn).toHaveBeenCalledOnce()
    expect(saveTokens).toHaveBeenCalledOnce()
  })

  it('does not persist a login that finishes after logout', async () => {
    let resolveLogin!: (value: Awaited<ReturnType<typeof signIn>>) => void
    mocked(signIn).mockReturnValue(
      new Promise((resolve) => {
        resolveLogin = resolve
      })
    )
    const session = new CloudSession()

    const login = session.login()
    session.logout()
    resolveLogin({
      tokens: { accessToken: 'stale', expiresAt: future },
      status: { signedIn: true, email: 'stale@comfy.org' }
    })

    await expect(login).resolves.toEqual({ signedIn: false })
    expect(saveTokens).not.toHaveBeenCalled()
  })

  it('does not let an older workspace switch overwrite a newer login', async () => {
    let resolveSwitch!: (value: Awaited<ReturnType<typeof signIn>>) => void
    let resolveLogin!: (value: Awaited<ReturnType<typeof signIn>>) => void
    mocked(signIn).mockImplementation(
      (options) =>
        new Promise((resolve) => {
          if (options?.workspaceId) resolveSwitch = resolve
          else resolveLogin = resolve
        })
    )
    const session = new CloudSession()

    const workspaceSwitch = session.switchWorkspace('old-workspace')
    session.logout()
    const login = session.login()
    const currentTokens = { accessToken: 'current', expiresAt: future }
    resolveLogin({
      tokens: currentTokens,
      status: { signedIn: true, email: 'current@comfy.org' }
    })
    await login
    resolveSwitch({
      tokens: { accessToken: 'stale', expiresAt: future },
      status: { signedIn: true, workspaceId: 'old-workspace' }
    })
    await workspaceSwitch

    expect(saveTokens).toHaveBeenCalledExactlyOnceWith(currentTokens)
  })
})

describe('CloudSession workspace + provider', () => {
  afterEach(() => vi.clearAllMocks())

  it('switchWorkspace re-auths pre-selecting the workspace', async () => {
    mocked(signIn).mockResolvedValue({
      tokens: { accessToken: 't', expiresAt: future },
      status: { signedIn: true, workspaceId: 'w-2' }
    })
    const status = await new CloudSession().switchWorkspace('w-2')
    expect(signIn).toHaveBeenCalledWith({ workspaceId: 'w-2' })
    expect(status.workspaceId).toBe('w-2')
    expect(saveTokens).toHaveBeenCalled()
  })

  it('listWorkspaces uses the current token', async () => {
    mocked(loadTokens).mockReturnValue({ accessToken: 'good', expiresAt: future })
    await new CloudSession().listWorkspaces()
    expect(listWorkspaces).toHaveBeenCalledWith('good')
  })

  it('asTokenProvider delegates getAccessToken and clears the rejected current token', async () => {
    mocked(loadTokens).mockReturnValue({ accessToken: 'good', expiresAt: future })
    const onSignedOut = vi.fn()
    const tp = new CloudSession().asTokenProvider(onSignedOut)
    expect(await tp.getAccessToken()).toBe('good')
    tp.onUnauthorized?.('good')
    expect(clearTokens).toHaveBeenCalled()
    expect(onSignedOut).toHaveBeenCalledOnce()
  })

  it('ignores a late 401 for a token replaced by a newer login', () => {
    mocked(loadTokens).mockReturnValue({ accessToken: 'new', expiresAt: future })
    const onSignedOut = vi.fn()
    const tp = new CloudSession().asTokenProvider(onSignedOut)

    tp.onUnauthorized?.('old')

    expect(clearTokens).not.toHaveBeenCalled()
    expect(onSignedOut).not.toHaveBeenCalled()
  })
})
