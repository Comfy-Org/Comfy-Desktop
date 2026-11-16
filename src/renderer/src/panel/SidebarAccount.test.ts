import { beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { nextTick } from 'vue'
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { workspaceAvatarStyle } from '@comfyorg/design-system/workspaceAvatar'

import SidebarAccount from './SidebarAccount.vue'
import { useDashboardScopeStore } from '../stores/dashboardScopeStore'
import type { AuthStatus, Workspace } from '../../../types/ipc'

const SIGNED_OUT: AuthStatus = { signedIn: false }
const SIGNED_IN: AuthStatus = {
  signedIn: true,
  email: 'someone@comfy.org',
  workspaceId: 'w1',
  workspaceName: 'Silverside',
  workspaceType: 'team'
}

const WORKSPACES: Workspace[] = [
  {
    id: 'p1',
    name: 'Personal Workspace',
    type: 'personal',
    role: 'owner',
    subscriptionTier: null
  },
  { id: 'w1', name: 'Silverside', type: 'team', role: 'owner', subscriptionTier: 'CREATOR' },
  { id: 'w2', name: 'Harbor', type: 'team', role: 'member', subscriptionTier: 'ENTERPRISE' },
  { id: 'legacy', name: 'Legacy', type: 'team', role: 'member' }
]

function toComputedColor(color: string | undefined): string {
  const probe = document.createElement('span')
  probe.style.backgroundColor = color ?? ''
  return probe.style.backgroundColor
}

interface ApiOptions {
  listWorkspaces?: () => Promise<Workspace[]>
  savedWorkspaceId?: string
}

function installApi(status: AuthStatus, options: ApiOptions = {}) {
  const comfybuilder = {
    getAuthStatus: vi.fn().mockResolvedValue(status),
    onAuthChanged: vi.fn((_callback: (status: AuthStatus) => void) => () => {}),
    signIn: vi.fn().mockResolvedValue({ signedIn: true }),
    signOut: vi.fn().mockResolvedValue({ signedIn: false }),
    listWorkspaces: vi.fn(options.listWorkspaces ?? (() => Promise.resolve(WORKSPACES))),
    switchWorkspace: vi.fn(),
    openSettingsPage: vi.fn().mockResolvedValue(undefined)
  }
  ;(window as unknown as { api: unknown }).api = {
    comfybuilder,
    getSetting: vi.fn().mockResolvedValue(options.savedWorkspaceId),
    setSetting: vi.fn().mockResolvedValue(undefined),
    onSettingsChanged: vi.fn(() => () => {})
  }
  return comfybuilder
}

async function mountAccount(status: AuthStatus, collapsed = false, options: ApiOptions = {}) {
  const comfybuilder = installApi(status, options)
  setActivePinia(createPinia())
  const wrapper = mount(SidebarAccount, {
    attachTo: document.body,
    props: { collapsed }
  })
  await flushPromises()
  return { wrapper, comfybuilder }
}

async function openMenu(wrapper: Awaited<ReturnType<typeof mountAccount>>['wrapper']) {
  await wrapper.get('[data-testid="workspace-switcher-trigger"]').trigger('click')
  await flushPromises()
  return new DOMWrapper(document.body)
}

async function openWorkspaces(wrapper: Awaited<ReturnType<typeof mountAccount>>['wrapper']) {
  const body = await openMenu(wrapper)
  await body.get('[data-testid="workspace-switch-action"]').trigger('click')
  await flushPromises()
  await nextTick()
  return body
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

  it('shows the current workspace on the trigger', async () => {
    const { wrapper } = await mountAccount(SIGNED_IN)

    const trigger = wrapper.get('[data-testid="workspace-switcher-trigger"]')
    expect(trigger.text()).toBe('SSilverside')
    expect(trigger.attributes('aria-label')).toBe('Silverside')
  })

  it('lists the Platform menu items for the current workspace', async () => {
    const { wrapper } = await mountAccount(SIGNED_IN)

    const body = await openMenu(wrapper)

    expect(body.get('[data-testid="workspace-switch-action"]').text()).toContain('Silverside')
    expect(
      body
        .findAll('[data-testid="workspace-menu-meta"] > span:not([aria-hidden])')
        .map((part) => part.text())
    ).toEqual(['Creator', 'Owner'])
    expect(body.get('[data-testid="workspace-settings"]').text()).toBe('Workspace settings')
    expect(body.get('[data-testid="workspace-manage-credits"]').text()).toBe(
      'Manage plan & credits'
    )
    expect(body.get('[data-testid="workspace-menu-user"]').text()).toBe('someone@comfy.org')
    expect(body.get('[data-testid="workspace-logout"]').text()).toBe('Log Out')
    expect(body.text()).not.toContain('Add workspace')
  })

  it('lists every workspace with its plan and checks the current one', async () => {
    const { wrapper } = await mountAccount(SIGNED_IN)

    const body = await openWorkspaces(wrapper)

    const options = body.findAll('[data-testid^="workspace-option-"]')
    expect(options.map((option) => option.text())).toEqual([
      'PPersonal Workspace',
      'SSilversideCreator',
      'HHarborEnterprise',
      'LLegacy'
    ])
    expect(options.map((option) => option.attributes('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
      'false'
    ])
  })

  it('shows a plan it has no name for as the plan code', async () => {
    const { wrapper } = await mountAccount(SIGNED_IN, false, {
      listWorkspaces: () =>
        Promise.resolve([
          { id: 'w1', name: 'Silverside', type: 'team', role: 'owner', subscriptionTier: 'GALAXY' }
        ])
    })

    const body = await openWorkspaces(wrapper)

    expect(body.get('[data-testid="workspace-option-w1"]').text()).toBe('SSilversideGALAXY')
  })

  it('colors each avatar with the shared workspace avatar helper', async () => {
    const { wrapper } = await mountAccount(SIGNED_IN)

    const body = await openWorkspaces(wrapper)

    const avatar = (testId: string) =>
      body.get(`[data-testid="${testId}"] [data-testid="workspace-avatar"]`).element as HTMLElement
    expect(avatar('workspace-option-w2').style.backgroundColor).toBe(
      toComputedColor(workspaceAvatarStyle('Harbor', 'ENTERPRISE').backgroundColor)
    )
    expect(avatar('workspace-option-w1').style.backgroundColor).toBe(
      toComputedColor(workspaceAvatarStyle('Silverside', 'CREATOR').backgroundColor)
    )
    expect(avatar('workspace-option-p1').style.backgroundColor).toBe(
      toComputedColor(workspaceAvatarStyle('Personal Workspace', null).backgroundColor)
    )
    expect(avatar('workspace-option-legacy').style.backgroundColor).toBe('')
  })

  it('switches the dashboard workspace from the list', async () => {
    const { wrapper } = await mountAccount(SIGNED_IN)

    const body = await openWorkspaces(wrapper)
    await body.get('[data-testid="workspace-option-w2"]').trigger('click')
    await flushPromises()

    expect(useDashboardScopeStore().selectedWorkspaceId).toBe('w2')
    expect(body.find('[data-testid="workspace-menu"]').exists()).toBe(false)
  })

  it('closes the menu when the current workspace is picked again', async () => {
    const { wrapper } = await mountAccount(SIGNED_IN)

    const body = await openWorkspaces(wrapper)
    await body.get('[data-testid="workspace-option-w1"]').trigger('click')
    await flushPromises()

    expect(useDashboardScopeStore().selectedWorkspaceId).toBe('w1')
    expect(body.find('[data-testid="workspace-menu"]').exists()).toBe(false)
  })

  it('maps the personal workspace row to the personal dashboard scope', async () => {
    const { wrapper } = await mountAccount(SIGNED_IN)

    const body = await openWorkspaces(wrapper)
    await body.get('[data-testid="workspace-option-p1"]').trigger('click')
    await flushPromises()

    expect(useDashboardScopeStore().selectedWorkspaceId).toBe('personal')
  })

  it('opens and closes the workspace list from the keyboard', async () => {
    const { wrapper } = await mountAccount(SIGNED_IN)
    const body = new DOMWrapper(document.body)

    ;(wrapper.get('[data-testid="workspace-switcher-trigger"]').element as HTMLElement).focus()
    await userEvent.keyboard('{Enter}')
    await flushPromises()
    const header = body.get('[data-testid="workspace-switch-action"]')
    expect(document.activeElement).toBe(header.element)

    await userEvent.keyboard('{ArrowRight}')
    await vi.waitFor(() =>
      expect(body.find('[data-testid="workspace-switcher-panel"]').exists()).toBe(true)
    )

    await userEvent.keyboard('{ArrowLeft}')
    await vi.waitFor(() =>
      expect(body.find('[data-testid="workspace-switcher-panel"]').exists()).toBe(false)
    )
    expect(document.activeElement).toBe(header.element)

    await userEvent.keyboard('{Escape}')
    await flushPromises()

    expect(body.find('[data-testid="workspace-menu"]').exists()).toBe(false)
  })

  it('opens the team settings page Platform links to, in the same workspace', async () => {
    const { wrapper, comfybuilder } = await mountAccount(SIGNED_IN)

    const body = await openMenu(wrapper)
    await body.get('[data-testid="workspace-settings"]').trigger('click')

    expect(comfybuilder.openSettingsPage).toHaveBeenCalledExactlyOnceWith('general', 'w1')
  })

  it('opens People as the settings page of a personal workspace', async () => {
    const { wrapper, comfybuilder } = await mountAccount(SIGNED_IN)
    useDashboardScopeStore().selectWorkspace('personal')
    await flushPromises()

    const body = await openMenu(wrapper)
    await body.get('[data-testid="workspace-settings"]').trigger('click')

    expect(comfybuilder.openSettingsPage).toHaveBeenCalledExactlyOnceWith('people', 'p1')
  })

  it('opens Billing from Manage plan & credits', async () => {
    const { wrapper, comfybuilder } = await mountAccount(SIGNED_IN)

    const body = await openMenu(wrapper)
    await body.get('[data-testid="workspace-manage-credits"]').trigger('click')
    await flushPromises()

    expect(comfybuilder.openSettingsPage).toHaveBeenCalledExactlyOnceWith('billing', 'w1')
    expect(body.find('[data-testid="workspace-menu"]').exists()).toBe(false)
  })

  it('logs out from the menu', async () => {
    const { wrapper, comfybuilder } = await mountAccount(SIGNED_IN)

    const body = await openMenu(wrapper)
    await body.get('[data-testid="workspace-logout"]').trigger('click')
    await flushPromises()

    expect(comfybuilder.signOut).toHaveBeenCalledOnce()
    expect(wrapper.find('[data-testid="devplatform-account-signin"]').exists()).toBe(true)
  })

  it('shows a workspace with no plan field on a neutral tile, as its list row does', async () => {
    const { wrapper } = await mountAccount(SIGNED_IN)
    useDashboardScopeStore().selectWorkspace('legacy')
    await flushPromises()

    const avatar = wrapper.get(
      '[data-testid="workspace-switcher-trigger"] [data-testid="workspace-avatar"]'
    ).element as HTMLElement
    expect(avatar.style.backgroundColor).toBe('')
  })

  it('shrinks to the workspace tile on the collapsed sidebar and names it in a tooltip', async () => {
    const { wrapper } = await mountAccount(SIGNED_IN, true)

    const trigger = wrapper.get('[data-testid="workspace-switcher-trigger"]')
    expect(trigger.text()).toBe('S')
    expect(trigger.attributes('title')).toBe('Silverside')
  })

  it('closes its menu when the window loses focus', async () => {
    const { wrapper } = await mountAccount(SIGNED_IN)

    await openMenu(wrapper)
    window.dispatchEvent(new Event('blur'))
    await flushPromises()

    expect(document.body.querySelector('[data-testid="workspace-menu"]')).toBeNull()
  })

  it('keeps the settings links off until it knows which workspace to open them in', async () => {
    const { wrapper } = await mountAccount(SIGNED_IN, false, {
      listWorkspaces: () => new Promise(() => {}),
      savedWorkspaceId: 'w2'
    })

    const body = await openMenu(wrapper)

    expect(wrapper.get('[data-testid="workspace-switcher-trigger"]').text()).toBe('WWorkspace')
    const settings = body.get('[data-testid="workspace-settings"]')
    const credits = body.get('[data-testid="workspace-manage-credits"]')
    expect(settings.attributes('aria-disabled')).toBe('true')
    expect(credits.attributes('aria-disabled')).toBe('true')
  })

  it('takes the open menu away when the person signs out', async () => {
    const { wrapper, comfybuilder } = await mountAccount(SIGNED_IN)
    await openMenu(wrapper)

    const authChanged = comfybuilder.onAuthChanged.mock.calls[0]![0] as (status: AuthStatus) => void
    authChanged(SIGNED_OUT)
    await flushPromises()

    expect(wrapper.find('[data-testid="workspace-switcher-trigger"]').exists()).toBe(false)
    expect(document.body.querySelector('[data-testid="workspace-menu"]')).toBeNull()
  })

  it('says it is loading while the workspaces load', async () => {
    const { wrapper } = await mountAccount(SIGNED_IN, false, {
      listWorkspaces: () => new Promise(() => {})
    })

    const body = await openWorkspaces(wrapper)

    expect(body.get('[data-testid="workspace-switcher-panel"] [role="status"]').text()).toBe(
      'Loading…'
    )
  })

  it('says when the workspaces cannot load and tries again when the menu opens', async () => {
    const { wrapper, comfybuilder } = await mountAccount(SIGNED_IN, false, {
      listWorkspaces: () => Promise.reject(new Error('offline'))
    })
    expect(comfybuilder.listWorkspaces).toHaveBeenCalledOnce()

    const body = await openWorkspaces(wrapper)

    expect(comfybuilder.listWorkspaces).toHaveBeenCalledTimes(2)
    expect(body.get('[data-testid="workspace-load-error"]').text()).toBe(
      "Couldn't load workspaces. Retry"
    )

    await body.get('[data-testid="workspace-load-error"]').trigger('click')
    await flushPromises()

    expect(comfybuilder.listWorkspaces).toHaveBeenCalledTimes(3)
  })
})
