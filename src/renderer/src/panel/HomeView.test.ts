import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import HomeView from './HomeView.vue'
import { HOME_BUILD_TONES } from './home/homeBuild'
import { useDashboardScopeStore } from '../stores/dashboardScopeStore'
import { useProgressStore } from '../stores/progressStore'
import { useAuthStore } from '../stores/authStore'
import { useSessionStore } from '../stores/sessionStore'
import type { AppCard, Installation, RecentWorkflow } from '../types/ipc'

const listApps = vi.fn<() => Promise<AppCard[]>>()
const getInstallations = vi.fn<() => Promise<Installation[]>>()
const getAuthStatus = vi.fn<() => Promise<{ signedIn: boolean }>>()
const listRecentWorkflows = vi.fn<(buildIds: string[]) => Promise<RecentWorkflow[]>>()
const openRecentWorkflow =
  vi.fn<(installationId: string, path: string) => Promise<{ opened: boolean; error?: string }>>()

function app(id: string, title: string): AppCard {
  return { id, title, description: '', covers: [] }
}

function pictured(card: AppCard, url: string): AppCard {
  return { ...card, covers: [{ url, stillUrl: url }] }
}

function build(over: Partial<Installation> & { id: string; name: string }): Installation {
  return { sourceLabel: 'Standalone', sourceCategory: 'local', status: 'installed', ...over }
}

const UPSCALE_PICTURE = 'https://comfy.org/apps-media/upscale/v1'
const UPSCALE: AppCard = {
  id: 'upscale',
  title: 'Upscale and restore detail',
  description: 'Enlarge an image and restore fine detail.',
  covers: [{ url: UPSCALE_PICTURE, stillUrl: UPSCALE_PICTURE }]
}
const TALK = app('talk', 'Make your character talk')
const SEVEN_APPS = Array.from({ length: 7 }, (_, index) => app(`app-${index}`, `App ${index}`))

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const NOW = new Date(2026, 10, 20, 15, 0).getTime()

const OLDEST = build({
  id: 'oldest',
  name: 'Flux Sandbox',
  lastLaunchedAt: NOW - 3 * DAY_MS,
  version: 'v0.42.4',
  installPath: '/Users/pablo/ComfyUI-Installs/Flux'
})
const CLOUD = build({
  id: 'cloud',
  name: 'Comfy Cloud',
  sourceId: 'cloud',
  sourceLabel: 'Cloud',
  sourceCategory: 'cloud',
  listPreview: 'https://cloud.comfy.org/',
  lastLaunchedAt: NOW - DAY_MS - HOUR_MS
})
const RUNNING = build({ id: 'running', name: 'Video Lab', lastLaunchedAt: NOW - 2 * HOUR_MS })
const NEWEST = build({
  id: 'newest',
  name: 'My Local 1',
  lastLaunchedAt: NOW - 5 * MINUTE_MS,
  statusTag: { style: 'update', label: 'Update available' }
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.clearAllMocks()
  listApps.mockResolvedValue([])
  getInstallations.mockResolvedValue([])
  getAuthStatus.mockResolvedValue({ signedIn: false })
  listRecentWorkflows.mockResolvedValue([])
  openRecentWorkflow.mockResolvedValue({ opened: true })
  ;(window as unknown as { api: unknown }).api = {
    listApps,
    listRecentWorkflows,
    openRecentWorkflow,
    getInstallations,
    onInstallationsChanged: vi.fn(() => () => {}),
    onInstallationsVersionsUpdated: vi.fn(() => () => {}),
    getSetting: vi.fn().mockResolvedValue(undefined),
    setSetting: vi.fn().mockResolvedValue(undefined),
    onSettingsChanged: vi.fn(() => () => {}),
    comfybuilder: {
      getAuthStatus,
      onAuthChanged: vi.fn(() => () => {})
    }
  }
  setActivePinia(createPinia())
})

const mounted: VueWrapper[] = []

afterEach(() => {
  while (mounted.length) mounted.pop()?.unmount()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function openHome() {
  const wrapper = mount(HomeView, { attachTo: document.body })
  mounted.push(wrapper)
  await flushPromises()
  return wrapper
}

function arc(wrapper: VueWrapper): string[] {
  return wrapper
    .findAll('[data-testid="home-carousel-card"]:not([aria-hidden="true"])')
    .map((card) => ({
      offset: Number(card.attributes('data-arc-offset')),
      text: card.get('[data-testid="home-carousel-name"]').text()
    }))
    .sort((left, right) => left.offset - right.offset)
    .map((card) => `${card.offset}:${card.text}`)
}

function cardAt(wrapper: VueWrapper, offset: number) {
  return wrapper.get(`[data-testid="home-carousel-card"][data-arc-offset="${offset}"]`)
}

function pressCarouselAt(wrapper: VueWrapper, clientX: number): void {
  wrapper
    .get('[data-testid="home-carousel"]')
    .element.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX, bubbles: true }))
}

async function openBuildMenu(wrapper: VueWrapper): Promise<void> {
  await wrapper.get('[data-testid="home-open-build-menu"]').trigger('keydown', { key: 'ArrowDown' })
  await flushPromises()
}

function buildOptions(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-testid="home-open-build-option"]')]
}

describe('Home carousel', () => {
  it('puts the first app in front with its neighbours on either side', async () => {
    listApps.mockResolvedValue(SEVEN_APPS)
    const wrapper = await openHome()

    expect(arc(wrapper)).toEqual(['-2:App 5', '-1:App 6', '0:App 0', '1:App 1', '2:App 2'])
  })

  it('brings a side card to the front when it is clicked, without opening it', async () => {
    listApps.mockResolvedValue(SEVEN_APPS)
    const wrapper = await openHome()

    await cardAt(wrapper, 1).trigger('click')

    expect(cardAt(wrapper, 0).text()).toContain('App 1')
    expect(wrapper.emitted('open-app')).toBeUndefined()
  })

  it('slides a card two places away to the front as the same card, with the next ones already waiting off stage', async () => {
    listApps.mockResolvedValue(SEVEN_APPS)
    const wrapper = await openHome()
    const twoAway = cardAt(wrapper, 2).element
    const waitingOffStage = cardAt(wrapper, 3)
    expect(waitingOffStage.text()).toBe('App 3')
    expect(waitingOffStage.attributes('aria-hidden')).toBe('true')

    await cardAt(wrapper, 2).trigger('click')

    expect(cardAt(wrapper, 0).element).toBe(twoAway)
    expect(cardAt(wrapper, 1).element).toBe(waitingOffStage.element)
    expect(arc(wrapper)).toEqual(['-2:App 0', '-1:App 1', '0:App 2', '1:App 3', '2:App 4'])
    expect(wrapper.emitted('open-app')).toBeUndefined()
  })

  it('keeps cards that are off stage out of reach of the keyboard and screen readers', async () => {
    listApps.mockResolvedValue(SEVEN_APPS)
    const wrapper = await openHome()

    const offStage = wrapper.findAll('[data-testid="home-carousel-card"][aria-hidden="true"]')

    expect(offStage.map((card) => card.text())).toEqual(['App 3', 'App 4'])
    expect(offStage.map((card) => card.attributes('tabindex'))).toEqual(['-1', '-1'])
  })

  it('loads every picture up front and fades each in once it has loaded', async () => {
    listApps.mockResolvedValue(
      SEVEN_APPS.map((entry) => pictured(entry, `https://comfy.org/apps-media/${entry.id}/v1`))
    )
    const wrapper = await openHome()
    const pictures = wrapper.findAll('[data-testid="home-carousel-card"] img')

    expect(pictures).toHaveLength(7)
    expect(pictures[4]!.attributes('data-loaded')).toBe('false')

    await pictures[4]!.trigger('load')

    expect(pictures[4]!.attributes('data-loaded')).toBe('true')
    expect(pictures[5]!.attributes('data-loaded')).toBe('false')
  })

  it('opens the app in front when it is clicked', async () => {
    listApps.mockResolvedValue(SEVEN_APPS)
    const wrapper = await openHome()
    await cardAt(wrapper, -1).trigger('click')

    await cardAt(wrapper, 0).trigger('click')

    expect(wrapper.emitted('open-app')).toEqual([[SEVEN_APPS[6]]])
  })

  it('turns the carousel with the arrow keys', async () => {
    listApps.mockResolvedValue(SEVEN_APPS)
    const wrapper = await openHome()
    const carousel = wrapper.get('[data-testid="home-carousel"]')

    await carousel.trigger('keydown', { key: 'ArrowRight' })
    await carousel.trigger('keydown', { key: 'ArrowRight' })
    expect(cardAt(wrapper, 0).text()).toContain('App 2')

    await carousel.trigger('keydown', { key: 'ArrowLeft' })
    expect(cardAt(wrapper, 0).text()).toContain('App 1')
  })

  it('turns the carousel with the previous and next arrows', async () => {
    listApps.mockResolvedValue(SEVEN_APPS)
    const wrapper = await openHome()
    const next = wrapper.get('[data-testid="home-carousel-next"]')
    const previous = wrapper.get('[data-testid="home-carousel-previous"]')

    await next.trigger('click')
    await next.trigger('click')
    expect(cardAt(wrapper, 0).text()).toContain('App 2')

    await previous.trigger('click')
    await previous.trigger('click')
    await previous.trigger('click')
    expect(cardAt(wrapper, 0).text()).toContain('App 6')
    expect(wrapper.emitted('open-app')).toBeUndefined()
  })

  it('stops the arrows at the ends of a short list and leaves them out for a single card', async () => {
    listApps.mockResolvedValue([UPSCALE, TALK])
    const wrapper = await openHome()
    const next = wrapper.get('[data-testid="home-carousel-next"]')
    const previous = wrapper.get('[data-testid="home-carousel-previous"]')

    expect(previous.attributes('disabled')).toBeDefined()
    expect(next.attributes('disabled')).toBeUndefined()

    await next.trigger('click')
    expect(cardAt(wrapper, 0).text()).toContain('Make your character talk')
    expect(next.attributes('disabled')).toBeDefined()
    expect(previous.attributes('disabled')).toBeUndefined()

    listApps.mockResolvedValue([UPSCALE])
    const single = await openHome()
    expect(single.find('[data-testid="home-carousel-next"]').exists()).toBe(false)
    expect(single.find('[data-testid="home-carousel-previous"]').exists()).toBe(false)
  })

  it('keeps keyboard focus on an arrow when the one in use reaches the end of a short list', async () => {
    listApps.mockResolvedValue([UPSCALE, TALK])
    const wrapper = await openHome()
    const next = wrapper.get<HTMLButtonElement>('[data-testid="home-carousel-next"]')
    const previous = wrapper.get<HTMLButtonElement>('[data-testid="home-carousel-previous"]')

    next.element.focus()
    await next.trigger('click')
    await flushPromises()

    expect(next.element.disabled).toBe(true)
    expect(document.activeElement).toBe(previous.element)
  })

  it('turns with the arrow keys from an arrow button and moves card focus to the new front card', async () => {
    listApps.mockResolvedValue(SEVEN_APPS)
    const wrapper = await openHome()

    const next = wrapper.get('[data-testid="home-carousel-next"]')
    await next.trigger('keydown', { key: 'ArrowRight' })
    expect(cardAt(wrapper, 0).text()).toContain('App 1')

    const front = cardAt(wrapper, 0).element as HTMLButtonElement
    front.focus()
    await cardAt(wrapper, 0).trigger('keydown', { key: 'ArrowRight' })
    await flushPromises()

    expect(cardAt(wrapper, 0).text()).toContain('App 2')
    expect(document.activeElement).toBe(cardAt(wrapper, 0).element)
  })

  it('shows the open arrow on hover of the front card only, and opens that app from it', async () => {
    listApps.mockResolvedValue(SEVEN_APPS)
    const wrapper = await openHome()
    const front = cardAt(wrapper, 0).get('[data-testid="home-carousel-cta"]')
    const side = cardAt(wrapper, 1).get('[data-testid="home-carousel-cta"]')

    expect(front.classes()).toContain('group-hover/card:opacity-100')
    expect(side.classes()).not.toContain('group-hover/card:opacity-100')
    expect(front.attributes('aria-hidden')).toBe('true')

    await front.trigger('click')

    expect(wrapper.emitted('open-app')).toEqual([[SEVEN_APPS[0]]])
  })

  it('turns the carousel when it is dragged, and does not open the card the drag ends on', async () => {
    listApps.mockResolvedValue(SEVEN_APPS)
    const wrapper = await openHome()

    pressCarouselAt(wrapper, 600)
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 290 }))
    await flushPromises()

    expect(cardAt(wrapper, 0).text()).toContain('App 2')

    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 290 }))
    await cardAt(wrapper, 0).trigger('click')

    expect(wrapper.emitted('open-app')).toBeUndefined()

    await new Promise((resolve) => setTimeout(resolve, 0))
    await cardAt(wrapper, 0).trigger('click')

    expect(wrapper.emitted('open-app')).toEqual([[SEVEN_APPS[2]]])
  })

  it('drags back the other way to earlier cards', async () => {
    listApps.mockResolvedValue(SEVEN_APPS)
    const wrapper = await openHome()

    pressCarouselAt(wrapper, 600)
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 760 }))
    await flushPromises()

    expect(cardAt(wrapper, 0).text()).toContain('App 6')
    window.dispatchEvent(new PointerEvent('pointerup'))
  })

  it('still opens the front card after a press that does not move', async () => {
    listApps.mockResolvedValue(SEVEN_APPS)
    const wrapper = await openHome()

    pressCarouselAt(wrapper, 600)
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 601 }))
    await cardAt(wrapper, 0).trigger('click')

    expect(wrapper.emitted('open-app')).toEqual([[SEVEN_APPS[0]]])
  })

  it('shows a short list once, without repeating cards around the arc', async () => {
    listApps.mockResolvedValue([UPSCALE, TALK])
    const wrapper = await openHome()

    expect(arc(wrapper)).toEqual([
      '0:Upscale and restore detailEnlarge an image and restore fine detail.',
      '1:Make your character talk'
    ])

    await wrapper.get('[data-testid="home-carousel"]').trigger('keydown', { key: 'ArrowLeft' })

    expect(cardAt(wrapper, 0).text()).toContain('Upscale and restore detail')
  })

  it('shows the picture when reduced motion is preferred', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {}
    }))
    listApps.mockResolvedValue([UPSCALE])
    const wrapper = await openHome()

    expect(cardAt(wrapper, 0).get('img').attributes('src')).toBe(UPSCALE_PICTURE)
  })

  it('shows the picture on a card and a plain card when there is none', async () => {
    listApps.mockResolvedValue([UPSCALE, TALK])
    const wrapper = await openHome()

    expect(cardAt(wrapper, 0).get('img').attributes('src')).toBe(UPSCALE_PICTURE)
    expect(cardAt(wrapper, 1).find('img').exists()).toBe(false)

    await cardAt(wrapper, 0).get('img').trigger('error')

    expect(cardAt(wrapper, 0).find('img').exists()).toBe(false)
    expect(cardAt(wrapper, 0).text()).toContain('Upscale and restore detail')
  })
})

describe('Home builds', () => {
  it('lists the three most recently used builds with what each is doing', async () => {
    getAuthStatus.mockResolvedValue({ signedIn: true })
    getInstallations.mockResolvedValue([OLDEST, CLOUD, RUNNING, NEWEST])
    const wrapper = await openHome()
    useSessionStore().runningInstances.set(RUNNING.id, {
      installationId: RUNNING.id,
      installationName: RUNNING.name,
      mode: 'window'
    })
    await flushPromises()

    expect(wrapper.findAll('[data-testid="home-build"]').map((card) => card.text())).toEqual([
      'Used 5m agoMy Local 1Standalone · Update available',
      'RunningVideo LabStandalone',
      'Used yesterdayComfy CloudRTX 6000 Pro · 96 GB'
    ])
  })

  it('keeps a running build in the row after more recently stopped builds pass it', async () => {
    getAuthStatus.mockResolvedValue({ signedIn: true })
    const stillRunning = build({
      id: 'still-running',
      name: 'ComfyUI',
      lastLaunchedAt: NOW - 3 * HOUR_MS
    })
    const stoppedNightly = build({
      id: 'nightly',
      name: 'ComfyUI Nightly',
      lastLaunchedAt: NOW - 4 * HOUR_MS,
      lastStoppedAt: NOW - 2 * MINUTE_MS
    })
    const stoppedPrivate = build({
      id: 'private',
      name: 'ComfyUI Private',
      lastLaunchedAt: NOW - 4 * HOUR_MS,
      lastStoppedAt: NOW - 1 * MINUTE_MS
    })
    getInstallations.mockResolvedValue([
      stillRunning,
      stoppedNightly,
      stoppedPrivate,
      { ...CLOUD, lastLaunchedAt: NOW - 10 * MINUTE_MS }
    ])
    const wrapper = await openHome()
    useSessionStore().runningInstances.set(stillRunning.id, {
      installationId: stillRunning.id,
      installationName: stillRunning.name,
      mode: 'window'
    })
    await flushPromises()

    expect(wrapper.findAll('[data-testid="home-build-name"]').map((name) => name.text())).toEqual([
      'ComfyUI Private',
      'ComfyUI Nightly',
      'ComfyUI'
    ])
    const hiddenWhenNarrow = wrapper
      .findAll('[data-narrow-hidden="true"]')
      .map((card) => card.get('[data-testid="home-build-name"]').text())
    expect(hiddenWhenNarrow, 'a narrow window still shows the running build').toEqual([
      'ComfyUI Nightly'
    ])
  })

  it('shows Running with the green dot while Comfy Cloud is open, like a local build', async () => {
    getAuthStatus.mockResolvedValue({ signedIn: true })
    getInstallations.mockResolvedValue([CLOUD])
    const wrapper = await openHome()
    useSessionStore().runningInstances.set(CLOUD.id, {
      installationId: CLOUD.id,
      installationName: CLOUD.name,
      mode: 'window'
    })
    await flushPromises()

    const status = wrapper.get('[data-testid="home-build-status"]')
    expect(status.text()).toBe('Running')
    expect(status.find('.rounded-full').exists()).toBe(true)
  })

  it('shows Running with the green dot while a remote build is connected', async () => {
    const studio = build({
      id: 'studio',
      name: 'Studio server',
      sourceId: 'remote',
      sourceCategory: 'remote',
      listPreview: 'http://studio.local:8188/',
      lastLaunchedAt: NOW - 3 * HOUR_MS
    })
    getInstallations.mockResolvedValue([studio])
    const wrapper = await openHome()
    useSessionStore().runningInstances.set(studio.id, {
      installationId: studio.id,
      installationName: studio.name,
      mode: 'window'
    })
    await flushPromises()

    const status = wrapper.get('[data-testid="home-build-status"]')
    expect(status.text()).toBe('Running')
    expect(status.find('.rounded-full').exists()).toBe(true)
  })

  it('asks a logged-out user to log in to use Comfy Cloud, with no icon, while local builds say when they were last used', async () => {
    getInstallations.mockResolvedValue([OLDEST, CLOUD])
    const wrapper = await openHome()

    const statusOn = (name: string) =>
      wrapper
        .findAll('[data-testid="home-build"]')
        .find((card) => card.get('[data-testid="home-build-name"]').text() === name)!
        .get('[data-testid="home-build-status"]')
    const local = statusOn(OLDEST.name)
    const cloud = statusOn(CLOUD.name)
    expect(local.text()).toBe('Used 3d ago')
    expect(cloud.text()).toBe('Log in to use')
    expect(cloud.find('svg').exists(), 'no icon next to Log in to use').toBe(false)
  })

  it('says when Comfy Cloud was last used once the user logs in, with no check icon', async () => {
    getInstallations.mockResolvedValue([CLOUD])
    const wrapper = await openHome()
    expect(wrapper.get('[data-testid="home-build-status"]').text()).toBe('Log in to use')

    useAuthStore().status = { signedIn: true }
    await flushPromises()

    const status = wrapper.get('[data-testid="home-build-status"]')
    expect(status.text()).toBe('Used yesterday')
    expect(status.find('svg').exists()).toBe(false)
  })

  it('keeps Running on top of a running build with an update, and names the update at the bottom', async () => {
    getInstallations.mockResolvedValue([NEWEST])
    const wrapper = await openHome()
    useSessionStore().runningInstances.set(NEWEST.id, {
      installationId: NEWEST.id,
      installationName: NEWEST.name,
      mode: 'window'
    })
    await flushPromises()

    const card = wrapper.get('[data-testid="home-build"]')
    expect(card.get('[data-testid="home-build-status"]').text()).toBe('Running')
    expect(card.get('[data-testid="home-build-detail"]').text()).toBe(
      'Standalone · Update available'
    )
    expect(card.get('[data-testid="home-build-open"]').attributes('aria-label')).toBe(
      'My Local 1, Running'
    )
  })

  it('keeps the update note short so the bottom line fits a narrow card', async () => {
    getInstallations.mockResolvedValue([
      {
        ...NEWEST,
        version: 'v0.3.68',
        statusTag: { style: 'update', label: 'Update available: v0.45.4' }
      }
    ])
    const wrapper = await openHome()

    expect(wrapper.get('[data-testid="home-build-detail"]').text()).toBe(
      'v0.3.68 · Update available'
    )
  })

  it('starts a build with an update from its card, saying when it was last used on top', async () => {
    getInstallations.mockResolvedValue([NEWEST])
    const wrapper = await openHome()

    const card = wrapper.get('[data-testid="home-build"]')
    expect(card.get('[data-testid="home-build-status"]').text()).toBe('Used 5m ago')
    await card.get('[data-testid="home-build-open"]').trigger('click')

    expect(wrapper.emitted('pick')?.[0]?.[0]).toMatchObject({ id: NEWEST.id })
  })

  it.each([
    ['a click', (link: HTMLElement) => userEvent.click(link)],
    [
      'Enter',
      async (link: HTMLElement) => {
        link.focus()
        await userEvent.keyboard('{Enter}')
      }
    ],
    [
      'Space',
      async (link: HTMLElement) => {
        link.focus()
        await userEvent.keyboard(' ')
      }
    ]
  ])(
    "opens the build's Update tab from Update available with %s, without starting the build",
    async (_how, activate) => {
      const openInstancePicker = vi.fn()
      Object.assign(window.api, { openInstancePicker })
      getInstallations.mockResolvedValue([NEWEST])
      const wrapper = await openHome()

      const link = wrapper.get<HTMLButtonElement>('[data-testid="build-update-open"]')
      expect(link.attributes('type')).toBe('button')
      expect(link.attributes('aria-label')).toBe('Update available: open Update for My Local 1')
      expect(link.text()).toBe('Update available')
      expect(link.find('svg').exists()).toBe(false)
      await activate(link.element)
      await flushPromises()

      expect(openInstancePicker).toHaveBeenCalledExactlyOnceWith({
        installationId: NEWEST.id,
        initialTab: 'update',
        autoAction: null
      })
      expect(wrapper.emitted('pick')).toBeUndefined()
    }
  )

  it('hides Update available while the build updates in place', async () => {
    Object.assign(window.api, {
      onInstallProgress: vi.fn(() => () => {}),
      onComfyOutput: vi.fn(() => () => {})
    })
    getInstallations.mockResolvedValue([NEWEST])
    const wrapper = await openHome()
    expect(wrapper.find('[data-testid="build-update-open"]').exists()).toBe(true)

    useProgressStore().startOperation({
      installationId: NEWEST.id,
      title: 'Updating',
      opKind: 'update',
      apiCall: () => new Promise(() => {})
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="build-update-open"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="build-update-note"]').exists()).toBe(false)
  })

  it('keeps only the latest build and Cloud when the window is narrow', async () => {
    getInstallations.mockResolvedValue([OLDEST, CLOUD, RUNNING, NEWEST])
    const wrapper = await openHome()
    const kept = wrapper
      .findAll('[data-testid="home-builds"] li:not([data-narrow-hidden])')
      .map((item) => item.get('[data-testid="home-build"] .font-semibold').text())

    expect(kept).toEqual(['My Local 1', 'Comfy Cloud'])
  })

  it('keeps the two latest builds when the window is narrow and there is no Cloud', async () => {
    getInstallations.mockResolvedValue([OLDEST, RUNNING, NEWEST])
    const wrapper = await openHome()
    const kept = wrapper
      .findAll('[data-testid="home-builds"] li:not([data-narrow-hidden])')
      .map((item) => item.get('[data-testid="home-build"] .font-semibold').text())

    expect(kept).toEqual(['My Local 1', 'Video Lab'])
  })

  it('shows a stopped local build by when it was last used, with its version and no folder path', async () => {
    getInstallations.mockResolvedValue([OLDEST])
    const wrapper = await openHome()

    expect(wrapper.get('[data-testid="home-build"]').text()).toBe('Used 3d agoFlux Sandboxv0.42.4')
    expect(wrapper.get('[data-testid="home-build-status"]').find('svg').exists()).toBe(false)
  })

  it('shows the address of a remote ComfyUI instead of hardware, and Never used before it is opened', async () => {
    getInstallations.mockResolvedValue([
      build({
        id: 'studio',
        name: 'Studio server',
        sourceId: 'remote',
        sourceCategory: 'remote',
        listPreview: 'http://studio.local:8188/'
      })
    ])
    const wrapper = await openHome()

    expect(wrapper.get('[data-testid="home-build"]').text()).toBe(
      'Never usedStudio serverstudio.local:8188'
    )
  })

  it('says No setup needed on a Comfy Cloud that was never opened, once signed in', async () => {
    getAuthStatus.mockResolvedValue({ signedIn: true })
    getInstallations.mockResolvedValue([{ ...CLOUD, lastLaunchedAt: undefined }])
    const wrapper = await openHome()

    expect(wrapper.get('[data-testid="home-build-status"]').text()).toBe('No setup needed')
  })

  it("lists only the builds of the workspace picked in the sidebar, and opens that workspace's latest", async () => {
    const teamBuild = build({
      id: 'team-build',
      name: 'Studio pipeline',
      workspaceId: 'team-1',
      lastLaunchedAt: 50
    })
    getInstallations.mockResolvedValue([OLDEST, NEWEST, teamBuild])
    const wrapper = await openHome()
    const names = () =>
      wrapper.findAll('[data-testid="home-build"] .font-semibold').map((name) => name.text())

    expect(names()).toEqual(['My Local 1', 'Flux Sandbox'])

    useDashboardScopeStore().selectedWorkspaceId = 'team-1'
    await flushPromises()

    expect(names()).toEqual(['Studio pipeline'])

    await wrapper.get('[data-testid="home-open-comfyui"]').trigger('click')

    expect(wrapper.emitted('pick')).toEqual([[teamBuild]])
  })

  it('opens the build that is clicked', async () => {
    getInstallations.mockResolvedValue([OLDEST, CLOUD])
    const wrapper = await openHome()

    await wrapper.findAll('[data-testid="home-build"]')[1]!.trigger('click')

    expect(wrapper.emitted('pick')).toEqual([[OLDEST]])
  })

  it('keeps Comfy Cloud available when moving between Personal and team workspaces', async () => {
    const teamBuild = build({ id: 'team', name: 'Team build', workspaceId: 'team-a' })
    getInstallations.mockResolvedValue([CLOUD, OLDEST, teamBuild])
    const wrapper = await openHome()
    const names = () =>
      wrapper.findAll('[data-testid="home-build"] .font-semibold').map((name) => name.text())

    expect(names()).toEqual(['Comfy Cloud', 'Flux Sandbox'])
    useDashboardScopeStore().selectedWorkspaceId = 'team-a'
    await flushPromises()
    expect(names()).toEqual(['Comfy Cloud', 'Team build'])
    await wrapper.findAll('[data-testid="home-build"]')[0]!.trigger('click')
    expect(wrapper.emitted('pick')).toEqual([[CLOUD]])

    useDashboardScopeStore().selectedWorkspaceId = 'personal'
    await flushPromises()
    expect(names()).toEqual(['Comfy Cloud', 'Flux Sandbox'])
  })

  it('opens the most recently used build from Open ComfyUI', async () => {
    getInstallations.mockResolvedValue([OLDEST, NEWEST, CLOUD])
    const wrapper = await openHome()

    await wrapper.get('[data-testid="home-open-comfyui"]').trigger('click')

    expect(wrapper.emitted('pick')).toEqual([[NEWEST]])
  })

  it('shows which build Open ComfyUI opens', async () => {
    getInstallations.mockResolvedValue([OLDEST, NEWEST])
    const wrapper = await openHome()

    expect(wrapper.get('[data-testid="home-open-comfyui-build"]').text()).toBe('My Local 1')
  })

  it('marks Open ComfyUI with the kind of build it opens', async () => {
    getInstallations.mockResolvedValue([CLOUD, OLDEST])
    const wrapper = await openHome()

    expect(
      (wrapper.get('[data-testid="home-open-comfyui-icon"]').element as SVGElement).dataset.kind
    ).toBe('cloud')
  })

  it('hides the Open ComfyUI tooltip while the build menu is open', async () => {
    getInstallations.mockResolvedValue([OLDEST, NEWEST])
    const wrapper = await openHome()
    wrapper
      .get('[data-testid="home-open-build"] .tooltip-wrap')
      .element.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse', buttons: 0 }))
    await vi.waitFor(() =>
      expect(document.querySelector('.tooltip-bubble')?.textContent).toContain(
        `Opens in ${NEWEST.name}`
      )
    )

    await openBuildMenu(wrapper)

    await vi.waitFor(() => expect(document.querySelector('.tooltip-bubble')).toBeNull())
  })

  it('lists every build of the workspace in the Open ComfyUI menu, with a dot on each open build, Comfy Cloud too', async () => {
    getInstallations.mockResolvedValue([OLDEST, CLOUD, RUNNING, NEWEST])
    const wrapper = await openHome()
    for (const open of [RUNNING, CLOUD]) {
      useSessionStore().runningInstances.set(open.id, {
        installationId: open.id,
        installationName: open.name,
        mode: 'window'
      })
    }
    await openBuildMenu(wrapper)

    expect(buildOptions().map((option) => option.textContent?.trim())).toEqual([
      'My Local 1',
      'Video Lab',
      'Comfy Cloud',
      'Flux Sandbox'
    ])
    expect(buildOptions().map((option) => option.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
      'false',
      'false'
    ])
    expect(
      buildOptions().map(
        (option) =>
          option
            .querySelector('[data-testid="home-open-build-status-dot"]')
            ?.getAttribute('data-tone') ?? null
      )
    ).toEqual([null, 'live', 'live', null])
  })

  it('marks a broken build red and keeps it from opening, with the reason on hover', async () => {
    const BROKEN = build({
      id: 'broken',
      name: 'Broken Build',
      statusTag: { style: 'danger', label: 'Install failed' }
    })
    getInstallations.mockResolvedValue([OLDEST, BROKEN])
    const wrapper = await openHome()
    await openBuildMenu(wrapper)

    const broken = buildOptions()[1]!
    expect(
      broken.querySelector('[data-testid="home-open-build-status-dot"]')?.getAttribute('data-tone')
    ).toBe('danger')
    expect(broken.hasAttribute('data-disabled')).toBe(true)

    broken.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()
    expect(wrapper.emitted('pick')).toBeUndefined()

    broken
      .closest('.tooltip-wrap')!
      .dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse', buttons: 0 }))
    await vi.waitFor(() =>
      expect(document.querySelector('.tooltip-bubble')?.textContent).toContain('Install failed')
    )
  })

  it('marks a build that did not start red, and still lets you open it', async () => {
    getInstallations.mockResolvedValue([OLDEST, NEWEST])
    const wrapper = await openHome()
    useSessionStore().errorInstances.set(OLDEST.id, { installationName: OLDEST.name })
    await openBuildMenu(wrapper)

    const failed = buildOptions()[1]!
    expect(
      failed.querySelector('[data-testid="home-open-build-status-dot"]')?.getAttribute('data-tone')
    ).toBe('danger')
    failed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()
    expect(wrapper.get('[data-testid="home-open-comfyui-build"]').text()).toBe(OLDEST.name)

    await wrapper.get('[data-testid="home-open-comfyui"]').trigger('click')
    expect(wrapper.emitted('pick')).toEqual([[OLDEST]])
  })

  it('aims Open ComfyUI at the build picked in the menu without opening it', async () => {
    getInstallations.mockResolvedValue([OLDEST, NEWEST, CLOUD])
    const wrapper = await openHome()
    await openBuildMenu(wrapper)

    buildOptions()[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()

    expect(wrapper.emitted('pick')).toBeUndefined()
    expect(wrapper.get('[data-testid="home-open-comfyui-build"]').text()).toBe(CLOUD.name)
    expect(
      (wrapper.get('[data-testid="home-open-comfyui-icon"]').element as SVGElement).dataset.kind
    ).toBe('cloud')

    await wrapper.get('[data-testid="home-open-comfyui"]').trigger('click')

    expect(wrapper.emitted('pick')).toEqual([[CLOUD]])
  })

  it('fills the picked build in the menu, with no check mark', async () => {
    getInstallations.mockResolvedValue([OLDEST, NEWEST, CLOUD])
    const wrapper = await openHome()
    await openBuildMenu(wrapper)
    buildOptions()[2]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()

    await openBuildMenu(wrapper)

    expect(buildOptions().map((option) => option.getAttribute('aria-checked'))).toEqual([
      'false',
      'false',
      'true'
    ])
    expect(buildOptions()[2]!.className).toContain('data-[state=checked]:bg-muted')
    expect(document.querySelector('[data-testid="menu-radio-item-check"]')).toBeNull()
  })

  it('leaves the build menu out with one build, keeping the icon and no arrow', async () => {
    getInstallations.mockResolvedValue([OLDEST])
    const wrapper = await openHome()

    expect(wrapper.get('[data-testid="home-open-comfyui-build"]').text()).toBe('Flux Sandbox')
    expect(wrapper.find('[data-testid="home-open-build-menu"]').exists()).toBe(false)
    expect(
      (wrapper.get('[data-testid="home-open-comfyui-icon"]').element as SVGElement).dataset.kind
    ).toBe('local')
    expect(wrapper.get('[data-testid="home-open-comfyui"]').findAll('svg')).toHaveLength(1)
  })

  it('goes to the full list from All builds', async () => {
    getInstallations.mockResolvedValue([NEWEST])
    const wrapper = await openHome()

    await wrapper.get('[data-testid="home-all-builds"]').trigger('click')

    expect(wrapper.emitted('show-builds')).toHaveLength(1)
  })

  it('offers New build in the builds row and leaves Open ComfyUI out when there is no build', async () => {
    const wrapper = await openHome()

    expect(
      wrapper.find('[data-testid="home-builds"] [data-testid="home-new-build"]').exists()
    ).toBe(true)
    expect(wrapper.find('[data-testid="home-build"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="home-open-comfyui"]').exists()).toBe(false)

    await wrapper.find('[data-testid="home-new-build"]').trigger('click')
    expect(wrapper.emitted('new-build')).toHaveLength(1)
  })
})

describe('Home build cards during a stop or update', () => {
  it.each([
    ['Stopping…', 'stop'],
    ['Updating…', 'update']
  ] as const)('shows %s and blocks opening until the operation finishes', async (label, action) => {
    getInstallations.mockResolvedValue([RUNNING])
    const session = useSessionStore()
    if (action === 'stop') {
      session.runningInstances.set(RUNNING.id, {
        installationId: RUNNING.id,
        installationName: RUNNING.name,
        mode: 'window'
      })
      session.stoppingInstances.add(RUNNING.id)
    } else {
      session.operationInstances.set(RUNNING.id, { actionId: 'update-comfyui' })
    }
    const wrapper = await openHome()
    const card = wrapper.get('[data-testid="home-build"]')
    const open = card.get<HTMLButtonElement>('[data-testid="home-build-open"]')

    expect(card.get('[data-testid="home-build-status"]').text()).toBe(label)
    expect(open.element.disabled).toBe(true)
    expect(wrapper.find('[data-testid="home-open-comfyui"]').exists()).toBe(false)
    await card.trigger('click')
    expect(wrapper.emitted('pick')).toBeUndefined()

    session.runningInstances.delete(RUNNING.id)
    session.stoppingInstances.delete(RUNNING.id)
    session.operationInstances.delete(RUNNING.id)
    await flushPromises()

    expect(open.element.disabled).toBe(false)
    expect(wrapper.find('[data-testid="home-open-comfyui"]').exists()).toBe(true)
    await open.trigger('click')
    expect(wrapper.emitted('pick')).toEqual([[RUNNING]])
  })
})

describe('Home build card while a build starts', () => {
  beforeEach(() => {
    Object.assign(window.api, {
      onInstallProgress: vi.fn(() => () => {}),
      onComfyOutput: vi.fn(() => () => {}),
      cancelOperation: vi.fn(),
      stopComfyUI: vi.fn()
    })
  })

  it('beside two other builds, keeps its status and name with no buttons inside, and Cancel lives in its ⋯ menu', async () => {
    getInstallations.mockResolvedValue([OLDEST, CLOUD, NEWEST])
    const wrapper = await openHome()
    useProgressStore().startOperation({
      installationId: NEWEST.id,
      title: 'Starting',
      opKind: 'launch',
      apiCall: () => new Promise(() => {})
    })
    await flushPromises()

    const starting = wrapper.get(
      `[data-testid="home-build-starting"][data-build-id="${NEWEST.id}"]`
    )
    expect(starting.text()).toContain('Starting…')
    expect(starting.text()).toContain(NEWEST.name)
    expect(starting.find('[data-testid="home-build-cancel"]').exists()).toBe(false)
    expect(starting.find('[data-testid="home-build-view-logs"]').exists()).toBe(false)

    await starting.get('[data-testid="home-build-more"]').trigger('click')
    await flushPromises()
    document.querySelector<HTMLElement>('[data-testid="build-menu-cancel"]')!.click()
    await flushPromises()
    expect(window.api.cancelOperation).toHaveBeenCalledWith(NEWEST.id)
  })
})

describe('Home build auto start', () => {
  let saved: unknown
  let settingsListeners: Array<(change: { key: string }) => void>
  const setSetting = vi.fn(async (_key: string, value: unknown) => {
    saved = value
  })

  beforeEach(() => {
    saved = 'none'
    settingsListeners = []
    Object.assign(window.api, {
      getSetting: vi.fn(async (key: string) => (key === 'autoLaunchOnStartup' ? saved : undefined)),
      setSetting,
      onSettingsChanged: vi.fn((callback: (change: { key: string }) => void) => {
        settingsListeners.push(callback)
        return () => {}
      })
    })
  })

  function cardOf(wrapper: VueWrapper, id: string) {
    return wrapper.get(`[data-build-id="${id}"][data-testid^="home-build"]`)
  }

  function statusOf(wrapper: VueWrapper, id: string): string {
    return cardOf(wrapper, id).get('[data-testid="home-build-status"]').text()
  }

  function startingWithDesktop(wrapper: VueWrapper): string[] {
    return wrapper
      .findAll('[data-testid="home-build-starts-with-desktop"]')
      .map((icon) => icon.element.closest('[data-build-id]')!.getAttribute('data-build-id')!)
  }

  it('says Auto start on the ready card of the build that starts when Desktop opens', async () => {
    saved = OLDEST.id
    getInstallations.mockResolvedValue([OLDEST, RUNNING])
    const wrapper = await openHome()

    expect(wrapper.find('[role="checkbox"]').exists()).toBe(false)
    expect(statusOf(wrapper, OLDEST.id)).toBe('Auto start')
    expect(statusOf(wrapper, RUNNING.id)).toBe('Used 2h ago')
    expect(startingWithDesktop(wrapper)).toEqual([OLDEST.id])
    expect(
      cardOf(wrapper, OLDEST.id).get('[data-testid="home-build-open"]').attributes('aria-label')
    ).toBe(`${OLDEST.name}, Auto start`)
  })

  it("says Didn't start on the card of an Auto start build that failed to start in the background", async () => {
    saved = OLDEST.id
    getInstallations.mockResolvedValue([OLDEST, RUNNING])
    const wrapper = await openHome()

    useSessionStore().errorInstances.set(OLDEST.id, {
      installationName: OLDEST.name,
      message: 'ComfyUI exited with code 1',
      startFailed: true
    })
    await flushPromises()

    expect(statusOf(wrapper, OLDEST.id)).toBe("Didn't start")
  })

  it("does not say Didn't start on the card of a build whose update failed", async () => {
    Object.assign(window.api, {
      onInstallProgress: vi.fn(() => () => {}),
      onComfyOutput: vi.fn(() => () => {})
    })
    saved = OLDEST.id
    getInstallations.mockResolvedValue([OLDEST, RUNNING])
    const wrapper = await openHome()

    useProgressStore().startOperation({
      installationId: OLDEST.id,
      title: 'Updating',
      opKind: 'update',
      apiCall: async () => ({ ok: false, message: 'Could not install the new dependencies' })
    })
    await flushPromises()

    expect(useSessionStore().errorInstances.get(OLDEST.id)?.message).toBe(
      'Could not install the new dependencies'
    )
    expect(statusOf(wrapper, OLDEST.id)).not.toBe("Didn't start")
  })

  it("does not say Didn't start on the card of a build that ran and then crashed", async () => {
    saved = OLDEST.id
    getInstallations.mockResolvedValue([OLDEST, RUNNING])
    const wrapper = await openHome()

    useSessionStore().errorInstances.set(OLDEST.id, {
      installationName: OLDEST.name,
      exitCode: 1
    })
    await flushPromises()

    expect(statusOf(wrapper, OLDEST.id)).not.toBe("Didn't start")
  })

  it('moves Auto start to the card whose menu says Auto start', async () => {
    saved = OLDEST.id
    getInstallations.mockResolvedValue([OLDEST, RUNNING])
    const wrapper = await openHome()

    await cardOf(wrapper, RUNNING.id).get('[data-testid="home-build-more"]').trigger('click')
    await flushPromises()
    const line = await vi.waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-testid="build-menu-auto-start"]')
      expect(found).not.toBeNull()
      return found!
    })
    expect(line.textContent?.trim()).toBe('Auto start')
    line.click()
    await flushPromises()

    expect(setSetting).toHaveBeenCalledWith('autoLaunchOnStartup', RUNNING.id)
    expect(startingWithDesktop(wrapper)).toEqual([RUNNING.id])
    expect(statusOf(wrapper, OLDEST.id)).toBe('Used 3d ago')
    expect(wrapper.emitted('open-build')).toBeUndefined()
  })

  it('says when Comfy Cloud was last used, never Auto start, when it is the one that starts with Desktop', async () => {
    getAuthStatus.mockResolvedValue({ signedIn: true })
    saved = CLOUD.id
    getInstallations.mockResolvedValue([OLDEST, CLOUD])
    const wrapper = await openHome()

    expect(statusOf(wrapper, CLOUD.id)).toBe('Used yesterday')
    expect(statusOf(wrapper, OLDEST.id)).toBe('Used 3d ago')
    expect(startingWithDesktop(wrapper)).toEqual([])
  })

  it('says when each build was last used on every card when Settings says Last used build', async () => {
    saved = 'last'
    getInstallations.mockResolvedValue([OLDEST, RUNNING])
    const wrapper = await openHome()

    expect(statusOf(wrapper, OLDEST.id)).toBe('Used 3d ago')
    expect(statusOf(wrapper, RUNNING.id)).toBe('Used 2h ago')
    expect(startingWithDesktop(wrapper)).toEqual([])
  })

  it('follows a build picked in Settings without a restart', async () => {
    saved = OLDEST.id
    getInstallations.mockResolvedValue([OLDEST, RUNNING])
    const wrapper = await openHome()

    saved = RUNNING.id
    for (const listener of settingsListeners) listener({ key: 'autoLaunchOnStartup' })
    await flushPromises()

    expect(startingWithDesktop(wrapper)).toEqual([RUNNING.id])
    expect(statusOf(wrapper, OLDEST.id)).toBe('Used 3d ago')
  })

  it('shows the install status, not Auto start, while that build installs', async () => {
    Object.assign(window.api, {
      onInstallProgress: vi.fn(() => () => {}),
      onComfyOutput: vi.fn(() => () => {})
    })
    saved = OLDEST.id
    getInstallations.mockResolvedValue([OLDEST, RUNNING])
    const wrapper = await openHome()

    useProgressStore().startOperation({
      installationId: OLDEST.id,
      title: 'Installing',
      opKind: 'install',
      apiCall: () => new Promise(() => {})
    })
    await flushPromises()

    expect(
      wrapper.find(`[data-testid="home-build-installing"][data-build-id="${OLDEST.id}"]`).exists()
    ).toBe(true)
    expect(statusOf(wrapper, OLDEST.id)).not.toContain('Auto start')
    expect(startingWithDesktop(wrapper)).toEqual([])
    expect(setSetting).not.toHaveBeenCalledWith('autoLaunchOnStartup', expect.anything())
  })
})

function recent(over: Partial<RecentWorkflow> & { title: string }): RecentWorkflow {
  return {
    id: `${over.installationId ?? 'newest'}:${over.title}.json`,
    path: `${over.title}.json`,
    installationId: 'newest',
    buildName: 'My Local 1',
    where: 'local',
    modifiedAt: NOW - 2 * HOUR_MS,
    ...over
  }
}

function recentTitles(wrapper: VueWrapper): string[] {
  return wrapper.findAll('[data-testid="home-recent-workflow-title"]').map((title) => title.text())
}

describe('Home recent workflows', () => {
  it('shows the saved workflows of the builds in this workspace, with build and age', async () => {
    getInstallations.mockResolvedValue([NEWEST, CLOUD])
    listRecentWorkflows.mockResolvedValue([
      recent({ title: 'Wan loop', modifiedAt: NOW - 5 * MINUTE_MS }),
      recent({
        title: 'Upscale',
        installationId: 'cloud',
        buildName: 'Comfy Cloud',
        where: 'cloud'
      }),
      recent({ title: 'Elsewhere', installationId: 'uninstalled' })
    ])

    const wrapper = await openHome()

    expect(recentTitles(wrapper)).toEqual(['Wan loop', 'Upscale'])
    expect(listRecentWorkflows).toHaveBeenLastCalledWith(
      expect.arrayContaining(['newest', 'cloud'])
    )
    const first = wrapper.get('[data-testid="home-recent-workflow"]')
    expect(first.text()).toContain('My Local 1')
    expect(first.text()).toContain('5m ago')
  })

  it('keeps up to ten workflows in one scrolling row', async () => {
    getInstallations.mockResolvedValue([NEWEST])
    listRecentWorkflows.mockResolvedValue(
      Array.from({ length: 12 }, (_, index) =>
        recent({ title: `Flow ${index}`, modifiedAt: NOW - index * MINUTE_MS })
      )
    )

    const wrapper = await openHome()

    expect(recentTitles(wrapper)).toEqual(Array.from({ length: 10 }, (_, index) => `Flow ${index}`))
    expect(wrapper.get('[data-testid="home-recent-workflows-row"]').classes()).toContain(
      'overflow-x-auto'
    )
  })

  it('hides the section when there are no saved workflows', async () => {
    getInstallations.mockResolvedValue([NEWEST])

    const wrapper = await openHome()

    expect(wrapper.find('[data-testid="home-recent-workflows"]').exists()).toBe(false)
  })

  it('opens a saved workflow in its own build', async () => {
    getInstallations.mockResolvedValue([NEWEST])
    listRecentWorkflows.mockResolvedValue([
      recent({ title: 'Wan loop', path: 'video/Wan loop.json' })
    ])

    const wrapper = await openHome()
    await wrapper.get('[data-testid="home-recent-workflow"]').trigger('click')
    await flushPromises()

    expect(openRecentWorkflow).toHaveBeenCalledExactlyOnceWith('newest', 'video/Wan loop.json')
  })

  it('paints no build tone on a workflow card, local or Cloud, leaving the icon as the cue', async () => {
    getInstallations.mockResolvedValue([NEWEST, CLOUD])
    listRecentWorkflows.mockResolvedValue([
      recent({ title: 'Wan loop' }),
      recent({
        title: 'Upscale',
        installationId: 'cloud',
        buildName: 'Comfy Cloud',
        where: 'cloud'
      })
    ])

    const wrapper = await openHome()
    const [local, cloud] = wrapper.findAll('[data-testid="home-recent-workflow"]')

    expect(local!.find('.lucide-laptop').exists()).toBe(true)
    expect(cloud!.find('.lucide-cloud').exists()).toBe(true)
    const toneColors = Object.values(HOME_BUILD_TONES).map(({ tint }) => tint.split(' ').join(', '))
    for (const card of [local!, cloud!]) {
      const painted = [card.element, ...card.element.querySelectorAll('*')].map((element) => {
        const style = getComputedStyle(element)
        return `${style.backgroundColor} ${style.backgroundImage}`
      })
      for (const tone of toneColors) {
        expect(painted.filter((paint) => paint.includes(tone))).toEqual([])
      }
    }
  })
})
