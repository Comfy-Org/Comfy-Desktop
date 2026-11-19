import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import BuildDetailsView from './BuildDetailsView.vue'
import { useSessionStore } from '../stores/sessionStore'
import { provideBuildLogs } from '../composables/useBuildProgress'
import type { Installation } from '../types/ipc'

vi.mock('../components/settings/ComfyUISettingsContent.vue', () => ({
  default: {
    name: 'ComfyUISettingsContent',
    props: ['installation', 'globalSettingsSnapshot', 'pageActionsTarget', 'pageTitleTarget'],
    emits: ['show-progress', 'navigate-list', 'request-close', 'request-dismiss', 'primary-action'],
    template:
      '<div data-testid="settings-content"><Teleport defer :to="pageTitleTarget">{{ installation.name }}</Teleport></div>'
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

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as unknown as { api: unknown }).api = {
    getBuildStorageSnapshot: vi.fn().mockResolvedValue(SNAPSHOT),
    onSettingsChanged: vi.fn(() => unsubscribeSettings),
    onInstallationsChanged: vi.fn(() => () => {}),
    onInstallationsVersionsUpdated: vi.fn(() => () => {})
  }
  setActivePinia(createPinia())
})

const viewBuildLogs = vi.fn()

async function mountDetails(installation: Installation = INSTALL) {
  const Host = defineComponent({
    setup() {
      provideBuildLogs(viewBuildLogs)
      return () => h(BuildDetailsView, { installation })
    }
  })
  const host = mount(Host, { attachTo: document.body })
  const wrapper = host.getComponent(BuildDetailsView)
  await flushPromises()
  return { wrapper, host, content: wrapper.findComponent({ name: 'ComfyUISettingsContent' }) }
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

  it.each([
    ["Didn't start", { startFailed: true, message: 'Port 8188 is in use' }],
    ['Crashed', { exitCode: 1 }],
    ['Error', { message: 'Could not install the new dependencies' }]
  ] as const)('names a build that went wrong %s, like its tile', async (label, error) => {
    const { wrapper } = await mountDetails()

    useSessionStore().errorInstances.set('a', { installationName: 'Video Lab', ...error })
    await flushPromises()

    expect(wrapper.get('.build-details-status').text()).toBe(label)
  })

  it("opens the start logs from the Didn't start chip, like the Home tile", async () => {
    const { wrapper } = await mountDetails()
    useSessionStore().errorInstances.set('a', {
      installationName: 'Video Lab',
      startFailed: true,
      message: 'Port 8188 is in use'
    })
    await flushPromises()

    await wrapper.get('[data-testid="build-details-failure"]').trigger('click')

    expect(viewBuildLogs).toHaveBeenCalledWith('a')
    expect(wrapper.emitted('view-error')).toBeUndefined()
  })

  it('opens the crash details from the Crashed chip, like the Builds tile', async () => {
    const { wrapper } = await mountDetails()
    useSessionStore().errorInstances.set('a', { installationName: 'Video Lab', exitCode: 1 })
    await flushPromises()

    await wrapper.get('[data-testid="build-details-failure"]').trigger('click')

    expect(wrapper.emitted('view-error')).toEqual([[INSTALL]])
    expect(viewBuildLogs).not.toHaveBeenCalled()
  })

  it("keeps a running build's chip as plain text", async () => {
    const { wrapper } = await mountDetails()
    useSessionStore().runningInstances.set('a', {
      installationId: 'a',
      installationName: 'Video Lab',
      mode: 'window'
    })
    await flushPromises()

    expect(wrapper.find('[data-testid="build-details-failure"]').exists()).toBe(false)
  })

  it('hands the settings body its build, shared storage, title and action slots', async () => {
    const { content } = await mountDetails()

    expect(content.props('installation')).toEqual(INSTALL)
    expect(content.props('globalSettingsSnapshot')).toEqual(SNAPSHOT)
    expect(content.props('pageActionsTarget')).toBe('#build-details-actions')
    expect(content.props('pageTitleTarget')).toBe('#build-details-title')
  })

  it('launches the build from the primary action', async () => {
    const { wrapper, content } = await mountDetails()

    content.vm.$emit('primary-action', { verb: 'start' })

    expect(wrapper.emitted('launch')).toEqual([[INSTALL]])
  })

  it.each(['navigate-list', 'request-close', 'request-dismiss'])(
    'returns to the list on %s',
    async (event) => {
      const { wrapper, content } = await mountDetails()

      content.vm.$emit(event)

      expect(wrapper.emitted('back')).toHaveLength(1)
    }
  )

  it('has no back link, since the sidebar returns to the list', async () => {
    const { wrapper } = await mountDetails()

    expect(wrapper.find('.build-details-back').exists()).toBe(false)
  })

  it('stops listening for settings changes when closed', async () => {
    const { host } = await mountDetails()

    host.unmount()

    expect(unsubscribeSettings).toHaveBeenCalledOnce()
  })
})
