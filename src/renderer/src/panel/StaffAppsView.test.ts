import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import '../assets/main.css'
import StaffAppsView from './StaffAppsView.vue'
import type { HiddenAppCard } from '../types/ipc'

const COVER =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>'

const WORLDS: HiddenAppCard = {
  id: 'explore-worlds',
  title: 'Explore Worlds',
  description: 'Walk through a world made from one picture.',
  covers: [{ url: COVER, stillUrl: COVER }],
  reasons: ['hub_only'],
  hasPage: true
}

const RELIGHT: HiddenAppCard = {
  id: 'relight',
  title: 'Relight',
  description: 'Change the light in a photo.',
  covers: [],
  reasons: ['off', 'draft', 'unpublished'],
  hasPage: false
}

const CARDS = '[data-testid="staff-apps-grid"] [data-testid^="staff-app-card-"]'

function mountPage(apps: HiddenAppCard[] = [WORLDS, RELIGHT]) {
  return mount(StaffAppsView, { props: { apps }, attachTo: document.body })
}

function chipsOf(wrapper: ReturnType<typeof mountPage>, id: string): string[] {
  return wrapper
    .get(`[data-testid="staff-app-card-${id}"]`)
    .findAll('[data-badge-style="chip"]')
    .map((chip) => chip.get('[aria-hidden="true"]').text())
}

function cardIds(wrapper: ReturnType<typeof mountPage>): (string | undefined)[] {
  return wrapper.findAll(CARDS).map((card) => card.attributes('data-testid'))
}

describe('StaffAppsView', () => {
  it('is titled Development and lists every staff app with a chip that says why it is hidden', () => {
    const wrapper = mountPage()

    expect(wrapper.get('h1').text()).toBe('Development')
    expect(wrapper.text()).toContain('Only Comfy staff see this page.')
    expect(cardIds(wrapper)).toEqual(['staff-app-card-explore-worlds', 'staff-app-card-relight'])
    expect(chipsOf(wrapper, 'explore-worlds')).toEqual(['Hub only'])
    expect(chipsOf(wrapper, 'relight')).toEqual(['Off', 'Draft', 'Unpublished edits'])
    const worlds = wrapper.get('[data-testid="staff-app-card-explore-worlds"]')
    expect(worlds.text()).toContain('Walk through a world made from one picture.')
    expect(worlds.get('img').attributes('src')).toBe(COVER)
    wrapper.unmount()
  })

  it('asks to open an app that has a page', async () => {
    const wrapper = mountPage()

    await wrapper.get('[data-testid="staff-app-card-explore-worlds"]').trigger('click')

    expect(wrapper.emitted('open-app')?.[0]?.[0]).toMatchObject({ id: 'explore-worlds' })
    wrapper.unmount()
  })

  it('shows an app with no page as a card that does not open and says it has no page yet', async () => {
    const wrapper = mountPage()

    const card = wrapper.get('[data-testid="staff-app-card-relight"]')
    expect(card.element.tagName).toBe('DIV')
    expect(card.get('[data-testid="app-card-note"]').text()).toBe('No page on comfy.org yet')
    expect(card.find('[data-testid="app-card-go"]').exists()).toBe(false)

    await card.trigger('click')

    expect(wrapper.emitted('open-app')).toBeUndefined()
    wrapper.unmount()
  })

  it('narrows the list with its search, and clears it from the no-match state', async () => {
    const wrapper = mountPage()

    await wrapper.get('input').setValue('light')
    expect(cardIds(wrapper)).toEqual(['staff-app-card-relight'])

    await wrapper.get('input').setValue('nothing like this')
    expect(wrapper.find('[data-testid="staff-apps-grid"]').exists()).toBe(false)
    await wrapper.get('[data-testid="staff-apps-clear-search"]').trigger('click')

    expect(cardIds(wrapper)).toHaveLength(2)
    wrapper.unmount()
  })
})
