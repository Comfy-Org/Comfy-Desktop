import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import AppsView from './AppsView.vue'
import AppsGallery from './AppsGallery.vue'
import type { AppOutputs, CatalogApp } from '../types/ipc'
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

  it('heads the page Explore with Apps and Templates tabs, starting on Apps', async () => {
    listCatalogApps.mockResolvedValue([catalogApp('studio', 'Cinematic Studio')])
    const wrapper = await mountApps()

    expect(wrapper.get('h1').text()).toBe('Explore')
    expect(tabs(wrapper).map((tab) => tab.text())).toEqual(['Apps', 'Templates'])
    expect(tabs(wrapper)[0]!.attributes('data-state')).toBe('on')
    expect(wrapper.getComponent(AppsGallery).attributes('style')).toBeUndefined()
    expect(wrapper.find('[data-testid="app-card-studio"]').exists()).toBe(true)
    expect(listHomeWorkflows).not.toHaveBeenCalled()
  })

  it('lists the catalog workflows on the Templates tab and opens one on Comfy Hub', async () => {
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

  it('says when the templates cannot be loaded', async () => {
    listHomeWorkflows.mockRejectedValue(new Error('offline'))
    const wrapper = await mountApps({ initialTab: 'templates' })

    expect(wrapper.get('[data-testid="templates-catalog-failed"]').text()).toBe(
      "Couldn't load the templates."
    )
  })

  it('shows only the templates, without tabs, while the remote apps switch is off', async () => {
    getAppsEnabled.mockResolvedValue(false)
    const wrapper = await mountApps()

    expect(wrapper.get('h1').text()).toBe('Explore')
    expect(wrapper.find('[data-testid="explore-tabs"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="templates-empty"]').exists()).toBe(true)
    expect(listCatalogApps).not.toHaveBeenCalled()
  })

  it('stays on Explore and moves to the templates when the remote apps switch turns off', async () => {
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
