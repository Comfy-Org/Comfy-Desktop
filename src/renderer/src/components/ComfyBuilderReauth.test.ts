import { createTestingPinia } from '@pinia/testing'
import { flushPromises, mount } from '@vue/test-utils'
import { setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthStatus } from '../../../main/comfybuilder/types'
import type { ElectronApi } from '../../../types/ipc'
import ComfyBuilderReauth from './ComfyBuilderReauth.vue'

const unsubscribe = vi.hoisted(() => vi.fn())
let authListener: ((status: AuthStatus) => void) | undefined

const signedOut: AuthStatus = { signedIn: false }
const signedIn: AuthStatus = { signedIn: true, email: 'user@example.com' }

vi.stubGlobal('window', {
  ...window,
  api: {
    comfybuilder: {
      // Boot hydration pulls this once at store creation.
      getAuthStatus: vi.fn().mockResolvedValue({ signedIn: false }),
      signIn: vi.fn(),
      signOut: vi.fn(),
      onAuthChanged: vi.fn((cb: (status: AuthStatus) => void) => {
        authListener = cb
        return unsubscribe
      }),
    },
  },
})

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      devPlatform: {
        reauth: { sessionExpired: 'Session expired — sign in again', signIn: 'Sign in' },
      },
    },
  },
})

// Attach to a live document so DOM queries reflect the real re-render — a
// root-level v-if component confuses @vue/test-utils' cached wrapper element.
function mountReauth() {
  return mount(
    {
      components: { ComfyBuilderReauth },
      template: '<div><ComfyBuilderReauth /></div>',
    },
    { attachTo: document.body, global: { plugins: [i18n] } },
  )
}

const REAUTH = '[data-testid="cb-reauth"]'
const REAUTH_SIGNIN = '[data-testid="cb-reauth-signin"]'
const api = () => (window as unknown as Window & { api: ElectronApi }).api
const reauthShown = (): boolean => document.querySelector(REAUTH) !== null

describe('ComfyBuilderReauth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authListener = undefined
    setActivePinia(createTestingPinia({ stubActions: false }))
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('stays hidden for a user who was never signed in this flow', () => {
    mountReauth()
    expect(reauthShown()).toBe(false)
  })

  it('appears only after a mid-flow expiry (signed in, then signed out)', async () => {
    const wrapper = mountReauth()
    expect(authListener).toBeTypeOf('function')

    authListener?.(signedIn)
    await wrapper.vm.$nextTick()
    expect(reauthShown()).toBe(false)

    authListener?.(signedOut)
    await wrapper.vm.$nextTick()
    expect(reauthShown()).toBe(true)
    expect(document.querySelector(REAUTH)?.textContent).toContain('Session expired')
  })

  it('recovers: clicking sign-in calls signIn and emits recovered on success', async () => {
    vi.mocked(api().comfybuilder.signIn).mockResolvedValue(signedIn)
    const wrapper = mountReauth()

    authListener?.(signedIn)
    await wrapper.vm.$nextTick()
    authListener?.(signedOut)
    await wrapper.vm.$nextTick()
    expect(reauthShown()).toBe(true)

    document.querySelector<HTMLButtonElement>(REAUTH_SIGNIN)?.click()
    await flushPromises()

    expect(api().comfybuilder.signIn).toHaveBeenCalledOnce()
    expect(wrapper.findComponent(ComfyBuilderReauth).emitted('recovered')).toHaveLength(1)
  })

  it('does not emit recovered when sign-in is dismissed (still signed out)', async () => {
    vi.mocked(api().comfybuilder.signIn).mockResolvedValue(signedOut)
    const wrapper = mountReauth()

    authListener?.(signedIn)
    await wrapper.vm.$nextTick()
    authListener?.(signedOut)
    await wrapper.vm.$nextTick()
    expect(reauthShown()).toBe(true)

    document.querySelector<HTMLButtonElement>(REAUTH_SIGNIN)?.click()
    await flushPromises()

    expect(api().comfybuilder.signIn).toHaveBeenCalledOnce()
    expect(wrapper.findComponent(ComfyBuilderReauth).emitted('recovered')).toBeUndefined()
  })
})
