// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// apiClient pulls tokens from tokenStore and refreshes via oauth; mock both so
// the tests drive auth entirely, and no real OAuth network traffic is made.
// authIpc is mocked so the broadcast never touches Electron's BrowserWindow.
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
import { ComfyBuilderApiError, listDeployments, listPipelines } from './apiClient'
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

/** Read the `Authorization` header off a captured `fetch` call. */
function authHeaderOf(spy: ReturnType<typeof vi.spyOn>, callIndex: number): string | undefined {
  const init = spy.mock.calls[callIndex]?.[1] as RequestInit | undefined
  const headers = (init?.headers ?? {}) as Record<string, string>
  return headers.Authorization
}

describe('comfybuilder apiClient', () => {
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

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('lists pipelines and sends a Bearer access token', async () => {
    vi.mocked(loadTokens).mockReturnValue(makeTokens())
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const pipelines = await listPipelines({ apiBase })

    // Parsed via the real dto.parsePipelines against the mock's payload.
    expect(pipelines).toHaveLength(2)
    expect(pipelines[0]?.id).toBe('pipe-success')
    expect(pipelines[1]?.id).toBe('pipe-failed')

    // The request carried `Authorization: Bearer <accessToken>`.
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(authHeaderOf(fetchSpy, 0)).toBe('Bearer access-token-1')

    // A 200 never triggers a refresh.
    expect(refresh).not.toHaveBeenCalled()
    expect(saveTokens).not.toHaveBeenCalled()
  })

  it('lists deployments for a pipeline', async () => {
    vi.mocked(loadTokens).mockReturnValue(makeTokens())

    const deployments = await listDeployments('pipe-success', { apiBase })

    expect(deployments).toHaveLength(2)
    expect(deployments[0]?.id).toBe('dep-success-1')
    expect(deployments[0]?.status).toBe('succeeded')
    expect(deployments[0]?.artifact?.filename).toBe('1.0.0.tar.gz')
  })

  it('refreshes exactly once and retries once after a 401, then succeeds', async () => {
    // An empty access token makes the mock's Bearer check fail -> 401 on the
    // first request; the refreshed token then succeeds on the retry.
    vi.mocked(loadTokens).mockReturnValue(makeTokens({ accessToken: '' }))
    vi.mocked(refresh).mockResolvedValue(
      makeTokens({ accessToken: 'fresh-access', refreshToken: 'fresh-refresh' }),
    )
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const pipelines = await listPipelines({ apiBase })

    expect(pipelines).toHaveLength(2)

    // Exactly ONE refresh, using the stored refresh token.
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledWith('refresh-token-1')

    // Rotated tokens were persisted before the retry.
    expect(saveTokens).toHaveBeenCalledTimes(1)
    expect(saveTokens).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'fresh-access', refreshToken: 'fresh-refresh' }),
    )

    // Exactly ONE retry: two fetches total (401 then 200), the retry using the
    // refreshed token.
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(authHeaderOf(fetchSpy, 1)).toBe('Bearer fresh-access')

    // A recovered session is still signed in: no re-auth broadcast, tokens kept.
    expect(clearTokens).not.toHaveBeenCalled()
    expect(broadcastAuthChanged).not.toHaveBeenCalled()
  })

  it('throws a typed unauthorized error when the refresh fails, without looping', async () => {
    vi.mocked(loadTokens).mockReturnValue(makeTokens({ accessToken: '' }))
    vi.mocked(refresh).mockRejectedValue(new Error('refresh endpoint down'))
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const error = await listPipelines({ apiBase }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ComfyBuilderApiError)
    expect(error).toMatchObject({ kind: 'unauthorized' })

    // One refresh attempt, no retry fetch, no token save — never an infinite loop.
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(saveTokens).not.toHaveBeenCalled()

    // A failed refresh ends the session: tokens cleared + renderer told to re-auth.
    expect(clearTokens).toHaveBeenCalledTimes(1)
    expect(broadcastAuthChanged).toHaveBeenCalledWith({ signedIn: false })
  })

  it('throws unauthorized without attempting a refresh when there is no refresh token', async () => {
    vi.mocked(loadTokens).mockReturnValue(makeTokens({ accessToken: '', refreshToken: undefined }))
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await expect(listPipelines({ apiBase })).rejects.toMatchObject({ kind: 'unauthorized' })

    expect(refresh).not.toHaveBeenCalled()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(saveTokens).not.toHaveBeenCalled()

    // No refresh token means no recovery: tokens cleared + renderer told to re-auth.
    expect(clearTokens).toHaveBeenCalledTimes(1)
    expect(broadcastAuthChanged).toHaveBeenCalledWith({ signedIn: false })
  })

  it('throws unauthorized without any request when not signed in', async () => {
    vi.mocked(loadTokens).mockReturnValue(null)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await expect(listPipelines({ apiBase })).rejects.toMatchObject({ kind: 'unauthorized' })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()

    // Never-signed-in is not a mid-flow expiry: no clear, no re-auth broadcast.
    expect(clearTokens).not.toHaveBeenCalled()
    expect(broadcastAuthChanged).not.toHaveBeenCalled()
  })

  it('maps an unknown route (404) to a typed notFound error', async () => {
    vi.mocked(loadTokens).mockReturnValue(makeTokens())

    await expect(
      listPipelines({ apiBase: `${api.baseUrl}/api/v1/does-not-exist` }),
    ).rejects.toMatchObject({ kind: 'notFound' })
  })

  it('maps a transport failure to a typed network error', async () => {
    vi.mocked(loadTokens).mockReturnValue(makeTokens())

    // Port 1 is not listening -> immediate connection refused.
    await expect(
      listPipelines({ apiBase: 'http://127.0.0.1:1/api/v1' }),
    ).rejects.toMatchObject({ kind: 'network' })
  })
})
