import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getInstallation = vi.fn()
const getAccessToken = vi.fn()
const runningSessions = new Map<string, { port?: number }>()

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))
vi.mock('../installations', () => ({ get: (id: string) => getInstallation(id) }))
vi.mock('../devplatform/session', () => ({
  getCloudSession: () => ({ getAccessToken })
}))
vi.mock('./ipc/shared', () => ({
  _runningSessions: runningSessions,
  sourceMap: { cloud: { category: 'cloud' }, standalone: { category: 'local' } }
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
    ['notes.txt', undefined, null]
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
        previewUrl: 'http://127.0.0.1:8188/api/view?type=output&filename=still.png'
      }
    ])
  })

  it('returns nothing for a local build that is not running', async () => {
    getInstallation.mockResolvedValue({ id: 'local-1', sourceId: 'standalone' })

    expect(await listAssets('local-1')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('lists the signed-in cloud workspace and resolves signed media links', async () => {
    getInstallation.mockResolvedValue({ id: 'cloud-1', sourceId: 'cloud' })
    getAccessToken.mockResolvedValue('token')
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          assets: [
            { id: 'v1', name: 'clip.mp4', created_at: '2026-11-09T10:00:00Z' },
            { id: 's1', name: 'audio/voice.wav', created_at: '2026-11-09T09:00:00Z' }
          ]
        })
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: 'https://storage.googleapis.com/bucket/clip.mp4?sig=1' }
        })
      )

    const assets = await listAssets('cloud-1')

    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe('Bearer token')
    expect(assets.map((a) => [a.name, a.kind, a.previewUrl])).toEqual([
      ['clip.mp4', 'video', 'https://storage.googleapis.com/bucket/clip.mp4?sig=1'],
      ['voice.wav', 'audio', null]
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
