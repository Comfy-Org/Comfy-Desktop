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

type Scope = Pick<VueWrapper, 'findAll' | 'get'>

function appsOf(wrapper: VueWrapper) {
  return wrapper.get('[data-testid="home-apps"]')
}

function workflowsOf(wrapper: VueWrapper) {
  return wrapper.get('[data-testid="home-workflows"]')
}

function arc(scope: Scope): string[] {
  return scope
    .findAll('[data-testid="home-carousel-card"]:not([aria-hidden="true"])')
    .map((card) => ({
      offset: Number(card.attributes('data-arc-offset')),
      text: card.get('[data-testid="home-carousel-name"]').text()
    }))
    .sort((left, right) => left.offset - right.offset)
    .map((card) => `${card.offset}:${card.text}`)
}

function cardAt(scope: Scope, offset: number) {
  return scope.get(`[data-testid="home-carousel-card"][data-arc-offset="${offset}"]`)
}

describe('Home apps', () => {
  it("shows the apps the Apps page lists, in the website's order, starting with the first", async () => {
    const wrapper = await openHome()

    expect(arc(appsOf(wrapper))).toEqual([
      '-2:Remove Background',
      '-1:Extend the Picture',
      '0:GenjutsuPut someone else in a short clip.',
      '1:Product Ads',
      '2:SDR to HDR'
    ])
    expect(cardAt(appsOf(wrapper), 0).get('img').attributes('src')).toBe(GENJUTSU.covers[0]!.url)
    expect(wrapper.get('[data-testid="home-see-all-apps"]').text()).toBe('See all apps')
    expect(listApps).toHaveBeenCalledOnce()
  })

  it('plays the covers of each app, the next loading behind the one shown once it has loaded', async () => {
    const covers = ['red', 'green', 'blue'].map((fill) => ({ url: picture(fill), stillUrl: null }))
    listApps.mockResolvedValue([{ ...GENJUTSU, covers }, PRODUCT_ADS])
    const wrapper = await openHome()
    const front = cardAt(appsOf(wrapper), 0)
    const urls = covers.map((cover) => cover.url)

    expect(urls).toContain(front.get('img[data-cover="shown"]').attributes('src'))
    await expect.poll(() => front.find('img[data-cover="upcoming"]').exists()).toBe(true)
    expect(urls).toContain(front.get('img[data-cover="upcoming"]').attributes('src'))
  })

  it('follows the website when the list of apps changes', async () => {
    listApps.mockResolvedValue([CUTOUT, HDR])
    const wrapper = await openHome()

    expect(arc(appsOf(wrapper))).toEqual(['0:Remove Background', '1:SDR to HDR'])
  })

  it('opens the app in front inside Desktop', async () => {
    const wrapper = await openHome()

    await cardAt(appsOf(wrapper), 0).trigger('click')

    expect(wrapper.emitted('open-app')).toEqual([[GENJUTSU]])
    expect(wrapper.emitted('open-workflow')).toBeUndefined()
  })

  it('brings an app at the side to the front first, and opens it on the next click', async () => {
    const wrapper = await openHome()

    await cardAt(appsOf(wrapper), 1).trigger('click')

    expect(cardAt(appsOf(wrapper), 0).text()).toContain('Product Ads')
    expect(wrapper.emitted('open-app')).toBeUndefined()

    await cardAt(appsOf(wrapper), 0).trigger('click')

    expect(wrapper.emitted('open-app')).toEqual([[PRODUCT_ADS]])
  })

  it("draws an app's badges in the carousel and none on an app without badges", async () => {
    const wrapper = await openHome()

    expect(cardAt(appsOf(wrapper), 0).find('[data-testid="app-badge-uses-credits"]').exists()).toBe(
      true
    )
    expect(cardAt(appsOf(wrapper), 2).find('[data-testid="app-badges"]').exists()).toBe(false)
  })

  it('names the cards and arrows as apps for screen readers', async () => {
    const wrapper = await openHome()

    expect(appsOf(wrapper).attributes('aria-labelledby')).toBe('home-apps')
    expect(appsOf(wrapper).get('h2').text()).toBe('Apps')
    expect(cardAt(appsOf(wrapper), 0).attributes('aria-label')).toBe('Open Genjutsu')
    expect(cardAt(appsOf(wrapper), 1).attributes('aria-label')).toBe('Show Product Ads')
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

    expect(wrapper.get('[data-testid="home-apps-loading"]').attributes('aria-busy')).toBe('true')
    expect(appsOf(wrapper).find('[data-testid="home-carousel-card"]').exists()).toBe(false)

    publish([CUTOUT])
    await flushPromises()

    expect(wrapper.find('[data-testid="home-apps-loading"]').exists()).toBe(false)
    expect(arc(appsOf(wrapper))).toEqual(['0:Remove Background'])
  })

  it('says the apps did not load, and shows them after Try again', async () => {
    listApps.mockRejectedValueOnce(new Error('offline'))
    const wrapper = await openHome()

    const failed = wrapper.get('[data-testid="home-apps-failed"]')
    expect(failed.text()).toContain("Apps couldn't be loaded")
    expect(appsOf(wrapper).find('[data-testid="home-carousel-card"]').exists()).toBe(false)

    await failed.get('button').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="home-apps-failed"]').exists()).toBe(false)
    expect(cardAt(appsOf(wrapper), 0).text()).toContain('Genjutsu')
    expect(wrapper.find('[data-testid="home-see-all-apps"]').exists()).toBe(true)
  })

  it('says there are no apps yet when the website lists none', async () => {
    listApps.mockResolvedValue([])
    const wrapper = await openHome()

    expect(wrapper.get('[data-testid="home-apps-empty"]').text()).toContain('No apps yet')
    expect(appsOf(wrapper).find('[data-testid="home-carousel-card"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="home-apps-failed"]').exists()).toBe(false)
  })

  it('shows a Workflows section above an Apps section, each loaded on open', async () => {
    const wrapper = await openHome()

    const sections = wrapper.findAll('section[aria-labelledby]').slice(0, 2)
    expect(sections.map((section) => section.attributes('data-testid'))).toEqual([
      'home-workflows',
      'home-apps'
    ])
    expect(sections.map((section) => section.get('h2').text())).toEqual(['Workflows', 'Apps'])
    expect(wrapper.find('[role="group"][aria-label="Browse featured content"]').exists()).toBe(
      false
    )
    expect(listHomeWorkflows).toHaveBeenCalledOnce()
    expect(listApps).toHaveBeenCalledOnce()
    expect(arc(workflowsOf(wrapper))).toEqual(['0:Upscale and restore detail'])
    expect(cardAt(appsOf(wrapper), 0).text()).toContain('Genjutsu')
    expect(workflowsOf(wrapper).get('[data-testid="home-see-all-workflows"]').text()).toBe(
      'See all workflows'
    )
    expect(appsOf(wrapper).get('[data-testid="home-see-all-apps"]').text()).toBe('See all apps')
  })

  it('opens the full lists from each section, and a workflow from its card', async () => {
    const wrapper = await openHome()

    await wrapper.get('[data-testid="home-see-all-workflows"]').trigger('click')
    await wrapper.get('[data-testid="home-see-all-apps"]').trigger('click')
    await cardAt(workflowsOf(wrapper), 0).trigger('click')

    expect(wrapper.emitted('show-workflows')).toEqual([[]])
    expect(wrapper.emitted('show-apps')).toEqual([[]])
    expect(wrapper.emitted('open-workflow')).toEqual([[UPSCALE_WORKFLOW]])
    expect(wrapper.emitted('open-app')).toBeUndefined()
  })
})

describe('Home workflows', () => {
  it('shows placeholders while the catalog is loading', async () => {
    listHomeWorkflows.mockReturnValue(new Promise(() => {}))
    const wrapper = await openHome()

    expect(wrapper.get('[data-testid="home-workflows-loading"]').attributes('aria-busy')).toBe(
      'true'
    )
    expect(workflowsOf(wrapper).find('[data-testid="home-carousel-card"]').exists()).toBe(false)
    expect(cardAt(appsOf(wrapper), 0).text()).toContain('Genjutsu')
  })

  it('says the workflows could not be loaded and loads them when asked to try again', async () => {
    listHomeWorkflows.mockRejectedValueOnce(new Error('offline'))
    const wrapper = await openHome()

    const unavailable = wrapper.get('[data-testid="home-workflows-unavailable"]')
    expect(unavailable.text()).toContain("Example workflows couldn't be loaded")

    listHomeWorkflows.mockResolvedValue([UPSCALE_WORKFLOW])
    await unavailable.get('button').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="home-workflows-unavailable"]').exists()).toBe(false)
    expect(arc(workflowsOf(wrapper))).toEqual(['0:Upscale and restore detail'])
  })
})
