import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import { SETTINGS_REOPEN_EPOCH } from './settingsReopenEpoch'
import BetaArgsPill from './BetaArgsPill.vue'
import { useSessionStore } from '../../stores/sessionStore'
import { en } from '../../lib/i18nMessages'
import type { CoreBetaArgs } from '../../types/ipc'

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })

const SESSION: CoreBetaArgs = {
  timing: 'session',
  args: [
    { arg: '--enable-assets', name: 'Asset library' },
    { arg: '--enable-agent', name: null }
  ]
}
const NEXT: CoreBetaArgs = {
  timing: 'next-launch',
  args: [{ arg: '--enable-assets', name: 'Asset library' }]
}

let api: {
  getCoreBetaArgs: ReturnType<typeof vi.fn>
  openGlobalSettings: ReturnType<typeof vi.fn>
  onSettingsChanged: ReturnType<typeof vi.fn>
}
let settingsListener: ((data: { key: string }) => void) | null = null
const wrappers: VueWrapper[] = []

function mountPill(props: Partial<InstanceType<typeof BetaArgsPill>['$props']> = {}): VueWrapper {
  const wrapper = mount(BetaArgsPill, {
    props: { installationId: 'inst-1', argsValue: '', schemaVersion: 0, ...props },
    global: { plugins: [i18n] },
    attachTo: document.body
  })
  wrappers.push(wrapper)
  return wrapper
}

const calls = (): number => api.getCoreBetaArgs.mock.calls.length
const menuText = (): string => document.body.querySelector('.beta-args-menu')?.textContent ?? ''

beforeEach(() => {
  setActivePinia(createPinia())
  settingsListener = null
  api = {
    getCoreBetaArgs: vi.fn().mockResolvedValue(SESSION),
    openGlobalSettings: vi.fn(),
    onSettingsChanged: vi.fn((cb: (data: { key: string }) => void) => {
      settingsListener = cb
      return () => (settingsListener = null)
    })
  }
  ;(window as unknown as { api: unknown }).api = api
})

afterEach(() => {
  while (wrappers.length) wrappers.pop()?.unmount()
  delete (window as unknown as { api?: unknown }).api
  vi.useRealTimers()
})

describe('BetaArgsPill', () => {
  it("shows the running session's args, named, under the session heading", async () => {
    const wrapper = mountPill()
    await flushPromises()
    expect(wrapper.text()).toContain('+2 beta')
    await wrapper.get('.beta-args button').trigger('click')
    await flushPromises()
    expect(menuText()).toContain('Added for this session')
    expect(menuText()).toContain('--enable-assets')
    expect(menuText()).toContain('Asset library')
    expect(menuText()).toContain('Beta feature')
  })

  it('says "eligible" for a stopped install, never that the args will be added', async () => {
    api.getCoreBetaArgs.mockResolvedValue(NEXT)
    const wrapper = mountPill()
    await flushPromises()
    expect(wrapper.get('.beta-args button').attributes('aria-label')).toBe(
      '1 beta argument eligible for the next launch, show details'
    )
    await wrapper.get('.beta-args button').trigger('click')
    await flushPromises()
    expect(menuText()).toContain('Eligible for next launch')
  })

  it('renders nothing when there are no args', async () => {
    api.getCoreBetaArgs.mockResolvedValue({ timing: 'next-launch', args: [] })
    const wrapper = mountPill()
    await flushPromises()
    expect(wrapper.html()).toBe('<!--v-if-->')
  })

  it('renders nothing when the request fails', async () => {
    api.getCoreBetaArgs.mockRejectedValue(new Error('ipc gone'))
    const wrapper = mountPill()
    await flushPromises()
    expect(wrapper.find('.beta-args').exists()).toBe(false)
  })

  it('opens Global Settings on the beta opt-in from "Manage beta features"', async () => {
    const wrapper = mountPill()
    await flushPromises()
    await wrapper.get('.beta-args button').trigger('click')
    await flushPromises()
    const manage = [...document.body.querySelectorAll<HTMLElement>('.ui-menu-item')].find((el) =>
      el.textContent?.includes('Manage beta features')
    )
    manage!.click()
    expect(api.openGlobalSettings).toHaveBeenCalledWith('general', {
      highlightField: 'betaFeaturesEnabled'
    })
  })

  it('treats the arg rows as information: picking one does nothing', async () => {
    const wrapper = mountPill()
    await flushPromises()
    const trigger = wrapper.get('.beta-args button')
    await trigger.trigger('click')
    await flushPromises()
    const rows = [...document.body.querySelectorAll<HTMLElement>('.beta-args-menu .ui-menu-item')]
    expect(rows.map((row) => row.getAttribute('aria-disabled'))).toEqual(['true', 'true', null])
    rows[0]!.click()
    await flushPromises()
    expect(trigger.attributes('aria-expanded')).toBe('true')
    expect(api.openGlobalSettings).not.toHaveBeenCalled()
  })

  it('closes the menu when the window loses focus', async () => {
    const wrapper = mountPill()
    await flushPromises()
    await wrapper.get('.beta-args button').trigger('click')
    await flushPromises()
    window.dispatchEvent(new Event('blur'))
    await flushPromises()
    expect(document.body.querySelector('.beta-args-menu')).toBeNull()
  })

  describe('loading', () => {
    it('shows a placeholder only once a request has run past the delay', async () => {
      vi.useFakeTimers()
      let resolve: (value: CoreBetaArgs) => void = () => {}
      api.getCoreBetaArgs.mockReturnValue(new Promise((r) => (resolve = r)))
      const wrapper = mountPill()
      await vi.advanceTimersByTimeAsync(149)
      expect(wrapper.find('.beta-args-loading').exists()).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(wrapper.find('.beta-args-loading').attributes('role')).toBe('status')

      resolve(NEXT)
      await vi.advanceTimersByTimeAsync(0)
      expect(wrapper.find('.beta-args-loading').exists()).toBe(false)
      expect(wrapper.text()).toContain('+1 beta')
    })

    it('shows no placeholder for an answer that arrives in time', async () => {
      vi.useFakeTimers()
      const wrapper = mountPill()
      await vi.advanceTimersByTimeAsync(1000)
      expect(wrapper.find('.beta-args-loading').exists()).toBe(false)
      expect(wrapper.text()).toContain('+2 beta')
    })
  })

  describe('when it asks', () => {
    it('asks once on mount', async () => {
      mountPill()
      await flushPromises()
      expect(api.getCoreBetaArgs).toHaveBeenCalledExactlyOnceWith('inst-1', '')
    })

    it('sends the committed args, which main previews in place of a write still in flight', async () => {
      const wrapper = mountPill({ argsValue: '--port 8188' })
      await flushPromises()
      await wrapper.setProps({ argsValue: '--port 8188 --disable-assets' })
      await flushPromises()
      expect(api.getCoreBetaArgs.mock.calls).toEqual([
        ['inst-1', '--port 8188'],
        ['inst-1', '--port 8188 --disable-assets']
      ])
    })

    it.each([
      ['the install', { installationId: 'inst-2' }],
      ['the committed args', { argsValue: '--disable-assets' }],
      ['the schema version', { schemaVersion: 1 }]
    ])('asks again when %s changes', async (_label, change) => {
      const wrapper = mountPill()
      await flushPromises()
      await wrapper.setProps(change)
      await flushPromises()
      expect(calls()).toBe(2)
    })

    it('does not ask again for a re-render with the same inputs', async () => {
      const wrapper = mountPill()
      await flushPromises()
      await wrapper.setProps({ argsValue: '' })
      await flushPromises()
      expect(calls()).toBe(1)
    })

    it('asks again when the session starts, and when a restart replaces it', async () => {
      mountPill()
      await flushPromises()
      const store = useSessionStore()
      const running = (startedAt: number) => ({
        installationId: 'inst-1',
        installationName: 'One',
        mode: 'window',
        startedAt
      })
      store.runningInstances.set('inst-1', running(100))
      await flushPromises()
      expect(calls()).toBe(2)
      store.runningInstances.set('inst-1', running(200))
      await flushPromises()
      expect(calls()).toBe(3)
    })

    it("ignores another install's session", async () => {
      mountPill()
      await flushPromises()
      useSessionStore().runningInstances.set('other', {
        installationId: 'other',
        installationName: 'Other',
        mode: 'window',
        startedAt: 1
      })
      await flushPromises()
      expect(calls()).toBe(1)
    })

    it('asks again when the beta opt-in or telemetry consent changes, and only then', async () => {
      mountPill()
      await flushPromises()
      settingsListener!({ key: 'theme' })
      settingsListener!({ key: 'betaFeaturesEnabled' })
      settingsListener!({ key: 'telemetryEnabled' })
      await flushPromises()
      expect(calls()).toBe(3)
    })

    it('asks again each time a host that stays mounted is reopened', async () => {
      const epoch = ref(1)
      const wrapper = mount(BetaArgsPill, {
        props: { installationId: 'inst-1', argsValue: '', schemaVersion: 0 },
        global: { plugins: [i18n], provide: { [SETTINGS_REOPEN_EPOCH as symbol]: epoch } }
      })
      wrappers.push(wrapper)
      await flushPromises()
      epoch.value = 2
      await flushPromises()
      expect(calls()).toBe(2)
    })

    it('stops listening for settings changes once unmounted', async () => {
      const wrapper = mountPill()
      await flushPromises()
      wrapper.unmount()
      wrappers.length = 0
      expect(settingsListener).toBeNull()
    })

    it('keeps the newest answer when an older request resolves after it', async () => {
      let resolveFirst: (value: CoreBetaArgs) => void = () => {}
      api.getCoreBetaArgs
        .mockReturnValueOnce(new Promise((r) => (resolveFirst = r)))
        .mockResolvedValueOnce(NEXT)
      const wrapper = mountPill()
      await wrapper.setProps({ argsValue: '--lowvram' })
      await flushPromises()
      resolveFirst(SESSION)
      await flushPromises()
      expect(wrapper.text()).toContain('+1 beta')
    })

    it('works where the bridge has no settings-change event (the picker popup)', async () => {
      ;(window as unknown as { api: Record<string, unknown> }).api = {
        getCoreBetaArgs: api.getCoreBetaArgs,
        openGlobalSettings: api.openGlobalSettings
      }
      const wrapper = mountPill()
      await flushPromises()
      expect(wrapper.text()).toContain('+2 beta')
    })
  })
})
