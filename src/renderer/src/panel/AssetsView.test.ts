import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import '../assets/main.css'
import AssetsView from './AssetsView.vue'
import Tooltip from '../components/ui/Tooltip.vue'
import { useAuthStore } from '../stores/authStore'
import { useInstallationStore } from '../stores/installationStore'
import type { AssetSummary, Installation } from '../types/ipc'

const listAssets = vi.fn()
const listLocalAssets = vi.fn()
const signIn = vi.fn().mockResolvedValue({ signedIn: false })
const MASONRY_GAP = 16
const FOUR_COLUMN_PAGE_WIDTH = 1000
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

function cloudBuild(id: string): Installation {
  return { id, name: id, sourceLabel: 'Comfy Cloud', sourceCategory: 'cloud' }
}

async function mountAssets(local: AssetSummary[] | Promise<AssetSummary[]> = []) {
  listLocalAssets.mockReturnValue(Promise.resolve(local))
  const wrapper = mount(AssetsView, { attachTo: page })
  await flushPromises()
  return wrapper
}

async function signInWith(cloud: AssetSummary[]): Promise<void> {
  useInstallationStore().installations = [cloudBuild('cloud')]
  listAssets.mockResolvedValue(cloud)
  useAuthStore().status = { signedIn: true }
  await flushPromises()
}

function assetNames(wrapper: Awaited<ReturnType<typeof mountAssets>>): string[] {
  return wrapper
    .get('[data-testid="assets-grid"]')
    .findAllComponents(Tooltip)
    .map((tip) => tip.props('text') as string)
}

beforeEach(() => {
  page = document.createElement('div')
  page.dataset.panelPage = ''
  page.style.cssText = `width: ${FOUR_COLUMN_PAGE_WIDTH}px; height: ${TALL_PAGE_HEIGHT}px`
  document.body.append(page)
  vi.clearAllMocks()
  window.localStorage.clear()
  listLocalAssets.mockResolvedValue([])
  ;(window as unknown as { api: unknown }).api = {
    listAssets,
    listLocalAssets,
    onInstallationsChanged: vi.fn(() => () => {}),
    onInstallationsVersionsUpdated: vi.fn(() => () => {}),
    comfybuilder: {
      getAuthStatus: vi.fn().mockResolvedValue({ signedIn: false }),
      signIn,
      onAuthChanged: vi.fn(() => () => {})
    }
  }
  setActivePinia(createPinia())
})

afterEach(() => page.remove())

describe('AssetsView', () => {
  it('starts with file names and details hidden', async () => {
    const wrapper = await mountAssets([asset('a', 'forest.png', 'image')])

    expect(wrapper.get('[data-testid="asset-a"]').text()).not.toContain('forest.png')
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
          expect(card.top - column[i]!.bottom, 'cards in a column sit one gap apart').toBeCloseTo(
            MASONRY_GAP
          )
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
    window.localStorage.setItem('comfy.desktop.assets.showName', 'true')

    const wrapper = await mountAssets([picture('a', 300)])

    const media = wrapper.get('[data-testid="asset-a"] img').element.getBoundingClientRect()
    expect(media.width / media.height, 'grid crops every card to the same wide shape').toBeCloseTo(
      16 / 9
    )
    expect(wrapper.get('[data-testid="asset-a"]').text()).toContain('a.svg')
  })

  it('shows the files on this computer without any build running or a Cloud login', async () => {
    const wrapper = await mountAssets([
      asset('/out/surfer.mp4', 'surfer.mp4', 'video'),
      asset('/out/forest.png', 'forest.png', 'image')
    ])

    expect(listLocalAssets).toHaveBeenCalledOnce()
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

  it('mixes this computer and the signed-in Cloud workspace, newest first', async () => {
    const wrapper = await mountAssets([
      asset('/out/old.png', 'old.png', 'image', { createdAt: '2026-11-01T00:00:00Z' })
    ])
    await signInWith([asset('c1', 'cloud.png', 'image', { createdAt: '2026-11-05T00:00:00Z' })])

    expect(listAssets.mock.calls.map(([id]) => id)).toEqual(['cloud'])
    expect(assetNames(wrapper)).toEqual(['cloud.png', 'old.png'])
  })

  it('loads the Cloud assets once when the account has several Cloud builds', async () => {
    useInstallationStore().installations = [cloudBuild('cloud-a'), cloudBuild('cloud-b')]
    listAssets.mockResolvedValue([asset('a', 'forest.png', 'image')])
    const wrapper = await mountAssets()
    useAuthStore().status = { signedIn: true }
    await flushPromises()

    expect(listAssets.mock.calls.map(([id]) => id)).toEqual(['cloud-a'])
    expect(assetNames(wrapper)).toEqual(['forest.png'])
  })

  it('filters by asset type and by name', async () => {
    const wrapper = await mountAssets([
      asset('a', 'surfer.mp4', 'video'),
      asset('b', 'forest.png', 'image'),
      asset('c', 'terraces.png', 'image')
    ])

    await wrapper.get('[data-testid="assets-filter"]').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    document.querySelector<HTMLElement>('[data-testid="assets-filter-image"]')!.click()
    await flushPromises()
    expect(assetNames(wrapper)).toEqual(['forest.png', 'terraces.png'])

    await wrapper.get('input').setValue('terr')
    expect(assetNames(wrapper)).toEqual(['terraces.png'])
  })

  it('asks a signed-out user with no files to log in to Comfy Cloud', async () => {
    useInstallationStore().installations = [cloudBuild('cloud')]
    const wrapper = await mountAssets()

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
    const wrapper = await mountAssets()

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

  it('does not reload when a build changes but the account stays the same', async () => {
    await mountAssets([asset('a', 'forest.png', 'image')])

    useInstallationStore().installations = [
      { id: 'lab', name: 'Video Lab', sourceLabel: 'Standalone', sourceCategory: 'local' }
    ]
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

  it('keeps the files on this computer when Cloud fails', async () => {
    const wrapper = await mountAssets([asset('/out/forest.png', 'forest.png', 'image')])
    useInstallationStore().installations = [cloudBuild('cloud')]
    listAssets.mockRejectedValue(new Error('offline'))
    useAuthStore().status = { signedIn: true }
    await flushPromises()

    expect(assetNames(wrapper)).toEqual(['forest.png'])
    expect(wrapper.find('[data-testid="assets-empty"]').exists()).toBe(false)
  })

  it('reloads when the signed-in workspace changes', async () => {
    await mountAssets([asset('a', 'forest.png', 'image')])

    useAuthStore().status = { signedIn: true, workspaceId: 'team-b' }
    await flushPromises()

    expect(listLocalAssets).toHaveBeenCalledTimes(2)
  })

  it('clears the previous workspace assets while the new workspace loads', async () => {
    const wrapper = await mountAssets([asset('a', 'forest.png', 'image')])
    listLocalAssets.mockReturnValueOnce(new Promise(() => {}))

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
})
