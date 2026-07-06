// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Real HTTP round-trips hit the mock Builder; the auth plumbing (token store,
// refresh, and the re-auth broadcast) is mocked so each 401 scenario is driven
// deterministically and no Electron BrowserWindow is touched.
vi.mock('./tokenStore', () => ({
  loadTokens: vi.fn(),
  saveTokens: vi.fn(),
  clearTokens: vi.fn(),
}))
vi.mock('./oauth', () => ({
  refresh: vi.fn(),
}))
vi.mock('./authIpc', () => ({
  broadcastAuthChanged: vi.fn(),
}))

import { startMockBuilderApi } from '../../test/comfybuilder/mockServers'
import type { MockServer } from '../../test/comfybuilder/mockServers'
import { listPipelines } from './apiClient'
import { broadcastAuthChanged } from './authIpc'
import { refresh } from './oauth'
import { clearTokens, loadTokens, saveTokens } from './tokenStore'
import type { AuthTokens } from './types'

function makeTokens(overrides: Partial<AuthTokens> = {}): AuthTokens {
  return {
    accessToken: 'access-token-1',
    refreshToken: 'refresh-token-1',
    expiresAt: Date.now() + 3_600_000,
    ...overrides,
  }
}

describe('comfybuilder apiClient auth-expiry (integration)', () => {
  let api: MockServer
  let apiBase: string

  beforeAll(async () => {
    api = await startMockBuilderApi()
    apiBase = `${api.baseUrl}/api/v1`
  })

  afterAll(async () => {
    await api.stop()
  })

  beforeEach(() => {
    vi.mocked(loadTokens).mockReset()
    vi.mocked(saveTokens).mockReset()
    vi.mocked(clearTokens).mockReset()
    vi.mocked(refresh).mockReset()
    vi.mocked(broadcastAuthChanged).mockReset()
  })

  it('401 -> one refresh -> retry succeeds, and never prompts re-auth', async () => {
    // Empty access token -> mock 401 on the first request; the refreshed token
    // then satisfies the retry.
    vi.mocked(loadTokens).mockReturnValue(makeTokens({ accessToken: '' }))
    vi.mocked(refresh).mockResolvedValue(
      makeTokens({ accessToken: 'fresh-access', refreshToken: 'fresh-refresh' }),
    )
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const pipelines = await listPipelines({ apiBase })

    expect(pipelines).toHaveLength(2)

    // Exactly one refresh and one retry: two fetches total, tokens persisted.
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(saveTokens).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledTimes(2)

    // The session recovered, so the renderer is never told to re-auth.
    expect(clearTokens).not.toHaveBeenCalled()
    expect(broadcastAuthChanged).not.toHaveBeenCalled()
  })

  it('401 -> refresh fails -> clears tokens and broadcasts signed-out for re-auth', async () => {
    vi.mocked(loadTokens).mockReturnValue(makeTokens({ accessToken: '' }))
    vi.mocked(refresh).mockRejectedValue(new Error('refresh endpoint down'))
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await expect(listPipelines({ apiBase })).rejects.toMatchObject({ kind: 'unauthorized' })

    // One refresh attempt, one fetch, no retry, no rotated tokens saved.
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(saveTokens).not.toHaveBeenCalled()

    // Dead session: tokens cleared and the renderer prompted to re-auth exactly once.
    expect(clearTokens).toHaveBeenCalledTimes(1)
    expect(broadcastAuthChanged).toHaveBeenCalledTimes(1)
    expect(broadcastAuthChanged).toHaveBeenCalledWith({ signedIn: false })
  })
})
