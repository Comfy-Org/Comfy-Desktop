// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComfyBuilderApiError, ComfyBuilderClient } from './client'
import type { TokenProvider } from './types'

const auth = (token: string | null, onUnauthorized = vi.fn()): TokenProvider => ({
  getAccessToken: async () => token,
  onUnauthorized,
})

function mockFetch(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch
}

describe('ComfyBuilderClient', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('lists distributions with a Bearer token at the right path', async () => {
    const f = mockFetch(200, { distributions: [{ id: 'd1', name: 'Dist One' }] })
    vi.stubGlobal('fetch', f)
    const client = new ComfyBuilderClient({ baseUrl: 'https://api.test/builder', auth: auth('tok-123') })
    const dists = await client.listDistributions()
    expect(dists).toEqual([{ id: 'd1', name: 'Dist One' }])
    const call = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(call[0]).toBe('https://api.test/builder/v1/distributions')
    expect((call[1].headers as Record<string, string>).Authorization).toBe('Bearer tok-123')
  })

  it('resolveDownloadUrl returns the presigned url', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { downloadUrl: 'https://gcs/signed', expiresAt: 'x' }))
    const client = new ComfyBuilderClient({ auth: auth('t') })
    expect(await client.resolveDownloadUrl('a1')).toBe('https://gcs/signed')
  })

  it('throws unauthorized (no network) when signed out', async () => {
    const f = mockFetch(200, {})
    vi.stubGlobal('fetch', f)
    const client = new ComfyBuilderClient({ auth: auth(null) })
    await expect(client.listDistributions()).rejects.toMatchObject({ kind: 'unauthorized' })
    expect(f).not.toHaveBeenCalled()
  })

  it('maps 401 to unauthorized and calls onUnauthorized', async () => {
    const onUnauthorized = vi.fn()
    vi.stubGlobal('fetch', mockFetch(401, { message: 'nope' }))
    const client = new ComfyBuilderClient({ auth: auth('stale', onUnauthorized) })
    await expect(client.listVersions('d1')).rejects.toBeInstanceOf(ComfyBuilderApiError)
    expect(onUnauthorized).toHaveBeenCalledOnce()
  })

  it('maps 404 to not-found and 500 to server', async () => {
    vi.stubGlobal('fetch', mockFetch(404, {}))
    await expect(new ComfyBuilderClient({ auth: auth('t') }).getVersion('v1')).rejects.toMatchObject({ kind: 'not-found' })
    vi.stubGlobal('fetch', mockFetch(500, {}))
    await expect(new ComfyBuilderClient({ auth: auth('t') }).getVersion('v1')).rejects.toMatchObject({ kind: 'server' })
  })
})
