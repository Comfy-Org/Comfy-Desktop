import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import HomeView from './HomeView.vue'
import type { CatalogWorkflow } from '../types/ipc'

const listHomeWorkflows = vi.fn<() => Promise<CatalogWorkflow[]>>()
const openCatalogWorkflow = vi.fn<(id: string) => Promise<boolean>>()

const UPSCALE: CatalogWorkflow = {
  id: 'upscale',
  title: 'Upscale and restore detail',
  description: 'Enlarge an image and restore fine detail.',
  thumbnailUrl: 'https://comfy.org/catalog-media/upscale/v1'
}
const TALK: CatalogWorkflow = {
  id: 'talk',
  title: 'Make your character talk',
  description: '',
  thumbnailUrl: null
}

beforeEach(() => {
  vi.clearAllMocks()
  openCatalogWorkflow.mockResolvedValue(true)
  ;(window as unknown as { api: unknown }).api = { listHomeWorkflows, openCatalogWorkflow }
})

async function openHome() {
  const wrapper = mount(HomeView, { attachTo: document.body })
  await flushPromises()
  return wrapper
}

describe('Home', () => {
  it('lists the example workflows from the catalog and opens the one that is clicked', async () => {
    listHomeWorkflows.mockResolvedValue([UPSCALE, TALK])
    const wrapper = await openHome()

    const cards = wrapper.findAll('[data-testid="home-workflow-card"]')
    expect(cards.map((card) => card.text())).toEqual([
      'Upscale and restore detailEnlarge an image and restore fine detail.',
      'Make your character talk'
    ])
    expect(wrapper.get('[data-testid="home-workflow-count"]').text()).toBe('2')
    expect(cards[0]!.get('img').attributes('src')).toBe(UPSCALE.thumbnailUrl)
    expect(cards[1]!.find('img').exists()).toBe(false)

    await cards[1]!.trigger('click')

    expect(openCatalogWorkflow).toHaveBeenCalledExactlyOnceWith('talk')
  })

  it('names each card by what opening it does, for screen readers', async () => {
    listHomeWorkflows.mockResolvedValue([UPSCALE])
    const wrapper = await openHome()

    expect(wrapper.get('[data-testid="home-workflow-card"]').attributes('aria-label')).toBe(
      'Open Upscale and restore detail on Comfy Hub'
    )
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

  it('drops a picture that fails to load and keeps the card', async () => {
    listHomeWorkflows.mockResolvedValue([UPSCALE])
    const wrapper = await openHome()
    const card = wrapper.get('[data-testid="home-workflow-card"]')

    await card.get('img').trigger('error')

    expect(card.find('img').exists()).toBe(false)
    expect(card.text()).toContain('Upscale and restore detail')
  })
})
