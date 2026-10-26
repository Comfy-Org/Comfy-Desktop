import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  handler: null as ((request: Request) => Promise<Response>) | null,
  enabled: true,
  token: 'token-1' as string | null,
  fetch: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
}))

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir(), isPackaged: false },
  net: { fetch: h.fetch },
  protocol: { registerSchemesAsPrivileged: vi.fn() },
  session: {
    defaultSession: {
      protocol: {
        handle: (_scheme: string, fn: (r: Request) => Promise<Response>) => (h.handler = fn)
      }
    }
  }
}))
vi.mock('../settings', () => ({ isRolloutEnabled: () => h.enabled }))
vi.mock('../devplatform/session', () => ({
  getCloudSession: () => ({ getAccessToken: async () => h.token })
}))
vi.mock('../installations', () => ({
  get: async (id: string) => (id === 'a' || id === 'cloud' ? { id, installPath: '/x' } : null)
}))

import { handleMediaRequests, localMediaUrl, parseMediaUrl, resolveAreaFile } from './mediaProtocol'

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'comfy-media-')))
const output = path.join(root, 'output')
const input = path.join(root, 'input')
const outside = path.join(root, 'outside')
const secret = path.join(outside, 'secret.png')
fs.mkdirSync(path.join(output, 'sub'), { recursive: true })
fs.mkdirSync(input, { recursive: true })
fs.mkdirSync(outside, { recursive: true })
fs.writeFileSync(path.join(output, 'sub', 'image one.png'), 'png')
fs.writeFileSync(path.join(output, 'page.html'), '<script></script>')
fs.writeFileSync(secret, 'secret')
// A junction on Windows needs no privilege, unlike a symlink; realpath resolves both.
fs.symlinkSync(
  outside,
  path.join(output, 'escape'),
  process.platform === 'win32' ? 'junction' : 'dir'
)
const folders = { output, input }
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

const ASSET = '0b8e0f1e-5a3a-4c35-9f53-7e2a9d1c8a10'

describe('parseMediaUrl', () => {
  it('round-trips a local file URL, spaces and folders included', () => {
    expect(parseMediaUrl(localMediaUrl('a', 'output', 'sub/image one.png'))).toEqual({
      kind: 'local',
      installationId: 'a',
      area: 'output',
      relativePath: 'sub/image one.png'
    })
  })

  it('reads a Cloud asset by id only', () => {
    expect(parseMediaUrl(`comfy-media://cloud/${ASSET}`)).toEqual({ kind: 'cloud', assetId: ASSET })
    expect(parseMediaUrl('comfy-media://cloud/../../etc')).toBeNull()
  })

  it('refuses other areas, traversal and other schemes', () => {
    expect(parseMediaUrl('comfy-media://local/a/models/x.png')).toBeNull()
    expect(parseMediaUrl('comfy-media://local/a/output/%2E%2E/outside/secret.png')).toBeNull()
    expect(parseMediaUrl('comfy-media://local/a/output/sub%2F..%2F..%2Fsecret.txt')).toBeNull()
    expect(parseMediaUrl('file:///etc/passwd')).toBeNull()
  })
})

describe('resolveAreaFile', () => {
  it('serves a file inside its area', async () => {
    expect(await resolveAreaFile(folders, 'output', 'sub/image one.png')).toBe(
      path.join(output, 'sub', 'image one.png')
    )
  })

  it('refuses escapes: symlinks out, parent paths, absolute paths, folders, missing files', async () => {
    expect(await resolveAreaFile(folders, 'output', 'escape/secret.png')).toBeNull()
    expect(await resolveAreaFile(folders, 'output', '../outside/secret.png')).toBeNull()
    expect(await resolveAreaFile(folders, 'output', secret)).toBeNull()
    expect(await resolveAreaFile(folders, 'output', 'sub')).toBeNull()
    expect(await resolveAreaFile(folders, 'input', 'sub/image one.png')).toBeNull()
  })
})

describe('the comfy-media handler', () => {
  // Build `a` is local; any other build has no local folders.
  handleMediaRequests((inst) => (inst.id === 'a' ? ({ ...folders } as never) : null))
  const request = (url: string, headers: Record<string, string> = {}) =>
    h.handler!(new Request(url, { headers }))

  beforeEach(() => {
    h.enabled = true
    h.token = 'token-1'
    h.fetch.mockReset()
    h.fetch.mockResolvedValue(new Response('ok', { status: 200 }))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('refuses everything while the Builds dashboard is off', async () => {
    h.enabled = false
    const res = await request(localMediaUrl('a', 'output', 'sub/image one.png'))
    expect(res.status).toBe(404)
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it('serves an allowed local file unsniffed and passes the byte range on', async () => {
    const res = await request(localMediaUrl('a', 'output', 'sub/image one.png'), {
      range: 'bytes=0-1'
    })
    const [url, init] = h.fetch.mock.calls[0]!
    expect(url).toMatch(/^file:\/\/.*image%20one\.png$/)
    expect(init).toEqual({ headers: { range: 'bytes=0-1' } })
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('answers 404 for an unknown build, an escaping file or a file that is not media', async () => {
    expect((await request(localMediaUrl('zz', 'output', 'sub/image one.png'))).status).toBe(404)
    expect((await request(localMediaUrl('a', 'output', 'escape/secret.png'))).status).toBe(404)
    expect((await request(localMediaUrl('a', 'output', 'page.html'))).status).toBe(404)
    // A Comfy Cloud or remote build has no local files to serve.
    expect((await request(localMediaUrl('cloud', 'output', 'sub/image one.png'))).status).toBe(404)
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it('fetches a Cloud asset with the token and follows its redirect without it', async () => {
    vi.stubGlobal('fetch', h.fetch)
    h.fetch.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'https://storage.example/x?sig=1' } })
    )
    await request(`comfy-media://cloud/${ASSET}`, { range: 'bytes=0-1' })
    const [first, firstInit] = h.fetch.mock.calls[0]!
    expect(String(first)).toContain(`/api/assets/${ASSET}/content`)
    expect(firstInit!.headers).toEqual({ Authorization: 'Bearer token-1', range: 'bytes=0-1' })
    const [signed, signedInit] = h.fetch.mock.calls[1]!
    expect(String(signed)).toBe('https://storage.example/x?sig=1')
    // Without the token, and one hop only.
    expect(signedInit).toMatchObject({ headers: { range: 'bytes=0-1' }, redirect: 'error' })
  })

  it('serves anything that is not image, video or audio as a download', async () => {
    vi.stubGlobal('fetch', h.fetch)
    h.fetch.mockResolvedValueOnce(
      new Response('<script></script>', { headers: { 'content-type': 'text/html' } })
    )
    const html = await request(`comfy-media://cloud/${ASSET}`)
    expect(html.headers.get('content-type')).toBe('application/octet-stream')
    h.fetch.mockResolvedValueOnce(new Response('x', { headers: { 'content-type': 'video/mp4' } }))
    const video = await request(`comfy-media://cloud/${ASSET}`)
    expect(video.headers.get('content-type')).toBe('video/mp4')
  })

  it('refuses a Cloud asset when signed out, and a redirect off https', async () => {
    h.token = null
    expect((await request(`comfy-media://cloud/${ASSET}`)).status).toBe(401)
    h.token = 'token-1'
    vi.stubGlobal('fetch', h.fetch)
    h.fetch.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'http://storage.example/x' } })
    )
    expect((await request(`comfy-media://cloud/${ASSET}`)).status).toBe(404)
  })
})
