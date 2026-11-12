import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import AppsView from './AppsView.vue'
import type { CatalogApp } from '../types/ipc'
import { useModal } from '../composables/useModal'

const showApps = vi.fn()
const hideApps = vi.fn()
const listCatalogApps = vi.fn()
let appsLoadFailed: ((info: { url: string }) => void) | null = null
let appsAppOpen: ((info: { open: boolean }) => void) | null = null
let appsSettled: (() => void) | null = null

async function mountApps(props: { growBy?: number; obscured?: boolean } = {}) {
  const wrapper = mount(AppsView, { props })
  await flushPromises()
  return wrapper
}

function catalogApp(id: string, title: string): CatalogApp {
  return {
    id,
    title,
    description: `${title} description`,
    thumbnailUrl: `https://comfy.org/catalog-media/${id}/v1`,
    url: `https://apps.example/apps/${id}/desktop.html`
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  listCatalogApps.mockResolvedValue([])
  ;(window as unknown as { api: unknown }).api = {
    showApps,
    hideApps,
    listCatalogApps,
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
    })
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

  it('opens a second app picked while the first one is still sliding in', async () => {
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

  it('slides in an empty surface and keeps the app off screen until its page settles', async () => {
    listCatalogApps.mockResolvedValue([catalogApp('studio', 'Cinematic Studio')])
    const wrapper = await mountApps({ growBy: 172 })

    await wrapper.get('[data-testid="app-card-studio"]').trigger('click')
    await flushPromises()

    const slot = wrapper.get('[data-testid="apps-host"]').element.getBoundingClientRect()
    const first = showApps.mock.calls[0]![0]
    expect(first.fresh).toBe(true)
    expect(first.x).toBe(window.innerWidth)
    expect(Math.round(first.width)).toBe(Math.round(slot.width + 172))
    expect(wrapper.find('[data-testid="apps-host-surface"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="app-card-studio"]').isVisible()).toBe(true)
    expect(wrapper.find('h1').exists()).toBe(true)

    await vi.waitFor(() => expect(wrapper.emitted('app-entered')).toEqual([[true]]))
    expect(wrapper.find('h1').exists()).toBe(false)
    expect(showApps.mock.calls.every(([rect]) => rect.x === window.innerWidth)).toBe(true)

    appsSettled!()
    await flushPromises()
    const last = showApps.mock.calls.at(-1)![0]
    expect(Math.round(last.x)).toBe(Math.round(slot.x))
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
      expect(showApps.mock.calls.at(-1)![0].x).toBe(window.innerWidth)

      await vi.advanceTimersByTimeAsync(4000)
      const slot = wrapper.get('[data-testid="apps-host"]').element.getBoundingClientRect()
      expect(Math.round(showApps.mock.calls.at(-1)![0].x)).toBe(Math.round(slot.x))
    } finally {
      vi.useRealTimers()
      matchMedia.mockRestore()
    }
  })

  it('shows an app in place without sliding when motion is reduced', async () => {
    listCatalogApps.mockResolvedValue([catalogApp('studio', 'Cinematic Studio')])
    const matchMedia = vi
      .spyOn(window, 'matchMedia')
      .mockImplementation((query) => ({ matches: query.includes('reduce') }) as MediaQueryList)
    try {
      const wrapper = await mountApps()
      await wrapper.get('[data-testid="app-card-studio"]').trigger('click')
      await flushPromises()

      expect(wrapper.emitted('app-entered')).toEqual([[true]])
      appsSettled!()
      await flushPromises()
      const slot = wrapper.get('[data-testid="apps-host"]').element.getBoundingClientRect()
      expect(Math.round(showApps.mock.calls.at(-1)![0].x)).toBe(Math.round(slot.x))
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
