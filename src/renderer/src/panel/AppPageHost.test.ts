import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { page as browserPage } from 'vitest/browser'
import { flushPromises, mount } from '@vue/test-utils'

import '../assets/main.css'
import AppPageHost from './AppPageHost.vue'
import type { AppPagePlacement, AppPageStatus } from '../types/ipc'

const PAGE_LEFT = 260
const PAGE_TOP = 12
const PAGE_WIDTH = 900
const PAGE_HEIGHT = 600
const FRAME =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

const showAppPage = vi.fn<(appId: string, placement: AppPagePlacement) => Promise<AppPageStatus>>()
const captureAppPage = vi.fn<() => Promise<string | null>>()
const hideAppPage = vi.fn()
const reloadAppPage = vi.fn()

const mountPointFillsThePage = document.createElement('style')
mountPointFillsThePage.textContent = '[data-apps-page] > div { display: flex; flex: 1 1 auto; }'
document.head.append(mountPointFillsThePage)

let page: HTMLElement
let tellStatus: (status: AppPageStatus) => void = () => {}
let stoppedListening = false

async function nextFrame(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  await flushPromises()
}

const CUTOUT = { appId: 'remove-background', title: 'Remove Background' }

async function mountHost(status: AppPageStatus = 'ready') {
  showAppPage.mockResolvedValue(status)
  const wrapper = mount(AppPageHost, { attachTo: page, props: CUTOUT })
  await flushPromises()
  await nextFrame()
  return wrapper
}

function coverPartOfThePage(): HTMLElement {
  const menu = document.createElement('div')
  menu.dataset.testid = 'sidebar-menu'
  menu.style.cssText = `position: fixed; left: ${PAGE_LEFT - 40}px; top: ${PAGE_TOP + 200}px; width: 200px; height: 120px; background: #222`
  document.body.append(menu)
  return menu
}

beforeAll(() => browserPage.viewport(1280, 800))

beforeEach(() => {
  vi.clearAllMocks()
  stoppedListening = false
  page = document.createElement('div')
  page.dataset.appsPage = ''
  page.style.cssText = `position: fixed; display: flex; left: ${PAGE_LEFT}px; top: ${PAGE_TOP}px; width: ${PAGE_WIDTH}px; height: ${PAGE_HEIGHT}px`
  document.body.append(page)
  captureAppPage.mockResolvedValue(FRAME)
  ;(window as unknown as { api: unknown }).api = {
    showAppPage,
    captureAppPage,
    hideAppPage,
    reloadAppPage,
    onAppPageStatusChanged: (listener: (status: AppPageStatus) => void) => {
      tellStatus = listener
      return () => {
        stoppedListening = true
      }
    }
  }
})

afterEach(() => {
  page.remove()
  document.querySelector('[data-testid="sidebar-menu"]')?.remove()
})

describe('AppPageHost', () => {
  it("asks Desktop to show the app's page exactly over the host, with its rounded corners", async () => {
    await mountHost()

    expect(showAppPage).toHaveBeenCalledWith('remove-background', {
      x: PAGE_LEFT,
      y: PAGE_TOP,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      cornerRadius: 14,
      justOpened: true
    })
  })

  it('shows a placeholder while the app loads, and nothing of its own once the app is up', async () => {
    const wrapper = await mountHost('loading')

    expect(wrapper.get('[data-testid="app-page-loading"]').isVisible()).toBe(true)
    expect(wrapper.get('[data-testid="app-page-loading"]').text()).toBe('Loading Remove Background')
    expect(wrapper.get('[data-testid="app-page-host"]').attributes('aria-busy')).toBe('true')

    tellStatus('ready')
    await flushPromises()

    expect(wrapper.find('[data-testid="app-page-loading"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="app-page-failed"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="app-page-host"]').attributes('aria-busy')).toBe('false')
  })

  it('says the app did not load, loads it again on Try again, and offers the way back', async () => {
    const wrapper = await mountHost('failed')

    expect(wrapper.get('[data-testid="app-page-failed"]').text()).toContain(
      "Remove Background didn't load"
    )

    await wrapper.get('[data-testid="app-page-retry"]').trigger('click')

    expect(reloadAppPage).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[data-testid="app-page-loading"]').isVisible()).toBe(true)

    tellStatus('failed')
    await flushPromises()
    await wrapper.get('[data-testid="app-page-back"]').trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('follows the host when it is resized, without counting another opening', async () => {
    await mountHost()
    showAppPage.mockClear()

    page.style.width = `${PAGE_WIDTH - 180}px`
    await nextFrame()
    await nextFrame()

    expect(showAppPage).toHaveBeenLastCalledWith(
      'remove-background',
      expect.objectContaining({ width: PAGE_WIDTH - 180, justOpened: false })
    )
  })

  it('counts one opening when the host is resized before Desktop has answered', async () => {
    let answer: (status: AppPageStatus) => void = () => {}
    showAppPage.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    mount(AppPageHost, { attachTo: page, props: CUTOUT })
    await flushPromises()
    await nextFrame()

    page.style.width = `${PAGE_WIDTH - 180}px`
    await nextFrame()
    await nextFrame()
    answer('ready')
    await flushPromises()

    expect(showAppPage.mock.calls.filter(([, placement]) => placement.justOpened)).toHaveLength(1)
    expect(showAppPage.mock.calls.length).toBeGreaterThan(1)
  })

  it('opens another app in the same host as a new opening', async () => {
    const wrapper = await mountHost()
    showAppPage.mockClear()
    showAppPage.mockResolvedValue('loading')

    await wrapper.setProps({ appId: 'sdr-to-hdr', title: 'SDR to HDR' })
    await flushPromises()

    expect(showAppPage).toHaveBeenLastCalledWith(
      'sdr-to-hdr',
      expect.objectContaining({ justOpened: true })
    )
    expect(wrapper.get('[data-testid="app-page-loading"]').text()).toBe('Loading SDR to HDR')
  })

  it('swaps the app for a still frame while a menu covers part of it, then brings it back', async () => {
    const wrapper = await mountHost()
    showAppPage.mockClear()

    const menu = coverPartOfThePage()
    await nextFrame()
    await nextFrame()

    expect(captureAppPage).toHaveBeenCalledTimes(1)
    expect(hideAppPage).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[data-testid="app-page-frozen-frame"]').attributes('src')).toBe(FRAME)
    expect(showAppPage).not.toHaveBeenCalled()

    menu.remove()
    await nextFrame()
    await nextFrame()

    expect(showAppPage).toHaveBeenCalledTimes(1)
  })

  it('leaves the app up for a menu that opens beside the host', async () => {
    await mountHost()
    const menu = document.createElement('div')
    menu.dataset.testid = 'sidebar-menu'
    menu.style.cssText = `position: fixed; left: 20px; top: ${PAGE_TOP + 200}px; width: 200px; height: 120px`
    document.body.append(menu)
    await nextFrame()
    await nextFrame()

    expect(hideAppPage).not.toHaveBeenCalled()
  })

  it('does not ask for the app while a dialog already covers the host', async () => {
    coverPartOfThePage()
    showAppPage.mockResolvedValue('ready')
    mount(AppPageHost, { attachTo: page, props: CUTOUT })
    await flushPromises()
    await nextFrame()

    expect(showAppPage).not.toHaveBeenCalled()
  })

  it('hides the app and stops listening when the host goes away', async () => {
    const wrapper = await mountHost()

    wrapper.unmount()

    expect(hideAppPage).toHaveBeenCalledTimes(1)
    expect(stoppedListening).toBe(true)
  })
})
