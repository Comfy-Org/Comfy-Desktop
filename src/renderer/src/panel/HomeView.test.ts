import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import HomeView from './HomeView.vue'
import { useDashboardScopeStore } from '../stores/dashboardScopeStore'
import { useSessionStore } from '../stores/sessionStore'
import type { CatalogWorkflow, Installation } from '../types/ipc'

const listHomeWorkflows = vi.fn<() => Promise<CatalogWorkflow[]>>()
const openCatalogWorkflow = vi.fn<(id: string) => Promise<boolean>>()
const openCatalogWorkflowHub = vi.fn<() => Promise<boolean>>()
const getInstallations = vi.fn<() => Promise<Installation[]>>()

function workflow(id: string, title: string, thumbnailUrl: string | null = null): CatalogWorkflow {
  return { id, title, description: '', thumbnailUrl }
}

function build(over: Partial<Installation> & { id: string; name: string }): Installation {
  return { sourceLabel: 'Standalone', sourceCategory: 'local', ...over }
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
  openCatalogWorkflowHub.mockResolvedValue(true)
  getInstallations.mockResolvedValue([])
  ;(window as unknown as { api: unknown }).api = {
    listHomeWorkflows,
    openCatalogWorkflow,
    openCatalogWorkflowHub,
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

async function openHome() {
  const wrapper = mount(HomeView, { attachTo: document.body })
  await flushPromises()
  return wrapper
}

function arc(wrapper: VueWrapper): string[] {
  return wrapper
    .findAll('[data-testid="home-workflow-card"]:not([aria-hidden="true"])')
    .map((card) => ({
      offset: Number(card.attributes('data-arc-offset')),
      text: card.get('[data-testid="home-workflow-name"]').text()
    }))
    .sort((left, right) => left.offset - right.offset)
    .map((card) => `${card.offset}:${card.text}`)
}

function cardAt(wrapper: VueWrapper, offset: number) {
  return wrapper.get(`[data-testid="home-workflow-card"][data-arc-offset="${offset}"]`)
}

function pressCarouselAt(wrapper: VueWrapper, clientX: number): void {
  wrapper
    .get('[data-testid="home-workflow-carousel"]')
    .element.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX, bubbles: true }))
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

    const offStage = wrapper.findAll('[data-testid="home-workflow-card"][aria-hidden="true"]')

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
    const pictures = wrapper.findAll('[data-testid="home-workflow-card"] img')

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
    const carousel = wrapper.get('[data-testid="home-workflow-carousel"]')

    await carousel.trigger('keydown', { key: 'ArrowRight' })
    await carousel.trigger('keydown', { key: 'ArrowRight' })
    expect(cardAt(wrapper, 0).text()).toContain('Workflow 2')

    await carousel.trigger('keydown', { key: 'ArrowLeft' })
    expect(cardAt(wrapper, 0).text()).toContain('Workflow 1')
  })

  it('turns the carousel with the previous and next arrows', async () => {
    listHomeWorkflows.mockResolvedValue(SEVEN_WORKFLOWS)
    const wrapper = await openHome()
    const next = wrapper.get('[data-testid="home-workflow-next"]')
    const previous = wrapper.get('[data-testid="home-workflow-previous"]')

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
    const next = wrapper.get('[data-testid="home-workflow-next"]')
    const previous = wrapper.get('[data-testid="home-workflow-previous"]')

    expect(previous.attributes('disabled')).toBeDefined()
    expect(next.attributes('disabled')).toBeUndefined()

    await next.trigger('click')
    expect(cardAt(wrapper, 0).text()).toContain('Make your character talk')
    expect(next.attributes('disabled')).toBeDefined()
    expect(previous.attributes('disabled')).toBeUndefined()

    listHomeWorkflows.mockResolvedValue([UPSCALE])
    const single = await openHome()
    expect(single.find('[data-testid="home-workflow-next"]').exists()).toBe(false)
    expect(single.find('[data-testid="home-workflow-previous"]').exists()).toBe(false)
  })

  it('keeps keyboard focus on an arrow when the one in use reaches the end of a short list', async () => {
    listHomeWorkflows.mockResolvedValue([UPSCALE, TALK])
    const wrapper = await openHome()
    const next = wrapper.get<HTMLButtonElement>('[data-testid="home-workflow-next"]')
    const previous = wrapper.get<HTMLButtonElement>('[data-testid="home-workflow-previous"]')

    next.element.focus()
    await next.trigger('click')
    await flushPromises()

    expect(next.element.disabled).toBe(true)
    expect(document.activeElement).toBe(previous.element)
  })

  it('turns with the arrow keys from an arrow button and moves card focus to the new front card', async () => {
    listHomeWorkflows.mockResolvedValue(SEVEN_WORKFLOWS)
    const wrapper = await openHome()

    const next = wrapper.get('[data-testid="home-workflow-next"]')
    await next.trigger('keydown', { key: 'ArrowRight' })
    expect(cardAt(wrapper, 0).text()).toContain('Workflow 1')

    const front = cardAt(wrapper, 0).element as HTMLButtonElement
    front.focus()
    await cardAt(wrapper, 0).trigger('keydown', { key: 'ArrowRight' })
    await flushPromises()

    expect(cardAt(wrapper, 0).text()).toContain('Workflow 2')
    expect(document.activeElement).toBe(cardAt(wrapper, 0).element)
  })

  it('offers Open on the front card only, and opens that workflow from it', async () => {
    listHomeWorkflows.mockResolvedValue(SEVEN_WORKFLOWS)
    const wrapper = await openHome()
    const ctas = wrapper.findAll('[data-testid="home-workflow-cta"]')

    expect(ctas).toHaveLength(1)
    expect(cardAt(wrapper, 0).find('[data-testid="home-workflow-cta"]').text()).toBe('Open')
    expect(ctas[0]!.attributes('aria-hidden')).toBe('true')

    await ctas[0]!.trigger('click')

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

    await wrapper
      .get('[data-testid="home-workflow-carousel"]')
      .trigger('keydown', { key: 'ArrowLeft' })

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

  it('opens the full list of workflows on Comfy Hub from See all workflows', async () => {
    listHomeWorkflows.mockResolvedValue([UPSCALE])
    const wrapper = await openHome()

    await wrapper.get('[data-testid="home-see-all-workflows"]').trigger('click')

    expect(openCatalogWorkflowHub).toHaveBeenCalledOnce()
  })

  it('shows placeholders while the catalog is loading', async () => {
    listHomeWorkflows.mockReturnValue(new Promise(() => {}))
    const wrapper = await openHome()

    expect(wrapper.get('[data-testid="home-workflows-loading"]').attributes('aria-busy')).toBe(
      'true'
    )
    expect(wrapper.find('[data-testid="home-workflow-card"]').exists()).toBe(false)
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
    expect(wrapper.findAll('[data-testid="home-workflow-card"]')).toHaveLength(1)
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
      'Update availableMy Local 1Standalone',
      'RunningVideo LabStandalone',
      'Always onComfy CloudRTX 6000 Pro · 96 GB'
    ])
  })

  it('shows a stopped local build as ready, with its ComfyUI version and folder', async () => {
    getInstallations.mockResolvedValue([OLDEST])
    const wrapper = await openHome()

    expect(wrapper.get('[data-testid="home-build"]').text()).toBe(
      'ReadyFlux SandboxComfyUI v0.42.4 · /Users/pablo/ComfyUI-Installs/Flux'
    )
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

  it('opens the most recently used build from Open ComfyUI', async () => {
    getInstallations.mockResolvedValue([OLDEST, NEWEST, CLOUD])
    const wrapper = await openHome()

    await wrapper.get('[data-testid="home-open-comfyui"]').trigger('click')

    expect(wrapper.emitted('pick')).toEqual([[NEWEST]])
  })

  it('goes to the full list from All builds', async () => {
    getInstallations.mockResolvedValue([NEWEST])
    const wrapper = await openHome()

    await wrapper.get('[data-testid="home-all-builds"]').trigger('click')

    expect(wrapper.emitted('show-builds')).toHaveLength(1)
  })

  it('leaves the builds row and Open ComfyUI out when there is no build', async () => {
    const wrapper = await openHome()

    expect(wrapper.find('[data-testid="home-builds"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="home-open-comfyui"]').exists()).toBe(false)
  })
})
