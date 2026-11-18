import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import HomeView from './HomeView.vue'
import { useDashboardScopeStore } from '../stores/dashboardScopeStore'
import { useProgressStore } from '../stores/progressStore'
import { useSessionStore } from '../stores/sessionStore'
import type { CatalogWorkflow, Installation, TemplateSearchResponse } from '../types/ipc'

const listHomeWorkflows = vi.fn<() => Promise<CatalogWorkflow[]>>()
const openCatalogWorkflow = vi.fn<(id: string) => Promise<boolean>>()
const getAppsEnabled = vi.fn<() => Promise<boolean>>()
const getInstallations = vi.fn<() => Promise<Installation[]>>()
const searchTemplates = vi.fn()
const openTemplateInBuild = vi.fn()

function workflow(id: string, title: string, thumbnailUrl: string | null = null): CatalogWorkflow {
  return { id, title, description: '', thumbnailUrl }
}

function build(over: Partial<Installation> & { id: string; name: string }): Installation {
  return { sourceLabel: 'Standalone', sourceCategory: 'local', status: 'installed', ...over }
}

const UPSCALE: CatalogWorkflow = {
  id: 'upscale',
  title: 'Upscale and restore detail',
  description: 'Enlarge an image and restore fine detail.',
  thumbnailUrl: 'https://comfy.org/catalog-media/upscale/v1'
}
const TALK = workflow('talk', 'Make your character talk')
const SEVEN_WORKFLOWS = Array.from({ length: 7 }, (_, index) =>
  workflow(`workflow-${index}`, `Workflow ${index}`)
)

const OLDEST = build({
  id: 'oldest',
  name: 'Flux Sandbox',
  lastLaunchedAt: 100,
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
  lastLaunchedAt: 200
})
const RUNNING = build({ id: 'running', name: 'Video Lab', lastLaunchedAt: 300 })
const NEWEST = build({
  id: 'newest',
  name: 'My Local 1',
  lastLaunchedAt: 400,
  statusTag: { style: 'update', label: 'Update available' }
})

beforeEach(() => {
  vi.clearAllMocks()
  listHomeWorkflows.mockResolvedValue([])
  openCatalogWorkflow.mockResolvedValue(true)
  getAppsEnabled.mockResolvedValue(false)
  getInstallations.mockResolvedValue([])
  ;(window as unknown as { api: unknown }).api = {
    listHomeWorkflows,
    searchTemplates,
    openTemplateInBuild,
    openCatalogWorkflow,
    getAppsEnabled,
    getInstallations,
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

const mounted: VueWrapper[] = []

afterEach(() => {
  while (mounted.length) mounted.pop()?.unmount()
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

describe('Home example workflows', () => {
  it('puts the first catalog workflow in front with its neighbours on either side', async () => {
    listHomeWorkflows.mockResolvedValue(SEVEN_WORKFLOWS)
    const wrapper = await openHome()

    expect(arc(wrapper)).toEqual([
      '-2:Workflow 5',
      '-1:Workflow 6',
      '0:Workflow 0',
      '1:Workflow 1',
      '2:Workflow 2'
    ])
  })

  it('brings a side card to the front when it is clicked, without opening it', async () => {
    listHomeWorkflows.mockResolvedValue(SEVEN_WORKFLOWS)
    const wrapper = await openHome()

    await cardAt(wrapper, 1).trigger('click')

    expect(cardAt(wrapper, 0).text()).toContain('Workflow 1')
    expect(openCatalogWorkflow).not.toHaveBeenCalled()
  })

  it('slides a card two places away to the front as the same card, with the next ones already waiting off stage', async () => {
    listHomeWorkflows.mockResolvedValue(SEVEN_WORKFLOWS)
    const wrapper = await openHome()
    const twoAway = cardAt(wrapper, 2).element
    const waitingOffStage = cardAt(wrapper, 3)
    expect(waitingOffStage.text()).toBe('Workflow 3')
    expect(waitingOffStage.attributes('aria-hidden')).toBe('true')

    await cardAt(wrapper, 2).trigger('click')

    expect(cardAt(wrapper, 0).element).toBe(twoAway)
    expect(cardAt(wrapper, 1).element).toBe(waitingOffStage.element)
    expect(arc(wrapper)).toEqual([
      '-2:Workflow 0',
      '-1:Workflow 1',
      '0:Workflow 2',
      '1:Workflow 3',
      '2:Workflow 4'
    ])
    expect(openCatalogWorkflow).not.toHaveBeenCalled()
  })

  it('keeps cards that are off stage out of reach of the keyboard and screen readers', async () => {
    listHomeWorkflows.mockResolvedValue(SEVEN_WORKFLOWS)
    const wrapper = await openHome()

    const offStage = wrapper.findAll('[data-testid="home-carousel-card"][aria-hidden="true"]')

    expect(offStage.map((card) => card.text())).toEqual(['Workflow 3', 'Workflow 4'])
    expect(offStage.map((card) => card.attributes('tabindex'))).toEqual(['-1', '-1'])
  })

  it('loads every picture up front and fades each in once it has loaded', async () => {
    listHomeWorkflows.mockResolvedValue(
      SEVEN_WORKFLOWS.map((entry) => ({
        ...entry,
        thumbnailUrl: `https://comfy.org/catalog-media/${entry.id}/v1`
      }))
    )
    const wrapper = await openHome()
    const pictures = wrapper.findAll('[data-testid="home-carousel-card"] img')

    expect(pictures).toHaveLength(7)
    expect(pictures[4]!.attributes('data-loaded')).toBe('false')

    await pictures[4]!.trigger('load')

    expect(pictures[4]!.attributes('data-loaded')).toBe('true')
    expect(pictures[5]!.attributes('data-loaded')).toBe('false')
  })

  it('opens the workflow in front when it is clicked', async () => {
    listHomeWorkflows.mockResolvedValue(SEVEN_WORKFLOWS)
    const wrapper = await openHome()
    await cardAt(wrapper, -1).trigger('click')

    await cardAt(wrapper, 0).trigger('click')

    expect(openCatalogWorkflow).toHaveBeenCalledExactlyOnceWith('workflow-6')
  })

  it('turns the carousel with the arrow keys', async () => {
    listHomeWorkflows.mockResolvedValue(SEVEN_WORKFLOWS)
    const wrapper = await openHome()
    const carousel = wrapper.get('[data-testid="home-carousel"]')

    await carousel.trigger('keydown', { key: 'ArrowRight' })
    await carousel.trigger('keydown', { key: 'ArrowRight' })
    expect(cardAt(wrapper, 0).text()).toContain('Workflow 2')

    await carousel.trigger('keydown', { key: 'ArrowLeft' })
    expect(cardAt(wrapper, 0).text()).toContain('Workflow 1')
  })

  it('turns the carousel with the previous and next arrows', async () => {
    listHomeWorkflows.mockResolvedValue(SEVEN_WORKFLOWS)
    const wrapper = await openHome()
    const next = wrapper.get('[data-testid="home-carousel-next"]')
    const previous = wrapper.get('[data-testid="home-carousel-previous"]')

    expect(next.attributes('aria-label')).toBe('Next workflow')
    expect(previous.attributes('aria-label')).toBe('Previous workflow')

    await next.trigger('click')
    await next.trigger('click')
    expect(cardAt(wrapper, 0).text()).toContain('Workflow 2')

    await previous.trigger('click')
    await previous.trigger('click')
    await previous.trigger('click')
    expect(cardAt(wrapper, 0).text()).toContain('Workflow 6')
    expect(openCatalogWorkflow).not.toHaveBeenCalled()
  })

  it('stops the arrows at the ends of a short list and leaves them out for a single card', async () => {
    listHomeWorkflows.mockResolvedValue([UPSCALE, TALK])
    const wrapper = await openHome()
    const next = wrapper.get('[data-testid="home-carousel-next"]')
    const previous = wrapper.get('[data-testid="home-carousel-previous"]')

    expect(previous.attributes('disabled')).toBeDefined()
    expect(next.attributes('disabled')).toBeUndefined()

    await next.trigger('click')
    expect(cardAt(wrapper, 0).text()).toContain('Make your character talk')
    expect(next.attributes('disabled')).toBeDefined()
    expect(previous.attributes('disabled')).toBeUndefined()

    listHomeWorkflows.mockResolvedValue([UPSCALE])
    const single = await openHome()
    expect(single.find('[data-testid="home-carousel-next"]').exists()).toBe(false)
    expect(single.find('[data-testid="home-carousel-previous"]').exists()).toBe(false)
  })

  it('keeps keyboard focus on an arrow when the one in use reaches the end of a short list', async () => {
    listHomeWorkflows.mockResolvedValue([UPSCALE, TALK])
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
    listHomeWorkflows.mockResolvedValue(SEVEN_WORKFLOWS)
    const wrapper = await openHome()

    const next = wrapper.get('[data-testid="home-carousel-next"]')
    await next.trigger('keydown', { key: 'ArrowRight' })
    expect(cardAt(wrapper, 0).text()).toContain('Workflow 1')

    const front = cardAt(wrapper, 0).element as HTMLButtonElement
    front.focus()
    await cardAt(wrapper, 0).trigger('keydown', { key: 'ArrowRight' })
    await flushPromises()

    expect(cardAt(wrapper, 0).text()).toContain('Workflow 2')
    expect(document.activeElement).toBe(cardAt(wrapper, 0).element)
  })

  it('shows the open arrow on hover of the front card only, and opens that workflow from it', async () => {
    listHomeWorkflows.mockResolvedValue(SEVEN_WORKFLOWS)
    const wrapper = await openHome()
    const front = cardAt(wrapper, 0).get('[data-testid="home-carousel-cta"]')
    const side = cardAt(wrapper, 1).get('[data-testid="home-carousel-cta"]')

    expect(front.classes()).toContain('group-hover/card:opacity-100')
    expect(side.classes()).not.toContain('group-hover/card:opacity-100')
    expect(front.attributes('aria-hidden')).toBe('true')

    await front.trigger('click')

    expect(openCatalogWorkflow).toHaveBeenCalledExactlyOnceWith('workflow-0')
  })

  it('turns the carousel when it is dragged, and does not open the card the drag ends on', async () => {
    listHomeWorkflows.mockResolvedValue(SEVEN_WORKFLOWS)
    const wrapper = await openHome()

    pressCarouselAt(wrapper, 600)
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 290 }))
    await flushPromises()

    expect(cardAt(wrapper, 0).text()).toContain('Workflow 2')

    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 290 }))
    await cardAt(wrapper, 0).trigger('click')

    expect(openCatalogWorkflow).not.toHaveBeenCalled()

    await new Promise((resolve) => setTimeout(resolve, 0))
    await cardAt(wrapper, 0).trigger('click')

    expect(openCatalogWorkflow).toHaveBeenCalledExactlyOnceWith('workflow-2')
  })

  it('drags back the other way to earlier cards', async () => {
    listHomeWorkflows.mockResolvedValue(SEVEN_WORKFLOWS)
    const wrapper = await openHome()

    pressCarouselAt(wrapper, 600)
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 760 }))
    await flushPromises()

    expect(cardAt(wrapper, 0).text()).toContain('Workflow 6')
    window.dispatchEvent(new PointerEvent('pointerup'))
  })

  it('still opens the front card after a press that does not move', async () => {
    listHomeWorkflows.mockResolvedValue(SEVEN_WORKFLOWS)
    const wrapper = await openHome()

    pressCarouselAt(wrapper, 600)
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 601 }))
    await cardAt(wrapper, 0).trigger('click')

    expect(openCatalogWorkflow).toHaveBeenCalledExactlyOnceWith('workflow-0')
  })

  it('shows a short list once, without repeating cards around the arc', async () => {
    listHomeWorkflows.mockResolvedValue([UPSCALE, TALK])
    const wrapper = await openHome()

    expect(arc(wrapper)).toEqual([
      '0:Upscale and restore detailEnlarge an image and restore fine detail.',
      '1:Make your character talk'
    ])

    await wrapper.get('[data-testid="home-carousel"]').trigger('keydown', { key: 'ArrowLeft' })

    expect(cardAt(wrapper, 0).text()).toContain('Upscale and restore detail')
  })

  it('shows the catalog picture on a card and a plain card when there is none', async () => {
    listHomeWorkflows.mockResolvedValue([UPSCALE, TALK])
    const wrapper = await openHome()

    expect(cardAt(wrapper, 0).get('img').attributes('src')).toBe(UPSCALE.thumbnailUrl)
    expect(cardAt(wrapper, 1).find('img').exists()).toBe(false)

    await cardAt(wrapper, 0).get('img').trigger('error')

    expect(cardAt(wrapper, 0).find('img').exists()).toBe(false)
    expect(cardAt(wrapper, 0).text()).toContain('Upscale and restore detail')
  })

  it('tells screen readers which card opens and which only comes forward', async () => {
    listHomeWorkflows.mockResolvedValue([UPSCALE, TALK])
    const wrapper = await openHome()

    expect(cardAt(wrapper, 0).attributes('aria-label')).toBe(
      'Open Upscale and restore detail on Comfy Hub'
    )
    expect(cardAt(wrapper, 1).attributes('aria-label')).toBe('Show Make your character talk')
  })

  it('leaves out See all apps while Apps is turned off', async () => {
    listHomeWorkflows.mockResolvedValue([UPSCALE])
    const wrapper = await openHome()

    expect(wrapper.find('[data-testid="home-see-all-apps"]').exists()).toBe(false)
  })

  it('shows placeholders while the catalog is loading', async () => {
    listHomeWorkflows.mockReturnValue(new Promise(() => {}))
    const wrapper = await openHome()

    expect(wrapper.get('[data-testid="home-carousel-loading"]').attributes('aria-busy')).toBe(
      'true'
    )
    expect(wrapper.find('[data-testid="home-carousel-card"]').exists()).toBe(false)
  })

  it('says the workflows could not be loaded and loads them when asked to try again', async () => {
    listHomeWorkflows.mockRejectedValueOnce(new Error('offline'))
    const wrapper = await openHome()

    const unavailable = wrapper.get('[data-testid="home-workflows-unavailable"]')
    expect(unavailable.text()).toContain("Example workflows couldn't be loaded")

    listHomeWorkflows.mockResolvedValue([UPSCALE])
    await unavailable.get('button').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="home-workflows-unavailable"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-testid="home-carousel-card"]')).toHaveLength(1)
  })
})

describe('Home builds', () => {
  it('lists the three most recently used builds with what each is doing', async () => {
    getInstallations.mockResolvedValue([OLDEST, CLOUD, RUNNING, NEWEST])
    const wrapper = await openHome()
    useSessionStore().runningInstances.set(RUNNING.id, {
      installationId: RUNNING.id,
      installationName: RUNNING.name,
      mode: 'window'
    })
    await flushPromises()

    expect(wrapper.findAll('[data-testid="home-build"]').map((card) => card.text())).toEqual([
      'ReadyMy Local 1Standalone · Update',
      'RunningVideo LabStandalone',
      'Always onComfy CloudRTX 6000 Pro · 96 GB'
    ])
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
    expect(card.get('[data-testid="home-build-detail"]').text()).toBe('Standalone · Update')
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

    expect(wrapper.get('[data-testid="home-build-detail"]').text()).toBe('v0.3.68 · Update')
  })

  it('starts a build with an update from its card, saying Ready on top', async () => {
    getInstallations.mockResolvedValue([NEWEST])
    const wrapper = await openHome()

    const card = wrapper.get('[data-testid="home-build"]')
    expect(card.get('[data-testid="home-build-status"]').text()).toBe('Ready')
    await card.get('[data-testid="home-build-open"]').trigger('click')

    expect(wrapper.emitted('pick')?.[0]?.[0]).toMatchObject({ id: NEWEST.id })
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

  it('shows a stopped local build as ready, with its version and no folder path', async () => {
    getInstallations.mockResolvedValue([OLDEST])
    const wrapper = await openHome()

    expect(wrapper.get('[data-testid="home-build"]').text()).toBe('ReadyFlux Sandboxv0.42.4')
  })

  it('shows the address of a remote ComfyUI instead of hardware', async () => {
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
      'ReadyStudio serverstudio.local:8188'
    )
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

  it('lists every build of the workspace in the Open ComfyUI menu, with a dot only on live builds', async () => {
    getInstallations.mockResolvedValue([OLDEST, CLOUD, RUNNING, NEWEST])
    const wrapper = await openHome()
    useSessionStore().runningInstances.set(RUNNING.id, {
      installationId: RUNNING.id,
      installationName: RUNNING.name,
      mode: 'window'
    })
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
    expect(starting.text()).toContain('Starting ComfyUI')
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
    expect(statusOf(wrapper, RUNNING.id)).toBe('Ready')
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
    expect(statusOf(wrapper, OLDEST.id)).toBe('Ready')
    expect(wrapper.emitted('open-build')).toBeUndefined()
  })

  it('keeps Always on for Comfy Cloud when it is the one that starts with Desktop', async () => {
    saved = CLOUD.id
    getInstallations.mockResolvedValue([OLDEST, CLOUD])
    const wrapper = await openHome()

    expect(statusOf(wrapper, CLOUD.id)).toBe('Always on')
    expect(statusOf(wrapper, OLDEST.id)).toBe('Ready')
    expect(startingWithDesktop(wrapper)).toEqual([])
  })

  it('says Ready on every card when Settings says Last used build', async () => {
    saved = 'last'
    getInstallations.mockResolvedValue([OLDEST, RUNNING])
    const wrapper = await openHome()

    expect(statusOf(wrapper, OLDEST.id)).toBe('Ready')
    expect(statusOf(wrapper, RUNNING.id)).toBe('Ready')
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
    expect(statusOf(wrapper, OLDEST.id)).toBe('Ready')
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

function posterAnswer(): TemplateSearchResponse {
  return {
    kind: 'result',
    result: {
      outcome: 'template',
      reply: null,
      run: [
        {
          templateId: 'poster_template',
          title: 'Poster',
          thumbnailUrl: null,
          family: null,
          partner: false,
          needsDownload: false,
          score: 0.9,
          calibrated: null,
          belowThreshold: false,
          missing: [],
          downloadBytes: null
        }
      ],
      download: [],
      alsoTry: [],
      partnerSwitch: false,
      partnersShown: true
    }
  }
}

describe('Home template search', () => {
  beforeEach(() => {
    Object.assign(window.api, {
      getSetting: vi.fn(async (key: string) =>
        key === 'templateSearchEnabled' ? true : undefined
      ),
      prepareTemplateSearch: vi.fn().mockResolvedValue({ kind: 'ready' }),
      downloadTemplateSearch: vi.fn().mockResolvedValue(undefined),
      onTemplateSearchAvailability: vi.fn(() => () => {})
    })
    searchTemplates.mockResolvedValue(posterAnswer())
  })

  async function searchAndPick(wrapper: VueWrapper) {
    const input = wrapper.get('[data-testid="home-template-search-input"]')
    await input.setValue('a poster for a bake sale')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()
  }

  it('stays hidden unless template search is switched on', async () => {
    Object.assign(window.api, { getSetting: vi.fn().mockResolvedValue(undefined) })
    const wrapper = await openHome()
    expect(wrapper.find('[data-testid="home-template-search"]').exists()).toBe(false)
  })

  it('shows the results in place of the apps while the bar has a request, and the apps again once it is cleared', async () => {
    getInstallations.mockResolvedValue([RUNNING])
    const wrapper = await openHome()
    const apps = () => wrapper.get('section[aria-label]').element as HTMLElement
    const input = wrapper.get('[data-testid="home-template-search-input"]')
    expect(apps().style.display).not.toBe('none')

    await input.setValue('a poster for a bake sale')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(wrapper.find('[data-testid="home-template-search-results"]').exists()).toBe(true)
    expect(apps().style.display).toBe('none')
    expect(wrapper.find('[data-testid="home-builds"]').exists()).toBe(true)

    await input.setValue('')
    await flushPromises()
    expect(wrapper.find('[data-testid="home-template-search-results"]').exists()).toBe(false)
    expect(apps().style.display).not.toBe('none')
  })

  it('shows the search bar under the title', async () => {
    const wrapper = await openHome()
    const search = wrapper.get('[data-testid="home-template-search"]')
    const title = wrapper.get('h1')
    expect(
      title.element.compareDocumentPosition(search.element) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('searches for and runs a template in the local build Home opens, and opens that build', async () => {
    getInstallations.mockResolvedValue([CLOUD, RUNNING, OLDEST])
    openTemplateInBuild.mockResolvedValue('launch')
    const wrapper = await openHome()
    await searchAndPick(wrapper)

    expect(searchTemplates).toHaveBeenCalledWith('a poster for a bake sale', 'running')
    expect(openTemplateInBuild).toHaveBeenCalledWith('running', 'poster_template')
    expect(wrapper.emitted('pick')).toEqual([[expect.objectContaining({ id: 'running' })]])
  })

  it('uses the most recent local build when Home would open Comfy Cloud', async () => {
    const recentCloud = { ...CLOUD, lastLaunchedAt: 900 }
    getInstallations.mockResolvedValue([OLDEST, recentCloud, RUNNING])
    openTemplateInBuild.mockResolvedValue('launch')
    const wrapper = await openHome()
    await searchAndPick(wrapper)

    expect(searchTemplates).toHaveBeenCalledWith('a poster for a bake sale', 'running')
    expect(openTemplateInBuild).toHaveBeenCalledWith('running', 'poster_template')
  })

  it('does not open a build the template was refused by', async () => {
    getInstallations.mockResolvedValue([RUNNING])
    openTemplateInBuild.mockResolvedValue('refused')
    const wrapper = await openHome()
    await searchAndPick(wrapper)
    expect(wrapper.emitted('pick')).toBeUndefined()
  })

  it('brings the build forward when the template opened in it straight away', async () => {
    getInstallations.mockResolvedValue([RUNNING])
    openTemplateInBuild.mockResolvedValue('opened')
    const wrapper = await openHome()
    await searchAndPick(wrapper)
    expect(wrapper.emitted('pick')).toEqual([[expect.objectContaining({ id: 'running' })]])
  })

  it('searches for and opens in the build picked in the Open ComfyUI menu', async () => {
    getInstallations.mockResolvedValue([RUNNING, OLDEST])
    openTemplateInBuild.mockResolvedValue('launch')
    const wrapper = await openHome()
    await openBuildMenu(wrapper)
    const oldest = buildOptions().find((option) => option.textContent?.includes(OLDEST.name))!
    oldest.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()

    await searchAndPick(wrapper)
    expect(searchTemplates).toHaveBeenCalledWith('a poster for a bake sale', 'oldest')
    expect(wrapper.emitted('pick')).toEqual([[expect.objectContaining({ id: 'oldest' })]])
  })

  it('brings forward the build the template went to when another build is picked while it opens', async () => {
    getInstallations.mockResolvedValue([RUNNING, OLDEST])
    let finish!: (outcome: 'opened') => void
    openTemplateInBuild.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const wrapper = await openHome()
    await searchAndPick(wrapper)

    await openBuildMenu(wrapper)
    const oldest = buildOptions().find((option) => option.textContent?.includes(OLDEST.name))!
    oldest.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()
    finish('opened')
    await flushPromises()

    expect(openTemplateInBuild).toHaveBeenCalledWith('running', 'poster_template')
    expect(wrapper.emitted('pick')).toEqual([[expect.objectContaining({ id: 'running' })]])
  })

  it.each(['console', 'external'])(
    'passes over builds that are not local, or that start in %s mode',
    async (launchMode) => {
      const remote = { ...NEWEST, sourceCategory: 'remote', lastLaunchedAt: 900 }
      const windowless = { ...RUNNING, launchMode }
      getInstallations.mockResolvedValue([remote, windowless, OLDEST])
      openTemplateInBuild.mockResolvedValue('launch')
      const wrapper = await openHome()
      await searchAndPick(wrapper)
      expect(searchTemplates).toHaveBeenCalledWith('a poster for a bake sale', 'oldest')
    }
  )

  it('passes over a local build that is marked broken', async () => {
    const broken = { ...RUNNING, statusTag: { style: 'danger', label: 'Broken' } }
    getInstallations.mockResolvedValue([{ ...CLOUD, lastLaunchedAt: 900 }, broken, OLDEST])
    openTemplateInBuild.mockResolvedValue('launch')
    const wrapper = await openHome()
    await searchAndPick(wrapper)
    expect(searchTemplates).toHaveBeenCalledWith('a poster for a bake sale', 'oldest')
  })

  it('says a template could not be opened when there is only Comfy Cloud', async () => {
    getInstallations.mockResolvedValue([CLOUD])
    const wrapper = await openHome()
    await searchAndPick(wrapper)

    expect(searchTemplates).toHaveBeenCalledWith('a poster for a bake sale', '')
    expect(openTemplateInBuild).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="home-template-search-open-failed"]').exists()).toBe(true)
  })
})
