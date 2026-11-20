import { beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { nextTick } from 'vue'
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { workspaceAvatarStyle } from '@comfyorg/design-system/workspaceAvatar'

import SidebarAccount from './SidebarAccount.vue'
import { useAuthStore } from '../stores/authStore'
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
    cancelSignIn: vi.fn().mockResolvedValue(undefined),
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

  function waitForBrowser(comfybuilder: ReturnType<typeof installApi>) {
    let fail!: (error: Error) => void
    comfybuilder.signIn.mockReturnValue(
      new Promise((_resolve, reject) => {
        fail = reject
      })
    )
    comfybuilder.cancelSignIn.mockImplementation(async () => fail(new Error('cancelled')))
  }

  it('says it is waiting for the browser, with Cancel, after the first click', async () => {
    const { wrapper, comfybuilder } = await mountAccount(SIGNED_OUT)
    waitForBrowser(comfybuilder)

    await wrapper.get('[data-testid="devplatform-account-signin"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="sidebar-signin-body"]').text()).toBe(
      'Waiting for sign-in in your browser…'
    )
    expect(
      wrapper.get('[data-testid="devplatform-account-signin"]').attributes('disabled')
    ).toBeDefined()
    expect(wrapper.get('[data-testid="devplatform-account-signin-cancel"]').text()).toBe('Cancel')
  })

  it('turns Log in back on when the sign-in is cancelled', async () => {
    const { wrapper, comfybuilder } = await mountAccount(SIGNED_OUT)
    waitForBrowser(comfybuilder)
    await wrapper.get('[data-testid="devplatform-account-signin"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-testid="devplatform-account-signin-cancel"]').trigger('click')
    await flushPromises()

    expect(comfybuilder.cancelSignIn).toHaveBeenCalledOnce()
    const signIn = wrapper.get('[data-testid="devplatform-account-signin"]')
    expect(signIn.text()).toBe('Log in')
    expect(signIn.attributes('disabled')).toBeUndefined()
    expect(wrapper.find('[data-testid="devplatform-account-signin-cancel"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="sidebar-signin-body"]').text()).toBe(
      'Sync and run on Comfy Cloud'
    )
  })

  it('offers Try again when the user comes back without finishing, and opens the browser again', async () => {
    const { wrapper, comfybuilder } = await mountAccount(SIGNED_OUT)
    waitForBrowser(comfybuilder)
    await wrapper.get('[data-testid="devplatform-account-signin"]').trigger('click')
    await flushPromises()

    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    const retry = wrapper.get('[data-testid="devplatform-account-signin"]')
    expect(retry.text()).toBe('Try again')
    expect(retry.attributes('disabled')).toBeUndefined()

    await retry.trigger('click')

    expect(comfybuilder.signIn).toHaveBeenCalledTimes(2)
  })

  it('signs in when the second attempt finishes', async () => {
    const { wrapper, comfybuilder } = await mountAccount(SIGNED_OUT)
    comfybuilder.signIn.mockRejectedValueOnce(new Error('timeout'))
    await wrapper.get('[data-testid="devplatform-account-signin"]').trigger('click')
    await flushPromises()

    comfybuilder.signIn.mockResolvedValueOnce(SIGNED_IN)
    await wrapper.get('[data-testid="devplatform-account-signin"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="workspace-switcher-trigger"]').exists()).toBe(true)
  })

  it('shows a sign-in started on another page as the same wait', async () => {
    const { wrapper, comfybuilder } = await mountAccount(SIGNED_OUT, true)
    waitForBrowser(comfybuilder)

    void useAuthStore()
      .signIn()
      .catch(() => {})
    await flushPromises()

    const icon = wrapper.get('[data-testid="devplatform-account-signin"]')
    expect(icon.attributes('disabled')).toBeDefined()
    expect(icon.attributes('title')).toBe('Waiting for sign-in in your browser…')

    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    expect(icon.attributes('disabled')).toBeUndefined()
    expect(icon.attributes('title')).toBe('Try again')
  })

  it('shrinks to a named icon on the collapsed sidebar, with the log-in card folded away and out of reach', async () => {
    const { wrapper } = await mountAccount(SIGNED_OUT, true)

    expect(wrapper.get('[data-testid="sidebar-signin-card"]').attributes()).toHaveProperty('inert')
    expect(wrapper.get('[data-testid="sidebar-signin-icon"]').attributes()).not.toHaveProperty(
      'inert'
    )
    expect(wrapper.findAll('[data-testid="devplatform-account-signin"]')).toHaveLength(1)
    expect(wrapper.get('[data-testid="devplatform-account-signin"]').attributes('title')).toBe(
      'Log in'
    )
  })

  it('keeps the log-in icon out of reach while the sidebar is open', async () => {
    const { wrapper } = await mountAccount(SIGNED_OUT)

    expect(wrapper.get('[data-testid="sidebar-signin-icon"]').attributes()).toHaveProperty('inert')
    expect(wrapper.findAll('[data-testid="devplatform-account-signin"]')).toHaveLength(1)
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
    expect(body.get('[data-testid="workspace-logout"]').text()).toBe('Log out')
    expect(body.text()).not.toContain('Add workspace')
  })

  it('lists every workspace with its plan and checks the current one', async () => {
    const { wrapper } = await mountAccount(SIGNED_IN)

    const body = await openWorkspaces(wrapper)

    const options = body.findAll('[role="option"]')
    expect(options.map((option) => option.text())).toEqual([
      'PPersonal',
      'SSilversideCreator',
      'HHarborEnterprise',
      'LLegacy'
    ])
    expect(options.map((option) => option.attributes('aria-selected'))).toEqual([
      'false',
      'true',
      'false',
      'false'
    ])
    expect(document.activeElement).toBe(options[1]?.element)
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
    expect(avatar('workspace-option-personal').style.backgroundColor).toBe(
      toComputedColor(workspaceAvatarStyle('Personal', null).backgroundColor)
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
    await body.get('[data-testid="workspace-option-personal"]').trigger('click')
    await flushPromises()

    expect(useDashboardScopeStore().selectedWorkspaceId).toBe('personal')
  })

  it('moves between workspaces with the arrow, Home and End keys', async () => {
    const { wrapper } = await mountAccount(SIGNED_IN)

    const body = await openWorkspaces(wrapper)
    const options = body.findAll('[role="option"]').map((option) => option.element)
    expect(document.activeElement).toBe(options[1])

    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(options[2])
    await userEvent.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}')
    expect(document.activeElement).toBe(options[0])
    await userEvent.keyboard('{End}')
    expect(document.activeElement).toBe(options[3])
    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(options[3])
    await userEvent.keyboard('{Home}')
    expect(document.activeElement).toBe(options[0])
  })

  it('closes only the workspace list on Escape and returns focus to its header', async () => {
    const { wrapper } = await mountAccount(SIGNED_IN)

    const body = await openWorkspaces(wrapper)
    await userEvent.keyboard('{Escape}')
    await flushPromises()

    expect(body.find('[data-testid="workspace-switcher-panel"]').exists()).toBe(false)
    const header = body.get('[data-testid="workspace-switch-action"]')
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

  it('keeps the settings links off until it knows which workspace to open them in', async () => {
    const { wrapper } = await mountAccount(SIGNED_IN, false, {
      listWorkspaces: () => new Promise(() => {}),
      savedWorkspaceId: 'w2'
    })

    const body = await openMenu(wrapper)

    expect(wrapper.get('[data-testid="workspace-switcher-trigger"]').text()).toBe('WWorkspace')
    const settings = body.get('[data-testid="workspace-settings"]')
    const credits = body.get('[data-testid="workspace-manage-credits"]')
    expect(settings.attributes('disabled')).toBeDefined()
    expect(credits.attributes('disabled')).toBeDefined()
  })

  it('keeps Personal pickable beside two loading rows while the workspaces load', async () => {
    const { wrapper } = await mountAccount(SIGNED_IN, false, {
      listWorkspaces: () => new Promise(() => {})
    })

    const body = await openWorkspaces(wrapper)

    expect(body.findAll('[data-testid="workspace-skeleton"]')).toHaveLength(2)
    expect(body.get('[data-testid="workspace-switcher-panel"]').attributes('aria-busy')).toBe(
      'true'
    )
    await body.get('[data-testid="workspace-option-personal"]').trigger('click')
    await flushPromises()
    expect(useDashboardScopeStore().selectedWorkspaceId).toBe('personal')
  })

  it('loads the workspaces again on open when an earlier load was dropped', async () => {
    const { wrapper, comfybuilder } = await mountAccount(SIGNED_IN)
    const auth = useAuthStore()
    auth.workspaces = []
    auth.workspacesLoaded = false
    comfybuilder.listWorkspaces.mockClear()

    const body = await openWorkspaces(wrapper)

    expect(comfybuilder.listWorkspaces).toHaveBeenCalledOnce()
    expect(body.findAll('[role="option"]')).toHaveLength(4)
  })

  it('says when the workspaces cannot load and tries again when the menu opens', async () => {
    const { wrapper, comfybuilder } = await mountAccount(SIGNED_IN, false, {
      listWorkspaces: () => Promise.reject(new Error('offline'))
    })
    expect(comfybuilder.listWorkspaces).toHaveBeenCalledOnce()

    const body = await openWorkspaces(wrapper)

    expect(comfybuilder.listWorkspaces).toHaveBeenCalledTimes(2)
    expect(body.get('[data-testid="workspace-load-error"]').text()).toBe(
      "Couldn't load your workspaces. Please try again later."
    )
  })

  it('still offers Personal offline, so a saved team workspace does not hide local builds', async () => {
    const { wrapper } = await mountAccount(SIGNED_IN, false, {
      listWorkspaces: () => Promise.reject(new Error('offline')),
      savedWorkspaceId: 'w2'
    })

    const body = await openWorkspaces(wrapper)
    expect(body.findAll('[role="option"]').map((option) => option.text())).toEqual(['PPersonal'])
    expect(body.find('[data-testid="workspace-load-error"]').exists()).toBe(true)

    await body.get('[data-testid="workspace-option-personal"]').trigger('click')
    await flushPromises()

    expect(useDashboardScopeStore().selectedWorkspaceId).toBe('personal')
    expect(wrapper.get('[data-testid="workspace-switcher-name"]').text()).toBe('Personal')
    expect(
      (await openMenu(wrapper)).get('[data-testid="workspace-settings"]').attributes('disabled')
    ).toBeDefined()
  })

  it('offers Personal when the account lists no workspaces', async () => {
    const { wrapper } = await mountAccount(SIGNED_IN, false, {
      listWorkspaces: () => Promise.resolve([])
    })

    const body = await openWorkspaces(wrapper)

    expect(body.findAll('[role="option"]').map((option) => option.text())).toEqual(['PPersonal'])
    expect(body.find('[data-testid="workspace-switcher-empty"]').exists()).toBe(false)
  })

  it('offers search above six workspaces and forgets the query when the list closes', async () => {
    const many: Workspace[] = Array.from({ length: 7 }, (_, index) => ({
      id: `t${index}`,
      name: index === 0 ? 'Silverside' : `Team ${index}`,
      type: 'team',
      role: 'member'
    }))
    const { wrapper } = await mountAccount(SIGNED_IN, false, {
      listWorkspaces: () => Promise.resolve(many)
    })

    let body = await openWorkspaces(wrapper)
    const search = body.get<HTMLInputElement>('[data-testid="workspace-switcher-panel"] input')
    await userEvent.fill(search.element, 'team 3')
    await vi.waitFor(() => expect(body.findAll('[role="option"]')).toHaveLength(1))
    await userEvent.fill(search.element, 'nothing')
    await vi.waitFor(() =>
      expect(body.get('[data-testid="workspace-switcher-empty"]').text()).toBe(
        'No workspaces match your search.'
      )
    )

    await userEvent.keyboard('{Escape}')
    await flushPromises()
    await body.get('[data-testid="workspace-switch-action"]').trigger('click')
    await flushPromises()
    body = new DOMWrapper(document.body)

    expect(
      body.get<HTMLInputElement>('[data-testid="workspace-switcher-panel"] input').element.value
    ).toBe('')
    expect(body.findAll('[role="option"]')).toHaveLength(8)
  })
})
