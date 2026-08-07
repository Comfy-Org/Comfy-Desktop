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

  it('asTokenProvider delegates getAccessToken and clears on unauthorized', async () => {
    mocked(loadTokens).mockReturnValue({ accessToken: 'good', expiresAt: future })
    const tp = new CloudSession().asTokenProvider()
    expect(await tp.getAccessToken()).toBe('good')
    tp.onUnauthorized?.()
    expect(clearTokens).toHaveBeenCalled()
  })
})
