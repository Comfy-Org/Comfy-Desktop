import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import '../assets/main.css'
import AssetsView from './AssetsView.vue'
import Tooltip from '../components/ui/Tooltip.vue'
import { useAuthStore } from '../stores/authStore'
import { useDashboardScopeStore } from '../stores/dashboardScopeStore'
import { useInstallationStore } from '../stores/installationStore'
import type {
  AssetSummary,
  Installation,
  OutputFolder,
  OutputFolderListing,
  OutputSubfolder
} from '../types/ipc'

const listAssets = vi.fn()
const listOutputFolders = vi.fn()
const listOutputFolder = vi.fn()
const downloadAsset = vi.fn()
const revealAsset = vi.fn()
const revealPath = vi.fn()
const openPath = vi.fn()
const copyAsset = vi.fn()
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
const OUTPUT = '/Users/me/ComfyUI-Shared/output'

type Wrapper = Awaited<ReturnType<typeof mountPage>>

let page: HTMLElement

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

function listing(files: AssetSummary[], folders: OutputSubfolder[] = []): OutputFolderListing {
  return { folders, files }
}

function cloudBuild(id: string, name = id): Installation {
  return { id, name, sourceLabel: 'Comfy Cloud', sourceCategory: 'cloud' }
}

function localBuild(id: string, name = id): Installation {
  return { id, name, sourceLabel: 'Standalone', sourceCategory: 'local' }
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

function outputFolder(path: string, builds: string[] = []): OutputFolder {
  return { path, builds, buildIds: builds.map((name) => name.toLowerCase()) }
}

async function mountPage({
  builds = [localBuild('lab')],
  folders = [outputFolder(OUTPUT, ['lab'])],
  installationId
}: { builds?: Installation[]; folders?: OutputFolder[]; installationId?: string } = {}) {
  const installationStore = useInstallationStore()
  installationStore.installations = builds
  installationStore.loading = false
  listOutputFolders.mockResolvedValue(folders)
  const wrapper = mount(AssetsView, { attachTo: page, props: { installationId } })
  await flushPromises()
  return wrapper
}

async function mountAssets(files: AssetSummary[] = [], options: { builds?: Installation[] } = {}) {
  listOutputFolder.mockResolvedValue(listing(files))
  const wrapper = await mountPage(options)
  await openFolder(wrapper, OUTPUT)
  return wrapper
}

async function mountCloud(builds: Installation[] = [cloudBuild('cloud')]) {
  window.localStorage.setItem('comfy.desktop.assets.place', 'cloud')
  return mountPage({ builds })
}

async function openFolder(wrapper: Wrapper, path: string): Promise<void> {
  await wrapper.get(`[data-testid="local-folder-${path}"]`).trigger('click')
  await flushPromises()
}

async function choose(wrapper: Wrapper, place: 'cloud' | 'computer'): Promise<void> {
  await wrapper.get(`[data-testid="assets-place-${place}"]`).trigger('click')
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

function assetNames(wrapper: Wrapper): string[] {
  return wrapper
    .get('[data-testid="assets-grid"]')
    .findAllComponents(Tooltip)
    .map((tip) => tip.props('text') as string)
}

function shownText(element: Element | null | undefined): string {
  return ((element as HTMLElement | null)?.innerText ?? '').replace(/\s+/g, ' ').trim()
}

function text(wrapper: Wrapper, testId: string): string {
  const element = [...wrapper.element.querySelectorAll('[data-testid]')].find(
    (candidate) => candidate.getAttribute('data-testid') === testId
  )
  expect(element, `${testId} is on the page`).toBeDefined()
  return shownText(element)
}

function signedInToPersonal(): void {
  getAuthStatus.mockResolvedValue({ signedIn: true, workspaceId: 'me', workspaceType: 'personal' })
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
  window.localStorage.clear()
  listOutputFolders.mockResolvedValue([])
  listOutputFolder.mockResolvedValue(listing([]))
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
  ;(window as unknown as { api: unknown }).api = {
    listAssets,
    listOutputFolders,
    listOutputFolder,
    downloadAsset,
    revealAsset,
    revealPath,
    openPath,
    copyAsset,
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
      Array.from({ length: 300 }, (_, i) => picture(`card-${i}`, 300))
    )
    const cardCount = () => wrapper.findAll('[data-testid="assets-grid"] > li').length

    await vi.waitFor(() => expect(cardCount(), 'the first rows are on the page').toBeGreaterThan(0))
    expect(cardCount(), 'cards far below the window are not').toBeLessThan(40)

    const view = wrapper.get('[data-testid="assets-view"]').element
    view.scrollTop = view.scrollHeight
    await vi.waitFor(() =>
      expect(
        wrapper.find('[data-testid="asset-card-299"]').exists(),
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

  it('opens on This computer with a card per output folder: its real name, a short path and the builds that save there', async () => {
    const wrapper = await mountPage({
      folders: [
        outputFolder(OUTPUT, ['ComfyUI', 'Video Lab', 'Apps', 'Sketches']),
        outputFolder('/Users/me/Installs/Bare/ComfyUI/output')
      ]
    })

    expect(listOutputFolders).toHaveBeenCalledOnce()
    expect(listAssets, 'nothing is read from Comfy Cloud').not.toHaveBeenCalled()
    expect(listOutputFolder, 'no folder is read before one is opened').not.toHaveBeenCalled()
    expect(text(wrapper, `local-folder-heading-${OUTPUT}`)).toBe('ComfyUI, Video Lab +2')
    expect(text(wrapper, `local-folder-${OUTPUT}`)).toBe('output /Users/…/ComfyUI-Shared')
    expect(
      wrapper.get(`[data-testid="local-folder-${OUTPUT}"]`).attributes('title'),
      'the full path on hover'
    ).toBe(OUTPUT)
    expect(text(wrapper, 'local-folder-heading-/Users/me/Installs/Bare/ComfyUI/output')).toBe(
      'No build saves here yet'
    )
    expect(text(wrapper, 'local-folder-/Users/me/Installs/Bare/ComfyUI/output')).toBe(
      'output /Users/…/ComfyUI'
    )
    expect(
      wrapper.find('[data-testid="assets-kind-all"]').exists(),
      'the type tabs show only where they act'
    ).toBe(false)
    expect(wrapper.find('input').exists(), 'so does the search').toBe(false)
  })

  it('shortens Windows drive and network paths the same way', async () => {
    const paths = ['C:\\Users\\me\\ComfyUI\\output', 'D:\\output', '\\\\nas\\share\\comfy\\output']
    const wrapper = await mountPage({ folders: paths.map((path) => outputFolder(path)) })

    expect(paths.map((path) => text(wrapper, `local-folder-${path}`))).toEqual([
      'output C:\\…\\ComfyUI',
      'output D:\\',
      'output \\\\nas\\share\\comfy'
    ])
  })

  it('names every build that saves to a folder when its +N button is focused', async () => {
    const builds = ['Build 1', 'Build 2', 'Build 3']
    const wrapper = await mountPage({ folders: [outputFolder(OUTPUT, builds)] })

    const more = wrapper.get(`[data-testid="local-folder-more-${OUTPUT}"]`)
    expect(more.text()).toBe('+1')
    await more.trigger('focusin')
    await flushPromises()

    const bubble = document.querySelector('.tooltip-bubble')?.textContent ?? ''
    expect(bubble).toContain('Saved here by')
    expect(bubble).toContain('Build 3')
  })

  it('says when there is no output folder yet', async () => {
    const wrapper = await mountPage({ folders: [] })

    expect(text(wrapper, 'local-folders-empty')).toContain('No output folders yet')
  })

  it('walks into a folder and its subfolders, and back with the path', async () => {
    listOutputFolder.mockImplementation(async (path: string) =>
      path === OUTPUT
        ? listing(
            [asset(`${OUTPUT}/top.png`, 'top.png', 'image')],
            [{ name: 'video', path: `${OUTPUT}/video` }]
          )
        : listing([asset(`${OUTPUT}/video/clip.mp4`, 'clip.mp4', 'video')])
    )
    const wrapper = await mountPage()

    await openFolder(wrapper, OUTPUT)
    expect(listOutputFolder).toHaveBeenLastCalledWith(OUTPUT)
    expect(shownText(wrapper.get('nav').element)).toBe('This computer output')
    expect(assetNames(wrapper)).toEqual(['top.png'])
    expect(wrapper.find('[data-testid="assets-kind-all"]').exists()).toBe(true)

    await wrapper.get('[data-testid="local-subfolder-video"]').trigger('click')
    await flushPromises()
    expect(listOutputFolder).toHaveBeenLastCalledWith(`${OUTPUT}/video`)
    expect(shownText(wrapper.get('nav').element)).toBe('This computer output video')
    expect(assetNames(wrapper)).toEqual(['clip.mp4'])

    await wrapper.get('[data-testid="local-crumb-1"]').trigger('click')
    await flushPromises()
    expect(assetNames(wrapper)).toEqual(['top.png'])

    await wrapper.get('[data-testid="local-crumb-0"]').trigger('click')
    await flushPromises()
    expect(wrapper.find(`[data-testid="local-folder-${OUTPUT}"]`).exists()).toBe(true)
    expect(wrapper.find('[data-testid="assets-grid"]').exists()).toBe(false)
  })

  it('shows no empty message in a folder that holds only subfolders', async () => {
    listOutputFolder.mockResolvedValue(listing([], [{ name: 'video', path: `${OUTPUT}/video` }]))
    const wrapper = await mountPage()

    await openFolder(wrapper, OUTPUT)

    expect(wrapper.find('[data-testid="local-subfolder-video"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="assets-empty"]').exists()).toBe(false)
  })

  it('says a folder has nothing to show', async () => {
    const wrapper = await mountAssets([])

    expect(text(wrapper, 'assets-empty')).toBe('No images, videos, audio or 3D files here.')
  })

  it('shows any folder or subfolder in Finder from its menu, and opens the folder it is in', async () => {
    listOutputFolder.mockResolvedValue(listing([], [{ name: 'video', path: `${OUTPUT}/video` }]))
    const wrapper = await mountPage()

    await wrapper
      .get(`[data-testid="local-folder-menu-${OUTPUT}"]`)
      .trigger('keydown', { key: 'Enter' })
    await flushPromises()
    const reveal = document.querySelector<HTMLElement>('[data-testid="local-folder-reveal"]')!
    expect(reveal.textContent?.trim()).toBe('Show in Finder')
    reveal.click()
    await flushPromises()
    expect(revealPath).toHaveBeenCalledExactlyOnceWith(OUTPUT)

    await openFolder(wrapper, OUTPUT)
    await wrapper
      .get('[data-testid="local-subfolder-menu-video"]')
      .trigger('keydown', { key: 'Enter' })
    await flushPromises()
    document.querySelector<HTMLElement>('[data-testid="local-folder-reveal"]')!.click()
    await flushPromises()
    expect(revealPath).toHaveBeenLastCalledWith(`${OUTPUT}/video`)

    await wrapper.get('[data-testid="local-open-folder"]').trigger('click')
    expect(openPath).toHaveBeenCalledExactlyOnceWith(OUTPUT)
  })

  it('says a folder could not be opened, with a way back to This computer', async () => {
    listOutputFolder.mockResolvedValue(null)
    const wrapper = await mountPage()

    await openFolder(wrapper, OUTPUT)
    expect(wrapper.get('[data-testid="assets-empty"] h2').text()).toBe(
      "Couldn't open this folder. It may have been moved or deleted."
    )
    await wrapper.get('[data-testid="assets-empty-action"]').trigger('click')
    await flushPromises()

    expect(wrapper.find(`[data-testid="local-folder-${OUTPUT}"]`).exists()).toBe(true)
  })

  it('says the output folders could not be read', async () => {
    listOutputFolders.mockRejectedValue(new Error('disk'))
    const wrapper = mount(AssetsView, { attachTo: page })
    await flushPromises()

    expect(text(wrapper, 'local-folders-empty')).toBe("Couldn't load assets")
  })

  it('remembers the place the user chose', async () => {
    const first = await mountPage({ builds: [cloudBuild('cloud')] })
    await choose(first, 'cloud')
    first.unmount()

    const again = await mountPage({ builds: [cloudBuild('cloud')] })

    expect(again.get('[data-testid="assets-place-cloud"]').attributes('data-state')).toBe('on')
    expect(again.find('[data-testid="local-folders"]').exists()).toBe(false)
  })

  it("opens a Cloud build's window on Comfy Cloud without changing the saved place", async () => {
    const wrapper = await mountPage({
      builds: [localBuild('lab'), cloudBuild('cloud')],
      installationId: 'cloud'
    })

    expect(wrapper.get('[data-testid="assets-place-cloud"]').attributes('data-state')).toBe('on')
    expect(listOutputFolders, 'This computer is not read').not.toHaveBeenCalled()
    expect(window.localStorage.getItem('comfy.desktop.assets.place')).not.toBe('cloud')
  })

  it("opens a local build's window inside that build's output folder, and keeps the saved place", async () => {
    window.localStorage.setItem('comfy.desktop.assets.place', 'cloud')
    listOutputFolder.mockResolvedValue(listing([asset(`${OUTPUT}/mine.png`, 'mine.png', 'image')]))
    const wrapper = await mountPage({
      builds: [localBuild('lab'), localBuild('other'), cloudBuild('cloud')],
      folders: [outputFolder('/Users/me/Other/output', ['other']), outputFolder(OUTPUT, ['lab'])],
      installationId: 'lab'
    })

    expect(wrapper.get('[data-testid="assets-place-computer"]').attributes('data-state')).toBe('on')
    expect(listOutputFolder).toHaveBeenCalledExactlyOnceWith(OUTPUT)
    expect(assetNames(wrapper)).toEqual(['mine.png'])
    expect(window.localStorage.getItem('comfy.desktop.assets.place')).toBe('cloud')
  })

  it('waits for the builds before it reads anything in a build window', async () => {
    const installationStore = useInstallationStore()
    mount(AssetsView, { attachTo: page, props: { installationId: 'cloud' } })
    await flushPromises()

    expect(listOutputFolders).not.toHaveBeenCalled()
    expect(listAssets).not.toHaveBeenCalled()

    installationStore.installations = [cloudBuild('cloud')]
    installationStore.loading = false
    await flushPromises()

    expect(listOutputFolders, 'the Cloud build window opens on Comfy Cloud').not.toHaveBeenCalled()
  })

  it('saves the place the user picks in a build window', async () => {
    const wrapper = await mountPage({ builds: [cloudBuild('cloud')], installationId: 'cloud' })

    await choose(wrapper, 'computer')

    expect(window.localStorage.getItem('comfy.desktop.assets.place')).toBe('computer')
    expect(wrapper.find(`[data-testid="local-folder-${OUTPUT}"]`).exists()).toBe(true)
  })

  it('reloads only the place the user is on when Refresh is pressed', async () => {
    const wrapper = await mountPage()

    await wrapper.get('[data-testid="assets-refresh"]').trigger('click')
    await flushPromises()

    expect(listOutputFolders).toHaveBeenCalledTimes(2)
    expect(listOutputFolder).not.toHaveBeenCalled()
    expect(listAssets).not.toHaveBeenCalled()
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

  it('waits for the builds before it lists Comfy Cloud', async () => {
    window.localStorage.setItem('comfy.desktop.assets.place', 'cloud')
    signedInToPersonal()
    const installationStore = useInstallationStore()
    const wrapper = mount(AssetsView, { attachTo: page })
    await flushPromises()

    expect(listAssets, 'Comfy Cloud is not read before the builds are known').not.toHaveBeenCalled()
    expect(wrapper.findAll('[data-testid="assets-skeleton"] > li')).toHaveLength(8)

    listAssets.mockResolvedValue([asset('c', 'cloud.png', 'image')])
    installationStore.installations = [cloudBuild('cloud')]
    installationStore.loading = false
    await flushPromises()

    expect(listAssets).toHaveBeenCalledExactlyOnceWith('cloud')
  })

  it('keeps an empty page in place while the builds refresh', async () => {
    const wrapper = await mountCloud()
    await signInWith([])

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

    page.style.width = '700px'
    await vi.waitFor(() => expect(shown('assets-kind-menu')).toBe(true))
    expect(shown('assets-kind-all')).toBe(false)
    expect(shown('assets-search-toggle')).toBe(true)
    expect(toolbarRow().scrollWidth).toBeLessThanOrEqual(toolbarRow().clientWidth)

    page.style.width = '1400px'
    await vi.waitFor(() => expect(shown('assets-kind-all')).toBe(true))
    expect(shown('assets-search-toggle')).toBe(false)
  })

  it('filters by asset type and by name', async () => {
    const wrapper = await mountAssets([
      asset('a', 'surfer.mp4', 'video'),
      asset('b', 'forest.png', 'image'),
      asset('c', 'terraces.png', 'image')
    ])

    const tabs = () => wrapper.findAll('[data-testid^="assets-kind-"]').map((tab) => tab.text())
    expect(tabs(), 'each type tab counts its files').toEqual([
      'All3',
      'Images2',
      'Videos1',
      '3D0',
      'Audio0'
    ])

    await wrapper.get('[data-testid="assets-kind-image"]').trigger('click')
    expect(assetNames(wrapper)).toEqual(['forest.png', 'terraces.png'])

    await wrapper.get('input').setValue('terr')
    expect(assetNames(wrapper)).toEqual(['terraces.png'])
    expect(tabs(), 'the counts follow the search').toEqual([
      'All1',
      'Images1',
      'Videos0',
      '3D0',
      'Audio0'
    ])
  })

  it('asks a signed-out user on Comfy Cloud to log in', async () => {
    const wrapper = await mountPage({ builds: [cloudBuild('cloud')] })
    await choose(wrapper, 'cloud')

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
    const wrapper = await mountCloud()

    await wrapper.get('[data-testid="assets-empty-action"]').trigger('click')
    await flushPromises()

    expect(
      wrapper.get('[data-testid="assets-empty-action"]').attributes('disabled')
    ).toBeUndefined()
  })

  it('tells a signed-in user with no assets where they come from', async () => {
    const wrapper = await mountCloud()
    await signInWith([])

    expect(wrapper.get('[data-testid="assets-empty"] h2').text()).toBe('No assets yet')
    expect(wrapper.get('[data-testid="assets-empty"] p').text()).toBe('Open an app to make assets.')
    expect(wrapper.find('[data-testid="assets-empty-action"]').exists()).toBe(false)
  })

  it('says the workspace has no Comfy Cloud build yet', async () => {
    const wrapper = await mountCloud([localBuild('lab')])
    useAuthStore().status = { signedIn: true, workspaceId: 'me', workspaceType: 'personal' }
    await flushPromises()

    expect(listAssets).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="assets-empty"] h2').text()).toBe(
      'This workspace has no Comfy Cloud build yet'
    )
    expect(wrapper.get('[data-testid="assets-empty"] p').text()).toBe(
      'Add Comfy Cloud to this workspace to see its assets here.'
    )
  })

  it('shows a skeleton card per slot while the first load is pending', async () => {
    listOutputFolder.mockReturnValue(new Promise(() => {}))
    const wrapper = await mountPage()
    await openFolder(wrapper, OUTPUT)

    expect(wrapper.findAll('[data-testid="assets-skeleton"] > li')).toHaveLength(8)
  })

  it('downloads a file on this computer from its card', async () => {
    const wrapper = await mountAssets([
      asset('a', 'surfer.mp4', 'video'),
      asset('b', 'forest.png', 'image')
    ])

    await wrapper.get('[data-testid="asset-download-b"]').trigger('click')

    expect(downloadAsset).toHaveBeenCalledExactlyOnceWith('local', 'b', 'forest.png')
  })

  it('downloads a Cloud file through the Cloud build', async () => {
    const wrapper = await mountCloud()
    await signInWith([asset('c', 'cloud.png', 'image')])

    await wrapper.get('[data-testid="asset-download-c"]').trigger('click')

    expect(downloadAsset).toHaveBeenCalledExactlyOnceWith('cloud', 'c', 'cloud.png')
  })

  it('starts one download at a time for a file', async () => {
    let finish: () => void = () => {}
    downloadAsset.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)))
    const wrapper = await mountAssets([asset('a', 'forest.png', 'image')])
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
    const wrapper = await mountAssets([asset('a', 'forest.png', 'image')])

    await wrapper.get('[data-testid="asset-download-a"]').trigger('click')
    await flushPromises()

    expect(alert).toHaveBeenCalledExactlyOnceWith({
      title: "Couldn't download asset",
      message: 'forest.png'
    })
  })

  it('does not read the folder again when a build changes or the user logs in', async () => {
    await mountAssets([asset('a', 'forest.png', 'image')])

    useInstallationStore().installations = [localBuild('lab'), localBuild('other', 'Video Lab')]
    useAuthStore().status = { signedIn: true }
    await flushPromises()

    expect(listOutputFolder).toHaveBeenCalledOnce()
  })

  it('delays the first name tooltip, then shows the rest at once until the pointer leaves', async () => {
    const wrapper = await mountAssets([
      asset('a', 'surfer.mp4', 'video'),
      asset('b', 'forest.png', 'image')
    ])
    const grid = wrapper.get('[data-testid="assets-grid"]')
    const delays = () => grid.findAllComponents(Tooltip).map((tip) => tip.props('delayMs'))
    expect(delays()).toEqual([600, 600])

    vi.useFakeTimers()
    try {
      await grid.trigger('pointerenter')
      await vi.advanceTimersByTimeAsync(600)
      expect(delays()).toEqual([0, 0])

      await grid.trigger('pointerleave')
      expect(delays()).toEqual([600, 600])
    } finally {
      vi.useRealTimers()
    }
  })

  it('lists the Cloud build of the workspace the user moves to', async () => {
    listAssets.mockResolvedValue([asset('t1', 'team.png', 'image')])
    const wrapper = await mountCloud([
      localBuild('lab', 'Video Lab'),
      teamBuild(cloudBuild('team-cloud', 'Team Cloud'))
    ])

    useAuthStore().status = { signedIn: true, workspaceId: 'team-b' }
    await flushPromises()

    expect(listAssets).toHaveBeenCalledExactlyOnceWith('team-cloud')
    expect(assetNames(wrapper)).toEqual(['team.png'])
  })

  it("moves the Cloud session to the Cloud build's workspace before listing its assets", async () => {
    const wrapper = await mountCloud([teamBuild(cloudBuild('team-cloud', 'Team Cloud'))])
    useAuthStore().status = { signedIn: true, workspaceId: 'me', workspaceType: 'personal' }
    await flushPromises()
    listAssets.mockImplementation(async () =>
      useAuthStore().status.workspaceId === 'team-b' ? [asset('t1', 'team.png', 'image')] : []
    )

    useDashboardScopeStore().selectWorkspace('team-b')
    await flushPromises()

    expect(switchWorkspace).toHaveBeenCalledExactlyOnceWith('team-b', 'chosen')
    expect(assetNames(wrapper), "the team's files, not the personal workspace's").toEqual([
      'team.png'
    ])
  })

  it("says the load failed instead of showing another workspace's files when the personal workspace is unknown", async () => {
    listAssets.mockResolvedValue([asset('t1', 'team.png', 'image')])
    listWorkspaces.mockResolvedValue([{ id: 'team-b', name: 'Team B', type: 'team' }])
    const wrapper = await mountCloud([cloudBuild('cloud', 'Comfy Cloud')])
    useAuthStore().status = { signedIn: true, workspaceId: 'team-b', workspaceType: 'team' }
    await flushPromises()
    useDashboardScopeStore().selectWorkspace('personal')
    await flushPromises()

    expect(listAssets).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="assets-empty"]').text()).toContain("Couldn't load assets")
  })

  it('does not list Cloud files with a session tied to no known workspace', async () => {
    listAssets.mockResolvedValue([asset('x1', 'unknown.png', 'image')])
    listWorkspaces.mockResolvedValue([{ id: 'team-b', name: 'Team B', type: 'team' }])
    const wrapper = await mountCloud([cloudBuild('cloud', 'Comfy Cloud')])
    useAuthStore().status = { signedIn: true }
    await flushPromises()

    expect(listAssets).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="assets-empty"]').text()).toContain("Couldn't load assets")
  })

  it("reopens on a saved workspace's Cloud build without treating the move there as the user's choice", async () => {
    signedInToPersonalWithTeamDashboard()
    listAssets.mockResolvedValue([asset('t1', 'team.png', 'image')])

    const wrapper = await mountCloud([teamBuild(cloudBuild('team-cloud', 'Team Cloud'))])

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
    const wrapper = await mountCloud([teamBuild(cloudBuild('team-cloud', 'Team Cloud'))])

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

  it("moves the session to the Cloud build's workspace as the user's choice when they pick Comfy Cloud", async () => {
    signedInToPersonalWithTeamDashboard()
    listAssets.mockResolvedValue([asset('t1', 'team.png', 'image')])
    const wrapper = await mountPage({
      builds: [teamBuild(localBuild('team-lab', 'Team Lab')), teamBuild(cloudBuild('team-cloud'))]
    })
    expect(switchWorkspace, 'This computer needs no workspace').not.toHaveBeenCalled()

    await choose(wrapper, 'cloud')

    expect(switchWorkspace).toHaveBeenCalledExactlyOnceWith('team-b', 'chosen')
    expect(assetNames(wrapper)).toEqual(['team.png'])
  })

  it('clears the files of the place the user left while the next one loads', async () => {
    signedInToPersonal()
    listAssets.mockReturnValue(new Promise(() => {}))
    const wrapper = await mountAssets([asset('a', 'forest.png', 'image')], {
      builds: [cloudBuild('cloud')]
    })

    await choose(wrapper, 'cloud')

    expect(wrapper.find('[data-testid="assets-grid"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="assets-skeleton"]').exists()).toBe(true)
  })

  it('says nothing matches when a search hides every asset', async () => {
    const wrapper = await mountAssets([asset('a', 'forest.png', 'image')])

    await wrapper.get('input').setValue('zzz')

    expect(wrapper.get('[data-testid="assets-empty"]').text()).toContain('No matching assets')
  })

  it('reports a failed Cloud load', async () => {
    signedInToPersonal()
    listAssets.mockRejectedValue(new Error('offline'))
    const wrapper = await mountCloud()

    expect(wrapper.get('[data-testid="assets-empty"]').text()).toContain("Couldn't load assets")
  })

  it('opens the asset menu on right-click instead of the browser menu, with actions for a file on this computer', async () => {
    const wrapper = await mountAssets([picture('b', 300)])

    const event = await rightClick(wrapper.get('[data-testid="asset-b"]').element)

    expect(event.defaultPrevented, 'the browser menu with Save Image does not open').toBe(true)
    expect(menuLabels()).toEqual(['Download', 'Show in Finder', 'Copy', 'Delete'])
    await pickMenuItem('reveal')
    expect(revealAsset).toHaveBeenCalledExactlyOnceWith('local', 'b')
  })

  it('offers only Download and Copy for a Cloud file, from the more actions button', async () => {
    const wrapper = await mountCloud()
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
    await rightClick(wrapper.get('[data-testid="asset-gone"]').element)
    await pickMenuItem('delete')

    expect(confirm.mock.calls[1]![0]).toMatchObject({
      title: 'Delete gone.svg?',
      message: 'It moves to the Trash.'
    })
    expect(trashAsset).toHaveBeenCalledExactlyOnceWith('local', 'gone')
    expect(assetNames(wrapper)).toEqual(['keep.svg'])
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

  it('tells where a file on this computer is saved in the viewer, and shows it in Finder', async () => {
    const wrapper = await mountAssets([asset(`${OUTPUT}/forest.png`, 'forest.png', 'image')])

    await wrapper.get(`[data-testid="asset-open-${OUTPUT}/forest.png"]`).trigger('click')
    await flushPromises()

    expect(shownText(viewer()!.querySelector('[data-testid="output-detail-saved-in"]'))).toBe(
      'SAVED IN output /Users/me/ComfyUI-Shared'
    )
    const show = viewer()!.querySelector<HTMLElement>(
      '[data-testid="output-detail-show-in-folder"]'
    )!
    expect(show.textContent?.trim()).toBe('Show in Finder')
    show.click()
    expect(revealAsset).toHaveBeenCalledExactlyOnceWith('local', `${OUTPUT}/forest.png`)
  })

  it('does not say where a Cloud file is saved in the viewer', async () => {
    const wrapper = await mountCloud()
    await signInWith([asset('c', 'cloud.png', 'image')])

    await wrapper.get('[data-testid="asset-open-c"]').trigger('click')
    await flushPromises()

    expect(viewer()!.querySelector('[data-testid="output-detail-saved-in"]')).toBeNull()
    expect(viewer()!.querySelector('[data-testid="output-detail-show-in-folder"]')).toBeNull()
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

  it('downloads the file the viewer is showing', async () => {
    const wrapper = await mountAssets([
      asset('a', 'surfer.mp4', 'video', { createdAt: '2026-11-02T00:00:00Z' }),
      asset('b', 'forest.png', 'image', { createdAt: '2026-11-01T00:00:00Z' })
    ])

    await wrapper.get('[data-testid="asset-open-a"]').trigger('click')
    await flushPromises()
    await press('ArrowRight')
    document.querySelector<HTMLElement>('[data-testid="output-detail-download"]')!.click()
    await flushPromises()

    expect(downloadAsset).toHaveBeenCalledExactlyOnceWith('local', 'b', 'forest.png')
  })
})
