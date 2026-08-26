import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'

import DevPlatformWorkspaceSelector from './DevPlatformWorkspaceSelector.vue'

const api = {
  getAuthStatus: vi.fn(),
  onAuthChanged: vi.fn(() => () => {}),
  signIn: vi.fn(),
  signOut: vi.fn(),
  listWorkspaces: vi.fn(),
  switchWorkspace: vi.fn(),
  listBuilds: vi.fn(),
  installBuild: vi.fn()
}

const messages = {
  en: {
    common: { loading: 'Loading...' },
    devPlatform: {
      workspace: {
        personalLabel: 'Personal',
        unmanagedLabel: 'No workspace',
        switchLabel: 'Workspace',
        currentFallback: 'Current workspace',
        loadError: "Couldn't load workspaces. Retry"
      }
    }
  }
}

function mountSelector(modelValue: string | null = 'w1') {
  return mount(DevPlatformWorkspaceSelector, {
    props: { modelValue },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', messages }), createPinia()]
    }
  })
}

describe('DevPlatformWorkspaceSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    api.getAuthStatus.mockResolvedValue({
      signedIn: true,
      email: 'someone@comfy.org',
      workspaceType: 'team',
      workspaceId: 'w1'
    })
    api.listWorkspaces.mockResolvedValue([
      { id: 'w1', name: 'Team One', type: 'team', role: 'owner', subscriptionTier: 'PRO' },
      { id: 'w2', name: 'Team Two', type: 'team', role: 'admin' },
      { id: 'personal', name: 'Personal', type: 'personal', role: 'owner' }
    ])
    api.switchWorkspace.mockResolvedValue({
      signedIn: true,
      email: 'someone@comfy.org',
      workspaceType: 'team',
      workspaceId: 'w2'
    })
    ;(window as unknown as { api: { comfybuilder: typeof api } }).api = { comfybuilder: api }
  })

  it('loads and displays the selected workspace', async () => {
    const wrapper = mountSelector()
    await flushPromises()

    expect(api.listWorkspaces).toHaveBeenCalledOnce()
    expect(wrapper.find('[data-testid="devplatform-workspace-selector"]').text()).toContain(
      'Team One'
    )
    expect(wrapper.get('[data-testid="devplatform-workspace-selector"] .dp-avatar').text()).toBe(
      'T'
    )
    await wrapper.find('[data-testid="devplatform-workspace-selector"]').trigger('click')
    expect(wrapper.get('[data-testid="devplatform-workspace-w1"]').text()).toContain('team')
    expect(wrapper.get('[data-testid="devplatform-workspace-w1"]').text()).not.toContain('PRO')
  })

  it('does not repeat the type under the Personal workspace', async () => {
    const wrapper = mountSelector()
    await flushPromises()
    await wrapper.find('[data-testid="devplatform-workspace-selector"]').trigger('click')

    const personal = wrapper.get('[data-testid="devplatform-workspace-personal"]')
    expect(personal.get('.workspace-selector__item-name').text()).toBe('Personal')
    expect(personal.find('.workspace-selector__item-sub').exists()).toBe(false)
  })

  it('uses an empty neutral avatar when No workspace is selected', async () => {
    const wrapper = mountSelector(null)
    await flushPromises()

    const avatar = wrapper.get('[data-testid="devplatform-workspace-selector"] .dp-avatar')
    expect(avatar.classes()).toContain('dp-avatar--neutral')
    expect(avatar.text()).toBe('')
  })

  it('closes without switching when the active workspace is selected', async () => {
    const wrapper = mountSelector()
    await flushPromises()
    await wrapper.find('[data-testid="devplatform-workspace-selector"]').trigger('click')

    await wrapper.find('[data-testid="devplatform-workspace-w1"]').trigger('click')
    expect(api.switchWorkspace).not.toHaveBeenCalled()
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(wrapper.find('[data-testid="devplatform-workspace-menu"]').exists()).toBe(false)
  })

  it('selects another workspace locally without activating remote credentials', async () => {
    const wrapper = mountSelector()
    await flushPromises()
    await wrapper.find('[data-testid="devplatform-workspace-selector"]').trigger('click')

    await wrapper.find('[data-testid="devplatform-workspace-w2"]').trigger('click')

    expect(api.switchWorkspace).not.toHaveBeenCalled()
    expect(wrapper.emitted('update:modelValue')).toEqual([['w2']])
    expect(wrapper.find('[data-testid="devplatform-workspace-menu"]').exists()).toBe(false)
  })

  it('selects No workspace without changing the authenticated workspace', async () => {
    const wrapper = mountSelector()
    await flushPromises()
    await wrapper.find('[data-testid="devplatform-workspace-selector"]').trigger('click')
    const noWorkspace = wrapper.find('[data-testid="devplatform-workspace-unmanaged"]')
    expect(noWorkspace.text()).toContain('No workspace')
    expect(noWorkspace.get('.dp-avatar').classes()).toContain('dp-avatar--neutral')
    expect(noWorkspace.get('.dp-avatar').text()).toBe('')
    await noWorkspace.trigger('click')

    expect(api.switchWorkspace).not.toHaveBeenCalled()
    expect(wrapper.emitted('update:modelValue')).toEqual([[null]])
  })
})
