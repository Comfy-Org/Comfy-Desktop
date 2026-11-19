import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { page as browserPage, userEvent } from 'vitest/browser'
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

type BuildState = 'starting' | 'installing' | 'uninstalling' | 'ready' | 'starting with Desktop'

const OPERATIONS: Partial<Record<BuildState, Partial<Operation>>> = {
  starting: { opKind: 'launch', flatPercent: 5 },
  installing: { opKind: 'install', flatPercent: 40 },
  uninstalling: { opKind: 'destructive', flatPercent: 18 }
}

async function homeWithBuildIn(state: BuildState) {
  if (state === 'starting with Desktop') {
    vi.mocked(window.api.getSetting).mockImplementation(async (key: string) =>
      key === 'autoLaunchOnStartup' ? STARTING.id : undefined
    )
  }
  const wrapper = mount(HomeView, { attachTo: host })
  await flushPromises()
  const operation = OPERATIONS[state]
  if (operation) {
    useProgressStore().operations.set(STARTING.id, {
      finished: false,
      cancelRequested: false,
      _globalFloor: 0,
      ...operation
    } as Operation)
  }
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

function shownTiles(section: HTMLElement): HTMLElement[] {
  return [...section.querySelectorAll('li')]
    .filter((item) => getComputedStyle(item).display !== 'none')
    .map((item) => item.querySelector<HTMLElement>('[data-build-id]')!)
}

function columnsOf(section: HTMLElement): number {
  return getComputedStyle(section.querySelector('ul')!).gridTemplateColumns.split(' ').length
}

describe('Home build tiles', () => {
  it.each([
    ['the minimum window width', 1, MIN_WINDOW_BUILDS_WIDTH],
    ['a normal window width', 3, NORMAL_WINDOW_BUILDS_WIDTH]
  ])(
    'at %s, sit %i per row and show the whole name and status of a starting build',
    async (_name, columns, width) => {
      const wrapper = await homeWithBuildIn('starting')
      const section = await layBuildsOut(width)
      const card = section.querySelector<HTMLElement>('[data-testid="home-build-starting"]')!
      const status = card.querySelector('[data-testid="home-build-status"] .truncate')!
      const name = card.querySelector('[data-testid="home-build-name"]')!

      expect(columnsOf(section)).toBe(columns)
      expect(status.textContent?.trim()).toBe('Starting ComfyUI · 5%')
      expect(fullyShown(status)).toBe(true)
      expect(name.textContent?.trim()).toBe(STARTING.name)
      expect(fullyShown(name)).toBe(true)
      expect(
        card.querySelector(
          'button:not([data-testid="home-build-more"]):not([data-testid="home-build-open"])'
        )
      ).toBeNull()

      const tiles = shownTiles(section)
      expect(tiles.length).toBeGreaterThan(1)
      const rows = new Set(tiles.map((tile) => Math.round(tile.getBoundingClientRect().top)))
      expect(rows.size).toBe(Math.ceil(tiles.length / columns))
      for (const tile of tiles) {
        expect(tile.getBoundingClientRect().width).toBeCloseTo(
          card.getBoundingClientRect().width,
          0
        )
      }
      wrapper.unmount()
    }
  )

  it.each(
    (['starting', 'installing', 'uninstalling', 'ready', 'starting with Desktop'] as const).flatMap(
      (state) => [
        [state, MIN_WINDOW_BUILDS_WIDTH] as const,
        [state, NORMAL_WINDOW_BUILDS_WIDTH] as const
      ]
    )
  )('keep one height when a build is %s, at %ipx', async (state, width) => {
    const wrapper = await homeWithBuildIn(state)
    const section = await layBuildsOut(width)
    const tiles = shownTiles(section)
    const more = tiles[0]!.querySelector<HTMLElement>('[data-testid="home-build-more"]')!

    expect(tiles[0]!.getAttribute('data-build-id')).toBe(STARTING.id)
    expect(tiles[0]!.getAttribute('data-testid')).toBe(
      OPERATIONS[state] ? `home-build-${state}` : 'home-build'
    )
    if (state === 'starting with Desktop') {
      const status = tiles[0]!.querySelector('[data-testid="home-build-status"] .truncate')!
      expect(status.textContent?.trim()).toBe('Auto start')
      expect(fullyShown(status)).toBe(true)
    }
    for (const tile of tiles) expect(tile.getBoundingClientRect().height).toBe(100)
    const tileBox = tiles[0]!.getBoundingClientRect()
    const moreBox = more.getBoundingClientRect()
    expect(moreBox.right).toBeLessThanOrEqual(tileBox.right)
    expect(moreBox.top + moreBox.height / 2).toBeCloseTo(tileBox.top + tileBox.height / 2, 0)
    wrapper.unmount()
  })
})

describe('Home build tile names', () => {
  const bubble = () => document.querySelector('[role="tooltip"]')?.textContent?.trim() ?? null

  async function hoverTileOf(id: string): Promise<void> {
    const wrapper = mount(HomeView, { attachTo: host })
    await flushPromises()
    const section = await layBuildsOut(MIN_WINDOW_BUILDS_WIDTH)
    const tile = section.querySelector<HTMLElement>(`[data-build-id="${id}"]`)!
    await userEvent.hover(tile.querySelector<HTMLElement>('[data-testid="home-build-open"]')!)
  }

  it('adds the full name to the hint when the tile cuts the name short', async () => {
    const name = 'My ComfyUI Build for the long weekend of video experiments and upscaling'
    vi.mocked(window.api.getInstallations).mockResolvedValue([{ ...READY, name }, CLOUD])

    await hoverTileOf(READY.id)

    await expect.poll(bubble).toBe(`${name} · Click to start`)
  })

  it('keeps the hint alone when the whole name fits', async () => {
    vi.mocked(window.api.getInstallations).mockResolvedValue([READY, CLOUD])

    await hoverTileOf(READY.id)

    await expect.poll(bubble).toBe('Click to start')
  })
})
