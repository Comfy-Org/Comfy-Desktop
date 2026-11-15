import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import HomeView from './HomeView.vue'
import type { AppCard, CatalogWorkflow } from '../types/ipc'

const getAppsEnabled = vi.fn<() => Promise<boolean>>()
const listApps = vi.fn<() => Promise<AppCard[]>>()
const listHomeWorkflows = vi.fn<() => Promise<CatalogWorkflow[]>>()
const openCatalogWorkflow = vi.fn<(id: string) => Promise<boolean>>()

function app(id: string, title: string, coverUrl: string | null = null): AppCard {
  return { id, title, description: '', coverUrl }
}

const GENJUTSU: AppCard = {
  id: 'genjutsu',
  title: 'Genjutsu',
  description: 'Put someone else in a short clip.',
  coverUrl: 'https://comfy.org/catalog-media/genjutsu/cover'
}
const PRODUCT_ADS = app('product-ads', 'Product Ads')
const HDR = app('sdr-to-hdr', 'SDR to HDR')
const CUTOUT = app('remove-background', 'Remove Background')
const EXTEND = app('extend-picture', 'Extend the Picture')
const PUBLISHED_APPS = [GENJUTSU, PRODUCT_ADS, HDR, CUTOUT, EXTEND]

const UPSCALE_WORKFLOW: CatalogWorkflow = {
  id: 'upscale',
  title: 'Upscale and restore detail',
  description: '',
  thumbnailUrl: null
}

beforeEach(() => {
  vi.clearAllMocks()
  getAppsEnabled.mockResolvedValue(true)
  listApps.mockResolvedValue(PUBLISHED_APPS)
  listHomeWorkflows.mockResolvedValue([UPSCALE_WORKFLOW])
  openCatalogWorkflow.mockResolvedValue(true)
  ;(window as unknown as { api: unknown }).api = {
    getAppsEnabled,
    listApps,
    listHomeWorkflows,
    openCatalogWorkflow,
    getInstallations: vi.fn().mockResolvedValue([]),
    onInstallationsChanged: vi.fn(() => () => {}),
    onInstallationsVersionsUpdated: vi.fn(() => () => {}),
    getSetting: vi.fn().mockResolvedValue(undefined),
    setSetting: vi.fn().mockResolvedValue(undefined),
    onSettingsChanged: vi.fn(() => () => {}),
    comfybuilder: {
      getAuthStatus: vi.fn().mockResolvedValue({ signedIn: false }),
      onAuthChanged: vi.fn(() => () => {})
    }
  }
  setActivePinia(createPinia())
})

const mounted: VueWrapper[] = []

afterEach(() => {
  while (mounted.length) mounted.pop()?.unmount()
})

async function openHome() {
  const wrapper = mount(HomeView, { attachTo: document.body })
  mounted.push(wrapper)
  await flushPromises()
  return wrapper
}

function arc(wrapper: VueWrapper): string[] {
  return wrapper
    .findAll('[data-testid="home-carousel-card"]:not([aria-hidden="true"])')
    .map((card) => ({
      offset: Number(card.attributes('data-arc-offset')),
      text: card.get('[data-testid="home-carousel-name"]').text()
    }))
    .sort((left, right) => left.offset - right.offset)
    .map((card) => `${card.offset}:${card.text}`)
}

function cardAt(wrapper: VueWrapper, offset: number) {
  return wrapper.get(`[data-testid="home-carousel-card"][data-arc-offset="${offset}"]`)
}

describe('Home apps', () => {
  it("shows the apps the Apps page lists, in the website's order, starting with the first", async () => {
    const wrapper = await openHome()

    expect(arc(wrapper)).toEqual([
      '-2:Remove Background',
      '-1:Extend the Picture',
      '0:GenjutsuPut someone else in a short clip.',
      '1:Product Ads',
      '2:SDR to HDR'
    ])
    expect(cardAt(wrapper, 0).get('img').attributes('src')).toBe(GENJUTSU.coverUrl)
    expect(wrapper.get('[data-testid="home-see-all-apps"]').text()).toBe('See all apps')
    expect(listHomeWorkflows).not.toHaveBeenCalled()
    expect(getAppsEnabled).toHaveBeenCalledOnce()
  })

  it('follows the website when the list of apps changes', async () => {
    listApps.mockResolvedValue([CUTOUT, HDR])
    const wrapper = await openHome()

    expect(arc(wrapper)).toEqual(['0:Remove Background', '1:SDR to HDR'])
  })

  it('opens the app in front inside Desktop, not on Comfy Hub', async () => {
    const wrapper = await openHome()

    await cardAt(wrapper, 0).trigger('click')

    expect(wrapper.emitted('open-app')).toEqual([[GENJUTSU]])
    expect(openCatalogWorkflow).not.toHaveBeenCalled()
  })

  it('brings an app at the side to the front first, and opens it on the next click', async () => {
    const wrapper = await openHome()

    await cardAt(wrapper, 1).trigger('click')

    expect(cardAt(wrapper, 0).text()).toContain('Product Ads')
    expect(wrapper.emitted('open-app')).toBeUndefined()

    await cardAt(wrapper, 0).trigger('click')

    expect(wrapper.emitted('open-app')).toEqual([[PRODUCT_ADS]])
  })

  it('names the cards and arrows as apps for screen readers', async () => {
    const wrapper = await openHome()

    expect(wrapper.get('section').attributes('aria-label')).toBe('Apps')
    expect(cardAt(wrapper, 0).attributes('aria-label')).toBe('Open Genjutsu')
    expect(cardAt(wrapper, 1).attributes('aria-label')).toBe('Show Product Ads')
    expect(wrapper.get('[data-testid="home-carousel-next"]').attributes('aria-label')).toBe(
      'Next app'
    )
    expect(wrapper.get('[data-testid="home-carousel-previous"]').attributes('aria-label')).toBe(
      'Previous app'
    )
  })

  it('shows placeholders until the apps have loaded', async () => {
    let publish: (apps: AppCard[]) => void = () => {}
    listApps.mockReturnValue(new Promise((resolve) => (publish = resolve)))
    const wrapper = await openHome()

    expect(wrapper.get('[data-testid="home-carousel-loading"]').attributes('aria-busy')).toBe(
      'true'
    )
    expect(wrapper.find('[data-testid="home-carousel-card"]').exists()).toBe(false)

    publish([CUTOUT])
    await flushPromises()

    expect(wrapper.find('[data-testid="home-carousel-loading"]').exists()).toBe(false)
    expect(arc(wrapper)).toEqual(['0:Remove Background'])
  })

  it('says the apps did not load, and shows them after Try again', async () => {
    listApps.mockRejectedValueOnce(new Error('offline'))
    const wrapper = await openHome()

    const failed = wrapper.get('[data-testid="home-apps-failed"]')
    expect(failed.text()).toContain("Apps couldn't be loaded")
    expect(wrapper.find('[data-testid="home-carousel-card"]').exists()).toBe(false)
    expect(listHomeWorkflows).not.toHaveBeenCalled()

    await failed.get('button').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="home-apps-failed"]').exists()).toBe(false)
    expect(cardAt(wrapper, 0).text()).toContain('Genjutsu')
    expect(wrapper.find('[data-testid="home-see-all-apps"]').exists()).toBe(true)
  })

  it('says there are no apps yet when the website lists none', async () => {
    listApps.mockResolvedValue([])
    const wrapper = await openHome()

    expect(wrapper.get('[data-testid="home-apps-empty"]').text()).toContain('No apps yet')
    expect(wrapper.find('[data-testid="home-carousel-card"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="home-apps-failed"]').exists()).toBe(false)
  })
})

describe('Home while Apps is turned off', () => {
  it('shows example workflows that open on Comfy Hub, as it did before Apps', async () => {
    getAppsEnabled.mockResolvedValue(false)
    const wrapper = await openHome()

    expect(arc(wrapper)).toEqual(['0:Upscale and restore detail'])
    expect(wrapper.get('section').attributes('aria-label')).toBe('Example workflows')
    expect(listApps).not.toHaveBeenCalled()

    await cardAt(wrapper, 0).trigger('click')

    expect(openCatalogWorkflow).toHaveBeenCalledExactlyOnceWith('upscale')
    expect(wrapper.emitted('open-app')).toBeUndefined()
  })

  it('shows example workflows when Desktop cannot tell whether Apps is on', async () => {
    getAppsEnabled.mockRejectedValue(new Error('no answer'))
    const wrapper = await openHome()

    expect(arc(wrapper)).toEqual(['0:Upscale and restore detail'])
    expect(wrapper.find('[data-testid="home-see-all-apps"]').exists()).toBe(false)
    expect(listApps).not.toHaveBeenCalled()
  })
})
