import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import BuildDetailsView from './BuildDetailsView.vue'
import { useSessionStore } from '../stores/sessionStore'
import { useProgressStore, type Operation } from '../stores/progressStore'
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
const launchEvents: Record<string, (data: { installationId: string }) => void> = {}

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as unknown as { api: unknown }).api = {
    getBuildStorageSnapshot: vi.fn().mockResolvedValue(SNAPSHOT),
    onSettingsChanged: vi.fn(() => unsubscribeSettings),
    onInstallationsChanged: vi.fn(() => () => {}),
    onInstallationsVersionsUpdated: vi.fn(() => () => {}),
    onInstanceLaunching: vi.fn((cb) => {
      launchEvents.launching = cb
      return () => {}
    }),
    onInstanceStarted: vi.fn((cb) => {
      launchEvents.started = cb
      return () => {}
    })
  }
  setActivePinia(createPinia())
})

const viewBuildLogs = vi.fn()

function failStart(message = 'Port 8188 is in use'): void {
  useProgressStore().operations.set('a', {
    opKind: 'launch',
    finished: true,
    cancelRequested: false,
    error: message
  } as Operation)
  useSessionStore().errorInstances.set('a', {
    installationName: 'Video Lab',
    startFailed: true,
    message
  })
}

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
    failStart()
    await flushPromises()

    await wrapper.get('[data-testid="build-details-failure"]').trigger('click')

    expect(viewBuildLogs).toHaveBeenCalledWith('a')
    expect(wrapper.emitted('view-error')).toBeUndefined()
  })

  it("opens the error details from the Didn't start chip when this window has no start logs", async () => {
    const { wrapper } = await mountDetails()
    useSessionStore().errorInstances.set('a', {
      installationName: 'Video Lab',
      startFailed: true,
      message: 'Port 8188 is in use'
    })
    await flushPromises()

    expect(wrapper.get('.build-details-status').text()).toBe("Didn't start")
    await wrapper.get('[data-testid="build-details-failure"]').trigger('click')

    expect(wrapper.emitted('view-error')).toEqual([[INSTALL]])
    expect(viewBuildLogs).not.toHaveBeenCalled()
  })

  it.each(['launching', 'started'])(
    "stops saying Didn't start once the build is %s again from any window",
    async (event) => {
      const { wrapper } = await mountDetails()
      failStart()
      await flushPromises()
      expect(wrapper.get('.build-details-status').text()).toBe("Didn't start")

      const sessions = useSessionStore()
      sessions.errorInstances.delete('a')
      if (event === 'started') {
        sessions.runningInstances.set('a', {
          installationId: 'a',
          installationName: 'Video Lab',
          mode: 'window'
        })
      } else {
        sessions.launchingInstances.set('a', { installationName: 'Video Lab' })
      }
      launchEvents[event]!({ installationId: 'a' })
      await flushPromises()

      expect(wrapper.get('.build-details-status').text()).toBe(
        event === 'started' ? 'Running' : 'Starting…'
      )
      expect(wrapper.find('[data-testid="build-start-failed"]').exists()).toBe(false)
      expect(useProgressStore().operations.get('a')?.error).toBe('Port 8188 is in use')
    }
  )

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

  describe('the notice when the build did not start', () => {
    const notice = (wrapper: Awaited<ReturnType<typeof mountDetails>>['wrapper']) =>
      wrapper.find('[data-testid="build-start-failed"]')

    it('names the failure and its reason above the tabs, with View logs as its one action', async () => {
      const { wrapper } = await mountDetails()
      failStart()
      await flushPromises()

      expect(notice(wrapper).get('h2').text()).toBe("ComfyUI didn't start")
      expect(notice(wrapper).get('[data-testid="build-start-failed-reason"]').text()).toBe(
        'Port 8188 is in use'
      )
      expect(
        notice(wrapper)
          .findAll('button')
          .map((b) => b.text())
      ).toEqual(['View logs'])
      expect(wrapper.find('[data-testid="settings-content"]').exists()).toBe(true)
      expect(
        notice(wrapper).element.compareDocumentPosition(
          wrapper.get('[data-testid="settings-content"]').element
        ) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
    })

    it('shows the title alone when the reason is unknown', async () => {
      const { wrapper } = await mountDetails()
      useSessionStore().errorInstances.set('a', {
        installationName: 'Video Lab',
        startFailed: true
      })
      await flushPromises()

      expect(notice(wrapper).get('h2').text()).toBe("ComfyUI didn't start")
      expect(notice(wrapper).find('[data-testid="build-start-failed-reason"]').exists()).toBe(false)
    })

    it('opens the start logs from View logs', async () => {
      const { wrapper } = await mountDetails()
      failStart()
      await flushPromises()

      await notice(wrapper).get('[data-testid="build-start-retry"]').trigger('click')

      expect(viewBuildLogs).toHaveBeenCalledWith('a')
    })

    it('offers View error, not an empty logs window, after an Auto start or earlier start failed', async () => {
      const { wrapper } = await mountDetails()
      useSessionStore().errorInstances.set('a', {
        installationName: 'Video Lab',
        startFailed: true,
        message: 'Port 8188 is in use'
      })
      await flushPromises()

      const action = notice(wrapper).get('[data-testid="build-start-retry"]')
      expect(action.text()).toBe('View error')
      await action.trigger('click')

      expect(wrapper.emitted('view-error')).toEqual([[INSTALL]])
      expect(viewBuildLogs).not.toHaveBeenCalled()
    })

    it('opens the crash details from View logs on a build that crashed', async () => {
      const { wrapper } = await mountDetails()
      useSessionStore().errorInstances.set('a', { installationName: 'Video Lab', exitCode: 1 })
      await flushPromises()

      expect(notice(wrapper).get('h2').text()).toBe('ComfyUI exited unexpectedly')
      await notice(wrapper).get('[data-testid="build-start-retry"]').trigger('click')

      expect(wrapper.emitted('view-error')).toEqual([[INSTALL]])
      expect(viewBuildLogs).not.toHaveBeenCalled()
    })

    it('goes away when the build starts again', async () => {
      const { wrapper } = await mountDetails()
      const sessions = useSessionStore()
      sessions.errorInstances.set('a', { installationName: 'Video Lab', startFailed: true })
      await flushPromises()
      expect(notice(wrapper).exists()).toBe(true)

      sessions.errorInstances.delete('a')
      sessions.launchingInstances.set('a', { installationName: 'Video Lab' })
      await flushPromises()

      expect(notice(wrapper).exists()).toBe(false)
      expect(wrapper.get('.build-details-status').text()).toBe('Starting…')
    })
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
