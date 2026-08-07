// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
// The client goes through Chromium's net.fetch; delegate to the current global
// fetch so the vi.stubGlobal('fetch', ...) stubs below keep driving it. The spy
// is what proves the request took the proxy-aware route.
const netFetch = vi.hoisted(() =>
  vi.fn((...args: Parameters<typeof fetch>) => globalThis.fetch(...args))
)
vi.mock('electron', () => ({ net: { fetch: netFetch } }))

import { ComfyBuilderApiError, ComfyBuilderClient } from './client'
import type { TokenProvider } from './types'

const auth = (token: string | null, onUnauthorized = vi.fn()): TokenProvider => ({
  getAccessToken: async () => token,
  onUnauthorized
})

function mockFetch(status: number, body: unknown): typeof fetch {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' }
      })
  ) as unknown as typeof fetch
}

describe('ComfyBuilderClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    netFetch.mockClear()
  })

  // Bare fetch ignores the system proxy, which is exactly what an enterprise
  // user behind one has.
  it('requests through the proxy-aware net.fetch, cookie-free', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { distributions: [] }))
    await new ComfyBuilderClient({ auth: auth('t') }).listDistributions()
    expect(netFetch).toHaveBeenCalledTimes(1)
    expect(netFetch.mock.calls[0]![1]).toMatchObject({ credentials: 'omit' })
  })

  it('lists distributions with a Bearer token at the right path', async () => {
    const f = mockFetch(200, { distributions: [{ id: 'd1', name: 'Dist One' }] })
    vi.stubGlobal('fetch', f)
    const client = new ComfyBuilderClient({
      baseUrl: 'https://api.test/builder',
      auth: auth('tok-123')
    })
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

  it('fetchModelManifest hits the version manifest path and normalizes absent fields', async () => {
    const f = mockFetch(200, {
      models: [{ type: 'checkpoints', filename: 'sd.safetensors', downloadUrl: 'https://x/sd' }]
    })
    vi.stubGlobal('fetch', f)
    const client = new ComfyBuilderClient({ baseUrl: 'https://api.test/builder', auth: auth('t') })
    const m = await client.fetchModelManifest('ver-9')
    expect(m.models).toHaveLength(1)
    expect(m.modelPolicy).toBeNull()
    expect(m.partnerNodePolicy).toBeNull()
    const call = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(call[0]).toBe('https://api.test/builder/v1/distribution-versions/ver-9/manifest')
  })

  it('getVersion surfaces the wire archiveSha256/archiveRef so the archive can be verified', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(200, {
        version: 3,
        artifacts: [
          {
            id: 'a1',
            os: 'linux',
            gpu: 'nvidia',
            accelVariant: 'cu128',
            status: 'ready',
            archiveRef: 'blob/a1',
            archiveSha256: 'deadbeef'
          }
        ]
      })
    )
    const { version, artifacts } = await new ComfyBuilderClient({ auth: auth('t') }).getVersion(
      'v1'
    )
    expect(version).toBe(3)
    expect(artifacts[0]).toMatchObject({
      id: 'a1',
      archiveSha256: 'deadbeef',
      archiveRef: 'blob/a1'
    })
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
    await expect(
      new ComfyBuilderClient({ auth: auth('t') }).getVersion('v1')
    ).rejects.toMatchObject({ kind: 'not-found' })
    vi.stubGlobal('fetch', mockFetch(500, {}))
    await expect(
      new ComfyBuilderClient({ auth: auth('t') }).getVersion('v1')
    ).rejects.toMatchObject({ kind: 'server' })
  })

  it('maps 403 to forbidden WITHOUT signing the user out', async () => {
    const onUnauthorized = vi.fn()
    vi.stubGlobal('fetch', mockFetch(403, {}))
    await expect(
      new ComfyBuilderClient({ auth: auth('t', onUnauthorized) }).listDistributions()
    ).rejects.toMatchObject({ kind: 'forbidden' })
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('maps an empty/non-JSON 2xx body to a typed server error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 200 })) as unknown as typeof fetch
    )
    await expect(
      new ComfyBuilderClient({ auth: auth('t') }).listDistributions()
    ).rejects.toMatchObject({ kind: 'server' })
  })

  it('a throwing onUnauthorized does not mask the unauthorized error', async () => {
    vi.stubGlobal('fetch', mockFetch(401, {}))
    const client = new ComfyBuilderClient({
      auth: auth(
        't',
        vi.fn(() => {
          throw new Error('boom')
        })
      )
    })
    await expect(client.listVersions('d1')).rejects.toMatchObject({ kind: 'unauthorized' })
  })
})
