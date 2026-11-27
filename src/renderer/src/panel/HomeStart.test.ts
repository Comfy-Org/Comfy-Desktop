import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cdp, page as browserPage } from 'vitest/browser'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import '../assets/main.css'
import HomeView from './HomeView.vue'
import Tooltip from '../components/ui/Tooltip.vue'
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

let host: HTMLElement
const mounted: VueWrapper[] = []

beforeAll(() => browserPage.viewport(1440, 900))

beforeEach(() => {
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
