import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { TooltipProvider } from 'reka-ui'
import { defineComponent, h } from 'vue'
import InstallListPage from './InstallListPage.vue'
import { provideBuildRename } from './useBuildRename'
import { useSessionStore } from '../../stores/sessionStore'
import type { Installation } from '../../types/ipc'

const installs = [
  { id: 'a', name: 'Studio', sourceCategory: 'local', sourceId: 'standalone', status: 'installed' },
  { id: 'b', name: 'Comfy Cloud', sourceCategory: 'cloud', sourceId: 'cloud', status: 'installed' },
  { id: 'c', name: 'Render box', sourceCategory: 'remote', sourceId: 'remote', status: 'installed' }
] as Installation[]

/** The dashboard provides rename state to its cards, pages and sidebar. */
const RenameScope = defineComponent({
  setup(_, { slots }) {
    provideBuildRename()
    return () => slots.default?.()
  }
})

function mountPage(installations = installs) {
  const wrapper = mount(TooltipProvider, {
    slots: {
      default: () =>
        h(RenameScope, () =>
          h(InstallListPage, {
            installations,
            showFreeRunsPill: false,
            showWhyCloud: false,
            isStoppedActionGated: () => false,
            isPromotingToWorkspace: () => false
          })
        )
    }
  })
  return { wrapper, page: wrapper.findComponent(InstallListPage) }
}

const cardIds = (wrapper: ReturnType<typeof mountPage>['wrapper']): string[] =>
  wrapper
    .findAll('[data-testid^="dashboard-card-"]')
    .map((card) => card.attributes('data-testid')!)
    .filter((id) => /^dashboard-card-[a-z]$/.test(id))

describe('InstallListPage', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('shows every build, and remote builds under All only', async () => {
    const { wrapper } = mountPage()
    expect(cardIds(wrapper)).toEqual(['dashboard-card-a', 'dashboard-card-b', 'dashboard-card-c'])
    const filters = wrapper.findAll('[role="radio"], button[data-state]')
    await filters.find((f) => f.text().startsWith('This computer'))!.trigger('click')
    expect(cardIds(wrapper)).toEqual(['dashboard-card-a'])
    await filters.find((f) => f.text().startsWith('Cloud'))!.trigger('click')
    expect(cardIds(wrapper)).toEqual(['dashboard-card-b'])
  })

  it('opens a build from its card and starts it from the card button', async () => {
    const { wrapper, page } = mountPage()
    await wrapper.get('[data-testid="dashboard-card-a"]').trigger('click')
    expect(page.emitted('open')?.[0]).toEqual([installs[0]])
    await wrapper.get('[data-testid="dashboard-card-launch-b"]').trigger('click')
    expect(page.emitted('launch')?.[0]).toEqual([installs[1]])
    expect(page.emitted('open')).toHaveLength(1)
  })

  it('labels the card button by what it does', () => {
    useSessionStore().runningInstances.set('a', { installationId: 'a' } as never)
    const { wrapper } = mountPage()
    expect(wrapper.get('[data-testid="dashboard-card-launch-a"]').text()).toBe('Open ComfyUI')
    expect(wrapper.get('[data-testid="dashboard-card-launch-b"]').text()).toBe('Start ComfyUI')
    expect(wrapper.get('[data-testid="dashboard-card-b"]').text()).toContain('Ready')
  })

  it('says a filter has no builds without offering a new one', async () => {
    const { wrapper } = mountPage([installs[0]!])
    const filters = wrapper.findAll('[role="radio"], button[data-state]')
    await filters.find((f) => f.text().startsWith('Cloud'))!.trigger('click')
    expect(wrapper.text()).toContain('No builds in this view')
    expect(wrapper.findAll('button').filter((b) => b.text().includes('New build'))).toHaveLength(1)
  })

  it('offers a new build when the workspace has none', async () => {
    const { wrapper, page } = mountPage([])
    const buttons = wrapper.findAll('button').filter((b) => b.text() === 'New build')
    expect(buttons).toHaveLength(2)
    await buttons[1]!.trigger('click')
    expect(page.emitted('new-build')).toHaveLength(1)
  })
})
