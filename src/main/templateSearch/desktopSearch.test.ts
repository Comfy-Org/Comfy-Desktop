import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  sitePackages: '/sp' as string | null,
  regularFileExists: vi.fn(async (_file: string) => false),
  buildExistenceCandidates: vi.fn(
    (_ctx: unknown, _base: string, directory: string, filename: string) => [
      `/shared/${directory}/${filename}`,
      `/extra/${directory}/${filename}`
    ]
  )
}))

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/userdata' }, net: {} }))
vi.mock('../installations', () => ({ list: mocks.list }))
vi.mock('../lib/modelDownloadPaths', () => ({
  resolveDownloadContext: () => ({
    modelRoots: [],
    extraPaths: [],
    downloadBaseDir: '/build-models'
  }),
  buildExistenceCandidates: mocks.buildExistenceCandidates,
  regularFileExists: mocks.regularFileExists
}))
vi.mock('./buildRuntime', () => ({
  buildRuntime: (build: { id: string }) => ({
    python: '/py',
    sitePackages: mocks.sitePackages && `${mocks.sitePackages}/${build.id}`
  })
}))

import { createDesktopSearch } from './desktopSearch'
import type { BuildTemplates, HasModel } from './buildTemplates'
import type { SidecarDecision } from './service'

const LOCAL = { id: 'local-1', sourceId: 'standalone' }
const CLOUD = { id: 'cloud-1', sourceId: 'cloud' }

const ANSWER = {
  outcome: { kind: 'template', reply: null },
  split: {
    run: [
      {
        rank: 1,
        option_id: 'poster:as_given',
        kind: 'as_given',
        family_id: 'poster',
        score: 0.9,
        threshold: 0.4,
        calibrated: 0.8,
        variant: { template_id: 'poster_template', title: null }
      }
    ],
    download: []
  },
  options: []
}

function setup(answer: SidecarDecision = { kind: 'answer', body: ANSWER }, enabled = true) {
  let clock = 0
  const decide = vi.fn(async (_body: unknown) => answer)
  const readTemplates = vi.fn(
    async (_sitePackages: string, _hasModel: HasModel): Promise<BuildTemplates> => ({
      installed: ['poster_template'],
      labels: new Map([
        ['poster_template', { title: 'Bake sale poster', thumbnailUrl: 'https://t/p.webp' }]
      ])
    })
  )
  const search = createDesktopSearch({
    process: { decide },
    isLocalInstallation: (b) => b.sourceId === 'standalone',
    terminalEnvOf: () => null,
    enabled: () => enabled,
    readTemplates,
    now: () => clock
  })
  return { search, decide, readTemplates, tick: (ms: number) => (clock += ms) }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.list.mockResolvedValue([LOCAL, CLOUD])
  mocks.sitePackages = '/sp'
})

describe('createDesktopSearch', () => {
  it("sends what the build has installed, and labels results from the build's own index", async () => {
    const { search, decide, readTemplates } = setup()
    const response = await search.search('a poster', 'local-1')

    expect(readTemplates.mock.calls[0]![0]).toBe('/sp/local-1')
    expect(decide.mock.calls[0]![0]).toMatchObject({
      text: 'a poster',
      installed: ['poster_template']
    })
    expect(response).toMatchObject({
      kind: 'result',
      result: {
        run: [
          {
            templateId: 'poster_template',
            title: 'Bake sale poster',
            thumbnailUrl: 'https://t/p.webp'
          }
        ]
      }
    })
  })

  it("finds a template's models wherever Desktop's model lookup would for that build", async () => {
    const { search, readTemplates } = setup()
    await search.search('a poster', 'local-1')
    const hasModel = readTemplates.mock.calls[0]![1]
    await hasModel('vae', 'v.safetensors')
    expect(mocks.buildExistenceCandidates).toHaveBeenCalledWith(
      expect.anything(),
      '/build-models',
      'vae',
      'v.safetensors'
    )

    mocks.regularFileExists.mockImplementation(async (file) => file === '/extra/vae/v.safetensors')
    expect(await hasModel('vae', 'v.safetensors')).toBe(true)
    mocks.regularFileExists.mockResolvedValue(false)
    expect(await hasModel('vae', 'v.safetensors')).toBe(false)
  })

  it.each([
    ['no build', null],
    ['a build that is not local', 'cloud-1'],
    ['a build Desktop does not know', 'missing-1']
  ])('treats every template as installed for %s', async (_name, installationId) => {
    const { search, decide, readTemplates } = setup()
    await search.search('a poster', installationId)
    expect(readTemplates).not.toHaveBeenCalled()
    expect(decide.mock.calls[0]![0]).not.toHaveProperty('installed')
  })

  it('reads nothing about the build while search is off', async () => {
    const { search, decide, readTemplates } = setup(undefined, false)
    expect(await search.search('a poster', 'local-1')).toEqual({
      kind: 'unavailable',
      availability: { kind: 'off' }
    })
    expect(readTemplates).not.toHaveBeenCalled()
    expect(decide).not.toHaveBeenCalled()
  })

  it('treats nothing as installed for a build whose runtime cannot be found', async () => {
    mocks.sitePackages = null
    const { search, decide, readTemplates } = setup()
    await search.search('a poster', 'local-1')
    expect(readTemplates).not.toHaveBeenCalled()
    expect(decide.mock.calls[0]![0]).toMatchObject({ installed: [] })
  })

  it('reads a build once a minute at most, and again after it changes', async () => {
    const { search, readTemplates, tick } = setup()
    await search.search('a poster', 'local-1')
    await search.search('a banner', 'local-1')
    expect(readTemplates).toHaveBeenCalledTimes(1)

    search.forget('local-1')
    await search.search('a poster', 'local-1')
    expect(readTemplates).toHaveBeenCalledTimes(2)

    tick(60_001)
    await search.search('a poster', 'local-1')
    expect(readTemplates).toHaveBeenCalledTimes(3)
  })

  it('passes on why search cannot answer', async () => {
    const { search } = setup({ kind: 'unavailable', availability: { kind: 'waiting_for_build' } })
    expect(await search.search('a poster', 'local-1')).toEqual({
      kind: 'unavailable',
      availability: { kind: 'waiting_for_build' }
    })
  })

  it('reports an answer it cannot read as failed', async () => {
    const { search } = setup({ kind: 'answer', body: { nothing: true } })
    expect(await search.search('a poster', 'local-1')).toEqual({ kind: 'failed' })
  })
})
