import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { page as browserPage } from 'vitest/browser'
import { flushPromises, mount } from '@vue/test-utils'

import '../assets/main.css'
import AppPageHost from './AppPageHost.vue'
import type { AppOutputAction, AppOutputs, AppPagePlacement, AppPageStatus } from '../types/ipc'

const PAGE_LEFT = 260
const PAGE_TOP = 12
const PAGE_WIDTH = 900
const PAGE_HEIGHT = 600
const FRAME =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

const showAppPage = vi.fn<(appId: string, placement: AppPagePlacement) => Promise<AppPageStatus>>()
const captureAppPage = vi.fn<() => Promise<string | null>>()
const hideAppPage = vi.fn()
const sendAppOutputAction = vi.fn<(action: AppOutputAction) => void>()

const mountPointFillsThePage = document.createElement('style')
mountPointFillsThePage.textContent = '[data-apps-page] > div { display: flex; flex: 1 1 auto; }'
document.head.append(mountPointFillsThePage)

let page: HTMLElement
let tellStatusOf: (appId: string | null, status: AppPageStatus) => void = () => {}
let stoppedListening = false
let tellOutputsOf: (appId: string, outputs: AppOutputs) => void = () => {}
let stoppedListeningForOutputs = false

function tellStatus(status: AppPageStatus): void {
  tellStatusOf('remove-background', status)
}

async function nextFrame(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  await flushPromises()
}

const CUTOUT = { appId: 'remove-background', title: 'Remove Background' }

function pngBytes(): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(FRAME.split(',')[1]!), (char) => char.charCodeAt(0))
}

const TWO_CUTOUTS: AppOutputs = {
  items: [
    { name: 'cutout-1.png', mimeType: 'image/png', bytes: pngBytes(), tags: [], workflow: true },
    { name: 'cutout-2.png', mimeType: 'image/png', bytes: pngBytes(), tags: [], workflow: false }
  ],
  index: 1
}

function outputDialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="output-detail"]')
}

function inOutputDialog(testId: string): HTMLElement | null {
  return outputDialog()?.querySelector<HTMLElement>(`[data-testid="${testId}"]`) ?? null
}

async function showOutputs(appId = 'remove-background', outputs = TWO_CUTOUTS): Promise<void> {
  tellOutputsOf(appId, outputs)
  await flushPromises()
  await nextFrame()
  await nextFrame()
}

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
  stoppedListeningForOutputs = false
  page = document.createElement('div')
  page.dataset.appsPage = ''
  page.style.cssText = `position: fixed; display: flex; left: ${PAGE_LEFT}px; top: ${PAGE_TOP}px; width: ${PAGE_WIDTH}px; height: ${PAGE_HEIGHT}px`
  document.body.append(page)
  captureAppPage.mockResolvedValue(FRAME)
  ;(window as unknown as { api: unknown }).api = {
    showAppPage,
    captureAppPage,
    hideAppPage,
    onAppPageStatusChanged: (listener: (appId: string | null, status: AppPageStatus) => void) => {
      tellStatusOf = listener
      return () => {
        stoppedListening = true
      }
    },
    onAppOutputs: (listener: (appId: string, outputs: AppOutputs) => void) => {
      tellOutputsOf = listener
      return () => {
        stoppedListeningForOutputs = true
      }
    },
    sendAppOutputAction
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
      justOpened: true,
      retry: false,
      focus: false
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

  it('lays the placeholder out where the app page puts its two panes: 360px, an 8px gap, the rest', async () => {
    const wrapper = await mountHost('loading')
    const [controls, results] = Array.from(
      wrapper.get('[data-testid="app-page-loading"]').element.querySelectorAll(':scope > div')
    ).map((pane) => pane.getBoundingClientRect())

    expect(controls).toMatchObject({ x: PAGE_LEFT, y: PAGE_TOP, width: 360, height: PAGE_HEIGHT })
    expect(results).toMatchObject({
      x: PAGE_LEFT + 368,
      y: PAGE_TOP,
      width: PAGE_WIDTH - 368,
      height: PAGE_HEIGHT
    })
  })

  it('says the app did not load, loads it again on Try again, and offers the way back', async () => {
    const wrapper = await mountHost('failed')

    expect(wrapper.get('[data-testid="app-page-failed"]').text()).toContain(
      "Remove Background didn't load"
    )

    showAppPage.mockClear()
    showAppPage.mockResolvedValue('loading')
    await wrapper.get('[data-testid="app-page-retry"]').trigger('click')
    await flushPromises()

    expect(showAppPage).toHaveBeenCalledExactlyOnceWith(
      'remove-background',
      expect.objectContaining({ justOpened: false, retry: true })
    )
    expect(wrapper.get('[data-testid="app-page-loading"]').isVisible()).toBe(true)

    tellStatus('failed')
    await flushPromises()
    await wrapper.get('[data-testid="app-page-back"]').trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('asks for a fresh load only on the Try again that was pressed, not on the next resize', async () => {
    const wrapper = await mountHost('failed')
    showAppPage.mockResolvedValue('loading')
    await wrapper.get('[data-testid="app-page-retry"]').trigger('click')
    await flushPromises()
    showAppPage.mockClear()

    page.style.width = `${PAGE_WIDTH - 180}px`
    await nextFrame()
    await nextFrame()

    expect(showAppPage).toHaveBeenLastCalledWith(
      'remove-background',
      expect.objectContaining({ justOpened: false, retry: false })
    )
  })

  it("keeps saying the app did not load when another app's hidden page finishes", async () => {
    const wrapper = await mountHost('failed')

    tellStatusOf('upscale', 'ready')
    tellStatusOf(null, 'loading')
    await flushPromises()

    expect(wrapper.get('[data-testid="app-page-failed"]').isVisible()).toBe(true)
    expect(wrapper.get('[data-testid="app-page-host"]').attributes('data-status')).toBe('failed')
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
    expect(stoppedListeningForOutputs).toBe(true)
  })
})

describe('AppPageHost outputs', () => {
  afterEach(async () => {
    inOutputDialog('output-detail-close')?.click()
    await flushPromises()
  })

  it('opens the output dialog over the app with the outputs its page sent, and swaps the app for a still frame', async () => {
    await mountHost()

    await showOutputs()

    expect(outputDialog()?.querySelector('h2')?.textContent?.trim()).toBe('cutout-2.png')
    expect(inOutputDialog('output-detail-image')?.getAttribute('src')).toMatch(/^blob:/)
    expect(inOutputDialog('output-detail-thumb-0')).not.toBeNull()
    expect(hideAppPage).toHaveBeenCalledTimes(1)
  })

  it("ignores outputs from another app's page", async () => {
    await mountHost()

    await showOutputs('upscale')

    expect(outputDialog()).toBeNull()
  })

  it('sends Download back to the page for the output on show, and stays open', async () => {
    await mountHost()
    await showOutputs()

    inOutputDialog('output-detail-download')!.click()
    await flushPromises()

    expect(sendAppOutputAction).toHaveBeenCalledExactlyOnceWith({ action: 'download', index: 1 })
    expect(outputDialog()).not.toBeNull()
  })

  it('offers Open workflow only for an output with a saved workflow, sends it to the page and closes', async () => {
    await mountHost()
    await showOutputs()
    expect(inOutputDialog('output-detail-workflow')).toBeNull()

    inOutputDialog('output-detail-thumb-0')!.click()
    await flushPromises()
    inOutputDialog('output-detail-workflow')!.click()
    await flushPromises()

    expect(sendAppOutputAction).toHaveBeenCalledExactlyOnceWith({
      action: 'open-workflow',
      index: 0
    })
    expect(outputDialog()).toBeNull()
  })

  it('brings the app back with the keyboard once the dialog closes, and lets go of the files', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    await mountHost()
    await showOutputs()
    showAppPage.mockClear()

    inOutputDialog('output-detail-close')!.click()
    await flushPromises()
    await nextFrame()
    await nextFrame()

    expect(outputDialog()).toBeNull()
    expect(showAppPage).toHaveBeenCalledExactlyOnceWith(
      'remove-background',
      expect.objectContaining({ focus: true, justOpened: false })
    )
    expect(revoke).toHaveBeenCalledTimes(2)

    page.style.width = `${PAGE_WIDTH - 180}px`
    await nextFrame()
    await nextFrame()

    expect(showAppPage).toHaveBeenLastCalledWith(
      'remove-background',
      expect.objectContaining({ focus: false })
    )
    revoke.mockRestore()
  })
})
