import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { page as browserPage, userEvent } from 'vitest/browser'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import '../assets/main.css'
import HomeView from './HomeView.vue'
import ChooserFamilyGrid from '../views/chooser/ChooserFamilyGrid.vue'
import { TID } from '../../../shared/testIds'
import { useProgressStore, type Operation } from '../stores/progressStore'
import { useSessionStore } from '../stores/sessionStore'
import type { Installation } from '../types/ipc'

const SMALLEST_WINDOW_WIDTH = 800
const LARGE_WINDOW_WIDTH = 1024
const FRAME_AND_EXPANDED_SIDEBAR_WIDTH = 16 + 8 + 244
const PAGE_SIDE_PADDING = 2 * 40
const HOME_WIDTH_IN_SMALLEST_WINDOW = SMALLEST_WINDOW_WIDTH - FRAME_AND_EXPANDED_SIDEBAR_WIDTH
const BUILDS_GRID_WIDTH_IN_LARGE_WINDOW =
  LARGE_WINDOW_WIDTH - FRAME_AND_EXPANDED_SIDEBAR_WIDTH - PAGE_SIDE_PADDING
const WIDE_WINDOW_WIDTH = 1280
const BUILDS_GRID_WIDTH_IN_WIDE_WINDOW =
  WIDE_WINDOW_WIDTH - FRAME_AND_EXPANDED_SIDEBAR_WIDTH - PAGE_SIDE_PADDING
const HOME_CARD_SIDE_PADDING_AND_BORDER = 18 + 1
const BUILDS_TILE_MENU_INSET = 10
const BUILDS_GRID_WIDTH_IN_SMALLEST_WINDOW =
  SMALLEST_WINDOW_WIDTH - FRAME_AND_EXPANDED_SIDEBAR_WIDTH - PAGE_SIDE_PADDING
const READABLE_NAME_WIDTH = 40

function build(id: string, name: string, lastLaunchedAt: number): Installation {
  return { id, name, lastLaunchedAt, sourceLabel: 'Standalone', sourceCategory: 'local' }
}

const STUDIO = build('studio', 'Flux Sandbox for the long weekend render', 400)
const PORTRAITS = build('portraits', 'Portrait retouching with the new upscaler', 300)

let page: HTMLElement
const mounted: VueWrapper[] = []

function track(wrapper: VueWrapper): VueWrapper {
  mounted.push(wrapper)
  return wrapper
}

function boxOf(element: Element): DOMRect {
  return element.getBoundingClientRect()
}

function onlyIn(wrapper: VueWrapper, selector: string): Element {
  return wrapper.get(selector).element
}

beforeAll(() => browserPage.viewport(1280, 1400))

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    listHomeWorkflows: vi.fn().mockResolvedValue([]),
    openCatalogWorkflow: vi.fn().mockResolvedValue(true),
    getAppsEnabled: vi.fn().mockResolvedValue(false),
    getInstallations: vi.fn().mockResolvedValue([STUDIO, PORTRAITS]),
    onInstallationsChanged: vi.fn(() => () => {}),
    onInstallationsVersionsUpdated: vi.fn(() => () => {}),
    onInstallProgress: vi.fn(() => () => {}),
    onComfyOutput: vi.fn(() => () => {}),
    getSetting: vi.fn(async (key: string) =>
      key === 'autoLaunchOnStartup' ? STUDIO.id : undefined
    ),
    setSetting: vi.fn().mockResolvedValue(undefined),
    onSettingsChanged: vi.fn(() => () => {}),
    comfybuilder: {
      getAuthStatus: vi.fn().mockResolvedValue({ signedIn: false }),
      onAuthChanged: vi.fn(() => () => {})
    }
  }
  setActivePinia(createPinia())
  page = document.createElement('div')
  document.body.append(page)
})

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  page.remove()
})

function fullyShown(element: Element): boolean {
  return element.scrollWidth <= element.clientWidth && element.clientWidth > 0
}

describe('Auto start on Home build cards in the smallest window with the sidebar open', () => {
  it('shows the whole status and leaves each name the width the card has after its picture', async () => {
    page.style.cssText = `position: absolute; left: 0; top: 0; width: ${HOME_WIDTH_IN_SMALLEST_WINDOW}px`
    const wrapper = track(mount(HomeView, { attachTo: page }))
    await flushPromises()

    const studioStatus = onlyIn(
      wrapper,
      `div[data-testid="home-build"][data-build-id="${STUDIO.id}"] [data-testid="home-build-status"] .truncate`
    )
    expect(studioStatus.textContent?.trim()).toBe('Auto start')
    expect(fullyShown(studioStatus), 'status is not cut off').toBe(true)
    expect(wrapper.find('[role="checkbox"]').exists()).toBe(false)

    for (const { id } of [STUDIO, PORTRAITS]) {
      const card = onlyIn(wrapper, `div[data-testid="home-build"][data-build-id="${id}"]`)
      const name = card.querySelector('.font-semibold')!
      const cardBox = boxOf(card)
      const nameBox = boxOf(name)

      expect(cardBox.height, `${id} card height`).toBe(100)
      expect(nameBox.width, `${id} name width`).toBeGreaterThanOrEqual(READABLE_NAME_WIDTH)
      expect(
        Math.abs(cardBox.right - HOME_CARD_SIDE_PADDING_AND_BORDER - nameBox.right),
        `${id} name stops at the card's padding`
      ).toBeLessThanOrEqual(1)
    }
  })
})

async function mountBuildsGrid(width: number): Promise<VueWrapper> {
  page.style.cssText = `position: absolute; left: 0; top: 0; width: ${width}px`
  const wrapper = track(
    mount(ChooserFamilyGrid, {
      attachTo: page,
      props: { installations: [STUDIO, PORTRAITS] }
    })
  )
  await flushPromises()
  return wrapper
}

function buildsTileStatus(wrapper: VueWrapper): Element {
  const tile = onlyIn(wrapper, `[data-testid="${TID.dashboardTile(STUDIO.id)}"]`)
  return tile.querySelector('.chooser-tile-body .truncate')!
}

describe('Auto start on Builds page tiles', () => {
  it('in a 1024 px window with the sidebar open, keeps the status on one line, the name readable and the ⋯ button inside the tile', async () => {
    const wrapper = await mountBuildsGrid(BUILDS_GRID_WIDTH_IN_LARGE_WINDOW)

    const status = buildsTileStatus(wrapper)
    expect(status.textContent?.trim()).toBe('Auto start')
    expect(boxOf(status).height, 'status stays on one line').toBe(16)
    expect(wrapper.find('[role="checkbox"]').exists()).toBe(false)

    const heights = new Set<number>()
    for (const { id } of [STUDIO, PORTRAITS]) {
      const tile = onlyIn(wrapper, `[data-testid="${TID.dashboardTile(id)}"]`)
      const name = tile.querySelector('.chooser-tile-name')!
      const kebab = tile.querySelector('.chooser-tile-kebab')!
      const tileBox = boxOf(tile)
      heights.add(tileBox.height)

      expect(boxOf(name).width, `${id} name width`).toBeGreaterThanOrEqual(READABLE_NAME_WIDTH)
      const kebabBox = boxOf(kebab)
      expect(kebabBox.right, `${id} menu button is not cut off`).toBeLessThanOrEqual(
        tileBox.right - BUILDS_TILE_MENU_INSET + 0.5
      )
      expect(kebabBox.top + kebabBox.height / 2).toBeCloseTo(tileBox.top + tileBox.height / 2, 0)
      expect(tile.scrollWidth, `${id} tile does not overflow`).toBeLessThanOrEqual(tile.clientWidth)
    }
    expect([...heights]).toEqual([100])
    const [studio, portraits] = [STUDIO, PORTRAITS].map(({ id }) =>
      boxOf(onlyIn(wrapper, `[data-testid="${TID.dashboardTile(id)}"]`))
    )
    expect(portraits!.top, 'two tiles share a row').toBe(studio!.top)
  })

  it('in a 1280 px window with the sidebar open, shows the whole status', async () => {
    const wrapper = await mountBuildsGrid(BUILDS_GRID_WIDTH_IN_WIDE_WINDOW)

    const status = buildsTileStatus(wrapper)
    expect(status.textContent?.trim()).toBe('Auto start')
    expect(fullyShown(status), 'status is not cut off').toBe(true)
  })
})

type TileState =
  | 'ready'
  | 'update'
  | 'running'
  | 'running with an update'
  | 'starting'
  | 'installing'
  | 'uninstalling'

const TILE_OPERATIONS: Partial<Record<TileState, Partial<Operation>>> = {
  starting: { opKind: 'launch', flatPercent: 5 },
  installing: { opKind: 'install', flatPercent: 40 },
  uninstalling: { opKind: 'destructive', flatPercent: 18 }
}

async function buildsGridWithStudioIn(state: TileState, width: number): Promise<VueWrapper> {
  const withUpdate = state === 'update' || state === 'running with an update'
  const studio: Installation = withUpdate
    ? { ...STUDIO, version: 'v0.3.68', statusTag: { style: 'update', label: 'Update to v0.3.70' } }
    : STUDIO
  page.style.cssText = `position: absolute; left: 0; top: 0; width: ${width}px`
  const wrapper = track(
    mount(ChooserFamilyGrid, {
      attachTo: page,
      props: { installations: [studio, PORTRAITS] }
    })
  )
  await flushPromises()
  const operation = TILE_OPERATIONS[state]
  if (operation) {
    useProgressStore().operations.set(STUDIO.id, {
      finished: false,
      cancelRequested: false,
      _globalFloor: 0,
      ...operation
    } as Operation)
  }
  if (state.startsWith('running')) {
    useSessionStore().runningInstances.set(STUDIO.id, { installationId: STUDIO.id } as never)
  }
  await flushPromises()
  return wrapper
}

describe('Builds page grid', () => {
  it('stacks the tiles one per row in the smallest window, each the full grid width', async () => {
    const wrapper = await buildsGridWithStudioIn('ready', BUILDS_GRID_WIDTH_IN_SMALLEST_WINDOW)
    const grid = onlyIn(wrapper, '.chooser-family-grid')
    const [studio, portraits] = [STUDIO, PORTRAITS].map(({ id }) =>
      boxOf(onlyIn(wrapper, `[data-testid="${TID.dashboardTile(id)}"]`))
    )

    expect(getComputedStyle(grid).gridTemplateColumns.split(' ')).toHaveLength(1)
    expect(studio!.width).toBe(BUILDS_GRID_WIDTH_IN_SMALLEST_WINDOW)
    expect(portraits!.left).toBe(studio!.left)
    expect(portraits!.top).toBeGreaterThan(studio!.bottom)
  })

  it.each(
    (
      [
        'ready',
        'update',
        'running',
        'running with an update',
        'starting',
        'installing',
        'uninstalling'
      ] as const
    ).flatMap((state) => [
      [state, BUILDS_GRID_WIDTH_IN_SMALLEST_WINDOW] as const,
      [state, BUILDS_GRID_WIDTH_IN_LARGE_WINDOW] as const
    ])
  )('keeps every tile 100 px high when a build is %s, at %ipx', async (state, width) => {
    const wrapper = await buildsGridWithStudioIn(state, width)
    for (const { id } of [STUDIO, PORTRAITS]) {
      const tile = onlyIn(wrapper, `[data-testid="${TID.dashboardTile(id)}"]`)
      expect(boxOf(tile).height, `${id} tile height`).toBe(100)
      expect(tile.scrollWidth, `${id} tile does not overflow`).toBeLessThanOrEqual(tile.clientWidth)
    }
    const tile = onlyIn(wrapper, `[data-testid="${TID.dashboardTile(STUDIO.id)}"]`)
    expect(tile.querySelector('.chooser-tile-launch')).toBeNull()
    expect(
      tile.querySelectorAll(
        'button:not(.chooser-tile-kebab):not([data-testid="build-update-link"])'
      )
    ).toHaveLength(0)
    if (state === 'running with an update') {
      expect(tile.querySelector('.chooser-tile-body .truncate')!.textContent?.trim()).toBe(
        'Running'
      )
      expect(tile.querySelector('.chooser-tile-meta-line')!.textContent?.trim()).toBe(
        'Standalone · v0.3.68 · Update'
      )
    }
    if (state === 'starting') {
      expect(tile.querySelector('.chooser-tile-body .truncate')!.textContent?.trim()).toBe(
        'Starting ComfyUI · 5%'
      )
    }
    if (state === 'installing') {
      expect(tile.querySelector('.chooser-tile-body .truncate')!.textContent?.trim()).toBe(
        'Installing ComfyUI · 40%'
      )
    }
  })

  it('lets the pointer through the whole tile to its click hint, and keeps the hint shut while the menu is open', async () => {
    const wrapper = await buildsGridWithStudioIn('ready', BUILDS_GRID_WIDTH_IN_LARGE_WINDOW)
    const tile = onlyIn(wrapper, `[data-testid="${TID.dashboardTile(STUDIO.id)}"]`)
    const area = tile.querySelector('[data-testid="chooser-tile-hint-area"]')!
    const tileBox = boxOf(tile)
    expect(boxOf(area).width).toBeCloseTo(tileBox.width - 2, 0)
    expect(boxOf(area).height).toBeCloseTo(tileBox.height - 2, 0)
    for (const element of [
      tile.querySelector('.chooser-tile-name')!,
      tile.querySelector('.chooser-tile-icon')!
    ]) {
      const box = boxOf(element)
      expect(document.elementFromPoint(box.left + 2, box.top + box.height / 2)).toBe(area)
    }

    for (const element of [
      tile.querySelector<HTMLElement>('.chooser-tile-name')!,
      tile.querySelector<HTMLElement>('.chooser-tile-icon')!
    ]) {
      await userEvent.hover(element, { force: true })
      await vi.waitFor(
        () =>
          expect(document.querySelector('.tooltip-bubble')?.textContent).toContain(
            'Click to start'
          ),
        { timeout: 3000 }
      )
      await userEvent.unhover(element, { force: true })
      await vi.waitFor(() => expect(document.querySelector('.tooltip-bubble')).toBeNull(), {
        timeout: 3000
      })
    }

    await userEvent.click(tile.querySelector<HTMLElement>('.chooser-tile-kebab')!)
    await vi.waitFor(() =>
      expect(document.querySelector('[data-testid="build-menu"]')).not.toBeNull()
    )
    await userEvent.hover(tile.querySelector<HTMLElement>('.chooser-tile-name')!, { force: true })
    await new Promise((resolve) => setTimeout(resolve, 800))
    expect(document.querySelector('.tooltip-bubble')).toBeNull()
  })

  it('closes the build menu on a second press of the ⋯ button', async () => {
    const wrapper = await buildsGridWithStudioIn('ready', BUILDS_GRID_WIDTH_IN_LARGE_WINDOW)
    const kebab = onlyIn(
      wrapper,
      `[data-testid="${TID.dashboardTile(STUDIO.id)}"] .chooser-tile-kebab`
    ) as HTMLElement
    await userEvent.click(kebab)
    await vi.waitFor(() =>
      expect(document.querySelector('[data-testid="build-menu"]')).not.toBeNull()
    )
    await userEvent.click(kebab)
    await vi.waitFor(() => expect(document.querySelector('[data-testid="build-menu"]')).toBeNull())
  })
})
