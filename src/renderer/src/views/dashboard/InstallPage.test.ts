import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { TooltipProvider } from 'reka-ui'
import { defineComponent, h } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import InstallPage from './InstallPage.vue'
import { provideBuildRename } from './useBuildRename'
import { useSessionStore } from '../../stores/sessionStore'
import type { Installation } from '../../types/ipc'

const local = {
  id: 'a',
  name: 'Studio',
  sourceCategory: 'local',
  sourceId: 'standalone',
  status: 'installed',
  version: 'v0.3.60'
} as Installation
const cloud = { ...local, id: 'b', name: 'Comfy Cloud', sourceCategory: 'cloud' } as Installation

/** The dashboard provides rename state to its cards, pages and sidebar. */
const RenameScope = defineComponent({
  setup(_, { slots }) {
    provideBuildRename()
    return () => slots.default?.()
  }
})

function mountPage(installation: Installation) {
  // The tabs list contents through main; they have their own tests.
  return mount(TooltipProvider, {
    slots: {
      default: () =>
        h(RenameScope, () => h(InstallPage, { installation, isStoppedActionGated: false }))
    },
    global: { stubs: { WorkflowsTab: true, ModelsTab: true, NodesTab: true } }
  }).findComponent(InstallPage)
}

describe('InstallPage', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('shows the build and starts it', async () => {
    const wrapper = mountPage(local)
    expect(wrapper.get('h1').text()).toBe('Studio')
    expect(wrapper.find('[data-testid="build-type-tag"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Not running')
    expect(wrapper.find('[data-testid="dashboard-stop"]').exists()).toBe(false)
    await wrapper.get('[data-testid="dashboard-launch"]').trigger('click')
    expect(wrapper.emitted('launch')?.[0]).toEqual([local])
  })

  it('offers Stop for a running local build only', async () => {
    const sessions = useSessionStore()
    sessions.runningInstances.set('a', { installationId: 'a' } as never)
    sessions.runningInstances.set('b', { installationId: 'b' } as never)
    const running = mountPage(local)
    expect(running.get('[data-testid="dashboard-launch"]').text()).toBe('Open ComfyUI')
    await running.get('[data-testid="dashboard-stop"]').trigger('click')
    expect(running.emitted('stop')?.[0]).toEqual([local])
    expect(mountPage(cloud).find('[data-testid="dashboard-stop"]').exists()).toBe(false)
  })

  it('shows a remote build without its contents', () => {
    const remote = { ...local, sourceCategory: 'remote' } as Installation
    const wrapper = mountPage(remote)
    expect(wrapper.text()).toContain('This build runs on another computer')
    expect(wrapper.find('[role="tablist"]').exists()).toBe(false)
  })

  it('goes back to all builds', async () => {
    const wrapper = mountPage(local)
    await wrapper.get('[data-testid="dashboard-back"]').trigger('click')
    expect(wrapper.emitted('back')).toHaveLength(1)
  })
})
