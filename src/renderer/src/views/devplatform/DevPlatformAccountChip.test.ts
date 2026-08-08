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
  telemetryGetExperimentFlag: ReturnType<typeof vi.fn>
  telemetryRecordExposure: ReturnType<typeof vi.fn>
  comfybuilder: Record<string, ReturnType<typeof vi.fn>>
}

let api: MockApi

function installMockApi(flag: string | boolean | null, status: AuthStatus): MockApi {
  api = {
    telemetryGetExperimentFlag: vi.fn().mockResolvedValue(flag),
    telemetryRecordExposure: vi.fn(),
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

/** Mount with the rollout flag resolved and the auth status hydrated. */
async function mountChip(opts: { flag?: string | boolean | null; status?: AuthStatus } = {}) {
  installMockApi(opts.flag ?? null, opts.status ?? SIGNED_OUT)
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
  it('renders the log-in CTA when the Comfy Builder flag is on', async () => {
    const { wrapper } = await mountChip({ flag: true })
    const cta = wrapper.find('[data-testid="devplatform-account-signin"]')
    expect(cta.exists()).toBe(true)
    expect(cta.text()).toContain('Log in')
  })

  // The whole point of the gate: absent, not merely inert.
  it('renders nothing at all when the flag is absent', async () => {
    const { wrapper } = await mountChip({ flag: null })
    expect(wrapper.find('[data-testid="devplatform-account-signin"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="devplatform-account-chip"]').exists()).toBe(false)
  })

  it.each([false, 'true', 'treatment'])(
    'stays hidden for the non-true flag value %p',
    async (value) => {
      const { wrapper } = await mountChip({ flag: value })
      expect(wrapper.find('[data-testid="devplatform-account-signin"]').exists()).toBe(false)
    }
  )

  it('stays hidden when the flag lookup rejects', async () => {
    installMockApi(null, SIGNED_OUT)
    api.telemetryGetExperimentFlag.mockRejectedValue(new Error('ipc down'))
    setActivePinia(createPinia())
    const wrapper = mount(DevPlatformAccountChip)
    await flushPromises()
    expect(wrapper.find('[data-testid="devplatform-account-signin"]').exists()).toBe(false)
  })

  it('runs the browser handoff and disables the button while it is out', async () => {
    let resolveSignIn: (status: AuthStatus) => void = () => {}
    const { wrapper, store } = await mountChip({ flag: true })
    store.signIn = vi.fn(
      () =>
        new Promise<AuthStatus>((resolve) => {
          resolveSignIn = resolve
        })
    )

    const cta = wrapper.find('[data-testid="devplatform-account-signin"]')
    await cta.trigger('click')
    expect(store.signIn).toHaveBeenCalledOnce()
    expect(cta.attributes('disabled')).toBeDefined()

    resolveSignIn({ signedIn: true })
    await flushPromises()
    expect(
      wrapper.find('[data-testid="devplatform-account-signin"]').attributes('disabled')
    ).toBeUndefined()
  })

  it('re-arms the button after a cancelled handoff', async () => {
    const { wrapper, store } = await mountChip({ flag: true })
    store.signIn = vi.fn().mockRejectedValue(new Error('user closed the browser'))

    await wrapper.find('[data-testid="devplatform-account-signin"]').trigger('click')
    await flushPromises()

    const cta = wrapper.find('[data-testid="devplatform-account-signin"]')
    expect(cta.exists()).toBe(true)
    expect(cta.attributes('disabled')).toBeUndefined()
  })
})

describe('DevPlatformAccountChip — signed in', () => {
  // Ungated on purpose: whoever is already signed in must still be able to
  // switch workspace and sign out, whatever the rollout says.
  it('renders the chip face even with the flag off', async () => {
    const { wrapper } = await mountChip({ flag: null, status: SIGNED_IN })
    expect(wrapper.find('[data-testid="devplatform-account-chip"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="devplatform-account-signin"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('someone@comfy.org')
  })

  it('opens the workspace switcher and pulls the list lazily', async () => {
    const { wrapper } = await mountChip({ flag: true, status: SIGNED_IN })
    expect(wrapper.find('[data-testid="devplatform-account-menu"]').exists()).toBe(false)

    await wrapper.find('[data-testid="devplatform-account-chip"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="devplatform-account-menu"]').exists()).toBe(true)
    expect(api.comfybuilder.listWorkspaces).toHaveBeenCalledOnce()
  })

  it('signs out only after the confirm is accepted', async () => {
    const { wrapper, store } = await mountChip({ flag: true, status: SIGNED_IN })
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
})

describe('DevPlatformAccountChip — exposure', () => {
  it('records the treatment arm when the flag is on', async () => {
    await mountChip({ flag: true })
    expect(api.telemetryRecordExposure).toHaveBeenCalledExactlyOnceWith({
      experimentKey: 'desktop-comfy-builder',
      variant: 'treatment',
      source: 'cache'
    })
  })

  // The control arm has to be counted too, or the readout is biased.
  it('records the control arm as a fallback when the flag is absent', async () => {
    await mountChip({ flag: null })
    expect(api.telemetryRecordExposure).toHaveBeenCalledExactlyOnceWith({
      experimentKey: 'desktop-comfy-builder',
      variant: 'control',
      source: 'fallback'
    })
  })
})
