import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { page, userEvent } from 'vitest/browser'
import { createPinia, setActivePinia } from 'pinia'

import '../assets/main.css'
import AppSidebar from './AppSidebar.vue'
import { stubWindowApi } from '../lib/stubWindowApi'
import { useInstallationStore } from '../stores/installationStore'
import type { DashboardPage, Installation } from '../types/ipc'

const BUILD: Installation = {
  id: 'flux',
  name: 'Flux Sandbox',
  sourceLabel: 'Standalone',
  sourceCategory: 'local',
  lastLaunchedAt: 100
}

let wrapper: VueWrapper | null = null

beforeEach(async () => {
  document.documentElement.classList.add('dark')
  document.documentElement.dataset.theme = 'dark'
  window.localStorage.clear()
  await page.viewport(1280, 800)
  setActivePinia(createPinia())
  stubWindowApi({
    navigatePanel: vi.fn(),
    getAppsEnabled: vi.fn().mockResolvedValue(false),
    getAppUpdateState: vi.fn().mockResolvedValue({ kind: null, version: null, autoUpdate: true }),
    onAppUpdateStateChanged: vi.fn(() => () => {}),
    getInstallations: vi.fn().mockResolvedValue([]),
    onInstallationsChanged: vi.fn(() => () => {}),
    onInstallationsVersionsUpdated: vi.fn(() => () => {}),
    getSetting: vi.fn().mockResolvedValue(undefined),
    setSetting: vi.fn().mockResolvedValue(undefined),
    onSettingsChanged: vi.fn(() => () => {}),
    refreshCreditBalance: vi.fn().mockResolvedValue({ status: 'signed_out' }),
    onCreditBalanceChanged: vi.fn(() => () => {}),
    onAppPageClosed: vi.fn(() => () => {}),
    comfybuilder: {
      getAuthStatus: vi.fn().mockResolvedValue({ signedIn: false }),
      onAuthChanged: vi.fn(() => () => {})
    }
  })
})

afterEach(async () => {
  await userEvent.unhover(document.body)
  wrapper?.unmount()
  wrapper = null
})

async function mountSidebar(activePage: DashboardPage): Promise<HTMLElement> {
  useInstallationStore().installations = [BUILD]
  wrapper = mount(AppSidebar, {
    props: { activePage, activeBuildId: null },
    attachTo: document.body
  })
  await flushPromises()
  return wrapper.element as HTMLElement
}

const byTestId = (root: Element, id: string) =>
  root.querySelector<HTMLElement>(`[data-testid="${id}"]`)!
const box = (el: Element) => el.getBoundingClientRect()
const paintedOverSidebar = (el: Element) => {
  const ctx = document.createElement('canvas').getContext('2d')!
  ctx.fillStyle = getComputedStyle(document.querySelector('aside') ?? document.body).backgroundColor
  ctx.fillRect(0, 0, 1, 1)
  ctx.fillStyle = getComputedStyle(el).backgroundColor
  ctx.fillRect(0, 0, 1, 1)
  return Array.from(ctx.getImageData(0, 0, 1, 1).data).join(',')
}
const TRANSPARENT = 'rgba(0, 0, 0, 0)'
const textBox = (el: Element) => {
  const range = document.createRange()
  range.selectNodeContents(el)
  return range.getBoundingClientRect()
}
const settled = () => new Promise((resolve) => setTimeout(resolve, 250))

describe('the sidebar Builds title reads like the other sidebar rows', () => {
  it('has no arrow: the button is just the uppercase word, inside its padding', async () => {
    const root = await mountSidebar('home')
    const title = byTestId(root, 'app-sidebar-chooser')

    expect(title.querySelector('svg')).toBeNull()
    const text = textBox(title)
    const frame = box(title)
    expect(Math.round(text.left - frame.left)).toBe(6)
    expect(Math.round(frame.right - text.right)).toBe(6)
    expect(getComputedStyle(title).textTransform).toBe('uppercase')
    expect(frame.height).toBe(22)
  })

  it('starts its text on the same edge as the build rows under it', async () => {
    const root = await mountSidebar('home')
    const title = byTestId(root, 'app-sidebar-chooser')
    const buildIcon = byTestId(root, 'app-sidebar-build-flux').querySelector('svg')!

    expect(Math.round(textBox(title).left)).toBe(Math.round(box(buildIcon).left))
  })

  it('takes the same hover fill as a sidebar row, and none at rest', async () => {
    const root = await mountSidebar('chooser')
    const home = byTestId(root, 'app-sidebar-home')
    await userEvent.hover(home)
    await settled()
    const rowHover = paintedOverSidebar(home)
    await userEvent.unhover(home)

    wrapper!.unmount()
    const fresh = await mountSidebar('home')
    const title = byTestId(fresh, 'app-sidebar-chooser')
    await settled()
    expect(getComputedStyle(title).backgroundColor).toBe(TRANSPARENT)

    await userEvent.hover(title)
    await settled()
    expect(rowHover).not.toBe(paintedOverSidebar(fresh))
    expect(paintedOverSidebar(title)).toBe(rowHover)
  })

  it('is lit with the selected row fill on the Builds page', async () => {
    const homeRoot = await mountSidebar('home')
    const selectedRow = paintedOverSidebar(byTestId(homeRoot, 'app-sidebar-home'))
    wrapper!.unmount()

    const root = await mountSidebar('chooser')
    const title = byTestId(root, 'app-sidebar-chooser')
    await settled()

    expect(title.getAttribute('aria-current')).toBe('page')
    expect(paintedOverSidebar(title)).toBe(selectedRow)
    await userEvent.hover(title)
    await settled()
    expect(paintedOverSidebar(title), 'hover keeps the selected fill').toBe(selectedRow)
  })
})
