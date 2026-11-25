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
  page: 'live'
}

const RELIGHT: HiddenAppCard = {
  id: 'relight',
  title: 'Relight',
  description: 'Change the light in a photo.',
  covers: [],
  reasons: ['off', 'draft', 'unpublished'],
  page: 'missing'
}

const STYLE: HiddenAppCard = {
  id: 'style-transfer',
  title: 'Style Transfer',
  description: '',
  covers: [],
  reasons: ['draft'],
  page: 'unchecked'
}

const COMPOSE: HiddenAppCard = {
  id: 'compose-scene',
  title: 'Compose Scene',
  description: 'Place things in a scene.',
  covers: [],
  reasons: ['off'],
  page: 'missing',
  opens: 'draft'
}

const NEVER_PUBLISHED_DRAFT: HiddenAppCard = {
  ...COMPOSE,
  id: 'make-song',
  title: 'Make Song',
  reasons: ['off', 'draft']
}

const RESHOOT: HiddenAppCard = {
  id: 'reshoot',
  title: 'Reshoot',
  description: 'Shoot a video again from a new angle.',
  covers: [],
  reasons: ['hub_only'],
  page: 'missing',
  opens: 'hub'
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

  it('opens the draft page of an app with no page on comfy.org, with a Draft chip and no no-page note', async () => {
    const wrapper = mountPage([COMPOSE])

    const card = wrapper.get('[data-testid="staff-app-card-compose-scene"]')
    expect(card.element.tagName).toBe('BUTTON')
    expect(chipsOf(wrapper, 'compose-scene')).toEqual(['Draft', 'Off'])
    expect(card.find('[data-testid="app-card-note"]').exists()).toBe(false)
    expect(card.text()).not.toContain('No page on comfy.org yet')

    await card.trigger('click')

    expect(wrapper.emitted('open-draft')?.[0]?.[0]).toMatchObject({ id: 'compose-scene' })
    expect(wrapper.emitted('open-app')).toBeUndefined()
    expect(wrapper.emitted('open-hub-page')).toBeUndefined()
    wrapper.unmount()
  })

  it('shows one Draft chip on a never-published app that opens its draft page', () => {
    const wrapper = mountPage([NEVER_PUBLISHED_DRAFT])

    expect(chipsOf(wrapper, 'make-song')).toEqual(['Draft', 'Off'])
    wrapper.unmount()
  })

  it('opens the Hub page of a Hub-only app with no page on comfy.org', async () => {
    const wrapper = mountPage([RESHOOT])

    const card = wrapper.get('[data-testid="staff-app-card-reshoot"]')
    expect(card.element.tagName).toBe('BUTTON')
    expect(chipsOf(wrapper, 'reshoot')).toEqual(['Hub only'])
    expect(card.text()).not.toContain('No page on comfy.org yet')

    await card.trigger('click')

    expect(wrapper.emitted('open-hub-page')?.[0]?.[0]).toMatchObject({ id: 'reshoot' })
    expect(wrapper.emitted('open-app')).toBeUndefined()
    expect(wrapper.emitted('open-draft')).toBeUndefined()
    wrapper.unmount()
  })

  it('shows an app whose page could not be checked as a card that does not open and says so', async () => {
    const wrapper = mountPage([WORLDS, STYLE])

    const card = wrapper.get('[data-testid="staff-app-card-style-transfer"]')
    expect(card.element.tagName).toBe('DIV')
    expect(card.get('[data-testid="app-card-note"]').text()).toBe(
      "Couldn't check the page on comfy.org"
    )
    expect(card.text()).not.toContain('No page on comfy.org yet')

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
