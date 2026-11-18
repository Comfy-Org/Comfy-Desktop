import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { page as browserPage, userEvent } from 'vitest/browser'
import { flushPromises, mount } from '@vue/test-utils'

import '../assets/main.css'
import AppsView from './AppsView.vue'
import AppPageHost from './AppPageHost.vue'
import type { AppBadge, AppCard, AppPagePlacement, AppPageStatus } from '../types/ipc'

const WIDE_PAGE_WIDTH = 1172
const MEDIUM_PAGE_WIDTH = 900
const NARROW_PAGE_WIDTH = 532
const COVER =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

const CROWN: AppBadge = {
  id: 'uses-credits',
  style: 'crown',
  text: { en: 'Uses credits' },
  description: { en: 'Runs a paid partner model' }
}
const NEW_CHIP: AppBadge = { id: 'new', style: 'chip', text: { en: 'New' } }

const CUTOUT: AppCard = {
  id: 'remove-background',
  title: 'Remove Background',
  description: 'Cut the subject out of a picture or video.',
  covers: [{ url: COVER, stillUrl: null }],
  badges: [CROWN, NEW_CHIP]
}
const HDR: AppCard = {
  id: 'sdr-to-hdr',
  title: 'SDR to HDR',
  description: 'Give a picture or video HDR brightness.',
  covers: [{ url: COVER, stillUrl: null }]
}
const GENJUTSU: AppCard = {
  id: 'genjutsu',
  title: 'Genjutsu',
  description: 'Move a character with the motion from a clip.',
  covers: [],
  badges: [NEW_CHIP]
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

async function mountApps(
  apps: AppCard[] | Promise<AppCard[]> = [CUTOUT, HDR, GENJUTSU],
  props: { startWith?: AppCard } = {}
) {
  listApps.mockReturnValue(Promise.resolve(apps))
  const wrapper = mount(AppsView, { attachTo: page, props })
  await flushPromises()
  return wrapper
}

function rowSizes(wrapper: Awaited<ReturnType<typeof mountApps>>): number[] {
  const rows = new Map<number, number>()
  for (const item of wrapper.findAll('[data-testid="apps-grid"] > li')) {
    const top = Math.round(item.element.getBoundingClientRect().top)
    rows.set(top, (rows.get(top) ?? 0) + 1)
  }
  return [...rows.keys()].sort((a, b) => a - b).map((top) => rows.get(top) ?? 0)
}

function manyApps(count: number): AppCard[] {
  return Array.from({ length: count }, (_, index) => ({ ...HDR, id: `app-${index}` }))
}

beforeAll(() => browserPage.viewport(1440, 900))

beforeEach(() => {
  vi.clearAllMocks()
  page = document.createElement('div')
  page.dataset.appsPage = ''
  page.style.cssText = `position: fixed; display: flex; left: 0; top: 0; width: ${WIDE_PAGE_WIDTH}px; height: 840px`
  document.body.append(page)
  showAppPage.mockResolvedValue('loading')
  ;(window as unknown as { api: unknown }).api = {
    listApps,
    showAppPage,
    captureAppPage: vi.fn().mockResolvedValue(null),
    hideAppPage,
    onAppPageStatusChanged: vi.fn(() => () => {}),
    onAppOutputs: vi.fn(() => () => {}),
    onAppPageClosed: (listener: () => void) => {
      appPageClosed = listener
      return () => {}
    }
  }
})

afterEach(() => {
  page.remove()
  delete document.documentElement.dataset.theme
})

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

  it("plays an app's covers on its card, one shown and the next loading behind it", async () => {
    const covers = ['red', 'green', 'blue'].map((fill) => ({
      url: `data:image/svg+xml,${encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="5"><rect width="8" height="5" fill="${fill}"/></svg>`
      )}`,
      stillUrl: null
    }))
    const wrapper = await mountApps([{ ...CUTOUT, covers }])
    const card = wrapper.get('[data-testid="app-card-remove-background"]')
    const urls = covers.map((cover) => cover.url)

    expect(urls).toContain(card.get('img[data-cover="shown"]').attributes('src'))
    expect(urls).toContain(card.get('img[data-cover="upcoming"]').attributes('src'))
    expect(card.get('img[data-cover="upcoming"]').attributes('src')).not.toBe(
      card.get('img[data-cover="shown"]').attributes('src')
    )
  })

  it('shows a glyph instead of a picture for an app with no cover', async () => {
    const wrapper = await mountApps()
    const card = wrapper.get('[data-testid="app-card-genjutsu"]')

    expect(card.find('img').exists()).toBe(false)
    expect(card.find('[data-testid="app-card-no-cover"]').exists()).toBe(true)
  })

  it('swaps a picture that fails to load for the glyph', async () => {
    const wrapper = await mountApps([
      { ...CUTOUT, covers: [{ url: 'data:image/png;base64,broken', stillUrl: null }] }
    ])
    const card = wrapper.get('[data-testid="app-card-remove-background"]')

    await expect.poll(() => card.find('[data-testid="app-card-no-cover"]').exists()).toBe(true)
    expect(card.find('img').exists()).toBe(false)
  })

  it.each([
    ['three big then four small at the width of the design', WIDE_PAGE_WIDTH, [3, 4, 3]],
    ['two big then three small on a medium page', MEDIUM_PAGE_WIDTH, [2, 3, 2, 3]],
    ['two across in the smallest window', NARROW_PAGE_WIDTH, [2, 2, 2, 2, 2]]
  ])('lays the cards out in rows, %s', async (_name, width, rows) => {
    page.style.width = `${width}px`
    const wrapper = await mountApps(manyApps(rows.reduce((sum, size) => sum + size, 0)))

    expect(rowSizes(wrapper)).toEqual(rows)
    for (const card of wrapper.findAll('[data-testid="apps-grid"] button')) {
      const box = card.element.getBoundingClientRect()
      expect(box.width / box.height).toBeCloseTo(1, 2)
    }
  })

  it('makes a card in a big row larger than a card in a small row', async () => {
    const wrapper = await mountApps(manyApps(7))
    const cards = wrapper.findAll('[data-testid="apps-grid"] button')
    const big = cards[0]!.element.getBoundingClientRect().width
    const small = cards[3]!.element.getBoundingClientRect().width

    expect(big).toBeGreaterThan(small)
  })

  it('puts the picture under the whole card, the name on it and the rest for hover', async () => {
    const wrapper = await mountApps()
    const card = wrapper.get('[data-testid="app-card-remove-background"]')
    const cardBox = card.element.getBoundingClientRect()
    const pictureBox = card.get('[data-testid="app-card-picture"]').element.getBoundingClientRect()
    const name = card.get('[data-testid="app-card-name"]').element
    const line = card.get('span.self-end').element

    expect(Math.round(pictureBox.width)).toBe(Math.round(cardBox.width))
    expect(Math.round(pictureBox.height)).toBe(Math.round(cardBox.height))
    expect(getComputedStyle(card.element).borderRadius).toBe('12px')
    expect(getComputedStyle(name).fontSize).toBe('14px')
    expect(name.getBoundingClientRect().bottom).toBeLessThanOrEqual(cardBox.bottom)
    expect(getComputedStyle(line).opacity).toBe('0')
    expect(getComputedStyle(card.get('[data-testid="app-card-go"]').element).opacity).toBe('0')
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

    expect(wrapper.findAll('[data-testid="apps-loading"] > li')).toHaveLength(7)

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

  it("passes on the Cloud file an app's output dialog asks to see in Assets", async () => {
    const wrapper = await mountApps()
    await wrapper.get('[data-testid="app-card-remove-background"]').trigger('click')
    await flushPromises()

    wrapper.findComponent(AppPageHost).vm.$emit('view-in-assets', 'cutout.png')

    expect(wrapper.emitted('view-in-assets')).toEqual([['cutout.png']])
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

  it('opens straight on the app that was picked on Home, over the whole Apps page', async () => {
    const pageBox = page.getBoundingClientRect()
    const wrapper = await mountApps([CUTOUT, HDR, GENJUTSU], { startWith: HDR })

    expect(wrapper.get('[data-testid="app-page-host"]').attributes('aria-label')).toBe('SDR to HDR')
    expect(wrapper.get('[data-testid="apps-view"]').isVisible()).toBe(false)
    expect(wrapper.emitted('app-open-change')).toEqual([[true]])
    expect(wrapper.emitted('update:startWith'), 'the pick is handed back as used').toEqual([[null]])
    expect(showAppPage).toHaveBeenCalledWith(
      'sdr-to-hdr',
      expect.objectContaining({
        justOpened: true,
        x: pageBox.x,
        y: pageBox.y,
        width: pageBox.width,
        height: pageBox.height
      })
    )
  })

  it("goes from an app picked on Home back to all the cards, on that app's card", async () => {
    const wrapper = await mountApps([CUTOUT, HDR, GENJUTSU], { startWith: HDR })

    appPageClosed()
    await flushPromises()

    expect(wrapper.find('[data-testid="app-page-host"]').exists()).toBe(false)
    expect(
      wrapper
        .findAll('[data-testid="apps-grid"] button')
        .map((card) => card.attributes('data-testid'))
    ).toEqual(['app-card-remove-background', 'app-card-sdr-to-hdr', 'app-card-genjutsu'])
    expect(document.activeElement).toBe(wrapper.get('[data-testid="app-card-sdr-to-hdr"]').element)
  })

  it("draws an app's badges on the top left of its picture, the crown alone in the credits gold, and none on an app without badges", async () => {
    const wrapper = await mountApps()

    const card = wrapper.get('[data-testid="app-card-remove-background"]')
    const badges = card.get('[data-testid="app-badges"]')
    const picture = card.get('[data-testid="app-card-picture"]').element.getBoundingClientRect()
    const badgesBox = badges.element.getBoundingClientRect()
    expect(Math.round(badgesBox.left - picture.left)).toBe(8)
    expect(Math.round(badgesBox.top - picture.top)).toBe(8)
    expect(
      badges.findAll('[data-badge-style]').map((badge) => badge.attributes('data-badge-style'))
    ).toEqual(['crown'])
    expect(Math.round(badgesBox.width)).toBe(28)
    document.documentElement.dataset.theme = 'dark'
    expect(getComputedStyle(badges.get('[data-testid="app-badge-crown"]').element).color).toBe(
      'rgb(233, 196, 34)'
    )
    expect(
      wrapper
        .get('[data-testid="app-card-genjutsu"]')
        .find('[data-testid="app-badge-new"]')
        .exists()
    ).toBe(true)
    expect(
      wrapper.get('[data-testid="app-card-sdr-to-hdr"]').find('[data-testid="app-badges"]').exists()
    ).toBe(false)
  })

  it('describes a card with each of its badges for screen readers, and a card without badges with none', async () => {
    const wrapper = await mountApps()

    const card = wrapper.get('[data-testid="app-card-remove-background"]')
    const ids = card.attributes('aria-describedby')?.split(' ') ?? []
    const notes = ids.map((id) => document.getElementById(id)?.textContent)
    expect(notes).toEqual(['Uses credits: Runs a paid partner model', 'New'])
    expect(wrapper.get('[data-testid="app-card-sdr-to-hdr"]').attributes('aria-describedby')).toBe(
      undefined
    )
  })

  it("shows the first badge's description when a card with badges gets keyboard focus, and not for a card without", async () => {
    const wrapper = await mountApps()

    wrapper.get('input').element.focus()
    await userEvent.tab()

    expect(document.activeElement).toBe(
      wrapper.get('[data-testid="app-card-remove-background"]').element
    )
    await expect
      .poll(() => document.querySelector('.tooltip-bubble')?.textContent ?? '')
      .toContain('Runs a paid partner model')

    await userEvent.tab()

    expect(document.activeElement).toBe(wrapper.get('[data-testid="app-card-sdr-to-hdr"]').element)
    await expect.poll(() => document.querySelector('.tooltip-bubble')).toBe(null)
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
