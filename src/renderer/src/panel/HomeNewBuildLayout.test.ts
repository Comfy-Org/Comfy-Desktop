import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { page as browserPage, userEvent } from 'vitest/browser'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import '../assets/main.css'
import HomeView from './HomeView.vue'
import type { Installation } from '../types/ipc'

const MIN_WINDOW_PAGE_WIDTH = 532
const NORMAL_WINDOW_PAGE_WIDTH = 1172
const MIN_WINDOW_BUILDS_WIDTH = 452
const NORMAL_WINDOW_BUILDS_WIDTH = 932

const CLOUD: Installation = {
  id: 'cloud',
  name: 'Comfy Cloud',
  sourceId: 'cloud',
  sourceLabel: 'Cloud',
  sourceCategory: 'cloud',
  lastLaunchedAt: 100
}
const OTHER_LOCAL: Installation = {
  id: 'other-local',
  name: 'SDXL Playground',
  sourceLabel: 'Standalone',
  sourceCategory: 'local',
  version: 'v0.41.0',
  installPath: '/Users/someone/Documents/ComfyUI/Builds/SDXL Playground',
  lastLaunchedAt: 150
}
const LOCAL: Installation = {
  id: 'local',
  name: 'Flux Sandbox',
  sourceLabel: 'Standalone',
  sourceCategory: 'local',
  version: 'v0.42.4',
  installPath: '/Users/someone/Documents/ComfyUI/Builds/Flux Sandbox',
  lastLaunchedAt: 200
}

let host: HTMLElement

beforeAll(() => browserPage.viewport(1440, 900))

function installApi(installations: Installation[]): void {
  ;(window as unknown as { api: unknown }).api = {
    listHomeWorkflows: vi.fn().mockResolvedValue([]),
    openCatalogWorkflow: vi.fn().mockResolvedValue(true),
    getAppsEnabled: vi.fn().mockResolvedValue(false),
    getInstallations: vi.fn().mockResolvedValue(installations),
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
}

beforeEach(() => {
  host?.remove()
  host = document.createElement('div')
  document.body.append(host)
  setActivePinia(createPinia())
})

async function homeAt(width: number, installations: Installation[]) {
  host.style.cssText = `position: fixed; left: 0; top: 0; width: ${width}px; height: 900px; display: flex`
  installApi(installations)
  const wrapper = mount(HomeView, { attachTo: host })
  await flushPromises()
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  return wrapper
}

function inside(inner: DOMRect, outer: DOMRect): boolean {
  return (
    inner.left >= outer.left &&
    inner.right <= outer.right &&
    inner.top >= outer.top &&
    inner.width > 0 &&
    inner.height > 0
  )
}

describe('Home with no local build', () => {
  it.each([
    ['no builds at all', 'the minimum window width', MIN_WINDOW_PAGE_WIDTH, []],
    ['no builds at all', 'a normal window width', NORMAL_WINDOW_PAGE_WIDTH, []],
    ['only Comfy Cloud', 'the minimum window width', MIN_WINDOW_PAGE_WIDTH, [CLOUD]],
    ['only Comfy Cloud', 'a normal window width', NORMAL_WINDOW_PAGE_WIDTH, [CLOUD]]
  ] as const)(
    'with %s, at %s, shows the New build tile whole inside the page',
    async (_builds, _width, width, installations) => {
      const wrapper = await homeAt(width, [...installations])
      const home = host.querySelector<HTMLElement>('[data-testid="home-view"]')!
      const tile = host.querySelector<HTMLElement>('[data-testid="home-new-build"]')!
      const name = tile.querySelector<HTMLElement>('[data-testid="home-new-build-name"]')!

      expect(tile.tagName).toBe('BUTTON')
      expect(tile.querySelector('button, a')).toBeNull()
      expect(name.textContent?.trim()).toBe('New build')
      expect(name.scrollWidth).toBeLessThanOrEqual(name.clientWidth)
      expect(getComputedStyle(tile).visibility).toBe('visible')
      expect(inside(tile.getBoundingClientRect(), home.getBoundingClientRect())).toBe(true)
      expect(home.scrollWidth).toBeLessThanOrEqual(home.clientWidth)
      expect(tile.getBoundingClientRect().height).toBe(100)

      const cloudTile = host.querySelector<HTMLElement>('[data-build-id="cloud"]')
      if (cloudTile) {
        expect(cloudTile.getBoundingClientRect().height).toBe(tile.getBoundingClientRect().height)
        expect(cloudTile.getBoundingClientRect().width).toBeCloseTo(
          tile.getBoundingClientRect().width,
          0
        )
      }

      tile.click()
      expect(wrapper.emitted('new-build')).toHaveLength(1)
      wrapper.unmount()
    }
  )

  it('opens New build from the keyboard', async () => {
    const wrapper = await homeAt(NORMAL_WINDOW_PAGE_WIDTH, [])
    const tile = host.querySelector<HTMLElement>('[data-testid="home-new-build"]')!

    tile.focus()
    expect(document.activeElement).toBe(tile)
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard(' ')
    expect(wrapper.emitted('new-build')).toHaveLength(2)
    wrapper.unmount()
  })
})

async function buildsRowAt(width: number, installations: Installation[]) {
  const wrapper = await homeAt(NORMAL_WINDOW_PAGE_WIDTH, installations)
  const section = host.querySelector<HTMLElement>('section:has([data-testid="home-all-builds"])')!
  section.style.width = `${width}px`
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  return wrapper
}

function shown(selector: string): boolean {
  const el = host.querySelector<HTMLElement>(selector)
  if (!el) return false
  const rect = el.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

describe('Home with local builds', () => {
  it.each([
    ['one build', 'the minimum window width', MIN_WINDOW_BUILDS_WIDTH, [LOCAL], true],
    ['one build', 'a normal window width', NORMAL_WINDOW_BUILDS_WIDTH, [LOCAL], true],
    ['two builds', 'the minimum window width', MIN_WINDOW_BUILDS_WIDTH, [LOCAL, CLOUD], false],
    ['two builds', 'a normal window width', NORMAL_WINDOW_BUILDS_WIDTH, [LOCAL, CLOUD], true],
    [
      'a full row',
      'a normal window width',
      NORMAL_WINDOW_BUILDS_WIDTH,
      [LOCAL, OTHER_LOCAL, CLOUD],
      false
    ]
  ] as const)(
    'with %s, at %s, offers New build in a free slot or else next to All builds',
    async (_builds, _width, width, installations, tileFits) => {
      const wrapper = await buildsRowAt(width, [...installations])

      expect(shown('[data-testid="home-new-build"]'), 'New build tile').toBe(tileFits)
      expect(shown('[data-testid="home-new-build-link"]'), 'New build link').toBe(!tileFits)
      expect(shown('[data-testid="home-build"]'), 'the builds keep their cards').toBe(true)
      wrapper.unmount()
    }
  )

  it('opens New build from the link next to All builds when the row is full', async () => {
    const wrapper = await buildsRowAt(NORMAL_WINDOW_BUILDS_WIDTH, [LOCAL, OTHER_LOCAL, CLOUD])

    host.querySelector<HTMLElement>('[data-testid="home-new-build-link"]')!.click()

    expect(wrapper.emitted('new-build')).toHaveLength(1)
    expect(host.querySelectorAll('[data-testid="home-build"]')).toHaveLength(3)
    wrapper.unmount()
  })
})
