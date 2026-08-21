// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  afterEach(() => vi.unstubAllGlobals())

  it('lists distributions with a Bearer token at the right path', async () => {
    const f = mockFetch(200, { builds: [{ id: 'd1', name: 'Dist One' }] })
    vi.stubGlobal('fetch', f)
    const client = new ComfyBuilderClient({
      baseUrl: 'https://api.test/builder',
      auth: auth('tok-123')
    })
    const dists = await client.listDistributions()
    expect(dists).toEqual([{ id: 'd1', name: 'Dist One' }])
    const call = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(call[0]).toBe('https://api.test/builder/v1/builds')
    expect((call[1].headers as Record<string, string>).Authorization).toBe('Bearer tok-123')
  })

  it('uploads a Desktop snapshot to create a draft', async () => {
    const f = mockFetch(200, {
      distributionId: 'dist-1',
      workspaceId: 'w1',
      editUrl: '/profile/distributions/new?workspace=w1&edit=dist-1&step=import'
    })
    vi.stubGlobal('fetch', f)
    const client = new ComfyBuilderClient({
      baseUrl: 'https://api.test/builder',
      platformBaseUrl: 'https://platform.test',
      auth: auth('tok-123')
    })
    const snapshot = {
      type: 'comfyui-desktop-2-snapshot' as const,
      version: 2 as const,
      exportedAt: '2026-08-21T00:00:00.000Z',
      installationName: 'Local One',
      snapshots: []
    }

    await expect(client.createDesktopDraft(snapshot)).resolves.toEqual({
      distributionId: 'dist-1',
      workspaceId: 'w1',
      editUrl: '/profile/distributions/new?workspace=w1&edit=dist-1&step=import'
    })
    const call = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(call[0]).toBe('https://platform.test/api/desktop/distribution-drafts')
    expect(call[1]).toMatchObject({
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer tok-123',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(snapshot)
    })
  })

  it('rejects an incomplete desktop draft response', async () => {
    vi.stubGlobal('fetch', mockFetch(200, {}))
    const client = new ComfyBuilderClient({ auth: auth('t') })

    await expect(
      client.createDesktopDraft({
        type: 'comfyui-desktop-2-snapshot',
        version: 2,
        exportedAt: '2026-08-21T00:00:00.000Z',
        installationName: 'Local One',
        snapshots: []
      })
    ).rejects.toMatchObject({ kind: 'server' })
  })

  it('resolveDownloadUrl returns the presigned url', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { downloadUrl: 'https://gcs/signed', expiresAt: 'x' }))
    const client = new ComfyBuilderClient({ auth: auth('t') })
    expect(await client.resolveDownloadUrl('a1')).toBe('https://gcs/signed')
  })

  it('rejects a non-HTTPS artifact URL outside loopback', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { downloadUrl: 'http://storage.example/a.tar.gz' }))
    const client = new ComfyBuilderClient({ auth: auth('t') })
    await expect(client.resolveDownloadUrl('a1')).rejects.toMatchObject({ kind: 'server' })
  })

  it('fetchModelManifest hits the version manifest path and normalizes absent fields', async () => {
    const f = mockFetch(200, {
      models: [
        {
          type: 'checkpoints',
          filename: 'sd.safetensors',
          sha256: 'a'.repeat(64),
          downloadUrl: 'https://x/sd'
        }
      ]
    })
    vi.stubGlobal('fetch', f)
    const client = new ComfyBuilderClient({ baseUrl: 'https://api.test/builder', auth: auth('t') })
    const m = await client.fetchModelManifest('ver-9')
    expect(m.models).toHaveLength(1)
    expect(m.modelPolicy).toBeNull()
    expect(m.partnerNodePolicy).toBeNull()
    const call = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(call[0]).toBe('https://api.test/builder/v1/build-versions/ver-9/manifest')
  })

  it('rejects a manifest response without an explicit model list', async () => {
    vi.stubGlobal('fetch', mockFetch(200, {}))
    const client = new ComfyBuilderClient({ auth: auth('t') })
    await expect(client.fetchModelManifest('ver-9')).rejects.toMatchObject({ kind: 'server' })
  })

  it.each([undefined, '', 'not-a-sha256'])(
    'rejects a model without a valid SHA-256 before returning the manifest',
    async (sha256) => {
      vi.stubGlobal(
        'fetch',
        mockFetch(200, {
          models: [
            { type: 'checkpoints', filename: 'sd.safetensors', sha256, downloadUrl: 'https://x/sd' }
          ]
        })
      )
      const client = new ComfyBuilderClient({ auth: auth('t') })
      await expect(client.fetchModelManifest('ver-9')).rejects.toMatchObject({ kind: 'server' })
    }
  )

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
    expect(onUnauthorized).toHaveBeenCalledExactlyOnceWith('stale')
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

  it('surfaces the server-provided reason in the error message', async () => {
    vi.stubGlobal('fetch', mockFetch(502, { message: 'upstream exploded' }))
    await expect(
      new ComfyBuilderClient({ auth: auth('t') }).getVersion('v1')
    ).rejects.toMatchObject({
      kind: 'server',
      message: expect.stringContaining('upstream exploded')
    })
  })

  it('names the timeout budget when the request times out', async () => {
    const timeoutErr = new Error('The operation was aborted due to timeout')
    timeoutErr.name = 'TimeoutError'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw timeoutErr
      }) as unknown as typeof fetch
    )
    await expect(
      new ComfyBuilderClient({ auth: auth('t'), timeoutMs: 1234 }).getVersion('v1')
    ).rejects.toMatchObject({
      kind: 'network',
      message: expect.stringContaining('timed out after 1234ms')
    })
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
