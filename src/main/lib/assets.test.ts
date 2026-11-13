import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getInstallation = vi.fn()
const getAccessToken = vi.fn()

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() }
}))
vi.mock('../installations', () => ({ get: (id: string) => getInstallation(id) }))
vi.mock('../devplatform/session', () => ({
  getCloudSession: () => ({ getAccessToken })
}))
vi.mock('./ipc/shared', () => ({
  sourceMap: {
    cloud: { category: 'cloud' },
    standalone: { category: 'local' },
    remote: { category: 'remote' }
  }
}))

const { assetKind, listAssets, signedStorageUrl } = await import('./assets')

const fetchMock = vi.fn()
const SAMPLE_VIDEO = path.resolve('src/renderer/public/install-showcase-scene/Assets/earpods.webm')

function pngHeader(width: number, height: number): Uint8Array<ArrayBuffer> {
  const header = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0)
  header.writeUInt32BE(13, 8)
  header.write('IHDR', 12, 'ascii')
  header.writeUInt32BE(width, 16)
  header.writeUInt32BE(height, 20)
  header.writeUInt8(8, 24)
  header.writeUInt8(2, 25)
  return new Uint8Array(header)
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
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
  it('never asks a local or remote build over HTTP', async () => {
    getInstallation.mockResolvedValue({ id: 'local-1', sourceId: 'standalone' })
    expect(await listAssets('local-1')).toEqual([])
    getInstallation.mockResolvedValue({ id: 'remote-1', sourceId: 'remote' })
    expect(await listAssets('remote-1')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns nothing for Cloud when signed out', async () => {
    getInstallation.mockResolvedValue({ id: 'cloud-1', sourceId: 'cloud' })
    getAccessToken.mockResolvedValue(null)

    expect(await listAssets('cloud-1')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('drops Cloud rows whose fields have the wrong type and keeps an empty size', async () => {
    getInstallation.mockResolvedValue({ id: 'cloud-1', sourceId: 'cloud' })
    getAccessToken.mockResolvedValue('token')
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          assets: [
            { id: 'bad', name: 'bad.png', mime_type: 1 },
            { id: 'good', name: 'good.png', mime_type: null, created_at: null, size: 0 }
          ]
        })
      )
      .mockResolvedValue(new Response(null, { status: 404 }))

    const assets = await listAssets('cloud-1')

    expect(assets.map((a) => [a.id, a.sizeBytes])).toEqual([['good', 0]])
  })

  it('keeps one page of Cloud rows when the server sends more than it was asked for', async () => {
    getInstallation.mockResolvedValue({ id: 'cloud-1', sourceId: 'cloud' })
    getAccessToken.mockResolvedValue('token')
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          assets: Array.from({ length: 150 }, (_, i) => ({ id: `a${i}`, name: `a${i}.bin` }))
        })
      )
      .mockResolvedValue(new Response(null, { status: 404 }))

    const assets = await listAssets('cloud-1')

    expect(assets).toHaveLength(100)
    expect(assets.at(-1)!.id).toBe('a99')
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
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('reads the size of each Cloud picture and video, and how long a video runs, from the start of the file', async () => {
    getInstallation.mockResolvedValue({ id: 'cloud-1', sourceId: 'cloud' })
    getAccessToken.mockResolvedValue('token')
    const files: Record<string, Uint8Array<ArrayBuffer>> = {
      p1: pngHeader(768, 1344),
      v1: new Uint8Array(fs.readFileSync(SAMPLE_VIDEO))
    }
    const rangesAsked: string[] = []
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/assets?'))
        return jsonResponse({
          assets: [
            { id: 'p1', name: 'portrait.png', created_at: '2026-11-09T10:00:00Z' },
            { id: 'v1', name: 'clip.webm', created_at: '2026-11-09T09:00:00Z' }
          ]
        })
      const id = /\/assets\/([^/]+)\/content/.exec(url)?.[1]
      if (id)
        return new Response(null, {
          status: 302,
          headers: { Location: `https://storage.googleapis.com/bucket/${id}?sig=1` }
        })
      rangesAsked.push(new Headers(init?.headers).get('Range') ?? '')
      const file = files[/bucket\/([^?]+)/.exec(url)![1]!]!
      return new Response(file, { status: 206 })
    })

    const assets = await listAssets('cloud-1')

    expect(
      assets.map((a) => [
        a.name,
        a.width,
        a.height,
        a.durationSeconds && Math.round(a.durationSeconds)
      ])
    ).toEqual([
      ['portrait.png', 768, 1344, null],
      ['clip.webm', 714, 530, 8]
    ])
    expect(rangesAsked.toSorted(), 'only the start of each file is asked for').toEqual([
      'bytes=0-524287',
      'bytes=0-65535'
    ])
  })
})
