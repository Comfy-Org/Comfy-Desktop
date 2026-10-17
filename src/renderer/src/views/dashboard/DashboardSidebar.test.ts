import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { TooltipProvider } from 'reka-ui'
import { h } from 'vue'
import DashboardSidebar from './DashboardSidebar.vue'
import { useSessionStore } from '../../stores/sessionStore'
import { ALL_BUILDS, installPage } from './dashboardPage'
import type { DashboardPage } from './dashboardPage'
import type { Installation } from '../../types/ipc'

const installs = [
  { id: 'local', name: 'Studio', sourceCategory: 'local' },
  { id: 'cloud', name: 'Comfy Cloud', sourceCategory: 'cloud' }
] as Installation[]

function mountSidebar(page: DashboardPage = ALL_BUILDS) {
  return mount(TooltipProvider, {
    slots: {
      default: () =>
        h(DashboardSidebar, { installations: installs, page }, { foot: () => h('div', 'foot') })
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
})
