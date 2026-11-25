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
const getAppUpdateState = vi.fn<() => Promise<AppUpdateState>>()

beforeEach(() => {
  vi.clearAllMocks()
  getAppUpdateState.mockResolvedValue(NO_UPDATE)
  ;(window as unknown as { api: unknown }).api = {
    getAppUpdateState,
    onAppUpdateStateChanged: vi.fn((cb: (state: AppUpdateState) => void) => {
      pushState = cb
      return unsubscribe
    })
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

  it('shows the update the app already knows about as a blue Update pill', async () => {
    const wrapper = await mountIndicator({ kind: 'available', version: '2.3.4', autoUpdate: false })

    const button = wrapper.get(indicator)
    expect(button.text()).toBe('Update')
    expect(button.classes()).toEqual(
      expect.arrayContaining(['rounded-full', 'bg-azure-600', 'text-white'])
    )
  })

  it.each([
    ['available', false, 'Update to v2.3.4 is available. Click to download it.'],
    [
      'ready',
      true,
      'Update to v2.3.4 installs the next time Desktop restarts. Click to restart now.'
    ],
    ['ready', false, 'Update to v2.3.4 is downloaded. Click to restart and install it.']
  ] as const)(
    'names the new version for the %s state (auto-update %s)',
    async (kind, autoUpdate, description) => {
      const wrapper = await mountIndicator()

      pushState({ kind, version: '2.3.4', autoUpdate })
      await flushPromises()

      const button = wrapper.get(indicator)
      expect(button.text()).toBe('Update')
      expect(button.attributes('aria-label')).toBe(description)
      expect(button.attributes('data-state')).toBe(kind)
    }
  )

  it.each([
    ['available', 'Desktop update'],
    ['ready', 'Desktop update ready']
  ] as const)(
    'falls back to a plain description when the %s update has no version',
    async (kind, description) => {
      const wrapper = await mountIndicator({ kind, version: null, autoUpdate: false })

      expect(wrapper.get(indicator).attributes('aria-label')).toBe(description)
    }
  )

  it.each([
    ['available', true],
    ['downloading', true],
    ['downloading', false]
  ] as const)(
    'stays hidden while the %s update needs nothing from the user (auto-update %s)',
    async (kind, autoUpdate) => {
      const wrapper = await mountIndicator()

      pushState({ kind, version: '2.3.4', autoUpdate })
      await flushPromises()

      expect(wrapper.find(indicator).exists()).toBe(false)
    }
  )

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

    expect(wrapper.get(indicator).attributes('data-state')).toBe('ready')
  })

  it('asks to download when an update is available', async () => {
    const wrapper = await mountIndicator({ kind: 'available', version: '2.3.4', autoUpdate: false })

    await wrapper.get(indicator).trigger('click')

    expect(prompts.showAppUpdateDownloadPrompt).toHaveBeenCalledWith('2.3.4')
    expect(prompts.showAppUpdateRestartPrompt).not.toHaveBeenCalled()
  })

  it('logs a failed update action instead of leaving the rejection unhandled', async () => {
    const failure = new Error('download-update handler missing')
    prompts.showAppUpdateDownloadPrompt.mockRejectedValueOnce(failure)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapper = await mountIndicator({ kind: 'available', version: '2.3.4', autoUpdate: false })

    await wrapper.get(indicator).trigger('click')
    await flushPromises()

    expect(consoleError).toHaveBeenCalledWith('SidebarDesktopUpdate: update action failed', failure)
    consoleError.mockRestore()
  })

  it('asks to restart when the update is ready', async () => {
    const wrapper = await mountIndicator({ kind: 'ready', version: '2.3.4', autoUpdate: true })

    await wrapper.get(indicator).trigger('click')

    expect(prompts.showAppUpdateRestartPrompt).toHaveBeenCalledWith('2.3.4')
    expect(prompts.showAppUpdateDownloadPrompt).not.toHaveBeenCalled()
  })

  it('shows only the icon when the sidebar is collapsed, with the description as its name', async () => {
    const wrapper = await mountIndicator(
      { kind: 'ready', version: '2.3.4', autoUpdate: true },
      true
    )

    const button = wrapper.get(indicator)
    expect(button.text()).toBe('')
    expect(button.attributes('aria-label')).toBe(
      'Update to v2.3.4 installs the next time Desktop restarts. Click to restart now.'
    )
  })

  it('stops listening when it unmounts', async () => {
    const wrapper = await mountIndicator()

    wrapper.unmount()

    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
