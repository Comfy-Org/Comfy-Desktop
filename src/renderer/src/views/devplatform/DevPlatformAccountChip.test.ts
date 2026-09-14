import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import DevPlatformAccountChip from './DevPlatformAccountChip.vue'
import { useAuthStore } from '../../stores/authStore'
import type { AuthStatus } from '../../../../types/ipc'

interface MockApi {
  comfybuilder: Record<string, ReturnType<typeof vi.fn>>
}

let api: MockApi

function installMockApi(status: AuthStatus): MockApi {
  api = {
    // authStore grabs `window.api.comfybuilder` at construction time and
    // hydrates itself from `getAuthStatus`, so the status has to arrive there
    // — assigning `store.status` would be overwritten by that pull.
    comfybuilder: {
      getAuthStatus: vi.fn().mockResolvedValue(status),
      onAuthChanged: vi.fn(() => () => {}),
      signIn: vi.fn().mockResolvedValue({ signedIn: true }),
      signOut: vi.fn().mockResolvedValue({ signedIn: false }),
      listWorkspaces: vi.fn().mockResolvedValue([]),
      switchWorkspace: vi.fn()
    }
  }
  ;(window as unknown as { api: MockApi }).api = api
  return api
}

const SIGNED_OUT: AuthStatus = { signedIn: false }
const SIGNED_IN: AuthStatus = {
  signedIn: true,
  email: 'someone@comfy.org',
  workspaceType: 'personal'
}

/** Mount with the auth status hydrated. */
async function mountChip(status: AuthStatus = SIGNED_OUT) {
  installMockApi(status)
  setActivePinia(createPinia())
  const store = useAuthStore()
  const wrapper = mount(DevPlatformAccountChip)
  await flushPromises()
  return { wrapper, store }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('DevPlatformAccountChip — signed out', () => {
  it('renders a login button instead of the account chip', async () => {
    const { wrapper } = await mountChip(SIGNED_OUT)
    expect(wrapper.find('[data-testid="devplatform-account-signin"]').text()).toBe('Log in')
    expect(wrapper.find('[data-testid="devplatform-account-chip"]').exists()).toBe(false)
  })

  it('starts sign-in from the login button', async () => {
    const { wrapper, store } = await mountChip(SIGNED_OUT)
    store.signIn = vi.fn().mockResolvedValue(SIGNED_IN)

    await wrapper.find('[data-testid="devplatform-account-signin"]').trigger('click')
    await flushPromises()

    expect(store.signIn).toHaveBeenCalledOnce()
  })

  it('appears as soon as an out-of-band sign-in lands', async () => {
    const { wrapper, store } = await mountChip(SIGNED_OUT)
    expect(wrapper.find('[data-testid="devplatform-account-chip"]').exists()).toBe(false)

    // What the file menu's Log in ultimately produces: main broadcasts the new
    // status and every surface re-renders off it.
    store.status = SIGNED_IN
    await flushPromises()

    expect(wrapper.find('[data-testid="devplatform-account-chip"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('someone@comfy.org')
  })
})

describe('DevPlatformAccountChip — signed in', () => {
  it('names only the account on the chip face', async () => {
    const { wrapper } = await mountChip(SIGNED_IN)
    expect(wrapper.find('[data-testid="devplatform-account-chip"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('someone@comfy.org')
    expect(wrapper.text()).not.toContain('Personal')
  })

  it('opens an account-only menu without pulling workspaces', async () => {
    const { wrapper } = await mountChip(SIGNED_IN)
    expect(wrapper.find('[data-testid="devplatform-account-menu"]').exists()).toBe(false)

    await wrapper.find('[data-testid="devplatform-account-chip"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="devplatform-account-menu"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="devplatform-account-signout"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid^="devplatform-workspace-"]').exists()).toBe(false)
    expect(api.comfybuilder.listWorkspaces).not.toHaveBeenCalled()
  })

  it('signs out directly from the account menu', async () => {
    const { wrapper, store } = await mountChip(SIGNED_IN)
    store.signOut = vi.fn().mockImplementation(async () => {
      store.status = SIGNED_OUT
      return SIGNED_OUT
    })

    await wrapper.find('[data-testid="devplatform-account-chip"]').trigger('click')
    await wrapper.find('[data-testid="devplatform-account-signout"]').trigger('click')
    await flushPromises()
    expect(store.signOut).toHaveBeenCalledOnce()
    expect(wrapper.emitted('signed-out')).toHaveLength(1)
  })

  it('stays signed in when main cancels sign-out', async () => {
    const { wrapper, store } = await mountChip(SIGNED_IN)
    store.signOut = vi.fn().mockResolvedValue(SIGNED_IN)

    await wrapper.find('[data-testid="devplatform-account-chip"]').trigger('click')
    await wrapper.find('[data-testid="devplatform-account-signout"]').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('signed-out')).toBeUndefined()
    expect(wrapper.find('[data-testid="devplatform-account-chip"]').exists()).toBe(true)
  })

  // Sign-out IPC failure must leave the chip visibly signed in rather than lie.
  it('stays signed in when sign-out fails', async () => {
    const { wrapper, store } = await mountChip(SIGNED_IN)
    store.signOut = vi.fn().mockRejectedValue(new Error('ipc down'))

    await wrapper.find('[data-testid="devplatform-account-chip"]').trigger('click')
    await wrapper.find('[data-testid="devplatform-account-signout"]').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('signed-out')).toBeUndefined()
    expect(wrapper.find('[data-testid="devplatform-account-chip"]').exists()).toBe(true)
  })
})
