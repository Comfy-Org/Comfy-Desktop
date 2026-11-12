import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getInstallation = vi.fn()
const getAccessToken = vi.fn()
const runningSessions = new Map<string, { port?: number }>()

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() }
}))
vi.mock('../installations', () => ({ get: (id: string) => getInstallation(id) }))
vi.mock('../devplatform/session', () => ({
  getCloudSession: () => ({ getAccessToken })
}))
vi.mock('./ipc/shared', () => ({
  _runningSessions: runningSessions,
  sourceMap: {
    cloud: { category: 'cloud' },
    standalone: { category: 'local' },
    remote: { category: 'remote' }
  }
}))

const { assetKind, listAssets, signedStorageUrl } = await import('./assets')

const fetchMock = vi.fn()

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  runningSessions.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('assetKind', () => {
  it.each([
    ['clip.bin', 'video/mp4', 'video'],
    ['still.png', undefined, 'image'],
    ['narration.WAV', undefined, 'audio'],
    ['mesh.glb', undefined, '3d'],
    ['notes.txt', undefined, null],
    ['shader.constructor', undefined, null],
    ['png', undefined, null]
  ])('classifies %s (%s) as %s', (name, mimeType, kind) => {
    expect(assetKind(name, mimeType)).toBe(kind)
  })
})

describe('signedStorageUrl', () => {
  it.each([
    ['https://storage.googleapis.com/bucket/a.png?sig=1', true],
    ['https://evil.example.com/a.png', false],
    ['http://storage.googleapis.com/a.png', false],
    [null, false]
  ])('accepts only https Google storage links: %s', (location, accepted) => {
    expect(signedStorageUrl(location) !== null).toBe(accepted)
  })
})

describe('listAssets', () => {
  it('lists a running local build with previews served by that build', async () => {
    getInstallation.mockResolvedValue({ id: 'local-1', sourceId: 'standalone' })
    runningSessions.set('local-1', { port: 8188 })
    fetchMock.mockResolvedValue(
      jsonResponse({
        assets: [
          {
            id: 'a1',
            name: 'still.png',
            size: 2048,
            mime_type: 'image/png',
            tags: ['output'],
            created_at: '2026-11-09T10:00:00Z',
            preview_url: '/api/view?type=output&filename=still.png'
          }
        ]
      })
    )

    const assets = await listAssets('local-1')

    expect(fetchMock.mock.calls[0]![0]).toBe(
      'http://127.0.0.1:8188/api/assets?tags_any=output&sort=created_at&order=desc&limit=100'
    )
    expect(assets).toEqual([
      {
        id: 'a1',
        name: 'still.png',
        kind: 'image',
        sizeBytes: 2048,
        createdAt: '2026-11-09T10:00:00Z',
        mimeType: 'image/png',
        tags: ['output'],
        previewUrl: 'http://127.0.0.1:8188/api/view?type=output&filename=still.png'
      }
    ])
  })

  it('skips remote builds instead of asking this machine', async () => {
    getInstallation.mockResolvedValue({ id: 'remote-1', sourceId: 'remote' })
    runningSessions.set('remote-1', { port: 8188 })

    expect(await listAssets('remote-1')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('serves local previews only from the build itself', async () => {
    getInstallation.mockResolvedValue({ id: 'local-1', sourceId: 'standalone' })
    runningSessions.set('local-1', { port: 8188 })
    fetchMock.mockResolvedValue(
      jsonResponse({
        assets: [{ id: 'a1', name: 'still.png', preview_url: 'http://127.0.0.1:9999/evil.png' }]
      })
    )

    const [summary] = await listAssets('local-1')

    expect(summary!.previewUrl).toBe(
      'http://127.0.0.1:8188/api/assets/a1/content?disposition=inline'
    )
  })

  it('serves local previews only from the build API', async () => {
    getInstallation.mockResolvedValue({ id: 'local-1', sourceId: 'standalone' })
    runningSessions.set('local-1', { port: 8188 })
    fetchMock.mockResolvedValue(
      jsonResponse({
        assets: [{ id: 'a1', name: 'still.png', preview_url: '/extensions/evil.png', size: 0 }]
      })
    )

    const [summary] = await listAssets('local-1')

    expect(summary!.previewUrl).toBe(
      'http://127.0.0.1:8188/api/assets/a1/content?disposition=inline'
    )
    expect(summary!.sizeBytes, 'an empty file keeps its size').toBe(0)
  })

  it('falls back to the content link when a preview link cannot be parsed', async () => {
    getInstallation.mockResolvedValue({ id: 'local-1', sourceId: 'standalone' })
    runningSessions.set('local-1', { port: 8188 })
    fetchMock.mockResolvedValue(
      jsonResponse({ assets: [{ id: 'a1', name: 'still.png', preview_url: 'http://' }] })
    )

    const [summary] = await listAssets('local-1')

    expect(summary!.previewUrl).toBe(
      'http://127.0.0.1:8188/api/assets/a1/content?disposition=inline'
    )
  })

  it('drops rows whose fields have the wrong type', async () => {
    getInstallation.mockResolvedValue({ id: 'local-1', sourceId: 'standalone' })
    runningSessions.set('local-1', { port: 8188 })
    fetchMock.mockResolvedValue(
      jsonResponse({
        assets: [
          { id: 'bad', name: 'bad.png', mime_type: 1 },
          { id: 'good', name: 'good.png', mime_type: null, created_at: null }
        ]
      })
    )

    const assets = await listAssets('local-1')

    expect(assets.map((a) => a.id)).toEqual(['good'])
  })

  it('returns nothing for a local build that is not running', async () => {
    getInstallation.mockResolvedValue({ id: 'local-1', sourceId: 'standalone' })

    expect(await listAssets('local-1')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('lists the signed-in cloud workspace and resolves signed media links for playable kinds', async () => {
    getInstallation.mockResolvedValue({ id: 'cloud-1', sourceId: 'cloud' })
    getAccessToken.mockResolvedValue('token')
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          assets: [
            { id: 'v1', name: 'clip.mp4', created_at: '2026-11-09T10:00:00Z' },
            { id: 's1', name: 'audio/voice.wav', created_at: '2026-11-09T09:00:00Z' },
            { id: 'm1', name: 'mesh.glb', created_at: '2026-11-09T08:00:00Z' }
          ]
        })
      )
      .mockImplementation(
        async (url: string) =>
          new Response(null, {
            status: 302,
            headers: {
              Location: `https://storage.googleapis.com/bucket/${/\/assets\/([^/]+)\/content/.exec(url)?.[1]}?sig=1`
            }
          })
      )

    const assets = await listAssets('cloud-1')

    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe('Bearer token')
    expect(assets.map((a) => [a.name, a.kind, a.previewUrl])).toEqual([
      ['clip.mp4', 'video', 'https://storage.googleapis.com/bucket/v1?sig=1'],
      ['voice.wav', 'audio', 'https://storage.googleapis.com/bucket/s1?sig=1'],
      ['mesh.glb', '3d', null]
    ])
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
