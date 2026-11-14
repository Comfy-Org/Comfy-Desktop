import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { page as browserPage } from 'vitest/browser'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import '../assets/main.css'
import HomeView from './HomeView.vue'
import { useProgressStore, type Operation } from '../stores/progressStore'
import type { Installation } from '../types/ipc'

const MIN_WINDOW_BUILDS_WIDTH = 452
const NORMAL_WINDOW_BUILDS_WIDTH = 932

const STARTING: Installation = {
  id: 'starting',
  name: 'My ComfyUI Build',
  sourceLabel: 'Standalone',
  sourceCategory: 'local',
  version: 'v0.3.68',
  installPath: '/Users/someone/Documents/ComfyUI/Builds/My ComfyUI Build',
  lastLaunchedAt: 300
}
const READY: Installation = {
  id: 'ready',
  name: 'Flux Sandbox',
  sourceLabel: 'Standalone',
  sourceCategory: 'local',
  version: 'v0.42.4',
  installPath: '/Users/someone/Documents/ComfyUI/Builds/Flux Sandbox',
  lastLaunchedAt: 200
}
const CLOUD: Installation = {
  id: 'cloud',
  name: 'Comfy Cloud',
  sourceId: 'cloud',
  sourceLabel: 'Cloud',
  sourceCategory: 'cloud',
  lastLaunchedAt: 100
}

let host: HTMLElement

beforeAll(() => browserPage.viewport(1440, 900))

beforeEach(() => {
  host = document.createElement('div')
  host.style.cssText = 'position: fixed; left: 0; top: 0; width: 1200px; height: 900px'
  document.body.append(host)
  ;(window as unknown as { api: unknown }).api = {
    listHomeWorkflows: vi.fn().mockResolvedValue([]),
    openCatalogWorkflow: vi.fn().mockResolvedValue(true),
    getAppsEnabled: vi.fn().mockResolvedValue(false),
    getInstallations: vi.fn().mockResolvedValue([STARTING, READY, CLOUD]),
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

async function homeWithStartingBuild() {
  const wrapper = mount(HomeView, { attachTo: host })
  await flushPromises()
  useProgressStore().operations.set(STARTING.id, {
    opKind: 'launch',
    finished: false,
    flatPercent: 5,
    cancelRequested: false
  } as Operation)
  await flushPromises()
  return wrapper
}

async function layBuildsOut(width: number): Promise<HTMLElement> {
  const section = host.querySelector<HTMLElement>('[data-testid="home-builds"]')!
  section.style.width = `${width}px`
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  return section
}

function fullyShown(element: Element): boolean {
  return element.scrollWidth <= element.clientWidth && element.clientWidth > 0
}

describe('Home build cards', () => {
  it.each([
    ['at the minimum window width', MIN_WINDOW_BUILDS_WIDTH],
    ['at a normal window width', NORMAL_WINDOW_BUILDS_WIDTH]
  ])(
    'show the whole name and status of a starting build %s, in a card shaped like the others',
    async (_name, width) => {
      const wrapper = await homeWithStartingBuild()
      const section = await layBuildsOut(width)
      const card = section.querySelector('[data-testid="home-build-starting"]')!
      const status = card.querySelector('[data-testid="home-build-status"] .truncate')!
      const name = card.querySelector('[data-testid="home-build-name"]')!
      const cardBox = card.getBoundingClientRect()

      expect(status.textContent?.trim()).toBe('Starting ComfyUI')
      expect(fullyShown(status)).toBe(true)
      expect(name.textContent?.trim()).toBe(STARTING.name)
      expect(fullyShown(name)).toBe(true)
      for (const action of ['home-build-view-logs', 'home-build-cancel']) {
        const box = card.querySelector(`[data-testid="${action}"]`)!.getBoundingClientRect()
        expect(box.width).toBeGreaterThan(0)
        expect(box.left).toBeGreaterThanOrEqual(cardBox.left)
        expect(box.right).toBeLessThanOrEqual(cardBox.right)
        expect(box.bottom).toBeLessThanOrEqual(cardBox.bottom)
      }
      const shown = [...section.querySelectorAll('li')].filter(
        (item) => getComputedStyle(item).display !== 'none'
      )
      expect(shown.length).toBeGreaterThan(1)
      for (const item of shown) {
        const box = item.firstElementChild!.getBoundingClientRect()
        expect(box.height).toBe(cardBox.height)
        expect(box.width).toBeCloseTo(cardBox.width, 0)
      }
      wrapper.unmount()
    }
  )
})
