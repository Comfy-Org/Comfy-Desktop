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
import type { AssetSummary, Installation, RunningInstance } from '../types/ipc'

const listAssets = vi.fn()
const listLocalAssets = vi.fn()
const downloadAsset = vi.fn()
const revealAsset = vi.fn()
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
    ...extra
  }
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
  ].map((row) => row.textContent?.replace(/\s+/g, ' ').trim() ?? '')
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
  window.localStorage.clear()
  listLocalAssets.mockResolvedValue([])
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
    listLocalAssets,
    downloadAsset,
    revealAsset,
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

  it("opens on the window's build, lists every build with where it runs, and switches to the one picked", async () => {
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
    expect(document.body.textContent).toContain('Browse the assets of')
    expect(buildRows()).toEqual([
      'My Local 1 Local · Stopped',
      'Video Lab Local · Running',
      'Comfy Cloud Cloud · Running'
    ])

    await pickBuild('cloud')

    expect(listAssets).toHaveBeenCalledExactlyOnceWith('cloud')
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

    expect(buildRows()).toEqual(['My Local 1 Local · Stopped'])
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

  it('shows the output folder as This computer when there is no local build', async () => {
    const wrapper = await mountAssets([asset('/out/forest.png', 'forest.png', 'image')], {
      builds: [cloudBuild('cloud', 'Comfy Cloud')]
    })

    expect(wrapper.get('[data-testid="assets-build-picker"]').text()).toBe('This computer')
    expect(
      listLocalAssets,
      'the shared output folder, not a build'
    ).toHaveBeenCalledExactlyOnceWith()
    expect(assetNames(wrapper)).toEqual(['forest.png'])
    await openBuildPicker(wrapper)
    expect(buildRows()).toEqual(['Comfy Cloud Cloud · Running', 'This computer Output folder'])
  })

  it('reopens on This computer, not the saved Comfy Cloud pick, after signing out', async () => {
    const builds = [cloudBuild('cloud', 'Comfy Cloud')]
    const first = await mountAssets([], { builds })
    useAuthStore().status = { signedIn: true }
    await flushPromises()
    await openBuildPicker(first)
    await pickBuild('cloud')
    first.unmount()

    useAuthStore().status = { signedIn: false }
    const again = await mountAssets([asset('/out/forest.png', 'forest.png', 'image')], { builds })

    expect(again.get('[data-testid="assets-build-picker"]').text()).toBe('This computer')
    expect(assetNames(again)).toEqual(['forest.png'])
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

  it('downloads a file on this computer from its card', async () => {
    const wrapper = await mountAssets([
      asset('a', 'surfer.mp4', 'video'),
      asset('b', 'forest.png', 'image')
    ])

    await wrapper.get('[data-testid="asset-download-b"]').trigger('click')

    expect(downloadAsset).toHaveBeenCalledExactlyOnceWith('local', 'b', 'forest.png')
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
    expect(wrapper.get('[data-testid="assets-build-picker"]').text()).toBe('Video Lab')

    useSessionStore().runningInstances.set('mine', { installationId: 'mine' } as RunningInstance)
    useInstallationStore().installations = [
      localBuild('mine', 'My Local 1', { lastLaunchedAt: 3 }),
      localBuild('lab', 'Video Lab', { lastLaunchedAt: 2 })
    ]
    await flushPromises()

    expect(wrapper.get('[data-testid="assets-build-picker"]').text()).toBe('Video Lab')
    expect(listLocalAssets).toHaveBeenCalledExactlyOnceWith('lab')
  })

  it('switches to the builds of the workspace the user moves to', async () => {
    listAssets.mockResolvedValue([asset('t1', 'team.png', 'image')])
    const wrapper = await mountAssets([asset('a', 'forest.png', 'image')], {
      builds: [localBuild('lab', 'Video Lab'), teamBuild(cloudBuild('team-cloud', 'Team Cloud'))]
    })

    useAuthStore().status = { signedIn: true, workspaceId: 'team-b' }
    await flushPromises()

    expect(wrapper.get('[data-testid="assets-build-picker"]').text()).toBe('Team Cloud')
    expect(listAssets).toHaveBeenCalledExactlyOnceWith('team-cloud')
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

    expect(wrapper.get('[data-testid="assets-build-picker"]').text()).toBe('Team Cloud')
    expect(switchWorkspace).toHaveBeenCalledExactlyOnceWith('team-b', 'chosen')
    expect(assetNames(wrapper), "the team's files, not the personal workspace's").toEqual([
      'team.png'
    ])
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

    expect(wrapper.get('[data-testid="assets-build-picker"]').text()).toBe('Team Cloud')
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
    await pickBuild('team-cloud')

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

    expect(wrapper.get('[data-testid="assets-empty"]').text()).toContain('No matching assets')
  })

  it('reports a failed load', async () => {
    const wrapper = await mountAssets(Promise.reject(new Error('disk')))

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
