import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { TooltipProvider } from 'reka-ui'
import { defineComponent, h } from 'vue'
import DashboardSidebar from './DashboardSidebar.vue'
import { provideBuildRename } from './useBuildRename'
import { useSessionStore } from '../../stores/sessionStore'
import { ALL_BUILDS, installPage } from './dashboardPage'
import type { DashboardPage } from './dashboardPage'
import type { Installation } from '../../types/ipc'

const installs = [
  { id: 'local', name: 'Studio', sourceCategory: 'local' },
  { id: 'cloud', name: 'Comfy Cloud', sourceCategory: 'cloud' }
] as Installation[]

/** The dashboard provides rename state to its cards, pages and sidebar. */
const RenameScope = defineComponent({
  setup(_, { slots }) {
    provideBuildRename()
    return () => slots.default?.()
  }
})

function mountSidebar(page: DashboardPage = ALL_BUILDS) {
  return mount(TooltipProvider, {
    attachTo: document.body,
    slots: {
      default: () =>
        h(RenameScope, () =>
          h(DashboardSidebar, { installations: installs, page }, { foot: () => h('div', 'foot') })
        )
    }
  })
}

describe('DashboardSidebar', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('lists every build of the workspace under All builds, with its count', () => {
    const wrapper = mountSidebar()
    expect(wrapper.get('[data-testid="dashboard-all-builds"]').text()).toContain('2')
    expect(wrapper.get('[data-testid="dashboard-all-builds"]').attributes('aria-current')).toBe(
      'page'
    )
    expect(wrapper.find('[data-testid="dashboard-sidebar-build-local"]').text()).toContain('Studio')
  })

  it('marks the open build and running builds', () => {
    useSessionStore().runningInstances.set('cloud', { installationId: 'cloud' } as never)
    const wrapper = mountSidebar(installPage('local'))
    expect(
      wrapper.get('[data-testid="dashboard-sidebar-build-local"]').attributes('aria-current')
    ).toBe('page')
    expect(wrapper.get('[data-testid="dashboard-sidebar-build-cloud"]').text()).toContain('Running')
    expect(wrapper.get('[data-testid="dashboard-sidebar-build-local"]').text()).not.toContain(
      'Running'
    )
  })

  it('opens a build page and asks for a new build', async () => {
    const wrapper = mountSidebar()
    const sidebar = wrapper.findComponent(DashboardSidebar)
    await wrapper.get('[data-testid="dashboard-sidebar-build-cloud"]').trigger('click')
    expect(sidebar.emitted('update:page')?.at(-1)).toEqual([installPage('cloud')])
    await wrapper.get('[data-testid="dashboard-new-build"]').trigger('click')
    expect(sidebar.emitted('new-build')).toHaveLength(1)
  })

  it('renames a build from its row: double-click, type, Enter', async () => {
    const updateInstallation = vi.fn(async () => ({ ok: true }))
    Object.defineProperty(window, 'api', { value: { updateInstallation }, configurable: true })
    const wrapper = mountSidebar()
    await wrapper.get('[data-testid="dashboard-sidebar-build-local"]').trigger('dblclick')
    expect(wrapper.find('[data-testid="dashboard-sidebar-build-local"]').exists()).toBe(false)
    const input = wrapper.get('input')
    await input.setValue('Studio 2')
    await input.trigger('keydown', { key: 'Enter' })
    expect(updateInstallation).toHaveBeenCalledWith('local', { name: 'Studio 2' })
    expect(wrapper.find('input').exists()).toBe(false)
    wrapper.unmount()
  })

  it("opens a build's menu on right-click", async () => {
    const wrapper = mountSidebar()
    await wrapper.get('[data-testid="dashboard-sidebar-build-local"]').trigger('contextmenu')
    expect(wrapper.findComponent(DashboardSidebar).emitted('open-menu')?.[0]?.[1]).toEqual(
      installs[0]
    )
    wrapper.unmount()
  })
})
