import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { page as browserPage } from 'vitest/browser'
import { flushPromises, mount } from '@vue/test-utils'

import '../assets/main.css'
import AppsView from './AppsView.vue'
import type { AppCard, AppPagePlacement, AppPageStatus } from '../types/ipc'

const FOUR_COLUMN_PAGE_WIDTH = 1172
const MEDIUM_PAGE_WIDTH = 900
const NARROW_PAGE_WIDTH = 532
const COVER =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

const CUTOUT: AppCard = {
  id: 'remove-background',
  title: 'Remove Background',
  description: 'Cut the subject out of a picture or video.',
  coverUrl: COVER
}
const HDR: AppCard = {
  id: 'sdr-to-hdr',
  title: 'SDR to HDR',
  description: 'Give a picture or video HDR brightness.',
  coverUrl: COVER
}
const GENJUTSU: AppCard = {
  id: 'genjutsu',
  title: 'Genjutsu',
  description: 'Move a character with the motion from a clip.',
  coverUrl: null
}

const listApps = vi.fn<() => Promise<AppCard[]>>()
const showAppPage = vi.fn<(appId: string, placement: AppPagePlacement) => Promise<AppPageStatus>>()
const hideAppPage = vi.fn()

const mountPointFillsThePage = document.createElement('style')
mountPointFillsThePage.textContent =
  '[data-apps-page] > div { display: flex; flex: 1 1 auto; flex-direction: column; min-width: 0; }'
document.head.append(mountPointFillsThePage)

let page: HTMLElement
let appPageClosed: () => void = () => {}

async function mountApps(apps: AppCard[] | Promise<AppCard[]> = [CUTOUT, HDR, GENJUTSU]) {
  listApps.mockReturnValue(Promise.resolve(apps))
  const wrapper = mount(AppsView, { attachTo: page })
  await flushPromises()
  return wrapper
}

function columnCount(wrapper: Awaited<ReturnType<typeof mountApps>>): number {
  const lefts = wrapper
    .findAll('[data-testid="apps-grid"] > li')
    .map((item) => Math.round(item.element.getBoundingClientRect().left))
  return new Set(lefts).size
}

beforeAll(() => browserPage.viewport(1440, 900))

beforeEach(() => {
  vi.clearAllMocks()
  page = document.createElement('div')
  page.dataset.appsPage = ''
  page.style.cssText = `position: fixed; display: flex; left: 0; top: 0; width: ${FOUR_COLUMN_PAGE_WIDTH}px; height: 840px`
  document.body.append(page)
  showAppPage.mockResolvedValue('loading')
  ;(window as unknown as { api: unknown }).api = {
    listApps,
    showAppPage,
    captureAppPage: vi.fn().mockResolvedValue(null),
    hideAppPage,
    reloadAppPage: vi.fn(),
    onAppPageStatusChanged: vi.fn(() => () => {}),
    onAppPageClosed: (listener: () => void) => {
      appPageClosed = listener
      return () => {}
    }
  }
})

afterEach(() => page.remove())

describe('AppsView', () => {
  it('lists every app as a card with its picture, name and one line on what it does', async () => {
    const wrapper = await mountApps()

    expect(wrapper.get('h1').text()).toBe('Apps')
    const card = wrapper.get('[data-testid="app-card-remove-background"]')
    expect(card.text()).toContain('Remove Background')
    expect(card.text()).toContain('Cut the subject out of a picture or video.')
    expect(card.get('img').attributes('src')).toBe(COVER)
    expect(wrapper.findAll('[data-testid="apps-grid"] button')).toHaveLength(3)
  })

  it('shows a glyph instead of a picture for an app with no cover', async () => {
    const wrapper = await mountApps()
    const card = wrapper.get('[data-testid="app-card-genjutsu"]')

    expect(card.find('img').exists()).toBe(false)
    expect(card.find('[data-testid="app-card-no-cover"]').exists()).toBe(true)
  })

  it('swaps a picture that fails to load for the glyph', async () => {
    const wrapper = await mountApps([{ ...CUTOUT, coverUrl: 'data:image/png;base64,broken' }])
    const card = wrapper.get('[data-testid="app-card-remove-background"]')

    await expect.poll(() => card.find('[data-testid="app-card-no-cover"]').exists()).toBe(true)
    expect(card.find('img').exists()).toBe(false)
  })

  it.each([
    ['four across at the width of the design', FOUR_COLUMN_PAGE_WIDTH, 4],
    ['three across on a medium page', MEDIUM_PAGE_WIDTH, 3],
    ['two across in the smallest window', NARROW_PAGE_WIDTH, 2]
  ])('lays the cards out %s', async (_name, width, columns) => {
    page.style.width = `${width}px`
    const wrapper = await mountApps([CUTOUT, HDR, GENJUTSU, { ...HDR, id: 'four' }])

    expect(columnCount(wrapper)).toBe(columns)
  })

  it('sizes a card as the design does: 4px around a 505 by 316 picture, 13px text', async () => {
    const wrapper = await mountApps()
    const card = wrapper.get('[data-testid="app-card-remove-background"]')
    const picture = card.get('img').element.parentElement as HTMLElement
    const cardBox = card.element.getBoundingClientRect()
    const pictureBox = picture.getBoundingClientRect()

    expect(Math.round(pictureBox.left - cardBox.left)).toBe(4)
    expect(Math.round(pictureBox.top - cardBox.top)).toBe(4)
    expect(pictureBox.width / pictureBox.height).toBeCloseTo(505 / 316, 2)
    expect(getComputedStyle(card.element).borderRadius).toBe('12px')
    expect(getComputedStyle(picture).borderRadius).toBe('8px')
    expect(getComputedStyle(card.get('span.font-medium').element).fontSize).toBe('13px')
  })

  it('narrows the cards to the apps whose name or description matches the search', async () => {
    const wrapper = await mountApps()

    await wrapper.get('input').setValue('hdr')
    expect(wrapper.findAll('[data-testid="apps-grid"] button')).toHaveLength(1)
    expect(wrapper.find('[data-testid="app-card-sdr-to-hdr"]').exists()).toBe(true)

    await wrapper.get('input').setValue('MOTION from')
    expect(wrapper.find('[data-testid="app-card-genjutsu"]').exists()).toBe(true)

    await wrapper.get('input').setValue('spreadsheet')
    expect(wrapper.get('[data-testid="apps-no-matches"]').text()).toBe(
      'No apps match “spreadsheet”'
    )
  })

  it('shows placeholder cards while the list loads', async () => {
    let finish: (apps: AppCard[]) => void = () => {}
    const wrapper = await mountApps(new Promise((resolve) => (finish = resolve)))

    expect(wrapper.findAll('[data-testid="apps-loading"] > li')).toHaveLength(8)

    finish([CUTOUT])
    await flushPromises()

    expect(wrapper.find('[data-testid="apps-loading"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="app-card-remove-background"]').exists()).toBe(true)
  })

  it('says there are no apps yet when the list is empty', async () => {
    const wrapper = await mountApps([])

    expect(wrapper.get('[data-testid="apps-empty"]').text()).toContain('No apps yet')
  })

  it('says the apps did not load and loads them again on Try again', async () => {
    const wrapper = await mountApps(Promise.reject(new Error('offline')))
    expect(wrapper.get('[data-testid="apps-failed"]').text()).toContain("Apps didn't load")

    listApps.mockResolvedValue([CUTOUT])
    await wrapper.get('[data-testid="apps-retry"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="apps-failed"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="app-card-remove-background"]').exists()).toBe(true)
  })

  it('opens an app from its card in place of the cards', async () => {
    const wrapper = await mountApps()

    await wrapper.get('[data-testid="app-card-sdr-to-hdr"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="app-page-host"]').attributes('aria-label')).toBe('SDR to HDR')
    expect(wrapper.get('[data-testid="apps-view"]').isVisible()).toBe(false)
    expect(wrapper.emitted('app-open-change')).toEqual([[true]])
    expect(showAppPage).toHaveBeenCalledWith(
      'sdr-to-hdr',
      expect.objectContaining({ justOpened: true })
    )
  })

  it('places the app over the whole Apps page the first time, not in the room the cards leave', async () => {
    const wrapper = await mountApps()
    const pageBox = page.getBoundingClientRect()

    await wrapper.get('[data-testid="app-card-sdr-to-hdr"]').trigger('click')

    expect(showAppPage).toHaveBeenCalledTimes(1)
    expect(showAppPage.mock.calls[0]?.[1]).toMatchObject({
      x: pageBox.x,
      y: pageBox.y,
      width: pageBox.width,
      height: pageBox.height
    })
  })

  it("returns to the cards, on the card that was opened, when the app's page goes back to all apps", async () => {
    const wrapper = await mountApps()
    await wrapper.get('input').setValue('hdr')
    await wrapper.get('[data-testid="app-card-sdr-to-hdr"]').trigger('click')
    await flushPromises()

    appPageClosed()
    await flushPromises()

    expect(wrapper.find('[data-testid="app-page-host"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="apps-view"]').isVisible()).toBe(true)
    expect(wrapper.emitted('app-open-change')).toEqual([[true], [false]])
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('hdr')
    expect(document.activeElement).toBe(wrapper.get('[data-testid="app-card-sdr-to-hdr"]').element)
    expect(hideAppPage).toHaveBeenCalled()
  })

  it('returns to the cards when Apps is picked in the sidebar again', async () => {
    const wrapper = await mountApps()
    await wrapper.get('[data-testid="app-card-genjutsu"]').trigger('click')
    await flushPromises()

    await wrapper.setProps({ revisit: 1 })
    await flushPromises()

    expect(wrapper.find('[data-testid="app-page-host"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="apps-view"]').isVisible()).toBe(true)
  })

  it('lists the apps in the order the website gave them', async () => {
    const wrapper = await mountApps([GENJUTSU, CUTOUT, HDR])

    expect(
      wrapper
        .findAll('[data-testid="apps-grid"] button')
        .map((card) => card.attributes('data-testid'))
    ).toEqual(['app-card-genjutsu', 'app-card-remove-background', 'app-card-sdr-to-hdr'])
  })
})
