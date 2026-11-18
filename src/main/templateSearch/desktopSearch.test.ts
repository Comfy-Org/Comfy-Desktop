import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  sitePackages: '/sp' as string | null,
  modelBytesOnDisk: vi.fn(
    async (
      _ctx: unknown,
      _base: string,
      _directory: string,
      _filename: string
    ): Promise<number | null> => null
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
  modelBytesOnDisk: mocks.modelBytesOnDisk
}))
vi.mock('./buildRuntime', () => ({
  buildRuntime: (build: { id: string }) => ({
    python: '/py',
    sitePackages: mocks.sitePackages && `${mocks.sitePackages}/${build.id}`
  })
}))

import { createDesktopSearch } from './desktopSearch'
import type { BuildTemplates, ModelBytes } from './buildTemplates'
import type { SidecarDecision, SidecarRequest } from './service'

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

const SIZES = new Map([
  ['mural_template', 18_000_000_000],
  ['zine_template', 7_000_000_000],
  ['banner_template', 5_000_000_000]
])

const OFF: SidecarDecision = { kind: 'unavailable', availability: { kind: 'off' } }

function setup(
  answer: SidecarDecision = { kind: 'answer', body: ANSWER, partnerSwitch: false },
  on = true,
  { partnersOn = true, offersSwitch = false } = {}
) {
  let clock = 0
  const sent: unknown[] = []
  const decide = vi.fn(async (request: SidecarRequest): Promise<SidecarDecision> => {
    sent.push(request({ port: 4100, token: 't', partner: offersSwitch }))
    return answer.kind === 'answer' ? { ...answer, partnerSwitch: offersSwitch } : answer
  })
  const readTemplates = vi.fn(
    async (_sitePackages: string, _modelBytes: ModelBytes): Promise<BuildTemplates> => ({
      installed: ['poster_template'],
      labels: new Map([
        [
          'poster_template',
          {
            title: 'Bake sale poster',
            thumbnailUrl: 'https://t/p.webp',
            partner: false
          }
        ]
      ]),
      downloadBytes: async (id) => SIZES.get(id) ?? null
    })
  )
  const search = createDesktopSearch({
    process: { decide },
    isLocalInstallation: (b) => b.sourceId === 'standalone',
    terminalEnvOf: () => null,
    searchOn: () => on,
    partnersOn: () => partnersOn,
    readTemplates,
    now: () => clock
  })
  return { search, decide, sent, readTemplates, tick: (ms: number) => (clock += ms) }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.list.mockResolvedValue([LOCAL, CLOUD])
  mocks.sitePackages = '/sp'
})

describe('createDesktopSearch', () => {
  it("sends what the build has installed, and labels results from the build's own index", async () => {
    const { search, sent, readTemplates } = setup()
    const response = await search.search('a poster', 'local-1')

    expect(readTemplates.mock.calls[0]![0]).toBe('/sp/local-1')
    expect(sent[0]).toMatchObject({
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

  it("looks for a template's models in the build's own model folder", async () => {
    const { search, readTemplates } = setup()
    await search.search('a poster', 'local-1')
    const modelBytes = readTemplates.mock.calls[0]![1]

    expect(await modelBytes('vae', 'v.safetensors')).toBeNull()
    mocks.modelBytesOnDisk.mockResolvedValueOnce(42)
    expect(await modelBytes('vae', 'v.safetensors')).toBe(42)
    expect(mocks.modelBytesOnDisk).toHaveBeenCalledWith(
      expect.anything(),
      '/build-models',
      'vae',
      'v.safetensors'
    )
  })

  it('gives each Download and run card the download size the build reads for it', async () => {
    const needsFiles = (templateId: string) => ({
      ...ANSWER.split.run[0]!,
      option_id: `${templateId}:as_given`,
      family_id: templateId,
      variant: { template_id: templateId, title: null },
      download: [templateId, `${templateId}.safetensors`]
    })
    const body = {
      ...ANSWER,
      split: {
        run: ANSWER.split.run,
        download: [needsFiles('mural_template'), needsFiles('zine_template')]
      }
    }
    const { search } = setup({ kind: 'answer', body, partnerSwitch: false })

    const local = await search.search('a mural', 'local-1')
    const unknown = await search.search('a mural', null)

    expect(local).toMatchObject({
      result: {
        download: [
          { templateId: 'mural_template', downloadBytes: 18_000_000_000 },
          { templateId: 'zine_template', downloadBytes: 7_000_000_000 }
        ]
      }
    })
    expect(unknown).toMatchObject({
      result: {
        download: [
          { templateId: 'mural_template', downloadBytes: null },
          { templateId: 'zine_template', downloadBytes: null }
        ]
      }
    })
  })

  it('gives an Also try card that needs a download its size too, and none to one that does not', async () => {
    const offer = (templateId: string, masked?: { code: string; detail: string }) => ({
      ...ANSWER.split.run[0]!,
      option_id: `${templateId}:as_given`,
      family_id: templateId,
      variant: { template_id: templateId, title: null },
      ...(masked ? { masked } : {})
    })
    const body = {
      ...ANSWER,
      options: [
        offer('mural_template', {
          code: 'not_installed',
          detail: 'mural_template,mural.safetensors'
        }),
        offer('banner_template')
      ]
    }
    const { search } = setup({ kind: 'answer', body, partnerSwitch: false })

    expect(await search.search('a mural', 'local-1')).toMatchObject({
      result: {
        alsoTry: [
          { templateId: 'mural_template', needsDownload: true, downloadBytes: 18_000_000_000 },
          { templateId: 'banner_template', needsDownload: false, downloadBytes: null }
        ]
      }
    })
  })

  it('asks a search that can leave partner templates out to do so while the setting is off', async () => {
    const { search, sent } = setup(undefined, true, { partnersOn: false, offersSwitch: true })
    const response = await search.search('a poster', 'local-1')

    expect(sent[0]).toMatchObject({ partner_on: false })
    expect(response).toMatchObject({
      kind: 'result',
      result: { partnerSwitch: true, partnersShown: false }
    })
  })

  it('never asks a search that cannot leave partner templates out to do so', async () => {
    const { search, sent } = setup(undefined, true, { partnersOn: false, offersSwitch: false })
    const response = await search.search('a poster', 'local-1')

    expect(sent[0]).not.toHaveProperty('partner_on')
    expect(response).toMatchObject({
      kind: 'result',
      result: { partnerSwitch: false, partnersShown: false }
    })
  })

  it('asks for partner templates as usual while the setting is on, and still offers the switch', async () => {
    const { search, sent } = setup(undefined, true, { offersSwitch: true })
    const response = await search.search('a poster', 'local-1')

    expect(sent[0]).not.toHaveProperty('partner_on')
    expect(response).toMatchObject({
      kind: 'result',
      result: { partnerSwitch: true, partnersShown: true }
    })
  })

  it.each([
    ['no build', null],
    ['a build that is not local', 'cloud-1'],
    ['a build Desktop does not know', 'missing-1']
  ])('treats every template as installed for %s', async (_name, installationId) => {
    const { search, sent, readTemplates } = setup()
    await search.search('a poster', installationId)
    expect(readTemplates).not.toHaveBeenCalled()
    expect(sent[0]).not.toHaveProperty('installed')
  })

  it('reads nothing about the build while search is off, and lets search stop itself', async () => {
    const { search, decide, sent, readTemplates } = setup(OFF, false)
    expect(await search.search('a poster', 'local-1')).toEqual(OFF)
    expect(readTemplates).not.toHaveBeenCalled()
    expect(mocks.list).not.toHaveBeenCalled()
    expect(decide).toHaveBeenCalledTimes(1)
    expect(sent[0]).not.toHaveProperty('installed')
  })

  it("treats nothing as installed for a build whose template index can't be read", async () => {
    const { search, sent, readTemplates } = setup()
    readTemplates.mockRejectedValueOnce(new Error('bad index'))
    expect((await search.search('a poster', 'local-1')).kind).toBe('result')
    expect(sent[0]).toMatchObject({ installed: [] })
  })

  it('treats nothing as installed for a build whose runtime cannot be found', async () => {
    mocks.sitePackages = null
    const { search, sent, readTemplates } = setup()
    await search.search('a poster', 'local-1')
    expect(readTemplates).not.toHaveBeenCalled()
    expect(sent[0]).toMatchObject({ installed: [] })
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
    const { search } = setup({ kind: 'answer', body: { nothing: true }, partnerSwitch: false })
    expect(await search.search('a poster', 'local-1')).toEqual({ kind: 'failed' })
  })
})
