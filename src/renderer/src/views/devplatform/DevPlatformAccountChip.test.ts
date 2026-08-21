import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import DevPlatformAccountChip from './DevPlatformAccountChip.vue'
import { useAuthStore } from '../../stores/authStore'
import type { AuthStatus } from '../../../../types/ipc'

// The real `confirm` resolves only when the singleton DialogHost answers, and
// no host is mounted here — stub it so the sign-out path is deterministic.
const dialogs = { confirm: vi.fn().mockResolvedValue('primary') }
vi.mock('../../composables/useDialogs', () => ({
  useDialogs: () => dialogs
}))

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
  dialogs.confirm.mockResolvedValue('primary')
})

describe('DevPlatformAccountChip — signed out', () => {
  // Logging in lives in the title-bar file menu and nowhere else, so the
  // dashboard shows no account affordance until there is an account.
  it('renders nothing at all', async () => {
    const { wrapper } = await mountChip(SIGNED_OUT)
    expect(wrapper.find('[data-testid="devplatform-account-signin"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="devplatform-account-chip"]').exists()).toBe(false)
    expect(wrapper.text()).toBe('')
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

  it('signs out only after the confirm is accepted', async () => {
    const { wrapper, store } = await mountChip(SIGNED_IN)
    store.signOut = vi.fn().mockResolvedValue({ signedIn: false })
    dialogs.confirm.mockResolvedValue(false)

    await wrapper.find('[data-testid="devplatform-account-chip"]').trigger('click')
    await wrapper.find('[data-testid="devplatform-account-signout"]').trigger('click')
    await flushPromises()
    expect(store.signOut).not.toHaveBeenCalled()

    dialogs.confirm.mockResolvedValue('primary')
    await wrapper.find('[data-testid="devplatform-account-chip"]').trigger('click')
    await wrapper.find('[data-testid="devplatform-account-signout"]').trigger('click')
    await flushPromises()
    expect(store.signOut).toHaveBeenCalledOnce()
    expect(wrapper.emitted('signed-out')).toHaveLength(1)
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
