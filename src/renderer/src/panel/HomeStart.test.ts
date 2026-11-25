import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cdp, page as browserPage } from 'vitest/browser'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import '../assets/main.css'
import HomeView from './HomeView.vue'
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

function startBarOf(id: string): HTMLElement | null {
  return card(id).querySelector<HTMLElement>('[data-testid="home-build-start-bar"]')
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
  it('reads "Starting…" in the foreground color with a spinner and an indeterminate edge bar', async () => {
    launching(AUTO.id)
    await openHome()

    const status = statusOf(AUTO.id)
    expect(status.textContent?.trim()).toBe('Starting…')
    expect(status.getAttribute('role')).toBe('status')
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(getComputedStyle(status).color).toBe(styleOf('text-foreground', 'color'))
    expect(status.querySelector('[data-testid="home-build-spinner"]')).not.toBeNull()

    const bar = startBarOf(AUTO.id)!
    const cardBox = card(AUTO.id).getBoundingClientRect()
    const barBox = bar.getBoundingClientRect()
    expect(bar.dataset.indeterminate).toBe('true')
    expect(bar.hasAttribute('aria-valuenow')).toBe(false)
    expect(barBox.height).toBe(2)
    expect(barBox.width).toBe(cardBox.width)
    expect(barBox.bottom).toBe(cardBox.bottom)
    expect(getComputedStyle(card(AUTO.id)).overflow).toBe('hidden')
    const segment = bar.querySelector<HTMLElement>('[data-testid="home-build-start-bar-segment"]')!
    expect(getComputedStyle(segment).backgroundColor).toBe(
      styleOf('bg-foreground', 'backgroundColor')
    )
  })

  it('shows the percent and a determinate bar only when the start reports progress', async () => {
    await openHome()
    launchOperation(AUTO.id, 62)
    await flushPromises()

    expect(statusOf(AUTO.id).textContent?.trim()).toBe('Starting · 62%')
    const bar = startBarOf(AUTO.id)!
    expect(bar.getAttribute('aria-valuenow')).toBe('62')
    expect(
      bar.querySelector<HTMLElement>('[data-testid="home-build-start-bar-fill"]')!.style.width
    ).toBe('62%')
  })

  it('goes back to the running look, with no bar, once the build is up', async () => {
    launching(AUTO.id)
    await openHome()
    expect(startBarOf(AUTO.id)).not.toBeNull()

    running(AUTO.id)
    await flushPromises()

    expect(statusOf(AUTO.id).textContent?.trim()).toBe('Running')
    expect(statusOf(AUTO.id).hasAttribute('role')).toBe(false)
    expect(startBarOf(AUTO.id)).toBeNull()
    expect(card(AUTO.id).querySelector('[role="progressbar"]')).toBeNull()
  })

  it('stands the edge bar and spinner still when reduced motion is preferred', async () => {
    launching(AUTO.id)
    await openHome()
    const segment = () =>
      startBarOf(AUTO.id)!.querySelector<HTMLElement>(
        '[data-testid="home-build-start-bar-segment"]'
      )!
    expect(getComputedStyle(segment()).animationName).toBe('start-bar-slide')

    await cdp().send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
    })

    expect(getComputedStyle(segment()).animationName).toBe('none')
    const spinner = card(AUTO.id).querySelector('[data-testid="home-build-spinner"]')!
    expect(getComputedStyle(spinner).animationName).toBe('none')
  })
})

describe('Open ComfyUI while the build it opens is starting', () => {
  it('says "Starting ComfyUI…" with a spinner, keeps its width, and still opens the build', async () => {
    const wrapper = await openHome()
    const button = host.querySelector<HTMLElement>('[data-testid="home-open-comfyui"]')!
    const restingWidth = button.getBoundingClientRect().width
    const visibleLabel = () =>
      [...button.querySelectorAll<HTMLElement>('[data-testid="home-open-comfyui-label"] > span')]
        .filter((label) => getComputedStyle(label).visibility === 'visible')
        .map((label) => label.textContent?.trim())

    expect(visibleLabel()).toEqual(['Open ComfyUI'])

    launching(AUTO.id)
    await flushPromises()

    expect(visibleLabel()).toEqual(['Starting ComfyUI…'])
    expect(button.querySelector('[data-testid="home-open-comfyui-spinner"]')).not.toBeNull()
    expect(button.getBoundingClientRect().width).toBe(restingWidth)
    button.click()
    expect(wrapper.emitted('pick')).toEqual([[AUTO]])

    running(AUTO.id)
    await flushPromises()

    expect(visibleLabel()).toEqual(['Open ComfyUI'])
    expect(button.querySelector('[data-testid="home-open-comfyui-spinner"]')).toBeNull()
    expect(button.getBoundingClientRect().width).toBe(restingWidth)
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

  it('shows a build that became ready before Home opened', async () => {
    running(AUTO.id)
    readyAtMount = AUTO.id
    await openHome()

    expect(toast()?.dataset.buildId).toBe(AUTO.id)
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
