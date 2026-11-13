import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import AppsView from './AppsView.vue'
import AppsGallery from './AppsGallery.vue'
import type { AppOutputs, CatalogApp, CatalogWorkflow } from '../types/ipc'
import { useModal } from '../composables/useModal'

const showApps = vi.fn()
const hideApps = vi.fn()
const listCatalogApps = vi.fn()
const listHomeWorkflows = vi.fn()
const openCatalogWorkflow = vi.fn()
const getAppsEnabled = vi.fn()
let pushAppsSwitch: ((info: { enabled: boolean }) => void) | null = null
let appsLoadFailed: ((info: { url: string }) => void) | null = null
let appsAppOpen: ((info: { open: boolean }) => void) | null = null
let appsSettled: (() => void) | null = null
let appsOutput: ((outputs: AppOutputs) => void) | null = null
const appsOutputAction = vi.fn()

async function mountApps(
  props: {
    growBy?: number
    obscured?: boolean
    initialTab?: 'apps' | 'templates'
    launchApp?: CatalogApp | null
  } = {}
) {
  const wrapper = mount(AppsView, {
    props,
    global: { stubs: { teleport: { template: '<div><slot /></div>' } } }
  })
  await flushPromises()
  return wrapper
}

const animate = vi.spyOn(Element.prototype, 'animate')

function entrance(): Animation {
  return animate.mock.results.at(-1)!.value as Animation
}

function catalogApp(id: string, title: string): CatalogApp {
  return {
    id,
    title,
    description: `${title} description`,
    thumbnailUrl: `https://comfy.org/catalog-media/${id}/v1`,
    category: null,
    url: `https://apps.example/apps/${id}/desktop.html`
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  listCatalogApps.mockResolvedValue([])
  listHomeWorkflows.mockResolvedValue([])
  openCatalogWorkflow.mockResolvedValue(true)
  getAppsEnabled.mockResolvedValue(true)
  ;(window as unknown as { api: unknown }).api = {
    showApps,
    hideApps,
    listCatalogApps,
    listHomeWorkflows,
    openCatalogWorkflow,
    getAppsEnabled,
    onAppsEnabledChanged: vi.fn((callback: (info: { enabled: boolean }) => void) => {
      pushAppsSwitch = callback
      return () => (pushAppsSwitch = null)
    }),
    onAppsLoadFailed: vi.fn((callback: (info: { url: string }) => void) => {
      appsLoadFailed = callback
      return () => (appsLoadFailed = null)
    }),
    onAppsAppOpen: vi.fn((callback: (info: { open: boolean }) => void) => {
      appsAppOpen = callback
      return () => (appsAppOpen = null)
    }),
    onAppsSettled: vi.fn((callback: () => void) => {
      appsSettled = callback
      return () => (appsSettled = null)
    }),
    onAppsOutput: vi.fn((callback: (outputs: AppOutputs) => void) => {
      appsOutput = callback
      return () => (appsOutput = null)
    }),
    appsOutputAction
  }
})

describe('AppsView', () => {
  it('shows the app cards from the catalog', async () => {
    listCatalogApps.mockResolvedValue([
      catalogApp('studio', 'Cinematic Studio'),
      catalogApp('reshoot', 'Re-shoot a video')
    ])
    const wrapper = await mountApps()

    const cards = wrapper.findAll('[data-testid^="app-card-"]')
    expect(cards.map((card) => card.find('span span').text())).toEqual([
      'Cinematic Studio',
      'Re-shoot a video'
    ])
    expect(cards[0]!.text()).toContain('Cinematic Studio description')
    expect(cards[0]!.get('img').attributes('src')).toBe('https://comfy.org/catalog-media/studio/v1')
    expect(showApps).not.toHaveBeenCalled()
  })

  it('opens an app from its card over the whole page and returns to the cards when the app goes back', async () => {
    listCatalogApps.mockResolvedValue([catalogApp('studio', 'Cinematic Studio')])
    const wrapper = await mountApps()

    await wrapper.get('[data-testid="app-card-studio"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="apps-host"]').exists()).toBe(true)
    expect(showApps).toHaveBeenCalledWith(
      expect.objectContaining({
        fresh: true,
        url: 'https://apps.example/apps/studio/desktop.html'
      })
    )
    await vi.waitFor(() => expect(wrapper.emitted('app-entered')).toEqual([[true]]))
    expect(wrapper.find('h1').exists()).toBe(false)

    appsAppOpen!({ open: true })
    await flushPromises()
    expect(wrapper.find('[data-testid="apps-host"]').exists()).toBe(true)

    appsAppOpen!({ open: false })
    await flushPromises()
    expect(wrapper.find('[data-testid="apps-host"]').exists()).toBe(false)
    expect(hideApps).toHaveBeenCalled()
    expect(wrapper.find('h1').exists()).toBe(true)
    expect(wrapper.find('[data-testid="app-card-studio"]').exists()).toBe(true)
    expect(listCatalogApps).toHaveBeenCalledOnce()
  })

  it("shows an app's outputs in the output dialog over a still of the app and hands the actions back to it", async () => {
    listCatalogApps.mockResolvedValue([catalogApp('studio', 'Cinematic Studio')])
    const wrapper = await mountApps()
    await wrapper.get('[data-testid="app-card-studio"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.emitted('app-entered')).toEqual([[true]]))
    showApps.mockClear()
    hideApps.mockClear()

    appsOutput!({
      items: [
        {
          name: 'picture-1.png',
          mimeType: 'image/png',
          bytes: new Uint8Array([1, 2, 3]),
          tags: ['This computer'],
          workflow: true
        },
        {
          name: 'picture-2.png',
          mimeType: 'image/png',
          bytes: new Uint8Array([4]),
          tags: [],
          workflow: false
        }
      ],
      index: 1,
      backdrop: new Uint8Array([9])
    })
    await flushPromises()

    expect(hideApps).toHaveBeenCalled()
    expect(wrapper.find('[data-testid="apps-host-backdrop"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="output-detail-panel"] h2').text()).toBe('picture-2.png')

    await wrapper.get('[data-testid="output-detail-download"]').trigger('click')
    expect(appsOutputAction).toHaveBeenLastCalledWith({ action: 'download', index: 1 })

    await wrapper.get('[data-testid="output-detail-thumb-0"]').trigger('click')
    expect(wrapper.get('[data-testid="output-detail-panel"]').text()).toContain('This computer')
    await wrapper.get('[data-testid="output-detail-workflow"]').trigger('click')
    await flushPromises()

    expect(appsOutputAction).toHaveBeenLastCalledWith({ action: 'open-workflow', index: 0 })
    expect(wrapper.find('[data-testid="output-detail-panel"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="apps-host-backdrop"]').exists()).toBe(false)
    expect(showApps).toHaveBeenCalled()
  })

  it("closes an app's output dialog when the app goes back", async () => {
    listCatalogApps.mockResolvedValue([catalogApp('studio', 'Cinematic Studio')])
    const wrapper = await mountApps()
    await wrapper.get('[data-testid="app-card-studio"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.emitted('app-entered')).toEqual([[true]]))
    appsOutput!({
      items: [
        {
          name: 'picture-1.png',
          mimeType: 'image/png',
          bytes: new Uint8Array([1]),
          tags: [],
          workflow: false
        }
      ],
      index: 0,
      backdrop: null
    })
    await flushPromises()
    expect(wrapper.find('[data-testid="output-detail-panel"]').exists()).toBe(true)

    appsAppOpen!({ open: false })
    await flushPromises()

    expect(wrapper.find('[data-testid="output-detail-panel"]').exists()).toBe(false)
  })

  it('opens a second app picked while the first one is still entering', async () => {
    listCatalogApps.mockResolvedValue([
      catalogApp('studio', 'Cinematic Studio'),
      catalogApp('reshoot', 'Re-shoot a video')
    ])
    const wrapper = await mountApps()

    await wrapper.get('[data-testid="app-card-studio"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="app-card-reshoot"]').trigger('click')
    await flushPromises()

    expect(showApps).toHaveBeenCalledWith(
      expect.objectContaining({
        fresh: true,
        url: 'https://apps.example/apps/reshoot/desktop.html'
      })
    )
  })

  it('fades in a skeleton of the app page and keeps the app parked behind it until its page settles', async () => {
    listCatalogApps.mockResolvedValue([catalogApp('studio', 'Cinematic Studio')])
    const wrapper = await mountApps({ growBy: 172 })

    await wrapper.get('[data-testid="app-card-studio"]').trigger('click')
    await flushPromises()

    const slot = wrapper.get('[data-testid="apps-host"]').element.getBoundingClientRect()
    const first = showApps.mock.calls[0]![0]
    expect(first).toMatchObject({ fresh: true, parked: true })
    expect(Math.round(first.x)).toBe(Math.round(slot.x))
    expect(Math.round(first.width)).toBe(Math.round(slot.width + 172))
    const surface = wrapper.get('[data-testid="apps-host-surface"]')
    expect(surface.find('[data-testid="app-page-skeleton"]').exists()).toBe(true)
    expect(animate.mock.calls.at(-1)).toEqual([
      [
        { transform: 'translateX(48px)', opacity: 0 },
        { transform: 'none', opacity: 1 }
      ],
      expect.objectContaining({ duration: 220 })
    ])
    expect(wrapper.emitted('app-entered')).toEqual([[true]])
    expect(wrapper.find('h1').exists()).toBe(false)
    expect(
      wrapper.get('[data-testid="app-card-studio"]').element.closest('[style*="display: none"]')
    ).not.toBeNull()

    await entrance().finished
    await flushPromises()
    expect(showApps.mock.calls.every(([rect]) => rect.parked)).toBe(true)
    expect(wrapper.find('[data-testid="app-page-skeleton"]').exists()).toBe(true)

    appsSettled!()
    await flushPromises()
    const last = showApps.mock.calls.at(-1)![0]
    expect(last.parked).toBe(false)
    expect(Math.round(last.x)).toBe(Math.round(slot.x))
    await vi.waitFor(() =>
      expect(wrapper.find('[data-testid="app-page-skeleton"]').exists()).toBe(false)
    )
  })

  it('starts loading the app at open and reveals it as soon as the entrance ends when the page settled first', async () => {
    listCatalogApps.mockResolvedValue([catalogApp('studio', 'Cinematic Studio')])
    const wrapper = await mountApps()

    await wrapper.get('[data-testid="app-card-studio"]').trigger('click')
    entrance().pause()
    await flushPromises()
    expect(showApps.mock.calls[0]![0]).toMatchObject({ fresh: true, parked: true })

    appsSettled!()
    await flushPromises()
    expect(showApps.mock.calls.every(([rect]) => rect.parked)).toBe(true)

    entrance().play()
    await entrance().finished
    await flushPromises()
    expect(showApps.mock.calls.at(-1)![0].parked).toBe(false)
  })

  it('shows the app anyway when its page never says it settled', async () => {
    listCatalogApps.mockResolvedValue([catalogApp('studio', 'Cinematic Studio')])
    const matchMedia = vi
      .spyOn(window, 'matchMedia')
      .mockImplementation((query) => ({ matches: query.includes('reduce') }) as MediaQueryList)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const wrapper = await mountApps()
      await wrapper.get('[data-testid="app-card-studio"]').trigger('click')
      await flushPromises()
      expect(showApps.mock.calls.at(-1)![0].parked).toBe(true)
      expect(wrapper.find('[data-testid="app-page-skeleton"]').exists()).toBe(true)
      await entrance().finished

      await vi.advanceTimersByTimeAsync(3999)
      expect(showApps.mock.calls.at(-1)![0].parked).toBe(true)
      expect(wrapper.find('[data-testid="app-page-skeleton"]').exists()).toBe(true)

      await vi.advanceTimersByTimeAsync(1)
      expect(showApps.mock.calls.at(-1)![0].parked).toBe(false)

      await vi.advanceTimersByTimeAsync(250)
      expect(wrapper.find('[data-testid="app-page-skeleton"]').exists()).toBe(false)
    } finally {
      vi.useRealTimers()
      matchMedia.mockRestore()
    }
  })

  it('shows a settled app after the reveal limit even when its entrance never finishes', async () => {
    listCatalogApps.mockResolvedValue([catalogApp('studio', 'Cinematic Studio')])
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const wrapper = await mountApps()
      await wrapper.get('[data-testid="app-card-studio"]').trigger('click')
      entrance().pause()
      await flushPromises()
      appsSettled!()
      await flushPromises()

      await vi.advanceTimersByTimeAsync(3999)
      expect(showApps.mock.calls.at(-1)![0].parked).toBe(true)

      await vi.advanceTimersByTimeAsync(1)
      expect(showApps.mock.calls.at(-1)![0].parked).toBe(false)

      await vi.advanceTimersByTimeAsync(250)
      expect(wrapper.find('[data-testid="app-page-skeleton"]').exists()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('eases the entrance with ease-out when the theme curve is not a valid easing', async () => {
    listCatalogApps.mockResolvedValue([catalogApp('studio', 'Cinematic Studio')])
    document.documentElement.style.setProperty('--ease-out-expo', 'not-a-curve')
    try {
      const wrapper = await mountApps()
      await wrapper.get('[data-testid="app-card-studio"]').trigger('click')
      await flushPromises()

      expect(animate.mock.calls.at(-1)![1]).toMatchObject({ easing: 'ease-out' })
      appsSettled!()
      await entrance().finished
      await flushPromises()
      expect(showApps.mock.calls.at(-1)![0].parked).toBe(false)
    } finally {
      document.documentElement.style.removeProperty('--ease-out-expo')
    }
  })

  it('fades an app in without moving it when motion is reduced', async () => {
    listCatalogApps.mockResolvedValue([catalogApp('studio', 'Cinematic Studio')])
    const matchMedia = vi
      .spyOn(window, 'matchMedia')
      .mockImplementation((query) => ({ matches: query.includes('reduce') }) as MediaQueryList)
    try {
      const wrapper = await mountApps()
      await wrapper.get('[data-testid="app-card-studio"]').trigger('click')
      await flushPromises()

      expect(wrapper.emitted('app-entered')).toEqual([[true]])
      expect(wrapper.find('[data-testid="app-page-skeleton"]').exists()).toBe(true)
      expect(animate.mock.calls.at(-1)![0]).toEqual([{ opacity: 0 }, { opacity: 1 }])

      appsSettled!()
      await entrance().finished
      await flushPromises()
      expect(showApps.mock.calls.at(-1)![0].parked).toBe(false)
    } finally {
      matchMedia.mockRestore()
    }
  })

  it('shows the address when an app cannot load, and opens it again from its card', async () => {
    listCatalogApps.mockResolvedValue([catalogApp('studio', 'Cinematic Studio')])
    const wrapper = await mountApps()
    await wrapper.get('[data-testid="app-card-studio"]').trigger('click')
    await flushPromises()

    appsLoadFailed!({ url: 'https://apps.example/apps/studio/desktop.html' })
    await flushPromises()

    expect(wrapper.find('[data-testid="apps-host"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="apps-load-failed"]').text()).toContain(
      'https://apps.example/apps/studio/desktop.html'
    )

    await wrapper.get('[data-testid="app-card-studio"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="apps-host"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="apps-load-failed"]').exists()).toBe(false)
  })

  it('shows Coming soon for an empty catalog and says so when it cannot be reached', async () => {
    const empty = await mountApps()
    expect(empty.get('[data-testid="apps-coming-soon"]').text()).toBe('Coming soon')
    empty.unmount()

    listCatalogApps.mockRejectedValue(new Error('offline'))
    const offline = await mountApps()
    expect(offline.get('[data-testid="apps-catalog-failed"]').text()).toBe(
      "Couldn't load the apps."
    )
    expect(offline.find('[data-testid="apps-coming-soon"]').exists()).toBe(false)
  })

  it('tells the page owner the app closed when the page goes away with an app open', async () => {
    listCatalogApps.mockResolvedValue([catalogApp('studio', 'Cinematic Studio')])
    const wrapper = await mountApps()
    await wrapper.get('[data-testid="app-card-studio"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.emitted('app-entered')).toEqual([[true]]))

    wrapper.unmount()

    expect(wrapper.emitted('app-open')!.at(-1)).toEqual([false])
    expect(wrapper.emitted('app-entered')!.at(-1)).toEqual([false])
  })

  it('shows where an app saved each output and offers the way to it', async () => {
    listCatalogApps.mockResolvedValue([catalogApp('studio', 'Cinematic Studio')])
    const wrapper = await mountApps()
    await wrapper.get('[data-testid="app-card-studio"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.emitted('app-entered')).toEqual([[true]]))

    appsOutput!({
      items: [
        {
          name: 'cutout.png',
          mimeType: 'image/png',
          bytes: new Uint8Array([1]),
          tags: [],
          workflow: false,
          savedOn: 'computer',
          folder: '/Users/me/ComfyUI-Shared/output/apps/remove-background'
        },
        {
          name: 'cloud-cutout.png',
          mimeType: 'image/png',
          bytes: new Uint8Array([2]),
          tags: [],
          workflow: false,
          savedOn: 'cloud'
        }
      ],
      index: 0,
      backdrop: null
    })
    await flushPromises()

    expect(wrapper.get('[data-testid="output-detail-saved-in"]').text()).toContain(
      'remove-background'
    )
    expect(wrapper.find('[data-testid="output-detail-view-in-assets"]').exists()).toBe(false)
    await wrapper.get('[data-testid="output-detail-show-in-folder"]').trigger('click')
    expect(appsOutputAction).toHaveBeenLastCalledWith({ action: 'show-in-folder', index: 0 })

    await wrapper.get('[data-testid="output-detail-thumb-1"]').trigger('click')
    expect(wrapper.get('[data-testid="output-detail-saved-in"]').text()).toContain(
      'Comfy Cloud assets'
    )
    expect(wrapper.find('[data-testid="output-detail-show-in-folder"]').exists()).toBe(false)
    await wrapper.get('[data-testid="output-detail-view-in-assets"]').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('view-in-assets')).toEqual([['cloud-cutout.png']])
    expect(wrapper.find('[data-testid="output-detail-panel"]').exists()).toBe(false)
  })

  it('hides an open app under a takeover and shows it again after', async () => {
    listCatalogApps.mockResolvedValue([catalogApp('studio', 'Cinematic Studio')])
    const wrapper = await mountApps()
    await wrapper.get('[data-testid="app-card-studio"]').trigger('click')
    await flushPromises()
    showApps.mockClear()

    await wrapper.setProps({ obscured: true })
    expect(hideApps).toHaveBeenCalledTimes(1)

    await wrapper.setProps({ obscured: false })
    expect(showApps).toHaveBeenCalledWith(expect.objectContaining({ fresh: false }))
  })

  it('hides an open app while a panel dialog is open', async () => {
    listCatalogApps.mockResolvedValue([catalogApp('studio', 'Cinematic Studio')])
    const wrapper = await mountApps()
    await wrapper.get('[data-testid="app-card-studio"]').trigger('click')
    await flushPromises()
    const modal = useModal()

    void modal.alert({ title: 'Update ready', message: 'Restart now?' })
    await flushPromises()
    expect(hideApps).toHaveBeenCalledTimes(1)

    modal.dismiss()
    await flushPromises()
    expect(showApps).toHaveBeenLastCalledWith(expect.objectContaining({ fresh: false }))
  })

  it('opens an app picked under a takeover once the takeover closes', async () => {
    listCatalogApps.mockResolvedValue([catalogApp('studio', 'Cinematic Studio')])
    const wrapper = await mountApps({ obscured: true })
    await wrapper.get('[data-testid="app-card-studio"]').trigger('click')
    await flushPromises()
    expect(showApps).not.toHaveBeenCalled()

    await wrapper.setProps({ obscured: false })
    expect(showApps).toHaveBeenCalledWith(
      expect.objectContaining({ fresh: true, url: 'https://apps.example/apps/studio/desktop.html' })
    )
  })
})

describe('Explore', () => {
  function tabs(wrapper: Awaited<ReturnType<typeof mountApps>>) {
    return wrapper.get('[data-testid="explore-tabs"]').findAll('button')
  }

  async function pickTab(wrapper: Awaited<ReturnType<typeof mountApps>>, index: number) {
    const tab = tabs(wrapper)[index]!
    await tab.trigger('mousedown')
    await tab.trigger('click')
    await flushPromises()
  }

  it('heads the page Explore with Apps and Workflows tabs, starting on Apps', async () => {
    listCatalogApps.mockResolvedValue([catalogApp('studio', 'Cinematic Studio')])
    const wrapper = await mountApps()

    expect(wrapper.get('h1').text()).toBe('Explore')
    expect(tabs(wrapper).map((tab) => tab.text())).toEqual(['Apps', 'Workflows'])
    expect(tabs(wrapper)[0]!.attributes('data-state')).toBe('on')
    expect(wrapper.getComponent(AppsGallery).attributes('style')).toBeUndefined()
    expect(wrapper.find('[data-testid="app-card-studio"]').exists()).toBe(true)
    expect(listHomeWorkflows).not.toHaveBeenCalled()
  })

  it('lists the catalog workflows on the Workflows tab and opens one on Comfy Hub', async () => {
    listCatalogApps.mockResolvedValue([catalogApp('studio', 'Cinematic Studio')])
    listHomeWorkflows.mockResolvedValue([
      {
        id: 'upscale',
        title: 'Upscale and restore detail',
        description: 'Enlarge an image.',
        thumbnailUrl: null,
        category: 'image'
      }
    ])
    const wrapper = await mountApps()

    await pickTab(wrapper, 1)

    expect(wrapper.getComponent(AppsGallery).attributes('style')).toContain('display: none')
    const card = wrapper.get('[data-testid="template-card-upscale"]')
    expect(card.text()).toContain('Upscale and restore detail')
    await card.trigger('click')
    expect(openCatalogWorkflow).toHaveBeenCalledExactlyOnceWith('upscale')
  })

  it('opens on the tab it is asked for', async () => {
    const wrapper = await mountApps({ initialTab: 'templates' })

    expect(tabs(wrapper)[1]!.attributes('data-state')).toBe('on')
    expect(wrapper.find('[data-testid="templates-empty"]').exists()).toBe(true)
    expect(listCatalogApps).not.toHaveBeenCalled()
  })

  it('says when the workflows cannot be loaded', async () => {
    listHomeWorkflows.mockRejectedValue(new Error('offline'))
    const wrapper = await mountApps({ initialTab: 'templates' })

    expect(wrapper.get('[data-testid="templates-catalog-failed"]').text()).toBe(
      "Couldn't load the workflows."
    )
  })

  it('shows only the workflows, without tabs, while the remote apps switch is off', async () => {
    getAppsEnabled.mockResolvedValue(false)
    const wrapper = await mountApps()

    expect(wrapper.get('h1').text()).toBe('Explore')
    expect(wrapper.find('[data-testid="explore-tabs"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="templates-empty"]').exists()).toBe(true)
    expect(listCatalogApps).not.toHaveBeenCalled()
  })

  it('stays on Explore and moves to the workflows when the remote apps switch turns off', async () => {
    listCatalogApps.mockResolvedValue([catalogApp('studio', 'Cinematic Studio')])
    const wrapper = await mountApps()
    await wrapper.get('[data-testid="app-card-studio"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="apps-host"]').exists()).toBe(true)

    pushAppsSwitch!({ enabled: false })
    await flushPromises()

    expect(wrapper.find('[data-testid="apps-host"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="explore-tabs"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="templates-empty"]').exists()).toBe(true)
  })

  it('opens the app it is handed as soon as it shows', async () => {
    const studio = catalogApp('studio', 'Cinematic Studio')
    listCatalogApps.mockResolvedValue([studio])
    const wrapper = await mountApps({ launchApp: studio })

    expect(wrapper.find('[data-testid="apps-host"]').exists()).toBe(true)
    expect(showApps).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://apps.example/apps/studio/desktop.html' })
    )
    expect(wrapper.emitted('app-open')).toEqual([[true]])
  })
})

describe('Explore categories', () => {
  function workflow(id: string, category: CatalogWorkflow['category']): CatalogWorkflow {
    return { id, title: id, description: '', thumbnailUrl: null, category }
  }

  function cardIds(wrapper: Awaited<ReturnType<typeof mountApps>>, prefix: string): string[] {
    return wrapper
      .findAll(`[data-testid^="${prefix}"]`)
      .map((card) => card.attributes('data-testid')!.slice(prefix.length))
  }

  async function openFilter(wrapper: Awaited<ReturnType<typeof mountApps>>) {
    await wrapper.get('[data-testid="explore-filter"]').trigger('keydown', { key: 'Enter' })
    await flushPromises()
  }

  async function flip(wrapper: Awaited<ReturnType<typeof mountApps>>, category: string) {
    await wrapper.get(`[data-testid="explore-filter-type-${category}"]`).trigger('click')
    await flushPromises()
  }

  beforeEach(() => {
    listHomeWorkflows.mockResolvedValue([
      workflow('upscale', 'image'),
      workflow('animate', 'video'),
      workflow('material', 'image'),
      workflow('talk', 'video'),
      workflow('loose', null)
    ])
  })

  it('labels each card with its category, and only the cards that have one', async () => {
    const wrapper = await mountApps({ initialTab: 'templates' })

    const badge = (id: string) =>
      wrapper
        .get(`[data-testid="template-card-${id}"]`)
        .find('[data-testid="explore-card-category"]')
    expect(badge('upscale').text()).toBe('Image')
    expect(badge('animate').text()).toBe('Video')
    expect(badge('loose').exists()).toBe(false)
  })

  it('offers only the categories the cards carry, with how many each has', async () => {
    const wrapper = await mountApps({ initialTab: 'templates' })
    await openFilter(wrapper)

    const rows = wrapper.findAll('[data-testid^="explore-filter-type-"]')
    expect(rows.map((row) => row.attributes('data-testid'))).toEqual([
      'explore-filter-type-image',
      'explore-filter-type-video'
    ])
    expect(rows.map((row) => row.text())).toEqual(['Image2', 'Video2'])
  })

  it('narrows the cards to the picked categories and widens them back', async () => {
    const wrapper = await mountApps({ initialTab: 'templates' })
    const ids = () => cardIds(wrapper, 'template-card-')
    expect(ids()).toEqual(['upscale', 'animate', 'material', 'talk', 'loose'])

    await openFilter(wrapper)
    await flip(wrapper, 'video')
    expect(ids()).toEqual(['animate', 'talk'])
    expect(
      wrapper.get('[data-testid="explore-filter-type-video"]').attributes('aria-checked')
    ).toBe('true')
    expect(wrapper.get('[data-testid="explore-filter-count"]').text()).toBe('1')

    await flip(wrapper, 'image')
    expect(ids()).toEqual(['upscale', 'animate', 'material', 'talk'])
    expect(wrapper.get('[data-testid="explore-filter-count"]').text()).toBe('2')

    await flip(wrapper, 'video')
    await flip(wrapper, 'image')
    expect(ids()).toEqual(['upscale', 'animate', 'material', 'talk', 'loose'])
    expect(wrapper.find('[data-testid="explore-filter-count"]').exists()).toBe(false)
  })

  it('keeps each tab its own filter, and hides it on a tab whose cards carry no category', async () => {
    listCatalogApps.mockResolvedValue([catalogApp('studio', 'Cinematic Studio')])
    const wrapper = await mountApps()
    expect(wrapper.find('[data-testid="explore-filter"]').exists()).toBe(false)

    await wrapper.findAll('[data-testid="explore-tabs"] button')[1]!.trigger('mousedown')
    await wrapper.findAll('[data-testid="explore-tabs"] button')[1]!.trigger('click')
    await flushPromises()
    await openFilter(wrapper)
    await flip(wrapper, 'image')
    expect(cardIds(wrapper, 'template-card-')).toEqual(['upscale', 'material'])

    await wrapper.findAll('[data-testid="explore-tabs"] button')[0]!.trigger('mousedown')
    await wrapper.findAll('[data-testid="explore-tabs"] button')[0]!.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="explore-filter"]').exists()).toBe(false)
    expect(cardIds(wrapper, 'app-card-')).toEqual(['studio'])
  })

  it('filters the apps by category when the catalog gives them one', async () => {
    listCatalogApps.mockResolvedValue([
      { ...catalogApp('song', 'Make a Song'), category: 'audio' },
      { ...catalogApp('shot', 'Product shot'), category: 'image' }
    ])
    const wrapper = await mountApps()
    expect(
      wrapper.get('[data-testid="app-card-song"] [data-testid="explore-card-category"]').text()
    ).toBe('Audio')

    await openFilter(wrapper)
    await flip(wrapper, 'audio')
    expect(cardIds(wrapper, 'app-card-')).toEqual(['song'])
  })
})

describe('Explore toolbar', () => {
  type Wrapper = Awaited<ReturnType<typeof mountApps>>

  function hubWorkflow(
    id: string,
    over: Partial<CatalogWorkflow> & { use?: [string, string, number] } = {}
  ): CatalogWorkflow {
    const { use, ...rest } = over
    return {
      id,
      title: id,
      description: '',
      thumbnailUrl: null,
      category: null,
      useCase: use ? { id: use[0], label: use[1], order: use[2] } : null,
      models: [],
      runsOn: 'cloud',
      rank: null,
      ...rest
    }
  }

  const UPSCALE = ['upscale', 'Upscale & restore', 3] as [string, string, number]
  const VIDEOS = ['videos', 'Create & edit videos', 0] as [string, string, number]

  function ids(wrapper: Wrapper, prefix = 'template-card-'): string[] {
    return wrapper
      .findAll(`[data-testid^="${prefix}"]`)
      .map((card) => card.attributes('data-testid')!.slice(prefix.length))
  }

  async function openMenu(wrapper: Wrapper, testid: string) {
    await wrapper.get(`[data-testid="${testid}"]`).trigger('keydown', { key: 'Enter' })
    await flushPromises()
  }

  async function pick(wrapper: Wrapper, testid: string) {
    await wrapper.get(`[data-testid="${testid}"]`).trigger('click')
    await flushPromises()
  }

  async function openSub(wrapper: Wrapper, testid: string) {
    await wrapper.get(`[data-testid="${testid}"]`).trigger('click')
    await flushPromises()
  }

  async function search(wrapper: Wrapper, text: string) {
    await wrapper.get('[data-testid="explore-search"] input').setValue(text)
    await flushPromises()
  }

  async function switchTab(wrapper: Wrapper, index: number) {
    const tab = wrapper.findAll('[data-testid="explore-tabs"] button')[index]!
    await tab.trigger('mousedown')
    await tab.trigger('click')
    await flushPromises()
  }

  beforeEach(() => {
    listCatalogApps.mockResolvedValue([
      catalogApp('studio', 'Cinematic Studio'),
      catalogApp('background', 'Remove Background')
    ])
    listHomeWorkflows.mockResolvedValue([
      hubWorkflow('talk', { use: VIDEOS, models: ['LTX-2.3'], rank: 2, category: 'video' }),
      hubWorkflow('upscale', { use: UPSCALE, models: ['SeedVR2'], rank: 1, category: 'image' }),
      hubWorkflow('motion', { use: VIDEOS, models: ['LTX-2.3'], rank: 3, category: 'video' }),
      hubWorkflow('video-upscale', {
        use: UPSCALE,
        models: ['SeedVR2'],
        rank: 2,
        description: 'Increase video resolution.',
        category: 'video'
      })
    ])
  })

  it('clears the search with its button or Escape', async () => {
    const wrapper = await mountApps()
    await search(wrapper, 'studio')
    expect(ids(wrapper, 'app-card-')).toEqual(['studio'])

    await pick(wrapper, 'explore-search-clear')
    expect(ids(wrapper, 'app-card-')).toHaveLength(2)

    await search(wrapper, 'studio')
    await wrapper.get('[data-testid="explore-search"] input').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(ids(wrapper, 'app-card-')).toHaveLength(2)
  })

  it('keeps search and view options in the same place on both tabs', async () => {
    const wrapper = await mountApps()
    const tools = () => [
      wrapper.find('[data-testid="explore-search"]').exists(),
      wrapper.find('[data-testid="explore-view-options"]').exists()
    ]
    expect(tools()).toEqual([true, true])
    expect(wrapper.get('[data-testid="explore-search"] input').attributes('placeholder')).toBe(
      'Search apps'
    )

    await switchTab(wrapper, 1)

    expect(tools()).toEqual([true, true])
    expect(wrapper.get('[data-testid="explore-search"] input').attributes('placeholder')).toBe(
      'Search workflows'
    )
  })

  it('lists the workflows in the catalog’s recommended order, or by name', async () => {
    const wrapper = await mountApps({ initialTab: 'templates' })
    expect(ids(wrapper)).toEqual(['upscale', 'talk', 'video-upscale', 'motion'])

    await openMenu(wrapper, 'explore-view-options')
    expect(wrapper.get('[data-testid="explore-sort-value"]').text()).toBe('Recommended')
    await openSub(wrapper, 'explore-sort')
    await pick(wrapper, 'explore-sort-az')

    expect(ids(wrapper)).toEqual(['motion', 'talk', 'upscale', 'video-upscale'])
    await openMenu(wrapper, 'explore-view-options')
    expect(wrapper.get('[data-testid="explore-sort-value"]').text()).toBe('Name A to Z')
  })

  it('searches titles, descriptions, use cases and models', async () => {
    const wrapper = await mountApps({ initialTab: 'templates' })

    await search(wrapper, 'resolution')
    expect(ids(wrapper)).toEqual(['video-upscale'])

    await search(wrapper, 'create & edit')
    expect(ids(wrapper)).toEqual(['talk', 'motion'])

    await search(wrapper, 'seedvr2')
    expect(ids(wrapper)).toEqual(['upscale', 'video-upscale'])

    await search(wrapper, 'nothing like this')
    expect(ids(wrapper)).toEqual([])
    expect(wrapper.get('[data-testid="explore-no-matches"]').text()).toBe(
      'Nothing matches. Try another filter or search.'
    )
  })

  it('filters workflows by type, use case and model, counting what each pick would show', async () => {
    const wrapper = await mountApps({ initialTab: 'templates' })
    await openMenu(wrapper, 'explore-filter')

    const groupKeys = wrapper
      .findAll('[data-testid^="explore-filter-group-"]')
      .map((group) => group.attributes('data-testid'))
    expect(groupKeys).toEqual([
      'explore-filter-group-type',
      'explore-filter-group-use',
      'explore-filter-group-model'
    ])
    const value = (key: string) => wrapper.get(`[data-testid="explore-filter-value-${key}"]`).text()
    expect(value('use')).toBe('All')
    const row = (testid: string) => wrapper.get(`[data-testid="explore-filter-${testid}"]`).text()

    await openSub(wrapper, 'explore-filter-group-use')
    expect(row('use-videos')).toBe('Create & edit videos2')
    expect(row('use-upscale')).toBe('Upscale & restore2')
    await pick(wrapper, 'explore-filter-use-upscale')
    expect(ids(wrapper)).toEqual(['upscale', 'video-upscale'])
    expect(value('use')).toBe('Upscale & restore')

    await openSub(wrapper, 'explore-filter-group-type')
    expect(row('type-video')).toBe('Video1')
    await pick(wrapper, 'explore-filter-type-video')
    expect(ids(wrapper)).toEqual(['video-upscale'])
    expect(wrapper.get('[data-testid="explore-filter-count"]').text()).toBe('2')

    await openSub(wrapper, 'explore-filter-group-model')
    expect(wrapper.find('[data-testid="explore-filter-model-LTX-2.3"]').exists()).toBe(false)
    expect(row('model-SeedVR2')).toBe('SeedVR21')
  })

  it('opens one filter group at a time', async () => {
    const wrapper = await mountApps({ initialTab: 'templates' })
    await openMenu(wrapper, 'explore-filter')

    await openSub(wrapper, 'explore-filter-group-use')
    expect(wrapper.find('[data-testid="explore-filter-use-videos"]').exists()).toBe(true)
    await openSub(wrapper, 'explore-filter-group-type')

    expect(wrapper.find('[data-testid="explore-filter-use-videos"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="explore-filter-type-video"]').exists()).toBe(true)
  })

  it('searches the models inside the Model filter', async () => {
    const wrapper = await mountApps({ initialTab: 'templates' })
    await openMenu(wrapper, 'explore-filter')
    await openSub(wrapper, 'explore-filter-group-model')
    const models = () =>
      wrapper
        .findAll('[data-testid^="explore-filter-model-"]')
        .map((option) => option.attributes('data-testid'))

    expect(models()).toEqual(['explore-filter-model-LTX-2.3', 'explore-filter-model-SeedVR2'])
    await wrapper.get('[data-testid="explore-filter-search-model"]').setValue('seed')
    await flushPromises()
    expect(models()).toEqual(['explore-filter-model-SeedVR2'])

    await wrapper.get('[data-testid="explore-filter-search-model"]').setValue('nothing')
    await flushPromises()
    expect(models()).toEqual([])
  })

  it('clears every filter from the menu or with the shortcut', async () => {
    const wrapper = await mountApps({ initialTab: 'templates' })
    await openMenu(wrapper, 'explore-filter')
    expect(wrapper.find('[data-testid="explore-filter-clear"]').exists()).toBe(false)
    await openSub(wrapper, 'explore-filter-group-use')
    await pick(wrapper, 'explore-filter-use-upscale')
    expect(ids(wrapper)).toHaveLength(2)

    await pick(wrapper, 'explore-filter-clear')
    expect(ids(wrapper)).toHaveLength(4)
    expect(wrapper.find('[data-testid="explore-filter-count"]').exists()).toBe(false)

    await openMenu(wrapper, 'explore-filter')
    await openSub(wrapper, 'explore-filter-group-use')
    await pick(wrapper, 'explore-filter-use-upscale')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', metaKey: true }))
    await flushPromises()
    expect(ids(wrapper)).toHaveLength(4)
  })

  it('leaves out Runs on while every workflow runs in the same place', async () => {
    const wrapper = await mountApps({ initialTab: 'templates' })
    await openMenu(wrapper, 'explore-filter')

    expect(wrapper.find('[data-testid="explore-filter-group-runs"]').exists()).toBe(false)
  })

  it('offers Runs on once the workflows run in more than one place', async () => {
    listHomeWorkflows.mockResolvedValue([
      hubWorkflow('cloud-one', { runsOn: 'cloud' }),
      hubWorkflow('local-one', { runsOn: 'local' })
    ])
    const wrapper = await mountApps({ initialTab: 'templates' })
    await openMenu(wrapper, 'explore-filter')

    expect(wrapper.get('[data-testid="explore-filter-runs-local"]').text()).toBe('This computer1')
    expect(
      wrapper.find('[data-testid="explore-filter-runs-local"] .lucide-laptop-minimal').exists()
    ).toBe(true)
    expect(wrapper.find('[data-testid="explore-filter-runs-cloud"] .lucide-cloud').exists()).toBe(
      true
    )
    await pick(wrapper, 'explore-filter-runs-local')
    expect(ids(wrapper)).toEqual(['local-one'])
  })

  it('keeps each tab its own search, and one card size for both', async () => {
    const wrapper = await mountApps()
    await search(wrapper, 'studio')
    expect(ids(wrapper, 'app-card-')).toEqual(['studio'])

    await openMenu(wrapper, 'explore-view-options')
    await pick(wrapper, 'explore-size-large')
    expect(wrapper.get('[data-testid="apps-gallery"]').classes()).toContain('grid-cols-3')

    await switchTab(wrapper, 1)
    expect(wrapper.get('[data-testid="explore-search"] input').element).toHaveProperty('value', '')
    expect(ids(wrapper)).toHaveLength(4)
    expect(wrapper.get('[data-testid="templates-gallery"]').classes()).toContain('grid-cols-3')

    await switchTab(wrapper, 0)
    expect(wrapper.get('[data-testid="explore-search"] input').element).toHaveProperty(
      'value',
      'studio'
    )
    expect(ids(wrapper, 'app-card-')).toEqual(['studio'])
  })

  it('shows four cards across by default, five when small', async () => {
    const wrapper = await mountApps()
    expect(wrapper.get('[data-testid="apps-gallery"]').classes()).toContain('grid-cols-4')

    await openMenu(wrapper, 'explore-view-options')
    await pick(wrapper, 'explore-size-smaller')

    expect(wrapper.get('[data-testid="apps-gallery"]').classes()).toContain('grid-cols-5')
    expect(wrapper.get('[data-testid="explore-size-smaller"]').attributes('disabled')).toBeDefined()
    await pick(wrapper, 'explore-size-bigger')
    await pick(wrapper, 'explore-size-bigger')
    expect(wrapper.get('[data-testid="apps-gallery"]').classes()).toContain('grid-cols-3')
    expect(wrapper.get('[data-testid="explore-size-bigger"]').attributes('disabled')).toBeDefined()
  })
})
