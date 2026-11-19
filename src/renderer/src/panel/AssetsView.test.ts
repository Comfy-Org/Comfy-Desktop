import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import '../assets/main.css'
import AssetsView from './AssetsView.vue'
import Tooltip from '../components/ui/Tooltip.vue'
import { useAuthStore } from '../stores/authStore'
import { useDashboardScopeStore } from '../stores/dashboardScopeStore'
import { useInstallationStore } from '../stores/installationStore'
import { useSessionStore } from '../stores/sessionStore'
import type {
  AssetSummary,
  CloudAssetLookup,
  CloudAssetPage,
  Installation,
  LocalAssetListing,
  LocalAssetPageRequest,
  RunningInstance
} from '../types/ipc'

const listAssets = vi.fn()
const findCloudAsset = vi.fn()
const listLocalAssets = vi.fn()
const downloadAsset = vi.fn()
const revealAsset = vi.fn()
const openAsset = vi.fn()
const openOutputFolder = vi.fn()
const copyAsset = vi.fn()
const readAssetModel = vi.fn()
const hasAssetWorkflow = vi.fn()
const openAssetWorkflow = vi.fn()
const trashAsset = vi.fn()
const alert = vi.fn()
const confirm = vi.fn()
const signIn = vi.fn().mockResolvedValue({ signedIn: false })
const switchWorkspace = vi.fn()
const listWorkspaces = vi.fn()
const getAuthStatus = vi.fn()
const getSetting = vi.fn()
const MASONRY_GAP = 14
const FOUR_COLUMN_PAGE_WIDTH = 1100
const TALL_PAGE_HEIGHT = 3000
const FIRST_PAGE = { offset: 0, limit: 100, order: 'newest' }

let page: HTMLElement
const localPages: LocalAssetPageRequest[] = []

const panelLayout = document.createElement('style')
panelLayout.textContent = '[data-panel-page] > div { display: flex; height: 100%; }'
document.head.append(panelLayout)

function picture(id: string, height: number): AssetSummary {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="${height}"/>`
  return asset(id, `${id}.svg`, 'image', {
    previewUrl: `data:image/svg+xml,${encodeURIComponent(svg)}`,
    width: 200,
    height
  })
}

vi.mock('../composables/useModal', () => ({
  useModal: () => ({ alert, confirm })
}))

function localListing(
  all: AssetSummary[],
  page: LocalAssetPageRequest = { offset: 0, limit: 500, order: 'newest' }
): LocalAssetListing {
  localPages.push(page)
  const term = page.search?.toLowerCase()
  const named = term ? all.filter((item) => item.name.toLowerCase().includes(term)) : all
  const count = (kind: AssetSummary['kind']) => named.filter((item) => item.kind === kind).length
  const matching = page.kind ? named.filter((item) => item.kind === page.kind) : named
  return {
    assets: matching.slice(page.offset, page.offset + page.limit),
    total: matching.length,
    counts: {
      all: named.length,
      image: count('image'),
      video: count('video'),
      audio: count('audio'),
      '3d': count('3d')
    }
  }
}

function asset(
  id: string,
  name: string,
  kind: AssetSummary['kind'],
  extra: Partial<AssetSummary> = {}
): AssetSummary {
  return {
    id,
    name,
    kind,
    sizeBytes: 1024,
    createdAt: null,
    mimeType: null,
    tags: ['output'],
    previewUrl: null,
    thumbnailUrl: null,
    width: null,
    height: null,
    ...extra
  }
}

function cloudBuild(id: string, name = id): Installation {
  return { id, name, sourceLabel: 'Comfy Cloud', sourceCategory: 'cloud' }
}

function localBuild(id: string, name = id, extra: Partial<Installation> = {}): Installation {
  return {
    id,
    name,
    sourceLabel: 'Standalone',
    sourceCategory: 'local',
    hasOutputFolder: true,
    useSharedOutput: false,
    ...extra
  }
}

function sharedBuild(id: string, name = id): Installation {
  return localBuild(id, name, { useSharedOutput: true })
}

function shownText(element: Element | null): string {
  return (element as HTMLElement | null)?.innerText.replace(/\s+/g, ' ').trim() ?? ''
}

function oldDesktopBuild(id: string, name = id): Installation {
  return localBuild(id, name, { sourceLabel: 'Desktop', hasOutputFolder: false })
}

function teamBuild(build: Installation): Installation {
  return { ...build, workspaceId: 'team-b' }
}

function signedInToPersonalWithTeamDashboard(): void {
  getAuthStatus.mockResolvedValue({ signedIn: true, workspaceId: 'me', workspaceType: 'personal' })
  getSetting.mockImplementation(async (key: string) =>
    key === 'dashboardWorkspaceId' ? 'team-b' : undefined
  )
}

async function mountAssets(
  local: AssetSummary[] | Promise<AssetSummary[]> = [],
  {
    builds = [localBuild('lab')],
    installationId
  }: { builds?: Installation[]; installationId?: string } = {}
) {
  const installationStore = useInstallationStore()
  installationStore.installations = builds
  installationStore.loading = false
  listLocalAssets.mockReturnValue(Promise.resolve(local))
  const wrapper = mount(AssetsView, { attachTo: page, props: { installationId } })
  await flushPromises()
  return wrapper
}

async function openBuildPicker(wrapper: Awaited<ReturnType<typeof mountAssets>>): Promise<void> {
  await wrapper.get('[data-testid="assets-build-picker"]').trigger('keydown', { key: 'Enter' })
  await flushPromises()
}

function buildRows(): string[] {
  return [
    ...document.querySelectorAll(
      '[data-testid^="assets-build-"]:not([data-testid="assets-build-picker"])'
    )
  ].map((row) =>
    [...row.querySelectorAll('.truncate')]
      .map((part) => part.textContent?.replace(/\s+/g, ' ').trim())
      .join(' ')
  )
}

async function pickBuild(id: string): Promise<void> {
  document.querySelector<HTMLElement>(`[data-testid="assets-build-${id}"]`)!.click()
  await flushPromises()
}

async function signInWith(cloud: AssetSummary[]): Promise<void> {
  useInstallationStore().installations = [cloudBuild('cloud')]
  listAssets.mockResolvedValue(cloud)
  useAuthStore().status = { signedIn: true }
  await flushPromises()
}

function menuLabels(): string[] {
  return [...document.querySelectorAll('[data-testid^="context-menu-item-"]')].map(
    (item) => item.textContent?.trim() ?? ''
  )
}

async function pickMenuItem(id: string): Promise<void> {
  document.querySelector<HTMLElement>(`[data-testid="context-menu-item-${id}"]`)!.click()
  await flushPromises()
}

async function rightClick(element: Element): Promise<MouseEvent> {
  const event = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: 100,
    clientY: 100
  })
  element.dispatchEvent(event)
  await flushPromises()
  return event
}

function assetNames(wrapper: Awaited<ReturnType<typeof mountAssets>>): string[] {
  return wrapper
    .get('[data-testid="assets-grid"]')
    .findAllComponents(Tooltip)
    .map((tip) => tip.props('text') as string)
}

function viewer(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="output-detail"]')
}

function viewerTitle(): string {
  return viewer()?.querySelector('h2')?.textContent?.trim() ?? ''
}

async function press(key: string): Promise<void> {
  const target = document.activeElement ?? document.body
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  await flushPromises()
}

beforeEach(() => {
  page = document.createElement('div')
  page.dataset.panelPage = ''
  page.style.cssText = `width: ${FOUR_COLUMN_PAGE_WIDTH}px; height: ${TALL_PAGE_HEIGHT}px`
  document.body.append(page)
  vi.clearAllMocks()
  localPages.length = 0
  window.localStorage.clear()
  listLocalAssets.mockResolvedValue([])
  openAsset.mockResolvedValue(true)
  revealAsset.mockResolvedValue(true)
  openOutputFolder.mockResolvedValue(true)
  listWorkspaces.mockResolvedValue([
    { id: 'me', name: 'Personal Workspace', type: 'personal' },
    { id: 'team-b', name: 'Team B', type: 'team' }
  ])
  switchWorkspace.mockImplementation(async (workspaceId: string) => ({
    signedIn: true,
    workspaceId
  }))
  getAuthStatus.mockResolvedValue({ signedIn: false })
  getSetting.mockResolvedValue(undefined)
  findCloudAsset.mockResolvedValue({ status: 'absent' })
  hasAssetWorkflow.mockResolvedValue(false)
  openAssetWorkflow.mockResolvedValue({ opened: true })
  ;(window as unknown as { api: unknown }).api = {
    listAssets: async (installationId: string, request: unknown) => {
      const listed: AssetSummary[] | CloudAssetPage | null = await listAssets(
        installationId,
        request
      )
      return Array.isArray(listed) ? { assets: listed, total: listed.length } : listed
    },
    findCloudAsset,
    listLocalAssets: async (installationId?: string, page?: LocalAssetPageRequest) =>
      localListing(await listLocalAssets(installationId), page),
    downloadAsset,
    revealAsset,
    openAsset,
    openOutputFolder,
    listOutputFolders: async () => ({
      home: '/Users/me',
      shared: '/Users/me/ComfyUI/output',
      ofBuild: { lab: '/Volumes/Work/Video Lab/output', mine: '/Users/me/My Local 1/output' }
    }),
    copyAsset,
    readAssetModel,
    hasAssetWorkflow,
    openAssetWorkflow,
    trashAsset,
    platform: 'darwin',
    getSetting,
    setSetting: vi.fn().mockResolvedValue(undefined),
    onSettingsChanged: vi.fn(() => () => {}),
    onInstallationsChanged: vi.fn(() => () => {}),
    onInstallationsVersionsUpdated: vi.fn(() => () => {}),
    comfybuilder: {
      getAuthStatus,
      signIn,
      switchWorkspace,
      listWorkspaces,
      onAuthChanged: vi.fn(() => () => {})
    }
  }
  setActivePinia(createPinia())
})

afterEach(() => page.remove())

describe('AssetsView', () => {
  it('shows each file name and its details under the card by default', async () => {
    const wrapper = await mountAssets([asset('a', 'forest.png', 'image', { sizeBytes: 2048 })])

    expect(wrapper.get('[data-testid="asset-a"]').text()).toContain('forest.png')
    expect(wrapper.get('[data-testid="asset-a"]').text()).toContain('2 KB')
  })

  it('marks a video with a play button and leaves pictures plain', async () => {
    const wrapper = await mountAssets([
      asset('clip', 'clip.mp4', 'video', { previewUrl: 'data:video/mp4,' }),
      asset('still', 'still.png', 'image', { previewUrl: picture('x', 300).previewUrl })
    ])

    expect(wrapper.find('[data-testid="asset-clip"] [data-testid="asset-play"]').exists()).toBe(
      true
    )
    expect(wrapper.find('[data-testid="asset-still"] [data-testid="asset-play"]').exists()).toBe(
      false
    )
  })

  it('shows how long a video runs once its card has read the start of the video', async () => {
    const wrapper = await mountAssets([
      asset('clip', 'clip.mp4', 'video', { previewUrl: 'data:video/mp4,' })
    ])
    const video = wrapper.get('[data-testid="asset-clip"] video').element
    expect(wrapper.find('[data-testid="asset-clip"] [data-testid="asset-duration"]').exists()).toBe(
      false
    )

    Object.defineProperty(video, 'duration', { value: 61.2 })
    video.dispatchEvent(new Event('loadedmetadata'))
    await flushPromises()

    expect(wrapper.get('[data-testid="asset-clip"] [data-testid="asset-duration"]').text()).toBe(
      '1:01'
    )
  })

  it('shows how long a sound runs on its card', async () => {
    const wrapper = await mountAssets([
      asset('song', 'song.flac', 'audio', { durationSeconds: 69.4 }),
      asset('blip', 'blip.wav', 'audio')
    ])

    expect(wrapper.get('[data-testid="asset-song"] [data-testid="asset-duration"]').text()).toBe(
      '1:09'
    )
    expect(wrapper.find('[data-testid="asset-blip"] [data-testid="asset-duration"]').exists()).toBe(
      false
    )
  })

  it('shows the picture of a 3D file whole, and its box when it has none', async () => {
    const thumb = picture('t', 200).previewUrl!
    const wrapper = await mountAssets([
      asset('fox', 'fox.glb', '3d', { thumbnailUrl: thumb }),
      asset('robot', 'robot.glb', '3d')
    ])

    const shown = wrapper.get('[data-testid="asset-fox"] img')
    expect(shown.attributes('src')).toBe(thumb)
    expect(shown.classes()).toContain('object-contain')
    expect(wrapper.find('[data-testid="asset-robot"] img').exists()).toBe(false)
  })

  it('opens a 3D file in a 3D view that reads the file through Desktop', async () => {
    readAssetModel.mockResolvedValue(null)
    const wrapper = await mountAssets([asset('/out/fox.glb', 'fox.glb', '3d')])

    await wrapper.get('[data-testid="asset-open-/out/fox.glb"]').trigger('click')
    await vi.waitFor(
      () =>
        expect(document.querySelector('[data-testid="output-detail-model-failed"]')).not.toBeNull(),
      { timeout: 5000 }
    )

    expect(readAssetModel).toHaveBeenCalledExactlyOnceWith('local', '/out/fox.glb')
    wrapper.unmount()
  })

  it('shows a video in its own shape with how long it runs, and a picture without a size as a square', async () => {
    const wrapper = await mountAssets([
      asset('clip', 'clip.mp4', 'video', { width: 320, height: 480, durationSeconds: 7.4 }),
      asset('still', 'still.png', 'image', { previewUrl: picture('x', 300).previewUrl })
    ])

    await vi.waitFor(() => {
      const shapeOf = (id: string) => {
        const media = wrapper
          .get(`[data-testid="asset-${id}"] .rounded-control`)
          .element.getBoundingClientRect()
        return Number((media.height / media.width).toFixed(2))
      }
      expect(shapeOf('clip'), 'the portrait video stays tall').toBe(1.5)
      expect(shapeOf('still'), 'a picture with no known size is a square crop').toBe(1)
    })
    expect(wrapper.get('[data-testid="asset-clip"] [data-testid="asset-duration"]').text()).toBe(
      '0:07'
    )
  })

  it('starts in masonry, newest across the top, each next card under the shortest column', async () => {
    const heights = [300, 300, 300, 100, 100, 100, 100, 100]
    const wrapper = await mountAssets(heights.map((height, i) => picture(`card-${i}`, height)))
    const gallery = wrapper.get('[data-testid="assets-grid"]').element

    await vi.waitFor(() => {
      const cards = wrapper
        .findAll('[data-testid="assets-grid"] > li')
        .map((card) => card.element.getBoundingClientRect())
      expect(cards, 'every card is on the page').toHaveLength(8)
      expect(
        wrapper.findAll('[data-testid="assets-grid"] img').map((img) => {
          const box = img.element.getBoundingClientRect()
          return Number((box.height / box.width).toFixed(2))
        }),
        'each picture keeps its own shape'
      ).toEqual(heights.map((height) => height / 200))

      const topRow = cards.slice(0, 4)
      expect(
        topRow.map((card) => card.top),
        'the four newest cards share the top row'
      ).toEqual(topRow.map(() => gallery.getBoundingClientRect().top))
      expect(
        topRow.map((card) => card.left),
        'the four newest cards read left to right'
      ).toEqual(topRow.map((card) => card.left).toSorted((a, b) => a - b))

      const columns = Map.groupBy(cards, (card) => Math.round(card.left))
      expect(columns.size, 'cards fill four columns').toBe(4)
      for (const column of columns.values()) {
        column.slice(1).forEach((card, i) => {
          expect(
            card.top - column[i]!.bottom,
            'cards in a column sit one gap apart, to the half pixel'
          ).toBeCloseTo(MASONRY_GAP, 0)
        })
      }
      const lastCardTops = [...columns.values()].map((column) => column.at(-1)!.top)
      const columnBottoms = [...columns.values()].map((column) => column.at(-1)!.bottom)
      expect(
        Math.max(...lastCardTops),
        'no card starts below the bottom of a shorter column'
      ).toBeLessThanOrEqual(Math.min(...columnBottoms) + MASONRY_GAP + 0.5)
    })
  })

  it('puts only the cards on screen on the page, and the rest as the user scrolls', async () => {
    page.style.height = '600px'
    const wrapper = await mountAssets(
      Array.from({ length: 100 }, (_, i) => picture(`card-${i}`, 300))
    )
    const cardCount = () => wrapper.findAll('[data-testid="assets-grid"] > li').length

    await vi.waitFor(() => expect(cardCount(), 'the first rows are on the page').toBeGreaterThan(0))
    expect(cardCount(), 'cards far below the window are not').toBeLessThan(40)

    const view = wrapper.get('[data-testid="assets-view"]').element
    view.scrollTop = view.scrollHeight
    await vi.waitFor(() =>
      expect(
        wrapper.find('[data-testid="asset-card-99"]').exists(),
        'the oldest card shows at the end'
      ).toBe(true)
    )
    expect(cardCount(), 'the cards scrolled past are gone').toBeLessThan(40)
  })

  it('opens with the view setup the user saved last time', async () => {
    window.localStorage.setItem('comfy.desktop.assets.layout', 'grid')
    window.localStorage.setItem('comfy.desktop.assets.showName', 'false')

    const wrapper = await mountAssets([picture('a', 300)])

    const media = wrapper.get('[data-testid="asset-a"] img').element.getBoundingClientRect()
    expect(media.width / media.height, 'grid crops every card to the same wide shape').toBeCloseTo(
      16 / 9
    )
    expect(wrapper.get('[data-testid="asset-a"]').text()).not.toContain('a.svg')
  })

  it('shows the files of a local build without it running or a Cloud login', async () => {
    const wrapper = await mountAssets([
      asset('/out/surfer.mp4', 'surfer.mp4', 'video'),
      asset('/out/forest.png', 'forest.png', 'image')
    ])

    expect(listLocalAssets).toHaveBeenCalledExactlyOnceWith('lab')
    expect(listAssets).not.toHaveBeenCalled()
    expect(assetNames(wrapper)).toEqual(['surfer.mp4', 'forest.png'])
  })

  it('shows an image card from its small thumbnail', async () => {
    const wrapper = await mountAssets([
      asset('/out/forest.png', 'forest.png', 'image', {
        previewUrl: 'comfy-output://file/full',
        thumbnailUrl: 'comfy-output://file/full?thumbnail=1'
      })
    ])

    expect(wrapper.get('img').attributes('src')).toBe('comfy-output://file/full?thumbnail=1')
  })

  it("opens on the window's build, lists Comfy Cloud then each build with its own folder, and switches to the one picked", async () => {
    useSessionStore().runningInstances.set('lab', { installationId: 'lab' } as RunningInstance)
    listAssets.mockResolvedValue([asset('c1', 'cloud.png', 'image')])
    const wrapper = await mountAssets([asset('/out/mine.png', 'mine.png', 'image')], {
      builds: [
        localBuild('mine', 'My Local 1'),
        localBuild('lab', 'Video Lab'),
        {
          ...cloudBuild('cloud', 'Comfy Cloud'),
          statusTag: { style: 'update', label: 'Update available' }
        }
      ],
      installationId: 'mine'
    })

    useAuthStore().status = { signedIn: true }
    await flushPromises()

    expect(wrapper.get('[data-testid="assets-build-picker"]').text()).toBe('My Local 1')
    expect(
      listLocalAssets.mock.calls.flat(),
      'only the window build is read, and logging in does not read it again'
    ).toEqual(['mine'])
    expect(listAssets).not.toHaveBeenCalled()
    expect(assetNames(wrapper)).toEqual(['mine.png'])

    await openBuildPicker(wrapper)
    expect(
      [...document.querySelectorAll('[data-testid^="assets-place-group-"]')].map((header) =>
        header.textContent?.trim()
      ),
      'Cloud and this computer are grouped apart'
    ).toEqual(['Comfy Cloud', 'This computer'])
    expect(
      document.querySelector('[data-testid="assets-place-subtitle-cloud"] .bg-success'),
      'Cloud runs nowhere on this computer, so it has no green dot'
    ).toBe(null)
    expect(buildRows(), 'no Shared folder when no build saves there').toEqual([
      'Comfy Cloud Ready',
      'My Local 1 ~/My Local 1/output',
      'Video Lab /Volumes/Work/Video Lab/output'
    ])

    await pickBuild('cloud')

    expect(listAssets).toHaveBeenCalledExactlyOnceWith('cloud', FIRST_PAGE)
    expect(wrapper.get('[data-testid="assets-build-picker"]').text()).toBe('Comfy Cloud')
    expect(assetNames(wrapper), "only the picked build's files show").toEqual(['cloud.png'])
  })

  it('reopens on the last picked build in a window with no build of its own', async () => {
    const builds = [localBuild('mine', 'My Local 1'), localBuild('lab', 'Video Lab')]
    const first = await mountAssets([], { builds })
    await openBuildPicker(first)
    await pickBuild('lab')
    first.unmount()
    listLocalAssets.mockClear()

    const again = await mountAssets([], { builds })

    expect(again.get('[data-testid="assets-build-picker"]').text()).toBe('Video Lab')
    expect(listLocalAssets).toHaveBeenCalledExactlyOnceWith('lab')
  })

  it('leaves out builds from other workspaces, and servers and builds whose files Desktop cannot list', async () => {
    const wrapper = await mountAssets([], {
      builds: [
        localBuild('mine', 'My Local 1'),
        teamBuild(localBuild('team', 'Team build')),
        { id: 'remote', name: 'Office server', sourceLabel: 'Remote', sourceCategory: 'remote' },
        oldDesktopBuild('old', 'Old Desktop')
      ]
    })

    await openBuildPicker(wrapper)

    expect(buildRows()).toEqual(['Comfy Cloud Ready', 'My Local 1 ~/My Local 1/output'])
  })

  it('opens on a build it can list, not on a running build that keeps its files to itself', async () => {
    useSessionStore().runningInstances.set('old', { installationId: 'old' } as RunningInstance)
    const wrapper = await mountAssets([asset('/out/forest.png', 'forest.png', 'image')], {
      builds: [oldDesktopBuild('old', 'Old Desktop'), localBuild('lab', 'Video Lab')]
    })

    expect(wrapper.get('[data-testid="assets-build-picker"]').text()).toBe('Video Lab')
    expect(listLocalAssets).toHaveBeenCalledExactlyOnceWith('lab')
    expect(assetNames(wrapper)).toEqual(['forest.png'])
  })

  it('waits for the builds before it reads any folder', async () => {
    const installationStore = useInstallationStore()
    const wrapper = mount(AssetsView, { attachTo: page, props: { installationId: 'mine' } })
    await flushPromises()

    expect(listLocalAssets, 'no folder is read before the builds are known').not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="assets-build-picker"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-testid="assets-skeleton"] > li')).toHaveLength(8)

    installationStore.installations = [localBuild('lab'), localBuild('mine', 'My Local 1')]
    installationStore.loading = false
    await flushPromises()

    expect(wrapper.get('[data-testid="assets-build-picker"]').text()).toBe('My Local 1')
    expect(listLocalAssets).toHaveBeenCalledExactlyOnceWith('mine')
  })

  it('keeps an empty page in place while the builds refresh', async () => {
    const wrapper = await mountAssets()

    useInstallationStore().loading = true
    await flushPromises()

    expect(wrapper.get('[data-testid="assets-empty"] h2').text()).toBe('No assets yet')
    expect(wrapper.find('[data-testid="assets-skeleton"]').exists()).toBe(false)
  })

  it('keeps the toolbar on one row: search turns into a button, then the type tabs into a menu', async () => {
    page.style.width = '1400px'
    const wrapper = await mountAssets([asset('b', 'forest.png', 'image')])
    const shown = (testId: string) => wrapper.find(`[data-testid="${testId}"]`).exists()
    const toolbarRow = () => wrapper.get('[data-testid="assets-toolbar"] > div').element

    await vi.waitFor(() => expect(shown('assets-kind-all')).toBe(true))
    expect(shown('assets-search-toggle')).toBe(false)
    expect(shown('assets-kind-menu')).toBe(false)

    page.style.width = '420px'
    await vi.waitFor(() => expect(shown('assets-kind-menu')).toBe(true))
    expect(shown('assets-kind-all')).toBe(false)
    expect(shown('assets-search-toggle')).toBe(true)
    expect(toolbarRow().scrollWidth).toBeLessThanOrEqual(toolbarRow().clientWidth)

    page.style.width = '1400px'
    await vi.waitFor(() => expect(shown('assets-kind-all')).toBe(true))
    expect(shown('assets-search-toggle')).toBe(false)
  })

  it('keeps the compact search open while a query changes the results', async () => {
    page.style.width = '560px'
    const wrapper = await mountAssets([
      asset('a', 'surfer.mp4', 'video'),
      asset('b', 'forest.png', 'image')
    ])
    const toggle = () => wrapper.find('[data-testid="assets-search-toggle"]')
    await vi.waitFor(() => expect(toggle().exists()).toBe(true))
    await toggle().trigger('click')
    const input = () =>
      document.querySelector<HTMLInputElement>('[data-testid="assets-search-compact"] input')
    await vi.waitFor(() => expect(input()).not.toBeNull())
    const typedInto = input()!

    typedInto.value = 'forest'
    typedInto.dispatchEvent(new Event('input'))

    await vi.waitFor(() => expect(assetNames(wrapper)).toEqual(['forest.png']))
    expect(input(), 'the same input stays on the page').toBe(typedInto)
  })

  it('filters by asset type and by name', async () => {
    const wrapper = await mountAssets([
      asset('a', 'surfer.mp4', 'video'),
      asset('b', 'forest.png', 'image'),
      asset('c', 'terraces.png', 'image')
    ])

    const tabs = () => wrapper.findAll('[data-testid^="assets-kind-"]').map((tab) => tab.text())
    expect(tabs(), 'the type tabs show no counts').toEqual([
      'All',
      'Images',
      'Videos',
      '3D',
      'Audio'
    ])

    await wrapper.get('[data-testid="assets-kind-image"]').trigger('click')
    await vi.waitFor(() => expect(assetNames(wrapper)).toEqual(['forest.png', 'terraces.png']))
    expect(listLocalAssets, 'the type is read from the folder').toHaveBeenCalledTimes(2)

    await wrapper.get('input').setValue('terr')
    await vi.waitFor(() => expect(assetNames(wrapper)).toEqual(['terraces.png']))
    expect(localPages.at(-1), 'the folder is searched, not only the open page').toEqual({
      offset: 0,
      limit: 100,
      order: 'newest',
      kind: 'image',
      search: 'terr'
    })
    expect(tabs(), 'a search adds no counts to the type tabs').toEqual([
      'All',
      'Images',
      'Videos',
      '3D',
      'Audio'
    ])
  })

  it('searches the whole folder once the typing stops, from page 1', async () => {
    const wrapper = await mountAssets(
      Array.from({ length: 150 }, (_, i) =>
        asset(`f${i}`, i === 140 ? 'lighthouse.png' : `frame-${i}.png`, 'image')
      )
    )
    await wrapper.get('[data-testid="assets-page-2"]').trigger('click')
    await flushPromises()
    const readsBefore = localPages.length

    const input = wrapper.get('input')
    for (const typed of ['l', 'li', 'lig', 'light']) await input.setValue(typed)
    await vi.waitFor(() => expect(assetNames(wrapper)).toEqual(['lighthouse.png']))

    expect(
      localPages.slice(readsBefore),
      'one read for the finished word, not one per key'
    ).toEqual([{ offset: 0, limit: 100, order: 'newest', search: 'light' }])
    expect(wrapper.find('[data-testid="assets-pagination"]').text()).toContain('1–1 of 1')
  })

  it('lists every output again from page 1 when the search is cleared', async () => {
    const wrapper = await mountAssets(
      Array.from({ length: 150 }, (_, i) =>
        asset(`f${i}`, i === 140 ? 'lighthouse.png' : `frame-${i}.png`, 'image')
      )
    )
    const input = wrapper.get('input')
    await input.setValue('light')
    await vi.waitFor(() => expect(assetNames(wrapper)).toEqual(['lighthouse.png']))
    const readsBefore = localPages.length

    await input.setValue('')
    await vi.waitFor(() =>
      expect(wrapper.find('[data-testid="assets-pagination"]').text()).toContain('1–100 of 150')
    )

    expect(localPages.slice(readsBefore)).toEqual([{ offset: 0, limit: 100, order: 'newest' }])
    expect(assetNames(wrapper)).toContain('frame-0.png')
  })

  it('sends at most the first 200 characters of a long search', async () => {
    const wrapper = await mountAssets([asset('a', 'lighthouse.png', 'image')])
    const readsBefore = localPages.length

    await wrapper.get('input').setValue('l'.repeat(250))
    await vi.waitFor(() => expect(localPages.length).toBeGreaterThan(readsBefore))

    expect(localPages.at(-1)?.search).toBe('l'.repeat(200))
  })

  it('never cuts a character in half when it shortens a long search', async () => {
    const wrapper = await mountAssets([asset('a', 'lighthouse.png', 'image')])
    const readsBefore = localPages.length

    await wrapper.get('input').setValue(`${'l'.repeat(199)}🌲🌲`)
    await vi.waitFor(() => expect(localPages.length).toBeGreaterThan(readsBefore))

    expect(localPages.at(-1)?.search).toBe(`${'l'.repeat(199)}🌲`)
  })

  it('shows each folder in its file manager from the picker', async () => {
    const wrapper = await mountAssets([], {
      builds: [sharedBuild('a', 'Shared A'), localBuild('lab', 'Video Lab')]
    })
    await openBuildPicker(wrapper)

    document.querySelector<HTMLElement>('[data-testid="assets-place-reveal-shared"]')!.click()
    document.querySelector<HTMLElement>('[data-testid="assets-place-reveal-lab"]')!.click()

    expect(openOutputFolder.mock.calls).toEqual([[undefined], ['lab']])
    expect(
      wrapper
        .findAllComponents(Tooltip)
        .some((tip) => tip.props('text') === '/Volumes/Work/Video Lab/output'),
      'the full path shows in a tooltip'
    ).toBe(true)
  })

  it('moves between rows with the arrow keys and never stops on Show in Finder', async () => {
    const wrapper = await mountAssets([], {
      builds: [localBuild('lab', 'Video Lab'), localBuild('art', 'Art Lab')]
    })
    await openBuildPicker(wrapper)
    const press = async (key: string) => {
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
      await flushPromises()
    }
    const focused = () => document.activeElement?.getAttribute('data-testid') ?? undefined
    expect(buildRows().length, 'more than one row').toBeGreaterThan(1)

    document.querySelector<HTMLElement>('[data-testid="assets-build-lab"]')!.focus()
    const visited: (string | undefined)[] = []
    for (let step = 0; step < 4; step++) {
      await press('ArrowDown')
      visited.push(focused())
    }
    await press('ArrowUp')
    visited.push(focused())

    expect(visited, 'focus moves to the next row').toContain('assets-build-art')
    expect(visited.every((id) => id?.startsWith('assets-build-'))).toBe(true)
  })

  it('opens the picker closed again after it leaves and comes back', async () => {
    const wrapper = await mountAssets([], { builds: [localBuild('lab', 'Video Lab')] })
    await openBuildPicker(wrapper)
    const installationStore = useInstallationStore()

    installationStore.loading = true
    installationStore.installations = []
    await flushPromises()
    expect(wrapper.find('[data-testid="assets-build-picker"]').exists()).toBe(false)
    installationStore.installations = [localBuild('lab', 'Video Lab')]
    installationStore.loading = false
    await flushPromises()

    expect(wrapper.get('[data-testid="assets-build-picker"]').attributes('aria-expanded')).toBe(
      'false'
    )
  })

  it('closes the picker when Show in Finder is clicked', async () => {
    const wrapper = await mountAssets([], { builds: [localBuild('lab', 'Video Lab')] })
    await openBuildPicker(wrapper)

    document.querySelector<HTMLElement>('[data-testid="assets-place-reveal-lab"]')!.click()
    await flushPromises()

    expect(openOutputFolder).toHaveBeenCalledExactlyOnceWith('lab')
    expect(wrapper.get('[data-testid="assets-build-picker"]').attributes('aria-expanded')).toBe(
      'false'
    )
    expect(document.querySelector('[data-testid="assets-place-reveal-lab"]')).toBeNull()
  })

  it('says when a folder does not open', async () => {
    openOutputFolder.mockResolvedValue(false)
    const wrapper = await mountAssets([], { builds: [localBuild('lab', 'Video Lab')] })
    await openBuildPicker(wrapper)

    document.querySelector<HTMLElement>('[data-testid="assets-place-reveal-lab"]')!.click()
    await flushPromises()

    expect(alert).toHaveBeenCalledExactlyOnceWith({
      title: "Couldn't open folder",
      message: '/Volumes/Work/Video Lab/output'
    })
  })

  it('lists Shared folder after Comfy Cloud when a build saves there, and opens on it', async () => {
    const wrapper = await mountAssets([asset('/out/forest.png', 'forest.png', 'image')], {
      builds: [sharedBuild('a', 'Shared A'), localBuild('lab', 'Video Lab'), cloudBuild('cloud')]
    })

    expect(wrapper.get('[data-testid="assets-build-picker"]').text()).toBe('Shared folder')
    expect(
      listLocalAssets,
      'the shared output folder, not a build'
    ).toHaveBeenCalledExactlyOnceWith(undefined)
    expect(assetNames(wrapper)).toEqual(['forest.png'])
    await openBuildPicker(wrapper)
    expect(buildRows()).toEqual([
      'Comfy Cloud Ready',
      'Shared folder ~/ComfyUI/output',
      'Video Lab /Volumes/Work/Video Lab/output'
    ])
  })

  it('opens a signed-out user with no local build on the Shared folder, so the default output folder still shows', async () => {
    const wrapper = await mountAssets([asset('/out/forest.png', 'forest.png', 'image')], {
      builds: [cloudBuild('cloud')]
    })

    expect(wrapper.get('[data-testid="assets-build-picker"]').text()).toBe('Shared folder')
    expect(listLocalAssets).toHaveBeenCalledExactlyOnceWith(undefined)
    expect(assetNames(wrapper)).toEqual(['forest.png'])
  })

  it('opens the Shared folder when a signed-out user last picked Comfy Cloud', async () => {
    window.localStorage.setItem('comfy.desktop.assets.place', 'cloud')
    const wrapper = await mountAssets([asset('/out/forest.png', 'forest.png', 'image')], {
      builds: [cloudBuild('cloud'), sharedBuild('a', 'Shared A')]
    })

    expect(wrapper.get('[data-testid="assets-build-picker"]').text()).toBe('Shared folder')
    expect(listLocalAssets).toHaveBeenCalledExactlyOnceWith(undefined)
    expect(assetNames(wrapper)).toEqual(['forest.png'])
    expect(window.localStorage.getItem('comfy.desktop.assets.place')).toBe('cloud')
  })

  it('turns an old This computer choice into Shared folder, or the first build without one', async () => {
    window.localStorage.setItem('comfy.desktop.assets.place', 'computer')
    const shared = await mountAssets([], { builds: [localBuild('lab'), sharedBuild('a')] })
    expect(shared.get('[data-testid="assets-build-picker"]').text()).toBe('Shared folder')
    shared.unmount()

    const dedicated = await mountAssets([], {
      builds: [localBuild('mine', 'My Local 1'), localBuild('lab')]
    })
    expect(dedicated.get('[data-testid="assets-build-picker"]').text()).toBe('My Local 1')
  })

  it("opens a shared build's window on Shared folder, and a Cloud build's window on Comfy Cloud, without changing the saved choice", async () => {
    window.localStorage.setItem('comfy.desktop.assets.place', 'lab')
    const builds = [sharedBuild('a'), localBuild('lab'), cloudBuild('cloud')]
    const shared = await mountAssets([], { builds, installationId: 'a' })
    expect(shared.get('[data-testid="assets-build-picker"]').text()).toBe('Shared folder')
    shared.unmount()

    const cloud = await mountAssets([], { builds, installationId: 'cloud' })
    expect(cloud.get('[data-testid="assets-build-picker"]').text()).toBe('Comfy Cloud')
    expect(window.localStorage.getItem('comfy.desktop.assets.place')).toBe('lab')
  })

  it('says the workspace has no Comfy Cloud build', async () => {
    window.localStorage.setItem('comfy.desktop.assets.place', 'cloud')
    const wrapper = await mountAssets([], { builds: [localBuild('lab')] })
    useAuthStore().status = { signedIn: true, workspaceId: 'me', workspaceType: 'personal' }
    await flushPromises()

    expect(wrapper.get('[data-testid="assets-build-picker"]').text()).toBe('Comfy Cloud')
    expect(listAssets).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="assets-empty"] h2').text()).toBe(
      'This workspace has no Comfy Cloud build'
    )
  })

  it('pages a large local folder with the same page bar as Comfy Cloud', async () => {
    const files = Array.from({ length: 130 }, (_, i) =>
      asset(`/out/f${i}.png`, `f${i}.png`, 'image')
    )
    const wrapper = await mountAssets(files)

    await vi.waitFor(() => expect(assetNames(wrapper)[0]).toBe('f0.png'))
    expect(wrapper.get('[data-testid="assets-pagination"]').text()).toContain('130')

    await wrapper.get('[data-testid="assets-page-2"]').trigger('click')
    await vi.waitFor(() => expect(assetNames(wrapper)[0]).toBe('f100.png'))
    expect(assetNames(wrapper)).not.toContain('f0.png')
  })

  it('asks a signed-out user who picked Comfy Cloud to log in', async () => {
    const wrapper = await mountAssets([], { builds: [cloudBuild('cloud')] })
    await openBuildPicker(wrapper)
    await pickBuild('cloud')

    expect(listAssets).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="assets-empty"] h2').text()).toBe('Log in to see your assets')
    expect(
      wrapper.get('[data-testid="assets-empty-action"]').classes(),
      'the label keeps the inverted button text color'
    ).toContain('text-background')
    await wrapper.get('[data-testid="assets-empty-action"]').trigger('click')

    expect(signIn).toHaveBeenCalledOnce()
  })

  it('ignores a cancelled log-in', async () => {
    signIn.mockRejectedValueOnce(new Error('cancelled'))
    const wrapper = await mountAssets([], { builds: [cloudBuild('cloud')] })
    await openBuildPicker(wrapper)
    await pickBuild('cloud')

    await wrapper.get('[data-testid="assets-empty-action"]').trigger('click')
    await flushPromises()

    expect(
      wrapper.get('[data-testid="assets-empty-action"]').attributes('disabled')
    ).toBeUndefined()
  })

  it('tells a signed-in user with no assets where they come from', async () => {
    const wrapper = await mountAssets()
    await signInWith([])

    expect(wrapper.get('[data-testid="assets-empty"] h2').text()).toBe('No assets yet')
    expect(wrapper.get('[data-testid="assets-empty"] p').text()).toBe('Open an app to make assets.')
    expect(wrapper.find('[data-testid="assets-empty-action"]').exists()).toBe(false)
  })

  it('shows a skeleton card per slot while the first load is pending', async () => {
    const wrapper = await mountAssets(new Promise(() => {}))

    expect(wrapper.findAll('[data-testid="assets-skeleton"] > li')).toHaveLength(8)
  })

  it('opens a file on this computer in its default app from its card', async () => {
    openAsset.mockResolvedValue(true)
    const wrapper = await mountAssets([
      asset('a', 'surfer.mp4', 'video'),
      asset('b', 'forest.png', 'image')
    ])

    expect(wrapper.find('[data-testid="asset-download-b"]').exists()).toBe(false)
    await wrapper.get('[data-testid="asset-open-file-b"]').trigger('click')

    expect(openAsset).toHaveBeenCalledExactlyOnceWith('local', 'b')
    expect(downloadAsset).not.toHaveBeenCalled()
  })

  it('shows a 3D file on this computer in its folder from its card', async () => {
    const wrapper = await mountAssets([asset('m', 'mesh.glb', '3d')])

    expect(wrapper.find('[data-testid="asset-open-file-m"]').exists()).toBe(false)
    await wrapper.get('[data-testid="asset-reveal-m"]').trigger('click')

    expect(revealAsset).toHaveBeenCalledExactlyOnceWith('local', 'm')
  })

  it('shows an SVG or a file of no media kind in its folder instead of opening it', async () => {
    const wrapper = await mountAssets([
      asset('/out/logo.svg', 'logo.svg', 'image'),
      asset('/out/notes.txt', 'notes.txt', null)
    ])

    expect(wrapper.find('[data-testid="asset-open-file-/out/logo.svg"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="asset-reveal-/out/logo.svg"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="asset-reveal-/out/notes.txt"]').exists()).toBe(true)
  })

  it('tells the user when a file on this computer does not open', async () => {
    openAsset.mockResolvedValue(false)
    const wrapper = await mountAssets([asset('a', 'forest.png', 'image')])

    await wrapper.get('[data-testid="asset-open-file-a"]').trigger('click')
    await flushPromises()

    expect(alert).toHaveBeenCalledExactlyOnceWith({
      title: "Couldn't open asset",
      message: 'forest.png'
    })
  })

  it('downloads a Cloud file through the Cloud build', async () => {
    const wrapper = await mountAssets()
    await signInWith([asset('c', 'cloud.png', 'image')])

    await wrapper.get('[data-testid="asset-download-c"]').trigger('click')

    expect(downloadAsset).toHaveBeenCalledExactlyOnceWith('cloud', 'c', 'cloud.png')
  })

  it('starts one download at a time for a file', async () => {
    let finish: () => void = () => {}
    downloadAsset.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)))
    const wrapper = await mountAssets()
    await signInWith([asset('a', 'forest.png', 'image')])
    const button = wrapper.get('[data-testid="asset-download-a"]')

    await button.trigger('click')
    await button.trigger('click')

    expect(downloadAsset).toHaveBeenCalledOnce()
    expect(button.attributes('disabled')).toBeDefined()
    finish()
    await flushPromises()
    expect(button.attributes('disabled')).toBeUndefined()
  })

  it('tells the user when a download fails', async () => {
    downloadAsset.mockRejectedValue(new Error('offline'))
    const wrapper = await mountAssets()
    await signInWith([asset('a', 'forest.png', 'image')])

    await wrapper.get('[data-testid="asset-download-a"]').trigger('click')
    await flushPromises()

    expect(alert).toHaveBeenCalledExactlyOnceWith({
      title: "Couldn't download asset",
      message: 'forest.png'
    })
  })

  it('does not reload when another build changes but the picked build stays the same', async () => {
    await mountAssets([asset('a', 'forest.png', 'image')])

    useInstallationStore().installations = [localBuild('lab'), localBuild('other', 'Video Lab')]
    useSessionStore().runningInstances.set('lab', { installationId: 'lab' } as RunningInstance)
    await flushPromises()

    expect(listLocalAssets).toHaveBeenCalledOnce()
  })

  it('delays the first name tooltip, then shows the rest at once until the pointer leaves', async () => {
    const wrapper = await mountAssets([
      asset('a', 'surfer.mp4', 'video'),
      asset('b', 'forest.png', 'image')
    ])
    const delays = () => wrapper.findAllComponents(Tooltip).map((tip) => tip.props('delayMs'))
    expect(delays()).toEqual([600, 600])

    vi.useFakeTimers()
    try {
      await wrapper.get('[data-testid="assets-grid"]').trigger('pointerenter')
      await vi.advanceTimersByTimeAsync(600)
      expect(delays()).toEqual([0, 0])

      await wrapper.get('[data-testid="assets-grid"]').trigger('pointerleave')
      expect(delays()).toEqual([600, 600])
    } finally {
      vi.useRealTimers()
    }
  })

  it('stays on the build it opened on when another build starts', async () => {
    const wrapper = await mountAssets([asset('a', 'forest.png', 'image')], {
      builds: [
        localBuild('mine', 'My Local 1', { lastLaunchedAt: 1 }),
        localBuild('lab', 'Video Lab', { lastLaunchedAt: 2 })
      ]
    })
    expect(wrapper.get('[data-testid="assets-build-picker"]').text()).toBe('My Local 1')

    useSessionStore().runningInstances.set('mine', { installationId: 'mine' } as RunningInstance)
    useInstallationStore().installations = [
      localBuild('mine', 'My Local 1', { lastLaunchedAt: 3 }),
      localBuild('lab', 'Video Lab', { lastLaunchedAt: 2 })
    ]
    await flushPromises()

    expect(wrapper.get('[data-testid="assets-build-picker"]').text()).toBe('My Local 1')
    expect(listLocalAssets).toHaveBeenCalledExactlyOnceWith('mine')
  })

  describe('a file an app asks to see', () => {
    async function mountWithFocus(files: AssetSummary[] | CloudAssetPage) {
      window.localStorage.setItem('comfy.desktop.assets.place', 'lab')
      getAuthStatus.mockResolvedValue({ signedIn: true })
      listAssets.mockResolvedValue(files)
      const installationStore = useInstallationStore()
      installationStore.installations = [cloudBuild('cloud'), localBuild('lab')]
      installationStore.loading = false
      const wrapper = mount(AssetsView, { attachTo: page, props: { focusName: 'cutout.png' } })
      await flushPromises()
      return wrapper
    }

    async function choose(wrapper: Awaited<ReturnType<typeof mountWithFocus>>, id: string) {
      await openBuildPicker(wrapper)
      await pickBuild(id)
    }

    it('picks Comfy Cloud with the newest file of that name open, once, and keeps the saved choice', async () => {
      const wrapper = await mountWithFocus([
        asset('old', 'cutout.png', 'image', { createdAt: '2026-11-01T00:00:00Z' }),
        asset('new', 'cutout.png', 'image', { createdAt: '2026-11-02T00:00:00Z' }),
        asset('other', 'other.png', 'image', { createdAt: '2026-11-03T00:00:00Z' })
      ])

      expect(wrapper.emitted('focus-used')).toHaveLength(1)
      expect(wrapper.get('[data-testid="assets-build-picker"]').text()).toBe('Comfy Cloud')
      expect(listAssets).toHaveBeenCalledWith('cloud', FIRST_PAGE)
      expect(findCloudAsset).toHaveBeenCalledWith('cloud', 'cutout.png')
      expect(listLocalAssets).not.toHaveBeenCalled()
      expect(viewerTitle()).toBe('cutout.png')
      expect(
        viewer()?.querySelector('[aria-current="true"]')?.getAttribute('data-testid'),
        'the newer of the two cutouts, after the newest file overall'
      ).toBe('output-detail-thumb-1')
      expect(window.localStorage.getItem('comfy.desktop.assets.place')).toBe('lab')
    })

    it('says so on Comfy Cloud when the file is not there, and drops the note once the user picks a place', async () => {
      const wrapper = await mountWithFocus([asset('other', 'other.png', 'image')])

      expect(wrapper.emitted('focus-used')).toHaveLength(1)
      expect(assetNames(wrapper)).toEqual(['other.png'])
      expect(viewer()).toBeNull()
      expect(wrapper.get('[data-testid="assets-not-found"]').text()).toBe(
        "Couldn't find cutout.png in your Comfy Cloud assets. It may have a different name here."
      )

      await choose(wrapper, 'lab')
      await choose(wrapper, 'cloud')

      expect(wrapper.find('[data-testid="assets-not-found"]').exists()).toBe(false)
    })

    it('asks Comfy Cloud again, by name, for a file the shown list does not have', async () => {
      const wrapper = await mountWithFocus([asset('other', 'other.png', 'image')])
      findCloudAsset.mockResolvedValue({
        status: 'found',
        asset: asset('older', 'older.png', 'image')
      })

      await wrapper.setProps({ focusName: 'older.png' })
      await flushPromises()

      expect(findCloudAsset).toHaveBeenLastCalledWith('cloud', 'older.png')
      expect(assetNames(wrapper)).toEqual(['other.png'])
      expect(viewerTitle()).toBe('older.png')
      expect(wrapper.find('[data-testid="assets-not-found"]').exists()).toBe(false)
    })

    it('opens the latest requested result when a saved-result lookup is already in flight', async () => {
      const previous = Promise.withResolvers<CloudAssetLookup>()
      findCloudAsset.mockImplementation((_cloudId, name) =>
        name === 'cutout.png'
          ? previous.promise
          : Promise.resolve({ status: 'found', asset: asset('new', 'new.png', 'image') })
      )
      const wrapper = await mountWithFocus([asset('other', 'other.png', 'image')])

      expect(findCloudAsset).toHaveBeenCalledWith('cloud', 'cutout.png')
      await wrapper.setProps({ focusName: 'new.png' })
      previous.resolve({ status: 'found', asset: asset('old', 'cutout.png', 'image') })
      await flushPromises()

      expect(findCloudAsset).toHaveBeenLastCalledWith('cloud', 'new.png')
      expect(viewerTitle()).toBe('new.png')
      expect(listAssets).toHaveBeenCalledTimes(1)
    })

    it('drops the note when Refresh finds the file', async () => {
      const wrapper = await mountWithFocus([asset('other', 'other.png', 'image')])
      expect(wrapper.find('[data-testid="assets-not-found"]').exists()).toBe(true)
      listAssets.mockResolvedValue([
        asset('other', 'other.png', 'image'),
        asset('new', 'cutout.png', 'image')
      ])

      await wrapper.get('[data-testid="assets-refresh"]').trigger('click')
      await flushPromises()

      expect(findCloudAsset).toHaveBeenLastCalledWith('cloud', 'cutout.png')
      expect(assetNames(wrapper)).toContain('cutout.png')
      expect(wrapper.find('[data-testid="assets-not-found"]').exists()).toBe(false)
    })

    it('opens and downloads an older result without putting it on the first page', async () => {
      findCloudAsset.mockResolvedValue({
        status: 'found',
        asset: asset('old', 'cutout.png', 'image')
      })
      const wrapper = await mountWithFocus({
        assets: Array.from({ length: 100 }, (_, index) =>
          asset(`new-${index}`, `new-${index}.png`, 'image')
        ),
        total: 101
      })

      expect(assetNames(wrapper)).toContain('new-0.png')
      expect(assetNames(wrapper)).not.toContain('cutout.png')
      expect(wrapper.get('[data-testid="assets-pagination"]').text()).toContain('1–100 of 101')
      expect(viewerTitle()).toBe('cutout.png')
      expect(wrapper.find('[data-testid="assets-not-found"]').exists()).toBe(false)
      viewer()!.querySelector<HTMLElement>('[data-testid="output-detail-download"]')!.click()
      expect(downloadAsset).toHaveBeenCalledWith('cloud', 'old', 'cutout.png')
    })

    it('says it could not check, not that the file is missing, when the search did not finish', async () => {
      findCloudAsset.mockResolvedValue({ status: 'incomplete' })
      const wrapper = await mountWithFocus([asset('other', 'other.png', 'image')])

      expect(assetNames(wrapper)).toEqual(['other.png'])
      expect(viewer()).toBeNull()
      expect(wrapper.get('[data-testid="assets-not-found"]').text()).toBe(
        "Couldn't check Comfy Cloud for cutout.png. Refresh to try again."
      )

      findCloudAsset.mockRejectedValue(new Error('ipc gone'))
      await wrapper.get('[data-testid="assets-refresh"]').trigger('click')
      await flushPromises()

      expect(assetNames(wrapper), 'the gallery stays').toEqual(['other.png'])
      expect(wrapper.get('[data-testid="assets-not-found"]').text()).toBe(
        "Couldn't check Comfy Cloud for cutout.png. Refresh to try again."
      )

      findCloudAsset.mockResolvedValue({ status: 'absent' })
      await wrapper.get('[data-testid="assets-refresh"]').trigger('click')
      await flushPromises()

      expect(wrapper.get('[data-testid="assets-not-found"]').text()).toBe(
        "Couldn't find cutout.png in your Comfy Cloud assets. It may have a different name here."
      )
    })

    it('shows no note when the file opened', async () => {
      await mountWithFocus([asset('new', 'cutout.png', 'image')])
      expect(viewerTitle()).toBe('cutout.png')
      expect(document.querySelector('[data-testid="assets-not-found"]')).toBeNull()
    })

    it('shows the load error instead of a note when the Cloud list fails', async () => {
      listAssets.mockRejectedValue(new Error('offline'))
      getAuthStatus.mockResolvedValue({ signedIn: true })
      const installationStore = useInstallationStore()
      installationStore.installations = [cloudBuild('cloud')]
      installationStore.loading = false
      const wrapper = mount(AssetsView, { attachTo: page, props: { focusName: 'cutout.png' } })
      await flushPromises()

      expect(wrapper.get('[data-testid="assets-empty"] h2').text()).toBe("Couldn't load assets")
      expect(wrapper.find('[data-testid="assets-not-found"]').exists()).toBe(false)
    })

    it('lets go of the file when Comfy Cloud cannot list it, and says why', async () => {
      getAuthStatus.mockResolvedValue({ signedIn: false })
      listAssets.mockResolvedValue([asset('new', 'cutout.png', 'image')])
      const installationStore = useInstallationStore()
      installationStore.installations = [cloudBuild('cloud')]
      installationStore.loading = false
      const signedOut = mount(AssetsView, { attachTo: page, props: { focusName: 'cutout.png' } })
      await flushPromises()

      expect(signedOut.get('[data-testid="assets-empty"] h2').text()).toBe(
        'Log in to see your assets'
      )
      await signInWith([asset('new', 'cutout.png', 'image')])
      expect(assetNames(signedOut)).toEqual(['cutout.png'])
      expect(viewer(), 'the file is not opened later').toBeNull()
      signedOut.unmount()

      installationStore.installations = [localBuild('lab')]
      const noCloudBuild = mount(AssetsView, { attachTo: page, props: { focusName: 'cutout.png' } })
      await flushPromises()
      expect(noCloudBuild.get('[data-testid="assets-empty"] h2').text()).toBe(
        'This workspace has no Comfy Cloud build'
      )
      installationStore.installations = [cloudBuild('cloud')]
      await flushPromises()
      expect(assetNames(noCloudBuild)).toEqual(['cutout.png'])
      expect(viewer(), 'the file is not opened later').toBeNull()
    })

    it('remembers a place the user picks after that', async () => {
      const wrapper = await mountWithFocus([])

      await choose(wrapper, 'lab')
      await choose(wrapper, 'cloud')

      expect(window.localStorage.getItem('comfy.desktop.assets.place')).toBe('cloud')
    })
  })

  it('switches to the builds of the workspace the user moves to', async () => {
    listAssets.mockResolvedValue([asset('t1', 'team.png', 'image')])
    const wrapper = await mountAssets([asset('a', 'forest.png', 'image')], {
      builds: [localBuild('lab', 'Video Lab'), teamBuild(cloudBuild('team-cloud', 'Team Cloud'))]
    })

    useAuthStore().status = { signedIn: true, workspaceId: 'team-b' }
    await flushPromises()

    expect(wrapper.get('[data-testid="assets-build-picker"]').text()).toBe('Comfy Cloud')
    expect(listAssets).toHaveBeenCalledExactlyOnceWith('team-cloud', FIRST_PAGE)
    expect(assetNames(wrapper)).toEqual(['team.png'])
  })

  it("moves the Cloud session to the picked Cloud build's workspace before listing its assets", async () => {
    const wrapper = await mountAssets([], {
      builds: [teamBuild(cloudBuild('team-cloud', 'Team Cloud'))]
    })
    useAuthStore().status = { signedIn: true, workspaceId: 'me', workspaceType: 'personal' }
    await flushPromises()
    listAssets.mockImplementation(async () =>
      useAuthStore().status.workspaceId === 'team-b' ? [asset('t1', 'team.png', 'image')] : []
    )

    useDashboardScopeStore().selectWorkspace('team-b')
    await flushPromises()

    expect(wrapper.get('[data-testid="assets-build-picker"]').text()).toBe('Comfy Cloud')
    expect(switchWorkspace).toHaveBeenCalledExactlyOnceWith('team-b', 'chosen')
    expect(assetNames(wrapper), "the team's files, not the personal workspace's").toEqual([
      'team.png'
    ])
  })

  it('lists the selected workspace assets through the same shared Cloud installation', async () => {
    signedInToPersonalWithTeamDashboard()
    const cloud = { ...cloudBuild('cloud', 'Comfy Cloud'), sourceId: 'cloud' }
    listAssets.mockImplementation(async () => [
      asset('current', `${useAuthStore().status.workspaceId}.png`, 'image')
    ])
    const wrapper = await mountAssets([], { builds: [cloud] })

    expect(wrapper.get('[data-testid="assets-build-picker"]').text()).toBe('Comfy Cloud')
    expect(switchWorkspace).toHaveBeenCalledExactlyOnceWith('team-b', 'restored')
    expect(assetNames(wrapper)).toEqual(['team-b.png'])

    useDashboardScopeStore().selectWorkspace('personal')
    await flushPromises()

    expect(switchWorkspace).toHaveBeenLastCalledWith('me', 'chosen')
    expect(assetNames(wrapper)).toEqual(['me.png'])
    expect(listAssets).toHaveBeenLastCalledWith('cloud', FIRST_PAGE)
  })

  it("says the load failed instead of showing another workspace's files when the personal workspace is unknown", async () => {
    listAssets.mockResolvedValue([asset('t1', 'team.png', 'image')])
    listWorkspaces.mockResolvedValue([{ id: 'team-b', name: 'Team B', type: 'team' }])
    const wrapper = await mountAssets([], { builds: [cloudBuild('cloud', 'Comfy Cloud')] })
    useAuthStore().status = { signedIn: true, workspaceId: 'team-b', workspaceType: 'team' }
    await flushPromises()
    useDashboardScopeStore().selectWorkspace('personal')
    await flushPromises()

    expect(wrapper.get('[data-testid="assets-build-picker"]').text()).toBe('Comfy Cloud')
    expect(listAssets).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="assets-empty"]').text()).toContain("Couldn't load assets")
  })

  it('does not list Cloud files with a session tied to no known workspace', async () => {
    listAssets.mockResolvedValue([asset('x1', 'unknown.png', 'image')])
    listWorkspaces.mockResolvedValue([{ id: 'team-b', name: 'Team B', type: 'team' }])
    const wrapper = await mountAssets([], { builds: [cloudBuild('cloud', 'Comfy Cloud')] })
    useAuthStore().status = { signedIn: true }
    await flushPromises()

    expect(listAssets).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="assets-empty"]').text()).toContain("Couldn't load assets")
  })

  it("reopens on a saved workspace's Cloud build without treating the move there as the user's choice", async () => {
    signedInToPersonalWithTeamDashboard()
    listAssets.mockResolvedValue([asset('t1', 'team.png', 'image')])

    const wrapper = await mountAssets([], {
      builds: [teamBuild(cloudBuild('team-cloud', 'Team Cloud'))]
    })

    expect(wrapper.get('[data-testid="assets-build-picker"]').text()).toBe('Comfy Cloud')
    expect(switchWorkspace).toHaveBeenCalledExactlyOnceWith('team-b', 'restored')
    expect(assetNames(wrapper)).toEqual(['team.png'])
  })

  it("says the load failed when the session could not move to the build's workspace, and Refresh moves it as the user's choice", async () => {
    signedInToPersonalWithTeamDashboard()
    listAssets.mockResolvedValue([asset('t1', 'team.png', 'image')])
    switchWorkspace.mockResolvedValueOnce({
      signedIn: true,
      workspaceId: 'me',
      workspaceType: 'personal',
      workspaceSwitchFailure: 'retryable'
    })
    const wrapper = await mountAssets([], {
      builds: [teamBuild(cloudBuild('team-cloud', 'Team Cloud'))]
    })

    expect(listAssets, "the personal workspace's files are not listed").not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="assets-empty"]').text()).toContain("Couldn't load assets")

    await wrapper.get('[data-testid="assets-refresh"]').trigger('click')
    await flushPromises()

    expect(switchWorkspace.mock.calls).toEqual([
      ['team-b', 'restored'],
      ['team-b', 'chosen']
    ])
    expect(assetNames(wrapper)).toEqual(['team.png'])
  })

  it("moves the session to a Cloud build's workspace as the user's choice when they pick the build", async () => {
    signedInToPersonalWithTeamDashboard()
    listAssets.mockResolvedValue([asset('t1', 'team.png', 'image')])
    const wrapper = await mountAssets([], {
      builds: [
        teamBuild(localBuild('team-lab', 'Team Lab', { lastLaunchedAt: 5 })),
        teamBuild(cloudBuild('team-cloud', 'Team Cloud'))
      ]
    })
    expect(wrapper.get('[data-testid="assets-build-picker"]').text()).toBe('Team Lab')
    expect(switchWorkspace, 'a local build needs no workspace').not.toHaveBeenCalled()

    await openBuildPicker(wrapper)
    await pickBuild('cloud')

    expect(switchWorkspace).toHaveBeenCalledExactlyOnceWith('team-b', 'chosen')
    expect(assetNames(wrapper)).toEqual(['team.png'])
  })

  it('clears the previous workspace assets while the new workspace loads', async () => {
    listAssets.mockReturnValue(new Promise(() => {}))
    const wrapper = await mountAssets([asset('a', 'forest.png', 'image')], {
      builds: [localBuild('lab'), teamBuild(cloudBuild('team-cloud'))]
    })

    useAuthStore().status = { signedIn: true, workspaceId: 'team-b' }
    await flushPromises()

    expect(wrapper.find('[data-testid="assets-grid"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="assets-skeleton"]').exists()).toBe(true)
  })

  it('says nothing matches when a search hides every asset', async () => {
    const wrapper = await mountAssets([asset('a', 'forest.png', 'image')])

    await wrapper.get('input').setValue('zzz')

    await vi.waitFor(() =>
      expect(wrapper.get('[data-testid="assets-empty"]').text()).toContain('No matching assets')
    )
  })

  it('reports a failed load', async () => {
    const wrapper = await mountAssets(Promise.reject(new Error('disk')))

    expect(wrapper.get('[data-testid="assets-empty"]').text()).toContain("Couldn't load assets")
  })

  it('opens the asset menu on right-click instead of the browser menu, with actions for a file on this computer', async () => {
    const wrapper = await mountAssets([{ ...picture('b', 300), name: 'b.png' }])

    const event = await rightClick(wrapper.get('[data-testid="asset-b"]').element)

    expect(event.defaultPrevented, 'the browser menu with Save Image does not open').toBe(true)
    expect(menuLabels()).toEqual(['Open', 'Show in Finder', 'Copy', 'Delete'])
    await pickMenuItem('reveal')
    expect(revealAsset).toHaveBeenCalledExactlyOnceWith('local', 'b')
    await rightClick(wrapper.get('[data-testid="asset-b"]').element)
    await pickMenuItem('open')
    expect(openAsset).toHaveBeenCalledExactlyOnceWith('local', 'b')
  })

  it('offers only Download and Copy for a Cloud file, from the more actions button', async () => {
    const wrapper = await mountAssets()
    await signInWith([picture('c', 300)])

    await wrapper.get('[data-testid="asset-more-c"]').trigger('click')
    await flushPromises()

    expect(menuLabels()).toEqual(['Download', 'Copy'])
    await pickMenuItem('download')
    expect(downloadAsset).toHaveBeenCalledExactlyOnceWith('cloud', 'c', 'c.svg')
  })

  it('asks before moving a file to the Trash, then takes its card off the page', async () => {
    trashAsset.mockResolvedValue(true)
    const wrapper = await mountAssets([picture('keep', 300), picture('gone', 300)])

    confirm.mockResolvedValueOnce(false)
    await rightClick(wrapper.get('[data-testid="asset-gone"]').element)
    await pickMenuItem('delete')
    expect(trashAsset, 'nothing is deleted when the user cancels').not.toHaveBeenCalled()

    confirm.mockResolvedValueOnce(true)
    listLocalAssets.mockResolvedValue([picture('keep', 300)])
    await rightClick(wrapper.get('[data-testid="asset-gone"]').element)
    await pickMenuItem('delete')

    expect(confirm.mock.calls[1]![0]).toMatchObject({
      title: 'Delete gone.svg?',
      message: 'It moves to the Trash.'
    })
    expect(trashAsset).toHaveBeenCalledExactlyOnceWith('local', 'gone')
    expect(assetNames(wrapper)).toEqual(['keep.svg'])
    await vi.waitFor(() =>
      expect(listLocalAssets, 'the folder is read again').toHaveBeenCalledTimes(2)
    )
  })

  it('tells the user when a picture could not be copied', async () => {
    copyAsset.mockResolvedValue(false)
    const wrapper = await mountAssets([picture('b', 300)])

    await rightClick(wrapper.get('[data-testid="asset-b"]').element)
    await pickMenuItem('copy')

    expect(copyAsset).toHaveBeenCalledExactlyOnceWith('local', 'b')
    expect(alert).toHaveBeenCalledExactlyOnceWith({
      title: "Couldn't copy asset",
      message: 'b.svg'
    })
  })

  it('opens a picture full size when its card is clicked, and puts focus back on the card when Escape closes it', async () => {
    const wrapper = await mountAssets([
      asset('/out/forest.png', 'forest.png', 'image', {
        previewUrl: 'comfy-output://file/full',
        thumbnailUrl: 'comfy-output://file/full?thumbnail=1'
      })
    ])
    const card = wrapper.get('[data-testid="asset-open-/out/forest.png"]')

    await card.trigger('click')
    await flushPromises()

    expect(viewerTitle()).toBe('forest.png')
    expect(
      viewer()!.querySelector('[data-testid="output-detail-image"]')!.getAttribute('src')
    ).toBe('comfy-output://file/full')

    await press('Escape')

    expect(viewer()).toBeNull()
    expect(document.activeElement).toBe(card.element)
  })

  it('steps through the files in page order with the arrow keys and the filmstrip', async () => {
    const wrapper = await mountAssets([
      asset('new', 'new.png', 'image', { createdAt: '2026-11-03T00:00:00Z' }),
      asset('mid', 'mid.png', 'image', { createdAt: '2026-11-02T00:00:00Z' }),
      asset('old', 'old.png', 'image', { createdAt: '2026-11-01T00:00:00Z' })
    ])

    await wrapper.get('[data-testid="asset-open-mid"]').trigger('click')
    await flushPromises()
    expect(viewerTitle()).toBe('mid.png')

    await press('ArrowRight')
    expect(viewerTitle()).toBe('old.png')

    await press('ArrowRight')
    expect(viewerTitle(), 'the last file wraps round to the first').toBe('new.png')

    await press('ArrowLeft')
    expect(viewerTitle()).toBe('old.png')

    document.querySelector<HTMLElement>('[data-testid="output-detail-thumb-1"]')!.click()
    await flushPromises()
    expect(viewerTitle()).toBe('mid.png')
  })

  it('plays a video in the viewer with its controls', async () => {
    const wrapper = await mountAssets([
      asset('clip', 'surfer.mp4', 'video', { previewUrl: 'comfy-output://file/surfer' })
    ])

    await wrapper.get('[data-testid="asset-open-clip"]').trigger('click')
    await flushPromises()

    const video = viewer()!.querySelector<HTMLVideoElement>('[data-testid="output-detail-video"]')!
    expect(video.getAttribute('src')).toBe('comfy-output://file/surfer')
    expect(video.controls).toBe(true)
  })

  it('tells the real folder of a file on this computer in the viewer, and shows it in Finder', async () => {
    const file = '/Users/me/output/2026-11/forest.png'
    const wrapper = await mountAssets([asset(file, 'forest.png', 'image')])

    await wrapper.get(`[data-testid="asset-open-${file}"]`).trigger('click')
    await flushPromises()

    expect(shownText(viewer()!.querySelector('[data-testid="output-detail-saved-in"]'))).toBe(
      'SAVED IN 2026-11 /Users/me/output'
    )
    const show = viewer()!.querySelector<HTMLElement>(
      '[data-testid="output-detail-show-in-folder"]'
    )!
    expect(show.textContent?.trim()).toBe('Show in Finder')
    show.click()
    expect(revealAsset).toHaveBeenCalledExactlyOnceWith('local', file)
  })

  it('does not say where a Cloud file is saved in the viewer', async () => {
    window.localStorage.setItem('comfy.desktop.assets.place', 'cloud')
    const wrapper = await mountAssets([], { builds: [cloudBuild('cloud')] })
    await signInWith([asset('c', 'cloud.png', 'image')])

    await wrapper.get('[data-testid="asset-open-c"]').trigger('click')
    await flushPromises()

    expect(viewer()!.querySelector('[data-testid="output-detail-saved-in"]')).toBeNull()
    expect(viewer()!.querySelector('[data-testid="output-detail-show-in-folder"]')).toBeNull()
  })

  it('gives a file on this computer only Show in Finder in the viewer, for the file it is showing', async () => {
    const wrapper = await mountAssets([
      asset('/out/surfer.mp4', 'surfer.mp4', 'video', { createdAt: '2026-11-02T00:00:00Z' }),
      asset('/out/forest.png', 'forest.png', 'image', { createdAt: '2026-11-01T00:00:00Z' })
    ])

    await wrapper.get('[data-testid="asset-open-/out/surfer.mp4"]').trigger('click')
    await flushPromises()
    await press('ArrowRight')
    expect(document.querySelector('[data-testid="output-detail-download"]')).toBeNull()
    document.querySelector<HTMLElement>('[data-testid="output-detail-show-in-folder"]')!.click()
    await flushPromises()

    expect(revealAsset).toHaveBeenCalledExactlyOnceWith('local', '/out/forest.png')
    expect(openAsset).not.toHaveBeenCalled()
  })

  it('gives a file at the top of the disk Show in Finder in the viewer, even with no folder to show', async () => {
    const wrapper = await mountAssets([asset('/forest.png', 'forest.png', 'image')])

    await wrapper.get('[data-testid="asset-open-/forest.png"]').trigger('click')
    await flushPromises()

    expect(viewer()!.querySelector('[data-testid="output-detail-download"]')).toBeNull()
    viewer()!.querySelector<HTMLElement>('[data-testid="output-detail-show-in-folder"]')!.click()
    expect(revealAsset).toHaveBeenCalledExactlyOnceWith('local', '/forest.png')
  })

  it('tells the user when Show in Finder cannot find the file', async () => {
    revealAsset.mockResolvedValue(false)
    const wrapper = await mountAssets([asset('/out/forest.png', 'forest.png', 'image')])

    await wrapper.get('[data-testid="asset-open-/out/forest.png"]').trigger('click')
    await flushPromises()
    viewer()!.querySelector<HTMLElement>('[data-testid="output-detail-show-in-folder"]')!.click()
    await flushPromises()

    expect(alert).toHaveBeenCalledExactlyOnceWith({
      title: "Couldn't open asset",
      message: 'forest.png'
    })
  })

  it('gives a 3D file on this computer only Show in Finder in the viewer', async () => {
    const wrapper = await mountAssets([asset('/out/mesh.glb', 'mesh.glb', '3d')])

    await wrapper.get('[data-testid="asset-open-/out/mesh.glb"]').trigger('click')
    await flushPromises()

    expect(document.querySelector('[data-testid="output-detail-download"]')).toBeNull()
    expect(document.querySelector('[data-testid="output-detail-show-in-folder"]')).not.toBeNull()
  })
})

describe('AssetsView Open workflow', () => {
  function workflowButton(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[data-testid="output-detail-workflow"]')
  }

  async function openViewer(
    wrapper: Awaited<ReturnType<typeof mountAssets>>,
    id: string
  ): Promise<void> {
    await wrapper.get(`[data-testid="asset-open-${id}"]`).trigger('click')
    await flushPromises()
  }

  it('opens the workflow of a file in a build folder in that build, and closes the viewer', async () => {
    hasAssetWorkflow.mockResolvedValue(true)
    const wrapper = await mountAssets([asset('/out/forest.png', 'forest.png', 'image')])

    await openViewer(wrapper, '/out/forest.png')
    expect(hasAssetWorkflow).toHaveBeenCalledExactlyOnceWith('local', '/out/forest.png')
    expect(workflowButton()?.textContent?.trim()).toBe('Open workflow')
    workflowButton()!.click()
    await flushPromises()

    expect(openAssetWorkflow).toHaveBeenCalledExactlyOnceWith(
      'local',
      '/out/forest.png',
      'forest.png',
      'lab'
    )
    expect(viewer()).toBeNull()
  })

  it('keeps the place of Open workflow while it checks the file, so the buttons do not move', async () => {
    let answer: (found: boolean) => void = () => {}
    hasAssetWorkflow.mockReturnValue(new Promise<boolean>((resolve) => (answer = resolve)))
    const wrapper = await mountAssets([asset('/out/forest.png', 'forest.png', 'image')])

    await openViewer(wrapper, '/out/forest.png')
    expect(workflowButton()?.classList.contains('invisible')).toBe(true)
    expect(workflowButton()?.getAttribute('aria-hidden')).toBe('true')
    answer(true)
    await flushPromises()

    expect(workflowButton()?.classList.contains('invisible')).toBe(false)
    expect(workflowButton()?.hasAttribute('disabled')).toBe(false)
  })

  it('does not check a 3D file, and keeps no place for Open workflow', async () => {
    const wrapper = await mountAssets([asset('/out/mesh.glb', 'mesh.glb', '3d')])

    await openViewer(wrapper, '/out/mesh.glb')

    expect(hasAssetWorkflow).not.toHaveBeenCalled()
    expect(workflowButton()).toBeNull()
  })

  it('opens a shared-folder file in the one build that saves there, with no menu', async () => {
    hasAssetWorkflow.mockResolvedValue(true)
    const wrapper = await mountAssets([asset('/out/forest.png', 'forest.png', 'image')], {
      builds: [sharedBuild('studio', 'Studio')]
    })

    await openViewer(wrapper, '/out/forest.png')
    workflowButton()!.click()
    await flushPromises()

    expect(document.querySelector('[role="menuitem"]')).toBeNull()
    expect(openAssetWorkflow).toHaveBeenCalledExactlyOnceWith(
      'local',
      '/out/forest.png',
      'forest.png',
      'studio'
    )
  })

  it('does not check a shared-folder file when no build can open it', async () => {
    hasAssetWorkflow.mockResolvedValue(true)
    const wrapper = await mountAssets([asset('/out/forest.png', 'forest.png', 'image')], {
      builds: []
    })

    await openViewer(wrapper, '/out/forest.png')

    expect(hasAssetWorkflow).not.toHaveBeenCalled()
    expect(workflowButton()).toBeNull()
  })

  it('checks the file again after the list reloads, and drops the answer from before the reload', async () => {
    const answers: ((found: boolean) => void)[] = []
    hasAssetWorkflow.mockImplementation(
      () => new Promise<boolean>((resolve) => answers.push(resolve))
    )
    const wrapper = await mountAssets([asset('/out/forest.png', 'forest.png', 'image')])
    await openViewer(wrapper, '/out/forest.png')

    await wrapper.get('[data-testid="assets-refresh"]').trigger('click')
    await flushPromises()
    expect(hasAssetWorkflow).toHaveBeenCalledTimes(2)
    answers[1]!(true)
    await flushPromises()
    answers[0]!(false)
    await flushPromises()

    expect(workflowButton()?.hasAttribute('disabled')).toBe(false)
    expect(workflowButton()?.classList.contains('invisible')).toBe(false)
  })

  it('keeps an invisible place for Open workflow when the file holds no workflow, so the buttons do not move', async () => {
    const wrapper = await mountAssets([asset('/out/forest.png', 'forest.png', 'image')])

    await openViewer(wrapper, '/out/forest.png')

    expect(hasAssetWorkflow).toHaveBeenCalledOnce()
    expect(workflowButton()?.classList.contains('invisible')).toBe(true)
    expect(workflowButton()?.hasAttribute('disabled')).toBe(true)
  })

  it('checks the file again on the next open when the check failed', async () => {
    hasAssetWorkflow.mockRejectedValueOnce(new Error('token refresh')).mockResolvedValue(true)
    const wrapper = await mountAssets([asset('/out/forest.png', 'forest.png', 'image')])

    await openViewer(wrapper, '/out/forest.png')
    expect(workflowButton()?.classList.contains('invisible')).toBe(true)
    await press('Escape')
    expect(viewer()).toBeNull()
    await openViewer(wrapper, '/out/forest.png')

    expect(hasAssetWorkflow).toHaveBeenCalledTimes(2)
    expect(workflowButton()?.classList.contains('invisible')).toBe(false)
  })

  it('asks which build to open a file in the shared folder in', async () => {
    hasAssetWorkflow.mockResolvedValue(true)
    const wrapper = await mountAssets([asset('/out/forest.png', 'forest.png', 'image')], {
      builds: [sharedBuild('studio', 'Studio'), sharedBuild('lab', 'Lab')]
    })

    await openViewer(wrapper, '/out/forest.png')
    workflowButton()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()
    const choices = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    expect(choices.map((choice) => choice.textContent?.trim())).toEqual(['Studio', 'Lab'])
    expect(openAssetWorkflow).not.toHaveBeenCalled()
    choices[1]!.click()
    await flushPromises()

    expect(openAssetWorkflow).toHaveBeenCalledExactlyOnceWith(
      'local',
      '/out/forest.png',
      'forest.png',
      'lab'
    )
  })

  it('opens the workflow of a Cloud file in Comfy Cloud', async () => {
    hasAssetWorkflow.mockResolvedValue(true)
    window.localStorage.setItem('comfy.desktop.assets.place', 'cloud')
    const wrapper = await mountAssets([], { builds: [cloudBuild('cloud')] })
    await signInWith([asset('c', 'cloud.png', 'image')])

    await openViewer(wrapper, 'c')
    workflowButton()!.click()
    await flushPromises()

    expect(openAssetWorkflow).toHaveBeenCalledExactlyOnceWith('cloud', 'c', 'cloud.png', undefined)
  })

  it('says why the workflow did not open', async () => {
    hasAssetWorkflow.mockResolvedValue(true)
    openAssetWorkflow.mockResolvedValueOnce({ opened: false, error: 'Lab did not start.' })
    const wrapper = await mountAssets([asset('/out/forest.png', 'forest.png', 'image')])

    await openViewer(wrapper, '/out/forest.png')
    workflowButton()!.click()
    await flushPromises()

    expect(alert).toHaveBeenCalledExactlyOnceWith({
      title: "Couldn't open workflow",
      message: 'Lab did not start.'
    })
  })
})

describe('AssetsView Comfy Cloud pages', () => {
  interface PageRequest {
    offset: number
    after?: string
    limit: number
    order: string
    kind?: string
    search?: string
  }

  function output(index: number): AssetSummary {
    return index % 50 === 7
      ? asset(`c${index}`, `mesh-${index}.glb`, '3d')
      : asset(`c${index}`, `out-${index}.png`, 'image')
  }

  function outputPage(total: number, request: PageRequest): CloudAssetPage {
    const { offset, limit, kind, search } = request
    if (search) {
      const matches = Array.from({ length: total }, (_, i) => output(i)).filter(
        (candidate) =>
          candidate.name.toLowerCase().includes(search.toLowerCase()) &&
          (!kind || candidate.kind === kind)
      )
      return { assets: matches.slice(offset, offset + limit), total: matches.length }
    }
    if (kind) {
      const matches = Array.from({ length: total }, (_, i) => output(i)).filter(
        (candidate) => candidate.kind === kind
      )
      return { assets: matches.slice(offset, offset + limit), total: matches.length }
    }
    const length = Math.max(0, Math.min(limit, total - offset))
    const assets = Array.from({ length }, (_, i) => output(offset + i))
    const end = offset + length
    if (offset >= total && offset > 0) return { assets, total: null }
    if (end >= total) return { assets, total: end }
    return {
      assets,
      total: offset === 0 ? Math.min(total, 10_000) : null,
      ...(offset === 0 && total >= 10_000 && { totalIsLowerBound: true }),
      nextCursor: `cursor-${end}`
    }
  }

  function cloudOutputs(total: number): void {
    listAssets.mockImplementation(async (_id: string, request: PageRequest) =>
      outputPage(total, request)
    )
  }

  function asked(): PageRequest[] {
    return listAssets.mock.calls.map(([, request]) => request as PageRequest)
  }

  function timesAskedFor(offset: number): number {
    return asked().filter((request) => request.offset === offset).length
  }

  async function mountCloud(builds: Installation[] = [cloudBuild('cloud', 'Comfy Cloud')]) {
    const wrapper = await mountAssets([], { builds })
    useAuthStore().status = { signedIn: true, workspaceId: 'me', workspaceType: 'personal' }
    await flushPromises()
    return wrapper
  }

  async function goToPage(wrapper: Awaited<ReturnType<typeof mountAssets>>, page: number) {
    await wrapper.get(`[data-testid="assets-page-${page}"]`).trigger('click')
    await flushPromises()
  }

  async function nextPagePrefetched(offset: number): Promise<void> {
    await vi.waitFor(() => expect(timesAskedFor(offset)).toBe(1), { timeout: 3000 })
    await flushPromises()
  }

  it('asks Cloud for the first page and shows the pages under the gallery', async () => {
    cloudOutputs(1561)
    const wrapper = await mountCloud()

    expect(asked()[0]).toEqual(FIRST_PAGE)
    expect(assetNames(wrapper)[0]).toBe('out-0.png')
    const pages = wrapper.get('[data-testid="assets-pagination"]')
    expect(shownText(pages.element)).toContain('1–100 of 1561')
    expect(pages.get('[data-testid="assets-page-1"]').attributes('aria-label')).toBe('Page 1')
    expect(pages.find('[data-testid="assets-page-16"]').exists(), 'the last page').toBe(true)
  })

  it('keeps the page bar when every Cloud output fits on one page', async () => {
    cloudOutputs(30)
    const wrapper = await mountCloud()

    expect(assetNames(wrapper)).toHaveLength(30)
    expect(shownText(wrapper.get('[data-testid="assets-pagination"]').element)).toContain(
      '1–30 of 30'
    )
  })

  it('continues past a capped Cloud total using cursors and shows an exact count at the end', async () => {
    cloudOutputs(10_137)
    const wrapper = await mountCloud()
    const pager = wrapper.get('[data-testid="assets-pagination"]')

    expect(shownText(pager.element)).toContain('1–100 of 10000+')
    expect(pager.find('[data-testid="assets-page-101"]').exists()).toBe(false)

    await goToPage(wrapper, 100)
    expect(asked()).toContainEqual({ ...FIRST_PAGE, offset: 9900 })
    expect(shownText(pager.element)).toContain('9901–10000 of 10001+')
    await nextPagePrefetched(10_000)
    expect(asked()).toContainEqual({ ...FIRST_PAGE, offset: 10_000, after: 'cursor-10000' })

    await goToPage(wrapper, 101)
    expect(assetNames(wrapper)[0]).toBe('out-10000.png')
    expect(shownText(pager.element)).toContain('10001–10100 of 10101+')
    await goToPage(wrapper, 102)
    expect(shownText(pager.element)).toContain('10101–10137 of 10137')

    await goToPage(wrapper, 1)
    expect(shownText(pager.element)).toContain('1–100 of 10137')
    expect(pager.find('[data-testid="assets-page-102"]').exists()).toBe(true)
  })

  it('shows an exact count when the page at the cap really is the last page', async () => {
    cloudOutputs(10_000)
    const wrapper = await mountCloud()
    const pager = wrapper.get('[data-testid="assets-pagination"]')

    await goToPage(wrapper, 100)

    expect(shownText(pager.element)).toContain('9901–10000 of 10000')
    expect(pager.find('[data-testid="assets-page-101"]').exists()).toBe(false)
    expect(timesAskedFor(10_000)).toBe(0)
  })

  it('opens the next page from Cloud and goes back to a seen page without asking again', async () => {
    cloudOutputs(250)
    const wrapper = await mountCloud()
    await nextPagePrefetched(100)

    await goToPage(wrapper, 2)
    expect(assetNames(wrapper)[0]).toBe('out-100.png')
    expect(shownText(wrapper.get('[data-testid="assets-pagination"]').element)).toContain(
      '101–200 of 250'
    )

    await goToPage(wrapper, 1)

    expect(assetNames(wrapper)[0]).toBe('out-0.png')
    expect(timesAskedFor(0), 'page 1 comes from the cache').toBe(1)
    expect(timesAskedFor(100), 'page 2 was asked for only once').toBe(1)
  })

  it('gets the next page ready while the user looks at this one', async () => {
    cloudOutputs(250)
    const wrapper = await mountCloud()

    await nextPagePrefetched(100)
    expect(asked()).toEqual([FIRST_PAGE, { ...FIRST_PAGE, offset: 100, after: 'cursor-100' }])

    await goToPage(wrapper, 2)
    expect(assetNames(wrapper)[0]).toBe('out-100.png')
    expect(timesAskedFor(100), 'the ready page is used').toBe(1)
  })

  it('scrolls to the top when another page opens', async () => {
    cloudOutputs(250)
    const wrapper = await mountCloud()
    await nextPagePrefetched(100)
    const scroller = wrapper.get('[data-testid="assets-view"]').element
    const scrolled = new Promise((resolve) =>
      scroller.addEventListener('scroll', resolve, { once: true })
    )
    scroller.scrollTop = scroller.scrollHeight
    await scrolled

    await goToPage(wrapper, 2)
    await new Promise(requestAnimationFrame)

    expect(scroller.scrollTop).toBe(0)
  })

  it('shows the last page clicked when an earlier page arrives late, and asks again for a page that a newer one replaced', async () => {
    let finishPageTwo: (page: CloudAssetPage | null) => void = () => {}
    listAssets.mockImplementation((_id: string, request: PageRequest) =>
      request.offset === 100
        ? new Promise((resolve) => (finishPageTwo = resolve))
        : Promise.resolve(outputPage(400, request))
    )
    const wrapper = await mountCloud()
    await nextPagePrefetched(100)

    await goToPage(wrapper, 2)
    await goToPage(wrapper, 3)
    expect(assetNames(wrapper)[0]).toBe('out-200.png')

    finishPageTwo(null)
    await flushPromises()

    expect(assetNames(wrapper)[0], 'the late page does not replace page 3').toBe('out-200.png')
    expect(wrapper.find('[data-testid="assets-empty"]').exists()).toBe(false)

    listAssets.mockImplementation(async (_id: string, request: PageRequest) =>
      outputPage(400, request)
    )
    await goToPage(wrapper, 2)

    expect(assetNames(wrapper)[0]).toBe('out-100.png')
    expect(timesAskedFor(100)).toBe(2)
  })

  it('recounts from the first page when a stale jump comes back empty', async () => {
    let total = 250
    listAssets.mockImplementation(async (_id: string, request: PageRequest) =>
      outputPage(total, request)
    )
    const wrapper = await mountCloud()
    await nextPagePrefetched(100)
    total = 150

    await goToPage(wrapper, 3)

    expect(timesAskedFor(0)).toBe(2)
    expect(assetNames(wrapper)[0]).toBe('out-0.png')
    expect(shownText(wrapper.get('[data-testid="assets-pagination"]').element)).toContain(
      '1–100 of 150'
    )
  })

  it('asks again for a page that a newer page replaced while it loaded', async () => {
    let finishFirstPageTwo: (page: CloudAssetPage | null) => void = () => {}
    listAssets.mockImplementation((_id: string, request: PageRequest) =>
      request.offset === 100 && timesAskedFor(100) === 1
        ? new Promise((resolve) => (finishFirstPageTwo = resolve))
        : Promise.resolve(outputPage(400, request))
    )
    const wrapper = await mountCloud()
    await nextPagePrefetched(100)

    await goToPage(wrapper, 3)
    await goToPage(wrapper, 2)
    finishFirstPageTwo(null)
    await flushPromises()

    expect(timesAskedFor(100)).toBe(2)
    expect(assetNames(wrapper)[0]).toBe('out-100.png')
    expect(wrapper.find('[data-testid="assets-empty"]').exists()).toBe(false)
  })

  it('asks Cloud for nothing more once the page is closed', async () => {
    let finishFirstPage: (page: CloudAssetPage) => void = () => {}
    listAssets.mockImplementation((_id: string, request: PageRequest) =>
      request.offset === 0
        ? new Promise((resolve) => (finishFirstPage = resolve))
        : Promise.resolve(outputPage(250, request))
    )
    const wrapper = await mountCloud()

    wrapper.unmount()
    finishFirstPage(outputPage(250, FIRST_PAGE))
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(timesAskedFor(100), 'no next page is fetched for a closed page').toBe(0)
  })

  it('asks Cloud again from page 1 after Refresh', async () => {
    cloudOutputs(250)
    const wrapper = await mountCloud()
    await nextPagePrefetched(100)
    await goToPage(wrapper, 2)

    await wrapper.get('[data-testid="assets-refresh"]').trigger('click')
    await flushPromises()

    expect(timesAskedFor(0)).toBe(2)
    expect(assetNames(wrapper)[0]).toBe('out-0.png')
  })

  it('starts again from page 1 with fresh pages when the user leaves Comfy Cloud and comes back', async () => {
    cloudOutputs(250)
    const wrapper = await mountCloud([
      localBuild('lab', 'Video Lab'),
      cloudBuild('cloud', 'Comfy Cloud')
    ])
    await openBuildPicker(wrapper)
    await pickBuild('cloud')
    await nextPagePrefetched(100)
    await goToPage(wrapper, 2)

    await openBuildPicker(wrapper)
    await pickBuild('lab')
    await openBuildPicker(wrapper)
    await pickBuild('cloud')

    expect(assetNames(wrapper)[0]).toBe('out-0.png')
    expect(timesAskedFor(0)).toBe(2)
  })

  it('starts again from page 1 with fresh pages when the user moves to another workspace', async () => {
    cloudOutputs(250)
    const wrapper = await mountCloud([{ ...cloudBuild('cloud', 'Comfy Cloud'), sourceId: 'cloud' }])
    await nextPagePrefetched(100)
    await goToPage(wrapper, 2)

    useDashboardScopeStore().selectWorkspace('team-b')
    await flushPromises()

    expect(switchWorkspace).toHaveBeenLastCalledWith('team-b', 'chosen')
    expect(timesAskedFor(0)).toBe(2)
    expect(assetNames(wrapper)[0]).toBe('out-0.png')
    expect(shownText(wrapper.get('[data-testid="assets-pagination"]').element)).toContain(
      '1–100 of 250'
    )
  })

  it('shows no type counts for Comfy Cloud, because Cloud cannot count by type', async () => {
    cloudOutputs(30)
    const wrapper = await mountCloud()

    expect(wrapper.get('[data-testid="assets-kind-all"]').text()).toBe('All')
    expect(wrapper.get('[data-testid="assets-kind-3d"]').text()).toBe('3D')
  })

  it('asks Cloud for every output of the picked type, not only those on the open page', async () => {
    cloudOutputs(250)
    const wrapper = await mountCloud()
    await nextPagePrefetched(100)

    await wrapper.get('[data-testid="assets-kind-3d"]').trigger('click')
    await flushPromises()

    expect(asked()).toContainEqual({ ...FIRST_PAGE, kind: '3d' })
    expect(assetNames(wrapper)).toEqual([
      'mesh-7.glb',
      'mesh-57.glb',
      'mesh-107.glb',
      'mesh-157.glb',
      'mesh-207.glb'
    ])
    expect(shownText(wrapper.get('[data-testid="assets-pagination"]').element)).toContain(
      '1–5 of 5'
    )

    await wrapper.get('[data-testid="assets-kind-all"]').trigger('click')
    await flushPromises()

    expect(assetNames(wrapper)[0]).toBe('out-0.png')
    expect(timesAskedFor(0), 'All comes back from the cache').toBe(2)
  })

  it("hides the old query's pages while the picked type loads", async () => {
    let finishThreeD: (page: CloudAssetPage) => void = () => {}
    listAssets.mockImplementation((_id: string, request: PageRequest) =>
      request.kind === '3d'
        ? new Promise((resolve) => (finishThreeD = resolve))
        : Promise.resolve(outputPage(250, request))
    )
    const wrapper = await mountCloud()
    expect(wrapper.find('[data-testid="assets-pagination"]').exists()).toBe(true)

    await wrapper.get('[data-testid="assets-kind-3d"]').trigger('click')
    await flushPromises()

    expect(
      wrapper.find('[data-testid="assets-pagination"]').exists(),
      'no page of the old query can be clicked'
    ).toBe(false)

    finishThreeD(outputPage(250, { ...FIRST_PAGE, kind: '3d' }))
    await flushPromises()

    expect(shownText(wrapper.get('[data-testid="assets-pagination"]').element)).toContain(
      '1–5 of 5'
    )
  })

  it('searches every Comfy Cloud output by name, with or without a type', async () => {
    cloudOutputs(250)
    const wrapper = await mountCloud()
    await goToPage(wrapper, 2)

    await wrapper.get('input').setValue('mesh')
    await vi.waitFor(() => expect(asked()).toContainEqual({ ...FIRST_PAGE, search: 'mesh' }))
    await flushPromises()

    expect(assetNames(wrapper)).toEqual([
      'mesh-7.glb',
      'mesh-57.glb',
      'mesh-107.glb',
      'mesh-157.glb',
      'mesh-207.glb'
    ])
    expect(shownText(wrapper.get('[data-testid="assets-pagination"]').element)).toContain(
      '1–5 of 5'
    )

    await wrapper.get('[data-testid="assets-kind-3d"]').trigger('click')
    await flushPromises()

    expect(asked().at(-1)).toEqual({ ...FIRST_PAGE, kind: '3d', search: 'mesh' })
    expect(
      wrapper.findAll('[data-testid^="assets-kind-"]').map((tab) => tab.text()),
      'Cloud tabs show no counts, with or without a search'
    ).toEqual(['All', 'Images', 'Videos', '3D', 'Audio'])
  })

  it('says nothing matches when Comfy Cloud has no outputs of the picked type', async () => {
    cloudOutputs(250)
    const wrapper = await mountCloud()

    await wrapper.get('[data-testid="assets-kind-audio"]').trigger('click')
    await flushPromises()

    expect(asked()).toContainEqual({ ...FIRST_PAGE, kind: 'audio' })
    expect(shownText(wrapper.get('[data-testid="assets-empty"]').element)).toBe(
      'No matching assets Try another type or search.'
    )
  })

  it('explains the scan limit even when a type did not match any of the scanned Cloud outputs', async () => {
    listAssets.mockImplementation(async (_id: string, request: PageRequest) =>
      request.kind ? { assets: [], total: 0, scanLimit: 50_000 } : outputPage(65_000, request)
    )
    const wrapper = await mountCloud()

    await wrapper.get('[data-testid="assets-kind-3d"]').trigger('click')
    await flushPromises()

    expect(shownText(wrapper.get('[data-testid="assets-scan-limit"]').element)).toBe(
      'Type filters cover the first 50000 Cloud outputs in this sort order.'
    )
  })

  it('asks Cloud for bigger pages from page 1 when the user picks another page size', async () => {
    cloudOutputs(500)
    const wrapper = await mountCloud()
    await nextPagePrefetched(100)
    await goToPage(wrapper, 2)

    await wrapper.get('[data-testid="assets-page-size"]').trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()
    const twoHundred = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (option) => option.textContent?.trim() === '200'
    )!
    twoHundred.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()

    expect(asked()).toContainEqual({ offset: 0, limit: 200, order: 'newest' })
    expect(assetNames(wrapper)[0]).toBe('out-0.png')
    expect(shownText(wrapper.get('[data-testid="assets-pagination"]').element)).toContain(
      '1–200 of 500'
    )
  })
})
