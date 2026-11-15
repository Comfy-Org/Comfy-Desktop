import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { page as browserPage } from 'vitest/browser'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import '../assets/main.css'
import HomeView from './HomeView.vue'
import ChooserFamilyGrid from '../views/chooser/ChooserFamilyGrid.vue'
import { TID } from '../../../shared/testIds'
import type { Installation } from '../types/ipc'

const SMALLEST_WINDOW_WIDTH = 800
const LARGE_WINDOW_WIDTH = 1024
const FRAME_AND_EXPANDED_SIDEBAR_WIDTH = 16 + 8 + 244
const PAGE_SIDE_PADDING = 2 * 40
const HOME_WIDTH_IN_SMALLEST_WINDOW = SMALLEST_WINDOW_WIDTH - FRAME_AND_EXPANDED_SIDEBAR_WIDTH
const BUILDS_GRID_WIDTH_IN_LARGE_WINDOW =
  LARGE_WINDOW_WIDTH - FRAME_AND_EXPANDED_SIDEBAR_WIDTH - PAGE_SIDE_PADDING
const HOME_CARD_SIDE_PADDING_AND_BORDER = 18 + 1
const BUILDS_TILE_RIGHT_PADDING = 12
const READABLE_NAME_WIDTH = 40

function build(id: string, name: string, lastLaunchedAt: number): Installation {
  return { id, name, lastLaunchedAt, sourceLabel: 'Standalone', sourceCategory: 'local' }
}

const STUDIO = build('studio', 'Flux Sandbox for the long weekend render', 400)
const PORTRAITS = build('portraits', 'Portrait retouching with the new upscaler', 300)

let page: HTMLElement

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
    getSetting: vi.fn().mockResolvedValue('none'),
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

afterEach(() => page.remove())

describe('Auto start on Home build cards in the smallest window with the sidebar open', () => {
  it('leaves each build name the width the card has after its picture, with the box on a row under the card', async () => {
    page.style.cssText = `position: absolute; left: 0; top: 0; width: ${HOME_WIDTH_IN_SMALLEST_WINDOW}px`
    const wrapper = mount(HomeView, { attachTo: page })
    await flushPromises()

    for (const { id } of [STUDIO, PORTRAITS]) {
      const card = onlyIn(wrapper, `div[data-testid="home-build"][data-build-id="${id}"]`)
      const name = card.querySelector('.font-semibold')!
      const box = onlyIn(wrapper, `[data-testid="home-build-auto-start"][data-build-id="${id}"]`)
      const cardBox = boxOf(card)
      const nameBox = boxOf(name)
      const checkboxBox = boxOf(box)

      expect(nameBox.width, `${id} name width`).toBeGreaterThanOrEqual(READABLE_NAME_WIDTH)
      expect(
        Math.abs(cardBox.right - HOME_CARD_SIDE_PADDING_AND_BORDER - nameBox.right),
        `${id} name stops at the card's padding`
      ).toBeLessThanOrEqual(1)
      expect(card.contains(box), `${id} box sits outside the card button`).toBe(false)
      expect(checkboxBox.top, `${id} box is under the card`).toBeGreaterThanOrEqual(cardBox.bottom)
      expect(checkboxBox.width, `${id} box is shown`).toBeGreaterThan(0)
      expect(checkboxBox.left).toBeGreaterThanOrEqual(cardBox.left)
      expect(checkboxBox.right).toBeLessThanOrEqual(cardBox.right)
    }
  })
})

describe('Auto start on Builds page tiles in a 1024 px window with the sidebar open', () => {
  it('keeps the name readable and every button inside the tile, with the box on a row under Start', async () => {
    page.style.cssText = `position: absolute; left: 0; top: 0; width: ${BUILDS_GRID_WIDTH_IN_LARGE_WINDOW}px`
    const wrapper = mount(ChooserFamilyGrid, {
      attachTo: page,
      props: { installations: [STUDIO, PORTRAITS], isStoppedActionGated: () => false }
    })
    await flushPromises()

    for (const { id } of [STUDIO, PORTRAITS]) {
      const tile = onlyIn(wrapper, `[data-testid="${TID.dashboardTile(id)}"]`)
      const name = tile.querySelector('.chooser-tile-name')!
      const start = tile.querySelector('.chooser-tile-launch')!
      const kebab = tile.querySelector('.chooser-tile-kebab')!
      const box = onlyIn(wrapper, `[data-testid="chooser-tile-auto-start-${id}"]`)
      const tileBox = boxOf(tile)
      const checkboxBox = boxOf(box)

      expect(boxOf(name).width, `${id} name width`).toBeGreaterThanOrEqual(READABLE_NAME_WIDTH)
      expect(boxOf(kebab).right, `${id} menu button is not cut off`).toBeLessThanOrEqual(
        tileBox.right - BUILDS_TILE_RIGHT_PADDING + 0.5
      )
      expect(checkboxBox.top, `${id} box is under Start`).toBeGreaterThanOrEqual(
        boxOf(start).bottom
      )
      expect(checkboxBox.width, `${id} box is shown`).toBeGreaterThan(0)
      expect(checkboxBox.right).toBeLessThanOrEqual(tileBox.right)
      expect(checkboxBox.bottom).toBeLessThanOrEqual(tileBox.bottom)
    }
  })
})
