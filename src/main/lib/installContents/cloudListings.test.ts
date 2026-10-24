import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({
  isSignedIn: vi.fn(() => true),
  currentWorkspaceId: vi.fn((): string | null => 'w1'),
  getAccessToken: vi.fn(async () => 'token-1'),
  onUnauthorized: vi.fn()
}))
vi.mock('../../devplatform/session', () => ({
  getCloudSession: () => session,
  getCloudTokenProvider: () => session
}))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false } }))

import { listCloudWorkflows } from './workflows'
import { listCloudModels } from './models'
import { packsOf } from './nodes'
import type * as Nodes from './nodes'
import { listCloudAssets } from './assets'

const fetchMock = vi.fn()

function respond(status: number, body: unknown): void {
  fetchMock.mockResolvedValueOnce({ ok: status < 400, status, json: async () => body })
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  session.isSignedIn.mockReturnValue(true)
  session.getAccessToken.mockResolvedValue('token-1')
  session.currentWorkspaceId.mockReturnValue('w1')
  session.onUnauthorized.mockClear()
})
afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllGlobals()
})

describe('listCloudWorkflows', () => {
  it('lists the workspace workflows with the session token, normalising seconds', async () => {
    respond(200, [
      { path: 'a.json', size: 10, modified: 1_700_000_000 },
      { path: 'sub/b.json', size: 5, modified: 1_700_000_100_000 },
      { path: 'notes.txt' }
    ])
    const page = await listCloudWorkflows({})
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain('/api/userdata?dir=workflows')
    expect(init.headers.Authorization).toBe('Bearer token-1')
    if (!page.ok) throw new Error(page.message)
    expect(page.items.map((w) => [w.path, w.modifiedAt])).toEqual([
      ['sub/b.json', 1_700_000_100_000],
      ['a.json', 1_700_000_000_000]
    ])
  })

  it('treats a missing workflows folder as empty', async () => {
    respond(404, null)
    expect(await listCloudWorkflows({})).toMatchObject({ ok: true, total: 0 })
  })

  it('reports signed out without calling Cloud, and when Cloud rejects the token', async () => {
    session.isSignedIn.mockReturnValue(false)
    expect(await listCloudWorkflows({})).toMatchObject({ ok: false, signedOut: true })
    expect(fetchMock).not.toHaveBeenCalled()
    session.isSignedIn.mockReturnValue(true)
    respond(401, null)
    expect(await listCloudWorkflows({})).toMatchObject({ ok: false, signedOut: true })
    // The rejected token is invalidated, as the rest of the Cloud client does.
    expect(session.onUnauthorized).toHaveBeenCalledWith('token-1')
  })

  it('reports a reply it cannot read', async () => {
    respond(200, { not: 'a list' })
    expect(await listCloudWorkflows({})).toMatchObject({
      ok: false,
      message: 'installContents.cloudUnexpected'
    })
    respond(200, ['plain-name.json'])
    expect(await listCloudWorkflows({})).toMatchObject({
      ok: false,
      message: 'installContents.cloudUnexpected'
    })
  })

  it('reports other failures as an error', async () => {
    respond(500, null)
    expect(await listCloudWorkflows({})).toMatchObject({ ok: false })
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    expect(await listCloudWorkflows({})).toMatchObject({ ok: false })
  })
})

describe('listCloudModels', () => {
  it('pages models through the API cursor, named by their uploaded file and typed by tag', async () => {
    respond(200, {
      assets: [
        {
          id: '1',
          name: 'abc123',
          size: '42',
          tags: ['models', 'model_type:loras'],
          user_metadata: { filename: 'ink.safetensors' }
        },
        { id: '2', name: 'flux.safetensors', tags: ['models', 'checkpoints'] }
      ],
      total: 3,
      has_more: true,
      next_cursor: 'c2'
    })
    const page = await listCloudModels({ query: 'ink', cursor: 'c1', limit: 2 })
    const url = new URL(String(fetchMock.mock.calls[0]![0]))
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      include_tags: 'models',
      name_contains: 'ink',
      after: 'c1',
      limit: '2'
    })
    expect(page).toMatchObject({
      ok: true,
      total: 3,
      nextCursor: 'c2',
      items: [
        { name: 'ink.safetensors', folder: 'loras', size: 42 },
        { name: 'flux.safetensors', folder: 'checkpoints', size: 0 }
      ]
    })
  })
})

describe('listCloudModels filters', () => {
  const asset = (id: string, isPublic: boolean) => ({
    id,
    name: `${id}.safetensors`,
    tags: ['models', 'model_type:checkpoints'],
    is_immutable: isPublic || undefined,
    updated_at: '2026-10-01T00:00:00Z'
  })

  /** The listing, then the two counts (with and without the public catalog). */
  function respondWithCounts(assets: unknown[], all: number, mine: number): void {
    respond(200, { assets, total: assets.length, has_more: false })
    respond(200, { assets: [], total: all })
    respond(200, { assets: [], total: mine })
  }

  it('counts all, mine and public on the first page', async () => {
    respondWithCounts([asset('a', false), asset('b', true)], 10, 3)
    const page = await listCloudModels({})
    const url = new URL(String(fetchMock.mock.calls[0]![0]))
    expect(url.searchParams.get('include_public')).toBe('true')
    expect(page).toMatchObject({
      ok: true,
      total: 10,
      facets: [
        { value: 'all', count: 10 },
        { value: 'mine', count: 3 },
        { value: 'public', count: 7 }
      ],
      items: [
        { name: 'a.safetensors', public: false, modifiedAt: Date.parse('2026-10-01T00:00:00Z') },
        { name: 'b.safetensors', public: true }
      ]
    })
  })

  it("asks Cloud for the user's own models only for My models", async () => {
    respondWithCounts([asset('a', false)], 10, 3)
    const page = await listCloudModels({ filter: 'mine' })
    const url = new URL(String(fetchMock.mock.calls[0]![0]))
    expect(url.searchParams.get('include_public')).toBe('false')
    expect(page).toMatchObject({ ok: true, total: 3 })
  })

  it('keeps only the public catalog for Public models', async () => {
    respondWithCounts([asset('a', false), asset('b', true)], 10, 3)
    const page = await listCloudModels({ filter: 'public' })
    if (!page.ok) throw new Error(page.message)
    expect(page.items.map((m) => m.name)).toEqual(['b.safetensors'])
    expect(page.total).toBe(7)
  })
})

describe('listCloudNodes', () => {
  // The catalog is cached per module; a fresh module gives each test its own.
  let listCloudNodes: typeof Nodes.listCloudNodes
  beforeEach(async () => {
    vi.resetModules()
    ;({ listCloudNodes } = await import('./nodes'))
  })

  it('reads the packs from the node catalog, counting their nodes', () => {
    expect(
      packsOf({
        A: { python_module: 'custom_nodes.ComfyUI-VideoHelperSuite' },
        B: { python_module: 'custom_nodes.ComfyUI-VideoHelperSuite.videohelpersuite' },
        C: { python_module: 'custom_nodes.rgthree-comfy' },
        D: { python_module: 'nodes' },
        E: { python_module: 'comfy_extras.nodes_mask' },
        F: {},
        G: null,
        H: { python_module: 42 }
      })
    ).toEqual([
      {
        id: 'ComfyUI-VideoHelperSuite',
        name: 'ComfyUI-VideoHelperSuite',
        enabled: true,
        nodeCount: 2
      },
      { id: 'rgthree-comfy', name: 'rgthree-comfy', enabled: true, nodeCount: 1 }
    ])
  })

  it('lists them as managed, and reads the catalog once', async () => {
    respond(200, { A: { python_module: 'custom_nodes.rgthree-comfy' } })
    const first = await listCloudNodes({})
    const second = await listCloudNodes({ query: 'rg' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/api/object_info')
    expect(first).toMatchObject({ ok: true, managed: true, total: 1 })
    expect(second).toMatchObject({ ok: true, items: [{ name: 'rgthree-comfy', nodeCount: 1 }] })
  })

  it('reads the catalog again for another workspace', async () => {
    respond(200, { A: { python_module: 'custom_nodes.rgthree-comfy' } })
    await listCloudNodes({})
    session.currentWorkspaceId.mockReturnValueOnce('w2')
    respond(200, {})
    expect(await listCloudNodes({})).toMatchObject({ ok: true, total: 0 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('reports signed out without reading the cached catalog', async () => {
    respond(200, { A: { python_module: 'custom_nodes.rgthree-comfy' } })
    await listCloudNodes({})
    session.isSignedIn.mockReturnValue(false)
    expect(await listCloudNodes({})).toMatchObject({ ok: false, signedOut: true })
  })

  it('reports a failed catalog read, and tries again next time', async () => {
    respond(500, null)
    expect(await listCloudNodes({})).toMatchObject({ ok: false })
    respond(200, {})
    expect(await listCloudNodes({})).toMatchObject({ ok: true, total: 0 })
  })
})

describe('listCloudAssets', () => {
  it('names outputs by file, with the details Cloud stores about them', async () => {
    respond(200, {
      assets: [
        {
          id: 'a1',
          name: 'video/clip_00001_.mp4',
          size: '2048',
          hash: 'blake3:abc',
          tags: ['output'],
          mime_type: 'video/mp4',
          created_at: '2026-10-01T10:00:00Z',
          updated_at: '2026-10-02T10:00:00Z'
        }
      ],
      total: 1,
      has_more: false
    })
    const page = await listCloudAssets({})
    expect(page).toMatchObject({
      ok: true,
      items: [
        {
          id: 'a1',
          name: 'clip_00001_.mp4',
          mediaType: 'video',
          category: 'output',
          size: 2048,
          hash: 'blake3:abc',
          mimeType: 'video/mp4',
          createdAt: Date.parse('2026-10-01T10:00:00Z'),
          modifiedAt: Date.parse('2026-10-02T10:00:00Z'),
          revealable: false
        }
      ]
    })
  })
})
