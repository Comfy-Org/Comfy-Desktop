import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { page as browserPage, userEvent } from 'vitest/browser'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import '../assets/main.css'
import HomeView from './HomeView.vue'
import type { Installation } from '../types/ipc'

const MIN_WINDOW_PAGE_WIDTH = 532
const NORMAL_WINDOW_PAGE_WIDTH = 1172

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

const FULL_ROW = [LOCAL, OTHER_LOCAL, CLOUD]

let host: HTMLElement

beforeAll(() => browserPage.viewport(1440, 900))

function installApi(installations: Installation[]): void {
  ;(window as unknown as { api: unknown }).api = {
    listApps: vi.fn().mockResolvedValue([]),
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
  host.querySelector<HTMLElement>(':scope > div')!.style.cssText =
    'display: flex; flex: 1; min-width: 0'
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

describe('Home with one local build', () => {
  it('keeps the New build tile in the free slot of the row, with no + beside the title', async () => {
    const wrapper = await homeAt(NORMAL_WINDOW_PAGE_WIDTH, [LOCAL, CLOUD])
    const row = host.querySelector<HTMLElement>('[data-testid="home-builds"] ul')!

    expect(shown('[data-testid="home-build"]'), 'local build').toBe(true)
    expect(shown('[data-testid="home-new-build"]'), 'New build tile').toBe(true)
    expect(getComputedStyle(row).gridTemplateColumns.split(' ')).toHaveLength(3)
    expect(shown('[data-testid="home-new-build-button"]'), 'New build button').toBe(false)
    wrapper.unmount()
  })

  it('swaps the tile for the + when the window is too narrow for a third card', async () => {
    const wrapper = await homeAt(MIN_WINDOW_PAGE_WIDTH, [LOCAL, CLOUD])

    expect(shown('[data-testid="home-new-build"]'), 'New build tile').toBe(false)
    expect(shown('[data-testid="home-new-build-button"]'), 'New build button').toBe(true)
    wrapper.unmount()
  })
})

function shown(selector: string): boolean {
  const el = host.querySelector<HTMLElement>(selector)
  if (!el) return false
  const rect = el.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

describe('New build next to All builds', () => {
  it.each([
    ['the minimum window width', MIN_WINDOW_PAGE_WIDTH],
    ['a normal window width', NORMAL_WINDOW_PAGE_WIDTH]
  ] as const)(
    'with a full row, at %s, offers New build as the + next to the Builds title, not a tile',
    async (_width, width) => {
      const wrapper = await homeAt(width, FULL_ROW)

      expect(shown('[data-testid="home-new-build-button"]'), 'New build button').toBe(true)
      expect(host.querySelector('[data-testid="home-new-build"]'), 'New build tile').toBeNull()
      wrapper.unmount()
    }
  )

  it('leaves the + out while the New build tile is in the row', async () => {
    const wrapper = await homeAt(NORMAL_WINDOW_PAGE_WIDTH, [CLOUD])

    expect(shown('[data-testid="home-new-build"]')).toBe(true)
    expect(host.querySelector('[data-testid="home-new-build-button"]')).toBeNull()
    wrapper.unmount()
  })

  it('goes to all builds from the Builds title', async () => {
    const wrapper = await homeAt(NORMAL_WINDOW_PAGE_WIDTH, FULL_ROW)
    const title = host.querySelector<HTMLElement>('[data-testid="home-all-builds"]')!

    expect(title.closest('h2')?.id).toBe('home-builds')
    expect(title.textContent?.trim()).toBe('Builds')
    title.click()

    expect(wrapper.emitted('show-builds')).toHaveLength(1)
    wrapper.unmount()
  })

  it('brightens the Builds title on hover with no background and no tooltip', async () => {
    const wrapper = await homeAt(NORMAL_WINDOW_PAGE_WIDTH, FULL_ROW)
    const title = host.querySelector<HTMLElement>('[data-testid="home-all-builds"]')!
    const probe = document.createElement('span')
    probe.className = 'text-foreground'
    host.appendChild(probe)

    await userEvent.hover(title)
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(getComputedStyle(title).backgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(getComputedStyle(title).color).toBe(getComputedStyle(probe).color)
    expect(document.body.textContent).not.toContain('All builds')
    probe.remove()
    await userEvent.unhover(title)
    wrapper.unmount()
  })

  it('shows the Builds title in the secondary text color, brighter than a plain section label', async () => {
    const wrapper = await homeAt(NORMAL_WINDOW_PAGE_WIDTH, FULL_ROW)
    const title = host.querySelector<HTMLElement>('[data-testid="home-all-builds"]')!
    const probe = document.createElement('span')
    probe.className = 'text-muted-foreground'
    host.appendChild(probe)

    expect(getComputedStyle(title).color).toBe(getComputedStyle(probe).color)
    probe.remove()
    wrapper.unmount()
  })

  it('names the + in a tooltip', async () => {
    const wrapper = await homeAt(NORMAL_WINDOW_PAGE_WIDTH, FULL_ROW)

    host.querySelector<HTMLElement>('[data-testid="home-new-build-button"]')!.focus()

    await expect
      .poll(() => document.querySelector('[role="tooltip"]')?.textContent?.trim())
      .toBe('New build')
    wrapper.unmount()
  })

  it('opens New build from the +', async () => {
    const wrapper = await homeAt(NORMAL_WINDOW_PAGE_WIDTH, FULL_ROW)

    host.querySelector<HTMLElement>('[data-testid="home-new-build-button"]')!.click()

    expect(wrapper.emitted('new-build')).toHaveLength(1)
    wrapper.unmount()
  })
})

const QUIET_CONTROLS = [
  ['the Builds title', 'home-all-builds', 'Builds'],
  ['the +', 'home-new-build-button', 'New build'],
  ['See all workflows', 'home-see-all-workflows', 'See all workflows'],
  ['See all apps', 'home-see-all-apps', 'See all apps']
] as const

function hoverFillClasses(el: HTMLElement): string[] {
  return [...el.classList].filter(
    (name) => name.startsWith('hover:bg-') && name !== 'hover:bg-transparent'
  )
}

describe('Home section links brighten on hover without a fill', () => {
  it.each(QUIET_CONTROLS)(
    '%s keeps its button role and name and has no hover fill class',
    async (_control, testId, name) => {
      const wrapper = await homeAt(NORMAL_WINDOW_PAGE_WIDTH, FULL_ROW)
      const control = host.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!

      expect(hoverFillClasses(control), 'hover fill classes').toEqual([])
      expect(control.classList.contains('hover:bg-transparent')).toBe(true)
      expect(browserPage.getByRole('button', { name, exact: true }).element()).toBe(control)
      wrapper.unmount()
    }
  )

  it.each(QUIET_CONTROLS)(
    '%s shows no background and turns the foreground color on hover',
    async (_control, testId) => {
      const wrapper = await homeAt(NORMAL_WINDOW_PAGE_WIDTH, FULL_ROW)
      const control = host.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!
      const probe = document.createElement('span')
      probe.className = 'text-foreground'
      host.appendChild(probe)

      await userEvent.hover(control)

      await expect.poll(() => getComputedStyle(control).color).toBe(getComputedStyle(probe).color)
      expect(getComputedStyle(control).backgroundColor).toBe('rgba(0, 0, 0, 0)')
      probe.remove()
      await userEvent.unhover(control)
      wrapper.unmount()
    }
  )

  it('keeps a visible focus ring on the + for the keyboard', async () => {
    const wrapper = await homeAt(NORMAL_WINDOW_PAGE_WIDTH, FULL_ROW)
    const plus = host.querySelector<HTMLElement>('[data-testid="home-new-build-button"]')!

    plus.focus()
    await userEvent.keyboard('{Shift>}{/Shift}')

    await expect.poll(() => getComputedStyle(plus).boxShadow).not.toBe('none')
    expect(getComputedStyle(plus).backgroundColor).toBe('rgba(0, 0, 0, 0)')
    wrapper.unmount()
  })
})
