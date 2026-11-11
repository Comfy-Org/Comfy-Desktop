import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import HomeView from './HomeView.vue'
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

const UPSCALE = workflow(
  'upscale',
  'Upscale and restore detail',
  'https://comfy.org/catalog-media/upscale/v1'
)
const TALK = workflow('talk', 'Make your character talk')
const SEVEN_WORKFLOWS = Array.from({ length: 7 }, (_, index) =>
  workflow(`workflow-${index}`, `Workflow ${index}`)
)

const OLDEST = build({ id: 'oldest', name: 'Flux Sandbox', lastLaunchedAt: 100 })
const CLOUD = build({
  id: 'cloud',
  name: 'Comfy Cloud',
  sourceCategory: 'cloud',
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
    onSettingsChanged: vi.fn(() => () => {})
  }
  setActivePinia(createPinia())
})

async function openHome() {
  const wrapper = mount(HomeView, { attachTo: document.body })
  await flushPromises()
  return wrapper
}

describe('Home example workflows', () => {
  it('fans out the first five catalog workflows and opens the one that is clicked', async () => {
    listHomeWorkflows.mockResolvedValue(SEVEN_WORKFLOWS)
    const wrapper = await openHome()

    const cards = wrapper.findAll('[data-testid="home-workflow-card"]')
    expect(cards.map((card) => card.text())).toEqual([
      'Workflow 0',
      'Workflow 1',
      'Workflow 2',
      'Workflow 3',
      'Workflow 4'
    ])
    expect(wrapper.get('[data-testid="home-workflow-count"]').text()).toBe('7')

    await cards[3]!.trigger('click')

    expect(openCatalogWorkflow).toHaveBeenCalledExactlyOnceWith('workflow-3')
  })

  it('keeps a short list centred in the fan', async () => {
    listHomeWorkflows.mockResolvedValue([UPSCALE, TALK, workflow('third', 'Third')])
    const wrapper = await openHome()

    const lefts = wrapper
      .findAll<HTMLElement>('[data-testid="home-workflow-card"]')
      .map((card) => card.element.style.left)

    expect(lefts).toEqual(['122px', '244px', '346px'])
  })

  it('shows the catalog picture on a card and a plain card when there is none', async () => {
    listHomeWorkflows.mockResolvedValue([UPSCALE, TALK])
    const wrapper = await openHome()
    const [withPicture, withoutPicture] = wrapper.findAll('[data-testid="home-workflow-card"]')

    expect(withPicture!.get('img').attributes('src')).toBe(UPSCALE.thumbnailUrl)
    expect(withoutPicture!.find('img').exists()).toBe(false)

    await withPicture!.get('img').trigger('error')

    expect(withPicture!.find('img').exists()).toBe(false)
    expect(withPicture!.text()).toBe('Upscale and restore detail')
  })

  it('names each card by what opening it does, for screen readers', async () => {
    listHomeWorkflows.mockResolvedValue([UPSCALE])
    const wrapper = await openHome()

    expect(wrapper.get('[data-testid="home-workflow-card"]').attributes('aria-label')).toBe(
      'Open Upscale and restore detail on Comfy Hub'
    )
  })

  it('opens the full list of workflows on Comfy Hub from Explore all', async () => {
    listHomeWorkflows.mockResolvedValue([UPSCALE])
    const wrapper = await openHome()

    await wrapper.get('[data-testid="home-explore-workflows"]').trigger('click')

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

    expect(wrapper.findAll('[data-testid="home-build"]').map((row) => row.text())).toEqual([
      'My Local 1Update available',
      'Video LabRunning',
      'Comfy CloudCloud'
    ])
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
