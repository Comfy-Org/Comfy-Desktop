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
        switchLabel: 'Workspace',
        currentFallback: 'Current workspace',
        loadError: "Couldn't load workspaces. Retry"
      }
    }
  }
}

function mountSelector(modelValue = 'w1') {
  return mount(DevPlatformWorkspaceSelector, {
    props: { modelValue },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', messages }), createPinia()]
    }
  })
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
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
      {
        id: 'personal',
        name: 'Personal',
        type: 'personal',
        role: 'owner',
        subscriptionTier: 'ENTERPRISE'
      }
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
  })

  it('keeps the cached workspace identity while the startup refresh is pending', async () => {
    api.getAuthStatus.mockResolvedValue({
      signedIn: true,
      workspaceType: 'team',
      workspaceId: 'w1',
      workspaceName: 'Team One'
    })
    const workspaces = deferred<Awaited<ReturnType<typeof api.listWorkspaces>>>()
    api.listWorkspaces.mockReturnValue(workspaces.promise)

    const wrapper = mountSelector()
    await flushPromises()

    const selector = wrapper.get('[data-testid="devplatform-workspace-selector"]')
    expect(selector.text()).toContain('Team One')
    expect(selector.text()).not.toContain('Loading...')
    expect(selector.get('.dp-avatar').text()).toBe('T')

    workspaces.resolve([
      { id: 'w1', name: 'Team One', type: 'team', role: 'owner', subscriptionTier: 'PRO' }
    ])
    await flushPromises()
    expect(selector.text()).toContain('Team One')
  })

  it('shows the workspace type only for non-personal workspaces', async () => {
    const wrapper = mountSelector()
    await flushPromises()
    await wrapper.find('[data-testid="devplatform-workspace-selector"]').trigger('click')

    const personal = wrapper.get('[data-testid="devplatform-workspace-personal"]')
    expect(personal.get('.workspace-selector__item-name').text()).toBe('Personal')
    expect(personal.find('.workspace-selector__item-sub').exists()).toBe(false)
    expect(
      wrapper.get('[data-testid="devplatform-workspace-w2"] .workspace-selector__item-sub').text()
    ).toBe('team')
  })

  it('uses the Personal workspace as the local selection', async () => {
    const wrapper = mountSelector('personal')
    await flushPromises()

    const avatar = wrapper.get('[data-testid="devplatform-workspace-selector"] .dp-avatar')
    expect(avatar.classes()).not.toContain('dp-avatar--neutral')
    expect(avatar.text()).toBe('P')
  })

  it('normalizes a server Personal workspace name even when its type is stale', async () => {
    api.getAuthStatus.mockResolvedValue({
      signedIn: true,
      workspaceType: 'team',
      workspaceId: 'server-personal',
      workspaceName: 'Personal workspace'
    })
    api.listWorkspaces.mockResolvedValue([
      {
        id: 'server-personal',
        name: 'Personal workspace',
        type: 'team',
        role: 'owner'
      }
    ])
    const wrapper = mountSelector('server-personal')
    await flushPromises()

    expect(wrapper.get('.workspace-selector__name').text()).toBe('Personal')
    await wrapper.get('[data-testid="devplatform-workspace-selector"]').trigger('click')
    expect(wrapper.findAll('.workspace-selector__item')).toHaveLength(1)
    expect(wrapper.get('.workspace-selector__item-name').text()).toBe('Personal')
    expect(wrapper.text()).not.toContain('Personal workspace')
  })

  it('offers only Personal when signed out', async () => {
    api.getAuthStatus.mockResolvedValue({ signedIn: false })
    const wrapper = mountSelector('personal')
    await flushPromises()

    await wrapper.get('[data-testid="devplatform-workspace-selector"]').trigger('click')
    expect(wrapper.findAll('.workspace-selector__item')).toHaveLength(1)
    expect(wrapper.get('[data-testid="devplatform-workspace-personal"]').text()).toContain(
      'Personal'
    )
    expect(api.listWorkspaces).not.toHaveBeenCalled()
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

  it('selects Personal without changing the authenticated workspace', async () => {
    const wrapper = mountSelector()
    await flushPromises()
    await wrapper.find('[data-testid="devplatform-workspace-selector"]').trigger('click')
    const personal = wrapper.get('[data-testid="devplatform-workspace-personal"]')
    expect(personal.text()).toContain('Personal')
    await personal.trigger('click')

    expect(api.switchWorkspace).not.toHaveBeenCalled()
    expect(wrapper.emitted('update:modelValue')).toEqual([['personal']])
  })
})
