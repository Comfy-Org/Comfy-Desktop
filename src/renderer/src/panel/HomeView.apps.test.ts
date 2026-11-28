import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import HomeView from './HomeView.vue'
import type { AppCard, AppCover, CatalogWorkflow } from '../types/ipc'

const listApps = vi.fn<() => Promise<AppCard[]>>()
const listHomeWorkflows = vi.fn<() => Promise<CatalogWorkflow[]>>()

function app(id: string, title: string, covers: AppCover[] = []): AppCard {
  return { id, title, description: '', covers }
}

function picture(fill: string): string {
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="5"><rect width="8" height="5" fill="${fill}"/></svg>`
  )}`
}

const GENJUTSU: AppCard = {
  id: 'genjutsu',
  title: 'Genjutsu',
  description: 'Put someone else in a short clip.',
  covers: [{ url: picture('purple'), stillUrl: null }],
  badges: [
    {
      id: 'uses-credits',
      style: 'crown',
      text: { en: 'Uses credits' },
      description: { en: 'Runs a paid partner model' }
    }
  ]
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
  thumbnailUrl: null,
  canOpenLocal: false,
  canOpenCloud: true,
  minComfyUIVersion: null,
  hubUrl: 'https://comfy.org/hub/workflows/upscale',
  longDescription: null,
  author: null,
  generationType: null,
  useCases: [],
  models: [],
  uses: null,
  license: null,
  publishedAt: null,
  media: [],
  tutorialUrl: null
}

beforeEach(() => {
  vi.clearAllMocks()
  listApps.mockResolvedValue(PUBLISHED_APPS)
  listHomeWorkflows.mockResolvedValue([UPSCALE_WORKFLOW])
  ;(window as unknown as { api: unknown }).api = {
    listApps,
    listHomeWorkflows,
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

async function openAppsTab() {
  const wrapper = await openHome()
  await wrapper.get('[data-testid="home-apps-tab"]').trigger('click')
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

function tabs(wrapper: VueWrapper) {
  return wrapper.findAll('[role="group"][aria-label="Browse featured content"] button')
}

describe('Home carousel tabs', () => {
  it('shows one carousel under a Workflows | Apps switch, with Workflows picked', async () => {
    const wrapper = await openHome()

    expect(wrapper.findAll('[data-testid="home-carousel"]')).toHaveLength(1)
    expect(wrapper.find('[data-testid="home-workflows"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="home-apps"]').exists()).toBe(false)
    expect(tabs(wrapper).map((tab) => tab.text())).toEqual(['Workflows', 'Apps'])
    expect(tabs(wrapper).map((tab) => tab.attributes('data-testid'))).toEqual([
      'home-workflows-tab',
      'home-apps-tab'
    ])
    expect(tabs(wrapper).map((tab) => tab.attributes('aria-pressed'))).toEqual(['true', 'false'])
    expect(arc(wrapper)).toEqual(['0:Upscale and restore detail'])
    expect(wrapper.get('[data-testid="home-featured"]').attributes('aria-label')).toBe(
      'Example workflows'
    )
  })

  it('names the content under the switch after the picked tab and announces it when the tab changes', async () => {
    const wrapper = await openHome()
    const panel = () => wrapper.get('[data-testid="home-featured-panel"]')

    expect(panel().attributes('role')).toBe('region')
    expect(panel().attributes('aria-live')).toBe('polite')
    expect(panel().attributes('aria-label')).toBe('Example workflows')

    await wrapper.get('[data-testid="home-apps-tab"]').trigger('click')

    expect(panel().attributes('aria-label')).toBe('Apps')
  })

  it('loads both lists when Home opens, so switching tabs shows the apps at once', async () => {
    const wrapper = await openHome()
    expect(listHomeWorkflows).toHaveBeenCalledOnce()
    expect(listApps).toHaveBeenCalledOnce()

    await wrapper.get('[data-testid="home-apps-tab"]').trigger('click')

    expect(tabs(wrapper).map((tab) => tab.attributes('aria-pressed'))).toEqual(['false', 'true'])
    expect(wrapper.findAll('[data-testid="home-carousel"]')).toHaveLength(1)
    expect(cardAt(wrapper, 0).text()).toContain('Genjutsu')
    expect(wrapper.find('[data-testid="home-apps-loading"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="home-featured"]').attributes('aria-label')).toBe('Apps')

    await wrapper.get('[data-testid="home-workflows-tab"]').trigger('click')

    expect(arc(wrapper)).toEqual(['0:Upscale and restore detail'])
    expect(listHomeWorkflows).toHaveBeenCalledOnce()
    expect(listApps).toHaveBeenCalledOnce()
  })

  it('puts one See all link under the carousel that follows the picked tab', async () => {
    const wrapper = await openHome()
    const seeAll = () => wrapper.findAll('[data-testid^="home-see-all-"]')

    expect(seeAll().map((link) => link.text())).toEqual(['See all workflows'])
    await seeAll()[0]!.trigger('click')
    expect(wrapper.emitted('show-workflows')).toEqual([[]])

    await wrapper.get('[data-testid="home-apps-tab"]').trigger('click')

    expect(seeAll().map((link) => link.text())).toEqual(['See all apps'])
    expect(seeAll()[0]!.attributes('data-testid')).toBe('home-see-all-apps')
    await seeAll()[0]!.trigger('click')
    expect(wrapper.emitted('show-apps')).toEqual([[]])
    expect(wrapper.emitted('show-workflows')).toEqual([[]])
  })

  it('opens a workflow from its card on the Workflows tab', async () => {
    const wrapper = await openHome()

    await cardAt(wrapper, 0).trigger('click')

    expect(wrapper.emitted('open-workflow')).toEqual([[UPSCALE_WORKFLOW]])
    expect(wrapper.emitted('open-app')).toBeUndefined()
  })

  it('marks the one carousel for the Home tour on either tab', async () => {
    const wrapper = await openHome()
    const anchor = () => wrapper.findAll('[data-home-tour="apps-carousel"]')

    expect(anchor()).toHaveLength(1)
    expect(anchor()[0]!.find('[data-testid="home-carousel"]').exists()).toBe(true)

    await wrapper.get('[data-testid="home-apps-tab"]').trigger('click')

    expect(anchor()).toHaveLength(1)
    expect(anchor()[0]!.find('[data-testid="home-carousel"]').exists()).toBe(true)
  })
})

describe('Home on the Apps tab', () => {
  it("shows the apps the Apps page lists, in the website's order, starting with the first", async () => {
    const wrapper = await openAppsTab()

    expect(arc(wrapper)).toEqual([
      '-2:Remove Background',
      '-1:Extend the Picture',
      '0:GenjutsuPut someone else in a short clip.',
      '1:Product Ads',
      '2:SDR to HDR'
    ])
    expect(cardAt(wrapper, 0).get('img').attributes('src')).toBe(GENJUTSU.covers[0]!.url)
    expect(wrapper.get('[data-testid="home-see-all-apps"]').text()).toBe('See all apps')
    expect(listApps).toHaveBeenCalledOnce()
  })

  it('plays the covers of each app, the next loading behind the one shown once it has loaded', async () => {
    const covers = ['red', 'green', 'blue'].map((fill) => ({ url: picture(fill), stillUrl: null }))
    listApps.mockResolvedValue([{ ...GENJUTSU, covers }, PRODUCT_ADS])
    const wrapper = await openAppsTab()
    const front = cardAt(wrapper, 0)
    const urls = covers.map((cover) => cover.url)

    expect(urls).toContain(front.get('img[data-cover="shown"]').attributes('src'))
    await expect.poll(() => front.find('img[data-cover="upcoming"]').exists()).toBe(true)
    expect(urls).toContain(front.get('img[data-cover="upcoming"]').attributes('src'))
  })

  it('follows the website when the list of apps changes', async () => {
    listApps.mockResolvedValue([CUTOUT, HDR])
    const wrapper = await openAppsTab()

    expect(arc(wrapper)).toEqual(['0:Remove Background', '1:SDR to HDR'])
  })

  it('opens the app in front inside Desktop', async () => {
    const wrapper = await openAppsTab()

    await cardAt(wrapper, 0).trigger('click')

    expect(wrapper.emitted('open-app')).toEqual([[GENJUTSU]])
    expect(wrapper.emitted('open-workflow')).toBeUndefined()
  })

  it('brings an app at the side to the front first, and opens it on the next click', async () => {
    const wrapper = await openAppsTab()

    await cardAt(wrapper, 1).trigger('click')

    expect(cardAt(wrapper, 0).text()).toContain('Product Ads')
    expect(wrapper.emitted('open-app')).toBeUndefined()

    await cardAt(wrapper, 0).trigger('click')

    expect(wrapper.emitted('open-app')).toEqual([[PRODUCT_ADS]])
  })

  it("draws an app's badges in the carousel and none on an app without badges", async () => {
    const wrapper = await openAppsTab()

    expect(cardAt(wrapper, 0).find('[data-testid="app-badge-uses-credits"]').exists()).toBe(true)
    expect(cardAt(wrapper, 2).find('[data-testid="app-badges"]').exists()).toBe(false)
  })

  it('names the cards and arrows as apps for screen readers', async () => {
    const wrapper = await openAppsTab()

    expect(wrapper.get('[data-testid="home-featured"]').attributes('aria-label')).toBe('Apps')
    expect(cardAt(wrapper, 0).attributes('aria-label')).toBe('Open Genjutsu')
    expect(cardAt(wrapper, 1).attributes('aria-label')).toBe('Show Product Ads')
    expect(wrapper.get('[data-testid="home-carousel-next"]').attributes('aria-label')).toBe(
      'Next app'
    )
    expect(wrapper.get('[data-testid="home-carousel-previous"]').attributes('aria-label')).toBe(
      'Previous app'
    )
  })

  it('shows placeholders until the apps have loaded, while the Workflows tab already shows its cards', async () => {
    let publish: (apps: AppCard[]) => void = () => {}
    listApps.mockReturnValue(new Promise((resolve) => (publish = resolve)))
    const wrapper = await openHome()

    expect(arc(wrapper)).toEqual(['0:Upscale and restore detail'])
    expect(wrapper.find('[data-testid="home-apps-loading"]').exists()).toBe(false)

    await wrapper.get('[data-testid="home-apps-tab"]').trigger('click')

    expect(wrapper.get('[data-testid="home-apps-loading"]').attributes('aria-busy')).toBe('true')
    expect(wrapper.find('[data-testid="home-carousel-card"]').exists()).toBe(false)

    publish([CUTOUT])
    await flushPromises()

    expect(wrapper.find('[data-testid="home-apps-loading"]').exists()).toBe(false)
    expect(arc(wrapper)).toEqual(['0:Remove Background'])
  })

  it('says the apps did not load, and shows them after Try again', async () => {
    listApps.mockRejectedValueOnce(new Error('offline'))
    const wrapper = await openHome()
    expect(wrapper.find('[data-testid="home-apps-failed"]').exists()).toBe(false)
    expect(arc(wrapper)).toEqual(['0:Upscale and restore detail'])

    await wrapper.get('[data-testid="home-apps-tab"]').trigger('click')

    const failed = wrapper.get('[data-testid="home-apps-failed"]')
    expect(failed.text()).toContain("Apps couldn't be loaded")
    expect(wrapper.find('[data-testid="home-carousel-card"]').exists()).toBe(false)

    await failed.get('button').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="home-apps-failed"]').exists()).toBe(false)
    expect(cardAt(wrapper, 0).text()).toContain('Genjutsu')
    expect(wrapper.find('[data-testid="home-see-all-apps"]').exists()).toBe(true)
  })

  it('says there are no apps yet when the website lists none', async () => {
    listApps.mockResolvedValue([])
    const wrapper = await openHome()
    expect(wrapper.find('[data-testid="home-apps-empty"]').exists()).toBe(false)

    await wrapper.get('[data-testid="home-apps-tab"]').trigger('click')

    expect(wrapper.get('[data-testid="home-apps-empty"]').text()).toContain('No apps yet')
    expect(wrapper.find('[data-testid="home-carousel-card"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="home-apps-failed"]').exists()).toBe(false)
  })
})

describe('Home on the Workflows tab', () => {
  it('shows placeholders while the catalog is loading, and the apps once Apps is picked', async () => {
    listHomeWorkflows.mockReturnValue(new Promise(() => {}))
    const wrapper = await openHome()

    expect(wrapper.get('[data-testid="home-workflows-loading"]').attributes('aria-busy')).toBe(
      'true'
    )
    expect(wrapper.find('[data-testid="home-carousel-card"]').exists()).toBe(false)

    await wrapper.get('[data-testid="home-apps-tab"]').trigger('click')

    expect(wrapper.find('[data-testid="home-workflows-loading"]').exists()).toBe(false)
    expect(cardAt(wrapper, 0).text()).toContain('Genjutsu')
  })

  it('says the workflows could not be loaded and loads them when asked to try again', async () => {
    listHomeWorkflows.mockRejectedValueOnce(new Error('offline'))
    const wrapper = await openHome()

    const unavailable = wrapper.get('[data-testid="home-workflows-unavailable"]')
    expect(unavailable.text()).toContain("Example workflows couldn't be loaded")
    expect(wrapper.get('[data-testid="home-see-all-workflows"]').text()).toBe('See all workflows')

    listHomeWorkflows.mockResolvedValue([UPSCALE_WORKFLOW])
    await unavailable.get('button').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="home-workflows-unavailable"]').exists()).toBe(false)
    expect(arc(wrapper)).toEqual(['0:Upscale and restore detail'])
  })

  it('keeps the workflows message to its own tab', async () => {
    listHomeWorkflows.mockRejectedValueOnce(new Error('offline'))
    const wrapper = await openHome()

    await wrapper.get('[data-testid="home-apps-tab"]').trigger('click')

    expect(wrapper.find('[data-testid="home-workflows-unavailable"]').exists()).toBe(false)
    expect(cardAt(wrapper, 0).text()).toContain('Genjutsu')
  })
})
