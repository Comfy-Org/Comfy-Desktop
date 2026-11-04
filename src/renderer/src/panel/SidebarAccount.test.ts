import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import en from '@locales/en.json'

import SidebarAccount from './SidebarAccount.vue'
import { useDashboardScopeStore } from '../stores/dashboardScopeStore'
import type { AuthStatus } from '../../../types/ipc'

const SIGNED_OUT: AuthStatus = { signedIn: false }
const SIGNED_IN: AuthStatus = {
  signedIn: true,
  email: 'someone@comfy.org',
  workspaceId: 'w1',
  workspaceName: 'Silverside',
  workspaceType: 'team'
}

function installApi(status: AuthStatus) {
  const comfybuilder = {
    getAuthStatus: vi.fn().mockResolvedValue(status),
    onAuthChanged: vi.fn(() => () => {}),
    signIn: vi.fn().mockResolvedValue({ signedIn: true }),
    signOut: vi.fn().mockResolvedValue({ signedIn: false }),
    listWorkspaces: vi.fn().mockResolvedValue([
      { id: 'w1', name: 'Silverside', type: 'team', role: 'owner' },
      { id: 'w2', name: 'Harbor', type: 'team', role: 'member' }
    ]),
    switchWorkspace: vi.fn()
  }
  ;(window as unknown as { api: unknown }).api = {
    comfybuilder,
    getSetting: vi.fn().mockResolvedValue(undefined),
    setSetting: vi.fn().mockResolvedValue(undefined),
    onSettingsChanged: vi.fn(() => () => {})
  }
  return comfybuilder
}

async function mountAccount(status: AuthStatus, collapsed = false) {
  const comfybuilder = installApi(status)
  setActivePinia(createPinia())
  const wrapper = mount(SidebarAccount, {
    attachTo: document.body,
    props: { collapsed },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages: { en } })] }
  })
  await flushPromises()
  return { wrapper, comfybuilder }
}

async function openMenu(wrapper: Awaited<ReturnType<typeof mountAccount>>['wrapper']) {
  await wrapper.get('[data-testid="devplatform-workspace-selector"]').trigger('click')
  await flushPromises()
  return new DOMWrapper(document.body)
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('SidebarAccount', () => {
  it('offers to log in when signed out', async () => {
    const { wrapper, comfybuilder } = await mountAccount(SIGNED_OUT)
    expect(wrapper.text()).toContain('Log in to Comfy')

    await wrapper.get('[data-testid="devplatform-account-signin"]').trigger('click')

    expect(comfybuilder.signIn).toHaveBeenCalledOnce()
  })

  it('stays signed out when the login handoff fails', async () => {
    const { wrapper, comfybuilder } = await mountAccount(SIGNED_OUT)
    comfybuilder.signIn.mockRejectedValueOnce(new Error('cancelled'))

    await wrapper.get('[data-testid="devplatform-account-signin"]').trigger('click')
    await flushPromises()

    const signIn = wrapper.get('[data-testid="devplatform-account-signin"]')
    expect(signIn.attributes('disabled')).toBeUndefined()
  })

  it('shrinks to a named icon on the collapsed sidebar', async () => {
    const { wrapper } = await mountAccount(SIGNED_OUT, true)

    expect(wrapper.text()).toBe('')
    expect(wrapper.get('[data-testid="devplatform-account-signin"]').attributes('title')).toBe(
      'Log in'
    )
  })

  it('shows the workspace and who is signed in', async () => {
    const { wrapper } = await mountAccount(SIGNED_IN)

    const trigger = wrapper.get('[data-testid="devplatform-workspace-selector"]')
    expect(trigger.text()).toContain('Silverside')
    expect(trigger.text()).toContain('someone@comfy.org')
  })

  it('switches the dashboard workspace from the menu', async () => {
    const { wrapper } = await mountAccount(SIGNED_IN)

    const body = await openMenu(wrapper)
    await body.get('[data-testid="devplatform-workspace-w2"]').trigger('click')
    await flushPromises()

    expect(useDashboardScopeStore().selectedWorkspaceId).toBe('w2')
  })

  it('signs out from the menu', async () => {
    const { wrapper, comfybuilder } = await mountAccount(SIGNED_IN)

    const body = await openMenu(wrapper)
    await body.get('[data-testid="devplatform-account-signout"]').trigger('click')
    await flushPromises()

    expect(comfybuilder.signOut).toHaveBeenCalledOnce()
    expect(wrapper.find('[data-testid="devplatform-account-signin"]').exists()).toBe(true)
  })
})
