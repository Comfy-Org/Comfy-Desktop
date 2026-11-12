import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import AppsView from './AppsView.vue'
import { useModal } from '../composables/useModal'

const showApps = vi.fn()
const hideApps = vi.fn()
let appsLoadFailed: ((info: { url: string }) => void) | null = null
let appsAppOpen: ((info: { open: boolean }) => void) | null = null

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as unknown as { api: unknown }).api = {
    showApps,
    hideApps,
    onAppsLoadFailed: vi.fn((callback: (info: { url: string }) => void) => {
      appsLoadFailed = callback
      return () => (appsLoadFailed = null)
    }),
    onAppsAppOpen: vi.fn((callback: (info: { open: boolean }) => void) => {
      appsAppOpen = callback
      return () => (appsAppOpen = null)
    })
  }
})

describe('AppsView', () => {
  it('shows the hosted Apps page', async () => {
    const wrapper = mount(AppsView)
    await flushPromises()

    expect(wrapper.find('[data-testid="apps-host"]').exists()).toBe(true)
    expect(showApps).toHaveBeenCalledWith(expect.objectContaining({ fresh: true }))
  })

  it('shows the address when the apps page cannot load', async () => {
    const wrapper = mount(AppsView)
    await flushPromises()

    appsLoadFailed!({ url: 'https://apps.example/apps/' })
    await flushPromises()

    expect(wrapper.find('[data-testid="apps-host"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="apps-load-failed"]').text()).toContain(
      'https://apps.example/apps/'
    )
    expect(hideApps).toHaveBeenCalled()
  })

  it('hides the Apps title while an app fills the page, and shows it on the list again', async () => {
    const wrapper = mount(AppsView)
    await flushPromises()

    appsAppOpen!({ open: true })
    await flushPromises()
    expect(wrapper.find('h1').exists()).toBe(false)
    expect(wrapper.find('[data-testid="apps-host"]').exists()).toBe(true)

    appsAppOpen!({ open: false })
    await flushPromises()
    expect(wrapper.find('h1').text()).toBe('Apps')
  })

  it('hides the native Apps page under a takeover and shows it again after', async () => {
    const wrapper = mount(AppsView)
    await flushPromises()
    showApps.mockClear()

    await wrapper.setProps({ obscured: true })
    expect(hideApps).toHaveBeenCalledTimes(1)

    await wrapper.setProps({ obscured: false })
    expect(showApps).toHaveBeenCalledWith(expect.objectContaining({ fresh: false }))
  })

  it('hides the native Apps page while a panel dialog is open', async () => {
    mount(AppsView)
    await flushPromises()
    const modal = useModal()

    void modal.alert({ title: 'Update ready', message: 'Restart now?' })
    await flushPromises()
    expect(hideApps).toHaveBeenCalledTimes(1)

    modal.dismiss()
    await flushPromises()
    expect(showApps).toHaveBeenLastCalledWith(expect.objectContaining({ fresh: false }))
  })
})
