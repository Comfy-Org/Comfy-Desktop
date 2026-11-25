import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cdp, page as browserPage } from 'vitest/browser'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import '../assets/main.css'
import HomeView from './HomeView.vue'
import Tooltip from '../components/ui/Tooltip.vue'
import { READY_NOTICE_MS } from './home/useAutoStartReadyNotice'
import { useProgressStore, type Operation } from '../stores/progressStore'
import { useSessionStore } from '../stores/sessionStore'
import type { Installation } from '../types/ipc'

const AUTO: Installation = {
  id: 'auto',
  name: 'My ComfyUI Build',
  sourceLabel: 'Standalone',
  sourceCategory: 'local',
  version: 'v0.3.68',
  lastLaunchedAt: 300
}
const OTHER: Installation = {
  id: 'other',
  name: 'Flux Sandbox',
  sourceLabel: 'Standalone',
  sourceCategory: 'local',
  version: 'v0.42.4',
  lastLaunchedAt: 200
}

let readyListener: ((data: { installationId: string | null }) => void) | null
let readyAtMount: string | null
let host: HTMLElement
const mounted: VueWrapper[] = []

beforeAll(() => browserPage.viewport(1440, 900))

beforeEach(() => {
  readyListener = null
  readyAtMount = null
  host = document.createElement('div')
  host.style.cssText = 'position: fixed; left: 0; top: 0; width: 1200px; height: 900px'
  document.body.append(host)
  ;(window as unknown as { api: unknown }).api = {
    listApps: vi.fn().mockResolvedValue([]),
    getInstallations: vi.fn().mockResolvedValue([AUTO, OTHER]),
    onInstallationsChanged: vi.fn(() => () => {}),
    onInstallationsVersionsUpdated: vi.fn(() => () => {}),
    getSetting: vi.fn().mockResolvedValue(undefined),
    setSetting: vi.fn().mockResolvedValue(undefined),
    onSettingsChanged: vi.fn(() => () => {}),
    getAutoStartReady: vi.fn(async () => readyAtMount),
    dismissAutoStartReady: vi.fn().mockResolvedValue(undefined),
    onAutoStartReadyChanged: vi.fn((callback: typeof readyListener) => {
      readyListener = callback
      return () => {
        readyListener = null
      }
    }),
    comfybuilder: {
      getAuthStatus: vi.fn().mockResolvedValue({ signedIn: false }),
      onAuthChanged: vi.fn(() => () => {})
    }
  }
  setActivePinia(createPinia())
})

afterEach(async () => {
  while (mounted.length) mounted.pop()?.unmount()
  host.remove()
  vi.useRealTimers()
  await cdp().send('Emulation.setEmulatedMedia', { features: [] })
})

async function openHome(): Promise<VueWrapper> {
  const wrapper = mount(HomeView, { attachTo: host })
  mounted.push(wrapper)
  await flushPromises()
  return wrapper
}

function launching(id: string): void {
  useSessionStore().launchingInstances.set(id, { installationName: id })
}

function running(id: string): void {
  const session = useSessionStore()
  session.launchingInstances.delete(id)
  session.runningInstances.set(id, { installationId: id, installationName: id, mode: 'console' })
}

function launchOperation(id: string, flatPercent: number): void {
  useProgressStore().operations.set(id, {
    opKind: 'launch',
    flatPercent,
    finished: false,
    cancelRequested: false,
    _globalFloor: 0
  } as Operation)
}

function card(id: string): HTMLElement {
  return host.querySelector<HTMLElement>(`[data-build-id="${id}"][data-testid^="home-build"]`)!
}

function statusOf(id: string): HTMLElement {
  return card(id).querySelector<HTMLElement>('[data-testid="home-build-status"]')!
}

function styleOf(className: string, property: 'color' | 'backgroundColor'): string {
  const probe = document.createElement('span')
  probe.className = className
  host.append(probe)
  const value = getComputedStyle(probe)[property]
  probe.remove()
  return value
}

async function readyNotice(id: string | null): Promise<void> {
  readyListener?.({ installationId: id })
  await flushPromises()
}

function toast(): HTMLElement | null {
  return host.querySelector<HTMLElement>('[data-testid="home-ready-toast"]')
}

describe('a build card while its ComfyUI starts', () => {
  it('reads "● Starting…" with an amber dot and white text, as a status, with no spinner and no progress bar', async () => {
    launching(AUTO.id)
    await openHome()

    const status = statusOf(AUTO.id)
    expect(status.textContent?.trim()).toBe('Starting…')
    expect(status.getAttribute('role')).toBe('status')
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(getComputedStyle(status).color).toBe(styleOf('text-foreground', 'color'))
    const dot = status.querySelector<HTMLElement>('[data-testid="home-build-starting-dot"]')!
    expect(getComputedStyle(dot).backgroundColor).toBe('rgb(245, 158, 11)')
    expect(card(AUTO.id).querySelector('[data-testid="home-build-spinner"]')).toBeNull()
    expect(card(AUTO.id).querySelector('svg.animate-spin')).toBeNull()
    expect(card(AUTO.id).querySelector('[role="progressbar"]')).toBeNull()
  })

  it('shows no percent and no bar even when the start reports one', async () => {
    await openHome()
    launchOperation(AUTO.id, 62)
    await flushPromises()

    expect(statusOf(AUTO.id).textContent?.trim()).toBe('Starting…')
    expect(card(AUTO.id).querySelector('[role="progressbar"]')).toBeNull()
  })

  it('swaps the amber dot for the green Running dot in the same place once the build is up', async () => {
    launching(AUTO.id)
    await openHome()
    expect(statusOf(AUTO.id).textContent?.trim()).toBe('Starting…')
    const startingDot = statusOf(AUTO.id)
      .querySelector('[data-testid="home-build-starting-dot"]')!
      .getBoundingClientRect()

    running(AUTO.id)
    await flushPromises()

    const runningDot = statusOf(AUTO.id)
      .querySelector('[data-testid="home-build-running-dot"]')!
      .getBoundingClientRect()
    expect([startingDot.left, startingDot.top, startingDot.width, startingDot.height]).toEqual([
      runningDot.left,
      runningDot.top,
      runningDot.width,
      runningDot.height
    ])
    expect(card(AUTO.id).querySelector('[data-testid="home-build-starting-dot"]')).toBeNull()

    expect(statusOf(AUTO.id).textContent?.trim()).toBe('Running')
    expect(statusOf(AUTO.id).hasAttribute('role')).toBe(false)
    expect(card(AUTO.id).querySelector('[data-testid="home-build-spinner"]')).toBeNull()
    expect(card(AUTO.id).querySelector('[role="progressbar"]')).toBeNull()
  })

  it('stills the pulsing amber dot and the Open ComfyUI spinner when reduced motion is preferred', async () => {
    launching(AUTO.id)
    await openHome()
    const spinners = () => [
      card(AUTO.id).querySelector('[data-testid="home-build-starting-dot"]')!,
      host.querySelector('[data-testid="home-open-comfyui-spinner"]')!
    ]
    expect(spinners().map((spinner) => getComputedStyle(spinner).animationName)).toEqual([
      'status-starting',
      'spin'
    ])

    await cdp().send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
    })

    expect(spinners().map((spinner) => getComputedStyle(spinner).animationName)).toEqual([
      'none',
      'none'
    ])
  })
})

describe('Open ComfyUI while the build it opens is starting', () => {
  function openButton(): HTMLElement {
    return host.querySelector<HTMLElement>('[data-testid="home-open-comfyui"]')!
  }

  it('keeps its label and width, swaps only its icon for a spinner, and says it opens when ready', async () => {
    const wrapper = await openHome()
    const restingWidth = openButton().getBoundingClientRect().width
    const restingText = openButton().textContent

    launching(AUTO.id)
    await flushPromises()

    expect(openButton().textContent).toBe(restingText)
    expect(openButton().textContent).toContain('Open ComfyUI')
    expect(openButton().getBoundingClientRect().width).toBe(restingWidth)
    expect(openButton().querySelector('[data-testid="home-open-comfyui-spinner"]')).not.toBeNull()
    expect(openButton().querySelector('[data-testid="home-open-comfyui-icon"]')).toBeNull()
    expect(openButton().getAttribute('aria-description')).toBe("Starting… opens when it's ready")
    expect(
      wrapper
        .findAllComponents(Tooltip)
        .map((tooltip) => tooltip.props('text'))
        .includes("Starting… opens when it's ready")
    ).toBe(true)

    running(AUTO.id)
    await flushPromises()

    expect(openButton().querySelector('[data-testid="home-open-comfyui-spinner"]')).toBeNull()
    expect(openButton().querySelector('[data-testid="home-open-comfyui-icon"]')).not.toBeNull()
    expect(openButton().hasAttribute('aria-description')).toBe(false)
    expect(openButton().getBoundingClientRect().width).toBe(restingWidth)
  })

  it('opens the build once it is ready when pressed while it starts', async () => {
    launching(AUTO.id)
    const wrapper = await openHome()

    openButton().click()
    await flushPromises()
    expect(wrapper.emitted('pick')).toBeUndefined()

    running(AUTO.id)
    await flushPromises()
    expect(wrapper.emitted('pick')).toEqual([[AUTO]])

    useSessionStore().runningInstances.delete(AUTO.id)
    launching(AUTO.id)
    running(AUTO.id)
    await flushPromises()
    expect(wrapper.emitted('pick')).toHaveLength(1)
  })

  it('opens the build once it is ready when its card is pressed while it starts', async () => {
    launching(AUTO.id)
    const wrapper = await openHome()

    card(AUTO.id).click()
    await flushPromises()
    expect(wrapper.emitted('pick')).toBeUndefined()

    running(AUTO.id)
    await flushPromises()
    expect(wrapper.emitted('pick')).toEqual([[AUTO]])
  })

  it('opens nothing when the start fails after it was pressed', async () => {
    launching(AUTO.id)
    const wrapper = await openHome()

    openButton().click()
    await flushPromises()
    useSessionStore().launchingInstances.delete(AUTO.id)
    await flushPromises()
    running(AUTO.id)
    await flushPromises()

    expect(wrapper.emitted('pick')).toBeUndefined()
  })
})

describe('the "ComfyUI is ready" notice', () => {
  it('appears when the build Desktop started on its own is ready, and Open opens that build', async () => {
    launching(AUTO.id)
    const wrapper = await openHome()
    expect(toast()).toBeNull()

    running(AUTO.id)
    await readyNotice(AUTO.id)

    expect(toast()!.textContent).toContain('ComfyUI is ready')
    expect(toast()!.getAttribute('role')).toBe('status')
    expect(toast()!.getAttribute('aria-live')).toBe('polite')
    const open = toast()!.querySelector<HTMLButtonElement>('[data-testid="home-ready-toast-open"]')!
    open.focus()
    expect(document.activeElement).toBe(open)
    open.click()
    await flushPromises()

    expect(wrapper.emitted('pick')).toEqual([[AUTO]])
    expect(toast()).toBeNull()
    expect(window.api.dismissAutoStartReady).toHaveBeenCalledWith(AUTO.id)
  })

  it('sits just below Open ComfyUI, on its right edge, clear of the builds row', async () => {
    running(AUTO.id)
    await openHome()
    await readyNotice(AUTO.id)

    for (const animation of toast()!.getAnimations()) animation.finish()
    const button = host.querySelector('[data-testid="home-open-build"]')!.getBoundingClientRect()
    const notice = toast()!.getBoundingClientRect()
    const builds = host.querySelector('[data-testid="home-builds"]')!.getBoundingClientRect()
    expect(notice.top).toBeGreaterThan(button.bottom)
    expect(notice.top - button.bottom).toBeLessThanOrEqual(16)
    expect(notice.right).toBe(button.right)
    expect(notice.bottom).toBeLessThan(builds.top)
  })

  it('shows a build that became ready before Home opened', async () => {
    running(AUTO.id)
    readyAtMount = AUTO.id
    await openHome()

    expect(toast()?.dataset.buildId).toBe(AUTO.id)
  })

  it('does not come back when it was closed elsewhere while Home was still asking whether it shows', async () => {
    running(AUTO.id)
    let answerRead: (id: string | null) => void = () => {}
    vi.mocked(window.api.getAutoStartReady).mockReturnValue(
      new Promise((resolve) => {
        answerRead = resolve
      })
    )
    await openHome()

    await readyNotice(null)
    answerRead(AUTO.id)
    await flushPromises()

    expect(toast()).toBeNull()
  })

  it('closes on X', async () => {
    running(AUTO.id)
    await openHome()
    await readyNotice(AUTO.id)

    const close = toast()!.querySelector<HTMLButtonElement>(
      '[data-testid="home-ready-toast-dismiss"]'
    )!
    expect(close.getAttribute('aria-label')).toBe('Dismiss')
    close.click()
    await flushPromises()

    expect(toast()).toBeNull()
    expect(window.api.dismissAutoStartReady).toHaveBeenCalledWith(AUTO.id)
  })

  it('goes away by itself after 12 seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    running(AUTO.id)
    await openHome()
    await readyNotice(AUTO.id)

    vi.advanceTimersByTime(READY_NOTICE_MS - 1)
    await flushPromises()
    expect(toast()).not.toBeNull()

    vi.advanceTimersByTime(1)
    await flushPromises()
    expect(toast()).toBeNull()
  })

  it('goes away when ComfyUI is opened another way', async () => {
    running(AUTO.id)
    const wrapper = await openHome()
    await readyNotice(AUTO.id)

    host.querySelector<HTMLElement>('[data-testid="home-open-comfyui"]')!.click()
    await flushPromises()
    expect(wrapper.emitted('pick')).toEqual([[AUTO]])
    expect(toast()).toBeNull()
    expect(window.api.dismissAutoStartReady).toHaveBeenCalledWith(AUTO.id)
  })

  it('never appears for a build the person started by hand, only for the Auto start one', async () => {
    await openHome()
    launchOperation(OTHER.id, -1)
    launching(OTHER.id)
    await flushPromises()
    expect(statusOf(OTHER.id).textContent?.trim()).toBe('Starting…')
    useProgressStore().operations.delete(OTHER.id)
    running(OTHER.id)
    await flushPromises()

    expect(toast()).toBeNull()

    running(AUTO.id)
    await readyNotice(AUTO.id)
    expect(toast()?.dataset.buildId).toBe(AUTO.id)
  })
})
