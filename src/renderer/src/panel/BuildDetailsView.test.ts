import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import BuildDetailsView from './BuildDetailsView.vue'
import { useSessionStore } from '../stores/sessionStore'
import type { Installation } from '../types/ipc'

vi.mock('../components/settings/ComfyUISettingsContent.vue', () => ({
  default: {
    name: 'ComfyUISettingsContent',
    props: ['installation', 'globalSettingsSnapshot', 'pageActionsTarget'],
    emits: [
      'show-progress',
      'navigate-list',
      'request-close',
      'request-dismiss',
      'primary-action',
      'open-new-window'
    ],
    template: '<div data-testid="settings-content" />'
  }
}))

const SNAPSHOT = {
  sharedDirectoriesFields: [],
  modelsDirs: [{ path: '/models', isPrimary: true }],
  modelsSystemDefault: '/models'
}

const INSTALL: Installation = {
  id: 'a',
  name: 'Video Lab',
  sourceLabel: 'Standalone',
  sourceCategory: 'local',
  version: 'v0.38.0'
}

const unsubscribeSettings = vi.fn()
const openInstallInNewWindow = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as unknown as { api: unknown }).api = {
    getBuildStorageSnapshot: vi.fn().mockResolvedValue(SNAPSHOT),
    onSettingsChanged: vi.fn(() => unsubscribeSettings),
    openInstallInNewWindow
  }
  setActivePinia(createPinia())
})

async function mountDetails(installation: Installation = INSTALL) {
  const wrapper = mount(BuildDetailsView, {
    props: { installation }
  })
  await flushPromises()
  return { wrapper, content: wrapper.findComponent({ name: 'ComfyUISettingsContent' }) }
}

describe('BuildDetailsView', () => {
  it('says what the build is and where it runs', async () => {
    const { wrapper } = await mountDetails()

    expect(wrapper.get('h1').text()).toBe('Video Lab')
    expect(wrapper.get('.build-details-meta').text()).toBe('This computer · Standalone · v0.38.0')
    expect(wrapper.find('.build-details-status').exists()).toBe(false)
  })

  it('shows a running build as running', async () => {
    const { wrapper } = await mountDetails()

    useSessionStore().runningInstances.set('a', {
      installationId: 'a',
      installationName: 'Video Lab',
      mode: 'window'
    })
    await flushPromises()

    expect(wrapper.get('.build-details-status').text()).toBe('Running')
  })

  it('hands the settings body its build, shared storage and action slot', async () => {
    const { content } = await mountDetails()

    expect(content.props('installation')).toEqual(INSTALL)
    expect(content.props('globalSettingsSnapshot')).toEqual(SNAPSHOT)
    expect(content.props('pageActionsTarget')).toBe('#build-details-actions')
  })

  it('launches the build from the primary action', async () => {
    const { wrapper, content } = await mountDetails()

    content.vm.$emit('primary-action', { verb: 'switch' })

    expect(wrapper.emitted('launch')).toEqual([[INSTALL]])
  })

  it('opens the build in its own window instead of launching it into this one', async () => {
    const { wrapper, content } = await mountDetails()

    content.vm.$emit('open-new-window', { verb: 'open-new' })

    expect(openInstallInNewWindow).toHaveBeenCalledExactlyOnceWith('a')
    expect(wrapper.emitted('launch')).toBeUndefined()
  })

  it.each(['navigate-list', 'request-close', 'request-dismiss'])(
    'returns to the list on %s',
    async (event) => {
      const { wrapper, content } = await mountDetails()

      content.vm.$emit(event)

      expect(wrapper.emitted('back')).toHaveLength(1)
    }
  )

  it('returns to the list from the back link', async () => {
    const { wrapper } = await mountDetails()

    await wrapper.get('.build-details-back').trigger('click')

    expect(wrapper.emitted('back')).toHaveLength(1)
  })

  it('stops listening for settings changes when closed', async () => {
    const { wrapper } = await mountDetails()

    wrapper.unmount()

    expect(unsubscribeSettings).toHaveBeenCalledOnce()
  })
})
