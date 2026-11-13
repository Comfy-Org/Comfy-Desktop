// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../cloud/config', () => ({
  CLOUD_CONFIG: { apiBase: 'https://cloud.example/api' }
}))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const LIST_URL =
  'https://cloud.example/api/v1/catalog/items?type=app&surface=desktop_starters&limit=100'

const catalog = (...slugs: unknown[]) =>
  new Response(JSON.stringify({ items: slugs.map((slug) => ({ data: { slug } })) }), {
    status: 200
  })

async function load() {
  vi.resetModules()
  return import('./desktopApps')
}

beforeEach(() => {
  fetchMock.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('desktopAppIds', () => {
  it("reads the slugs on the catalog's Desktop app list", async () => {
    fetchMock.mockResolvedValue(catalog('remove-background', 'upscale'))
    const { desktopAppIds } = await load()

    expect([...(await desktopAppIds())]).toEqual(['remove-background', 'upscale'])
    expect(fetchMock).toHaveBeenCalledWith(LIST_URL, expect.anything())
  })

  it('skips catalog entries whose slug is not a slug', async () => {
    fetchMock.mockResolvedValue(catalog('upscale', 'Upscale 4x', 3, undefined, '../x'))
    const { desktopAppIds } = await load()

    expect([...(await desktopAppIds())]).toEqual(['upscale'])
  })

  it('reads the list once an hour', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    fetchMock.mockImplementation(async () => catalog('upscale'))
    const { desktopAppIds } = await load()

    await desktopAppIds()
    await desktopAppIds()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    now.mockReturnValue(1_000_000 + 60 * 60 * 1000 + 1)
    await desktopAppIds()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each<[string, () => Promise<Response>]>([
    ['Cloud answers an error', async () => new Response('down', { status: 503 })],
    ['Cloud cannot be reached', async () => Promise.reject(new TypeError('fetch failed'))],
    ['the answer is not JSON', async () => new Response('<html>', { status: 200 })],
    ['the answer has no item list', async () => new Response('{}', { status: 200 })]
  ])('answers an empty list when %s, and asks again next time', async (_why, answer) => {
    fetchMock.mockImplementationOnce(answer)
    const { desktopAppIds } = await load()

    expect((await desktopAppIds()).size).toBe(0)

    fetchMock.mockResolvedValueOnce(catalog('upscale'))
    expect([...(await desktopAppIds())]).toEqual(['upscale'])
  })
})
