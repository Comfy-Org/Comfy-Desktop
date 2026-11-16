import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import SidebarDesktopUpdate from './SidebarDesktopUpdate.vue'
import type { AppUpdateState } from '../types/ipc'

const prompts = vi.hoisted(() => ({
  showAppUpdateDownloadPrompt: vi.fn(async () => {}),
  showAppUpdateRestartPrompt: vi.fn(async () => {})
}))

vi.mock('../composables/useAppUpdatePrompts', () => ({
  useAppUpdatePrompts: () => prompts
}))

const NO_UPDATE: AppUpdateState = { kind: null, version: null, autoUpdate: true }

let pushState: (state: AppUpdateState) => void = () => {}
const unsubscribe = vi.fn()
const openGlobalSettings = vi.fn()
const getAppUpdateState = vi.fn<() => Promise<AppUpdateState>>()

beforeEach(() => {
  vi.clearAllMocks()
  getAppUpdateState.mockResolvedValue(NO_UPDATE)
  ;(window as unknown as { api: unknown }).api = {
    getAppUpdateState,
    onAppUpdateStateChanged: vi.fn((cb: (state: AppUpdateState) => void) => {
      pushState = cb
      return unsubscribe
    }),
    openGlobalSettings
  }
})

async function mountIndicator(initial: AppUpdateState = NO_UPDATE, collapsed = false) {
  getAppUpdateState.mockResolvedValue(initial)
  const wrapper = mount(SidebarDesktopUpdate, { props: { collapsed } })
  await flushPromises()
  return wrapper
}

const indicator = '[data-testid="app-sidebar-desktop-update"]'

describe('SidebarDesktopUpdate', () => {
  it('stays hidden while there is no Desktop update', async () => {
    const wrapper = await mountIndicator()

    expect(wrapper.find(indicator).exists()).toBe(false)
  })

  it('shows the update the app already knows about when the sidebar opens', async () => {
    const wrapper = await mountIndicator({ kind: 'available', version: '2.3.4', autoUpdate: false })

    const button = wrapper.get(indicator)
    expect(button.text()).toBe('Desktop Update')
    expect(button.attributes('title')).toBe('Desktop Update (v2.3.4)')
    expect(button.classes()).toContain('text-azure-600')
  })

  it.each([
    ['available', 'Desktop Update'],
    ['downloading', 'Downloading update…'],
    ['ready', 'Desktop Update Ready']
  ] as const)('labels the %s state "%s"', async (kind, label) => {
    const wrapper = await mountIndicator()

    pushState({ kind, version: '2.3.4', autoUpdate: true })
    await flushPromises()

    expect(wrapper.get(indicator).text()).toBe(label)
    expect(wrapper.get(indicator).attributes('data-state')).toBe(kind)
  })

  it('hides again when the update state clears', async () => {
    const wrapper = await mountIndicator({ kind: 'ready', version: '2.3.4', autoUpdate: true })

    pushState(NO_UPDATE)
    await flushPromises()

    expect(wrapper.find(indicator).exists()).toBe(false)
  })

  it('keeps a pushed state over a slower first read', async () => {
    let resolveFirstRead: (state: AppUpdateState) => void = () => {}
    getAppUpdateState.mockReturnValue(
      new Promise((resolve) => {
        resolveFirstRead = resolve
      })
    )
    const wrapper = mount(SidebarDesktopUpdate, { props: { collapsed: false } })

    pushState({ kind: 'ready', version: '2.3.4', autoUpdate: true })
    resolveFirstRead(NO_UPDATE)
    await flushPromises()

    expect(wrapper.get(indicator).text()).toBe('Desktop Update Ready')
  })

  it('asks to download when an update is available', async () => {
    const wrapper = await mountIndicator({ kind: 'available', version: '2.3.4', autoUpdate: false })

    await wrapper.get(indicator).trigger('click')

    expect(prompts.showAppUpdateDownloadPrompt).toHaveBeenCalledWith('2.3.4')
    expect(prompts.showAppUpdateRestartPrompt).not.toHaveBeenCalled()
  })

  it('asks to restart when the update is ready', async () => {
    const wrapper = await mountIndicator({ kind: 'ready', version: '2.3.4', autoUpdate: true })

    await wrapper.get(indicator).trigger('click')

    expect(prompts.showAppUpdateRestartPrompt).toHaveBeenCalledWith('2.3.4')
    expect(prompts.showAppUpdateDownloadPrompt).not.toHaveBeenCalled()
  })

  it('opens the Updates settings while the update downloads', async () => {
    const wrapper = await mountIndicator({
      kind: 'downloading',
      version: '2.3.4',
      autoUpdate: true
    })

    await wrapper.get(indicator).trigger('click')

    expect(openGlobalSettings).toHaveBeenCalledWith('updates')
    expect(prompts.showAppUpdateDownloadPrompt).not.toHaveBeenCalled()
    expect(prompts.showAppUpdateRestartPrompt).not.toHaveBeenCalled()
  })

  it('shows only the icon when the sidebar is collapsed, with the label as its name', async () => {
    const wrapper = await mountIndicator(
      { kind: 'ready', version: '2.3.4', autoUpdate: true },
      true
    )

    const button = wrapper.get(indicator)
    expect(button.text()).toBe('')
    expect(button.attributes('aria-label')).toBe('Desktop Update Ready (v2.3.4)')
    expect(button.attributes('title')).toBe('Desktop Update Ready (v2.3.4)')
  })

  it('stops listening when it unmounts', async () => {
    const wrapper = await mountIndicator()

    wrapper.unmount()

    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
