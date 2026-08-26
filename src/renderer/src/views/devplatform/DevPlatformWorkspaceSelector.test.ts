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
        unmanagedLabel: 'No Workspace',
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
      { id: 'w1', name: 'Team One', type: 'team', role: 'owner' },
      { id: 'w2', name: 'Team Two', type: 'team', role: 'admin' }
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

  it('switches the authenticated workspace before selecting it', async () => {
    const wrapper = mountSelector()
    await flushPromises()
    await wrapper.find('[data-testid="devplatform-workspace-selector"]').trigger('click')

    await wrapper.find('[data-testid="devplatform-workspace-w2"]').trigger('click')
    await flushPromises()

    expect(api.switchWorkspace).toHaveBeenCalledExactlyOnceWith('w2')
    expect(wrapper.emitted('update:modelValue')).toEqual([['w2']])
    expect(wrapper.find('[data-testid="devplatform-workspace-menu"]').exists()).toBe(false)
  })

  it('selects No Workspace without changing the authenticated workspace', async () => {
    const wrapper = mountSelector()
    await flushPromises()
    await wrapper.find('[data-testid="devplatform-workspace-selector"]').trigger('click')
    const noWorkspace = wrapper.find('[data-testid="devplatform-workspace-unmanaged"]')
    expect(noWorkspace.text()).toContain('No Workspace')
    await noWorkspace.trigger('click')

    expect(api.switchWorkspace).not.toHaveBeenCalled()
    expect(wrapper.emitted('update:modelValue')).toEqual([[null]])
  })

  it('keeps the active workspace when browser re-authentication fails', async () => {
    api.switchWorkspace.mockRejectedValue(new Error('cancelled'))
    const wrapper = mountSelector()
    await flushPromises()
    await wrapper.find('[data-testid="devplatform-workspace-selector"]').trigger('click')
    await wrapper.find('[data-testid="devplatform-workspace-w2"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="devplatform-workspace-selector"]').text()).toContain(
      'Team One'
    )
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('does not select a workspace when re-authentication returns a different workspace', async () => {
    api.switchWorkspace.mockResolvedValue({
      signedIn: true,
      workspaceType: 'team',
      workspaceId: 'w1'
    })
    const wrapper = mountSelector()
    await flushPromises()
    await wrapper.find('[data-testid="devplatform-workspace-selector"]').trigger('click')

    await wrapper.find('[data-testid="devplatform-workspace-w2"]').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(wrapper.find('[data-testid="devplatform-workspace-selector"]').text()).toContain(
      'Team One'
    )
  })
})
