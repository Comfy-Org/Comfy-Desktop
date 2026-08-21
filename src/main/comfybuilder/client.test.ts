// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComfyBuilderApiError, ComfyBuilderClient } from './client'
import type { TokenProvider } from './types'
import type { SnapshotExportEnvelope } from '../lib/snapshots/types'

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

function snapshotExport(installationName = 'Local One'): SnapshotExportEnvelope {
  return {
    type: 'comfyui-desktop-2-snapshot',
    version: 2,
    exportedAt: '2026-08-21T00:00:00.000Z',
    installationName,
    snapshots: [
      {
        version: 2,
        createdAt: '2026-08-21T00:00:00.000Z',
        trigger: 'manual',
        label: null,
        comfyui: {
          ref: 'v0.28.2',
          commit: null,
          releaseTag: 'v0.28.2',
          variant: 'nvidia'
        },
        customNodes: [],
        pipPackages: {},
        pythonVersion: '3.13.1'
      }
    ]
  }
}

function snapshotResolution() {
  return {
    definition: {
      baseImage: 'cuda128-py312',
      baseComfyVersion: 'v0.28.2',
      customNodes: [],
      pipDependencies: 'einops==0.8.0\n\nnumpy==2.0.0'
    },
    comfyVersion: 'v0.28.2',
    pythonVersion: '3.13.1',
    nodes: [{ name: 'ComfyUI-Test', cnrId: 'test-pack', registryVersion: '1.0.0' }],
    report: {
      unresolvedNodes: ['missing-pack'],
      notInRegistry: ['missing-registry-pack'],
      registryPending: [],
      skippedPins: ['torch'],
      unpinnablePins: ['local-package'],
      unverifiedPins: [],
      collidingNodes: ['duplicate-pack'],
      droppedComfyVersion: 'old-ref',
      pythonSatisfied: false
    }
  }
}

describe('ComfyBuilderClient', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('lists builds with a Bearer token at the right path', async () => {
    const f = mockFetch(200, { builds: [{ id: 'b1', name: 'Build One' }] })
    vi.stubGlobal('fetch', f)
    const client = new ComfyBuilderClient({
      baseUrl: 'https://api.test/builder',
      auth: auth('tok-123')
    })
    const builds = await client.listBuilds()
    expect(builds).toEqual([{ id: 'b1', name: 'Build One' }])
    const call = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(call[0]).toBe('https://api.test/builder/v1/builds')
    expect((call[1].headers as Record<string, string>).Authorization).toBe('Bearer tok-123')
  })

  it('resolves a Desktop snapshot and creates a Build draft with the same token', async () => {
    const resolution = snapshotResolution()
    const f = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      const body = url.endsWith('/v1/snapshots/resolve')
        ? resolution
        : { id: 'build/id+1', workspaceId: 'workspace/id+1' }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }) as unknown as typeof fetch
    vi.stubGlobal('fetch', f)
    const getAccessToken = vi.fn(async () => 'tok-123')
    const client = new ComfyBuilderClient({
      baseUrl: 'https://api.test/builder',
      auth: { getAccessToken }
    })
    const snapshot = snapshotExport(' Local One ')

    await expect(client.createBuildDraft(snapshot)).resolves.toEqual({
      buildId: 'build/id+1',
      workspaceId: 'workspace/id+1',
      editUrl: '/profile/builds/new?workspace=workspace%2Fid%2B1&edit=build%2Fid%2B1&step=import'
    })
    const calls = (f as unknown as ReturnType<typeof vi.fn>).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[0]![0]).toBe('https://api.test/builder/v1/snapshots/resolve')
    expect(calls[0]![1]).toMatchObject({
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer tok-123',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ snapshot: { ...snapshot, installationName: 'Local One' } })
    })
    expect(calls[1]![0]).toBe('https://api.test/builder/v1/builds')
    expect(calls[1]![1]).toMatchObject({
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer tok-123',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Local One',
        definition: {
          ...resolution.definition,
          uiDesktopSnapshotImport: {
            installationName: 'Local One',
            comfyVersion: resolution.comfyVersion,
            pythonVersion: resolution.pythonVersion,
            nodes: resolution.nodes,
            pipRequirements: ['einops==0.8.0', 'numpy==2.0.0'],
            report: resolution.report
          }
        }
      })
    })
    expect(getAccessToken).toHaveBeenCalledOnce()
  })

  it('does not create a Build when snapshot resolution is invalid', async () => {
    vi.stubGlobal('fetch', mockFetch(200, {}))
    const client = new ComfyBuilderClient({ auth: auth('t') })

    await expect(client.createBuildDraft(snapshotExport())).rejects.toMatchObject({
      kind: 'server'
    })
  })

  it('rejects a Build response without opaque IDs', async () => {
    const f = vi.fn(async (input: string | URL | Request) => {
      const body = String(input).endsWith('/v1/snapshots/resolve') ? snapshotResolution() : {}
      return new Response(JSON.stringify(body), { status: 200 })
    }) as unknown as typeof fetch
    vi.stubGlobal('fetch', f)
    const client = new ComfyBuilderClient({ auth: auth('t') })

    await expect(client.createBuildDraft(snapshotExport())).rejects.toMatchObject({
      kind: 'server'
    })
  })

  it.each([
    { case: 'an empty snapshot list', snapshots: [] },
    {
      case: 'retained snapshot history',
      snapshots: [snapshotExport().snapshots[0]!, snapshotExport().snapshots[0]!]
    }
  ])('rejects $case', async ({ snapshots }) => {
    const f = mockFetch(200, snapshotResolution())
    vi.stubGlobal('fetch', f)
    const client = new ComfyBuilderClient({ auth: auth('t') })

    await expect(client.createBuildDraft({ ...snapshotExport(), snapshots })).rejects.toMatchObject(
      {
        kind: 'server'
      }
    )
    expect(f).not.toHaveBeenCalled()
  })

  it('resolveDownloadUrl returns the presigned url', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { downloadUrl: 'https://gcs/signed', expiresAt: 'x' }))
    const client = new ComfyBuilderClient({ auth: auth('t') })
    expect(await client.resolveDownloadUrl('a1')).toBe('https://gcs/signed')
  })

  it('lists versions from the build path', async () => {
    const f = mockFetch(200, { versions: [{ id: 'v1', version: 1, status: 'complete' }] })
    vi.stubGlobal('fetch', f)
    const client = new ComfyBuilderClient({ baseUrl: 'https://api.test/builder', auth: auth('t') })

    await expect(client.listVersions('build/one')).resolves.toHaveLength(1)
    const call = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(call[0]).toBe('https://api.test/builder/v1/builds/build%2Fone/versions')
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
    const f = mockFetch(200, {
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
    vi.stubGlobal('fetch', f)
    const { version, artifacts } = await new ComfyBuilderClient({
      baseUrl: 'https://api.test/builder',
      auth: auth('t')
    }).getVersion('version/one')
    expect(version).toBe(3)
    expect(artifacts[0]).toMatchObject({
      id: 'a1',
      archiveSha256: 'deadbeef',
      archiveRef: 'blob/a1'
    })
    const call = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(call[0]).toBe('https://api.test/builder/v1/build-versions/version%2Fone')
  })

  it('throws unauthorized (no network) when signed out', async () => {
    const f = mockFetch(200, {})
    vi.stubGlobal('fetch', f)
    const client = new ComfyBuilderClient({ auth: auth(null) })
    await expect(client.listBuilds()).rejects.toMatchObject({ kind: 'unauthorized' })
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
      new ComfyBuilderClient({ auth: auth('t', onUnauthorized) }).listBuilds()
    ).rejects.toMatchObject({ kind: 'forbidden' })
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('maps an empty/non-JSON 2xx body to a typed server error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 200 })) as unknown as typeof fetch
    )
    await expect(new ComfyBuilderClient({ auth: auth('t') }).listBuilds()).rejects.toMatchObject({
      kind: 'server'
    })
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
