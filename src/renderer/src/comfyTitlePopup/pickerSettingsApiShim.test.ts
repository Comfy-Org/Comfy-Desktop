import { afterEach, describe, expect, it, vi } from 'vitest'

import { installPickerSettingsApiShim } from './pickerSettingsApiShim'
import { useStopAction } from '../composables/useStopAction'

vi.mock('vue-i18n', async (importOriginal) =>
  (await import('../lib/vueI18nWithAppMessages')).vueI18nWithAppMessages(importOriginal)
)

afterEach(() => {
  delete (window as unknown as { api?: unknown }).api
  delete (window as unknown as { __comfyTitlePopup?: unknown }).__comfyTitlePopup
})

function installBridge(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const explicit: Record<string, unknown> = {
    terminalSubscribe: vi.fn().mockResolvedValue({
      buffer: [],
      size: { cols: 80, rows: 30 },
      exited: false
    }),
    terminalUnsubscribe: vi.fn().mockResolvedValue(undefined),
    terminalWrite: vi.fn().mockResolvedValue(undefined),
    terminalResize: vi.fn().mockResolvedValue(undefined),
    terminalRestart: vi.fn().mockResolvedValue({
      buffer: [],
      size: { cols: 80, rows: 30 },
      exited: false
    }),
    onTerminalOutput: vi.fn(() => () => {}),
    onTerminalExited: vi.fn(() => () => {}),
    ...overrides
  }
  const bridge = new Proxy(explicit, {
    get(target, prop: string) {
      if (!(prop in target)) target[prop] = vi.fn()
      return target[prop]
    },
    has() {
      return true
    }
  })
  ;(window as unknown as { __comfyTitlePopup?: unknown }).__comfyTitlePopup = bridge
  return bridge
}

it('stops and closes a build from picker settings after the stop finishes', async () => {
  const stopped = Promise.withResolvers<void>()
  const bridge = installBridge({
    pickerSettingsStopComfyUI: vi.fn().mockReturnValue(stopped.promise),
    pickerSettingsCloseComfyWindow: vi.fn().mockResolvedValue(true)
  })
  installPickerSettingsApiShim()
  const dialogs = { confirm: vi.fn().mockResolvedValue(true), alert: vi.fn() }

  const pending = useStopAction(dialogs).confirmAndStop('build-A')
  await vi.waitFor(() =>
    expect(bridge.pickerSettingsStopComfyUI).toHaveBeenCalledExactlyOnceWith('build-A')
  )
  expect(bridge.pickerSettingsCloseComfyWindow).not.toHaveBeenCalled()

  stopped.resolve()
  expect(await pending).toBe(true)
  expect(bridge.pickerSettingsCloseComfyWindow).toHaveBeenCalledExactlyOnceWith('build-A', {
    skipConfirm: true,
    keepDesktopOpen: true
  })
  expect(dialogs.alert).not.toHaveBeenCalled()
})

describe('installPickerSettingsApiShim — terminal forwarding', () => {
  const terminalMethods = [
    'terminalSubscribe',
    'terminalUnsubscribe',
    'terminalWrite',
    'terminalResize',
    'terminalRestart',
    'onTerminalOutput',
    'onTerminalExited'
  ] as const

  it('exposes every terminal method on window.api', () => {
    installBridge()
    installPickerSettingsApiShim()

    const api = (window as unknown as { api: Record<string, unknown> }).api
    for (const method of terminalMethods) {
      expect(typeof api[method]).toBe('function')
    }
  })

  it('forwards terminal calls to the bridge', async () => {
    const bridge = installBridge()
    installPickerSettingsApiShim()

    const api = (
      window as unknown as {
        api: {
          terminalSubscribe: (id: string) => Promise<unknown>
          terminalWrite: (id: string, data: string) => Promise<void>
          onTerminalOutput: (cb: () => void) => () => void
        }
      }
    ).api

    await api.terminalSubscribe('install-A')
    expect(bridge.terminalSubscribe).toHaveBeenCalledWith('install-A')

    await api.terminalWrite('install-A', 'ls\r')
    expect(bridge.terminalWrite).toHaveBeenCalledWith('install-A', 'ls\r')

    const cb = vi.fn()
    api.onTerminalOutput(cb)
    expect(bridge.onTerminalOutput).toHaveBeenCalledWith(cb)
  })
})

describe('installPickerSettingsApiShim — language changes', () => {
  it('tells the build details in the picker when the app language changes', () => {
    const bridge = installBridge()
    installPickerSettingsApiShim()

    const api = (window as unknown as { api: { onLocaleChanged: (cb: () => void) => () => void } })
      .api
    const cb = vi.fn()
    api.onLocaleChanged(cb)

    expect(bridge.pickerSettingsOnLocaleChanged).toHaveBeenCalledExactlyOnceWith(cb)
  })
})

describe('installPickerSettingsApiShim — Global Settings deep link', () => {
  it('forwards openGlobalSettings to the popup bridge with its tab and highlight', () => {
    const bridge = installBridge()
    installPickerSettingsApiShim()

    const api = (
      window as unknown as {
        api: {
          openGlobalSettings: (tab?: string, opts?: { highlightField?: string }) => void
        }
      }
    ).api
    api.openGlobalSettings('general', { highlightField: 'betaFeaturesEnabled' })

    expect(bridge.pickerSettingsOpenGlobalSettings).toHaveBeenCalledExactlyOnceWith('general', {
      highlightField: 'betaFeaturesEnabled'
    })
  })
})

describe('installPickerSettingsApiShim — folder actions', () => {
  it('gives the Storage tab the same folder actions the panel has', () => {
    const bridge = installBridge({ platform: 'win32' })
    installPickerSettingsApiShim()

    const api = (
      window as unknown as {
        api: {
          platform: string
          openPath: (path: string) => void
          revealPath: (path: string) => void
        }
      }
    ).api
    api.openPath('/models')
    api.revealPath('/models/extra_model_paths.yaml')

    expect(api.platform).toBe('win32')
    expect(bridge.globalSettingsOpenPath).toHaveBeenCalledExactlyOnceWith('/models')
    expect(bridge.globalSettingsRevealPath).toHaveBeenCalledExactlyOnceWith(
      '/models/extra_model_paths.yaml'
    )
  })
})

it("gives the picker the app's openExternal, sent through the settings link channel", async () => {
  const bridge = installBridge()
  installPickerSettingsApiShim()

  await window.api.openExternal('https://docs.comfy.org/')

  expect(bridge.globalSettingsOpenExternal).toHaveBeenCalledExactlyOnceWith(
    'https://docs.comfy.org/'
  )
})

it('gives the picker onSettingsChanged, so a setting changed elsewhere reaches it', () => {
  const unsubscribe = vi.fn()
  const bridge = installBridge({ pickerSettingsOnSettingsChanged: vi.fn(() => unsubscribe) })
  installPickerSettingsApiShim()
  const changed = vi.fn()

  const off = window.api.onSettingsChanged(changed)
  const [[forward]] = vi.mocked(bridge.pickerSettingsOnSettingsChanged as (cb: unknown) => unknown)
    .mock.calls as unknown as [[(data: { key: string }) => void]]
  forward({ key: 'coreBetaFeatures' })
  off()

  expect(changed).toHaveBeenCalledExactlyOnceWith({ key: 'coreBetaFeatures' })
  expect(unsubscribe).toHaveBeenCalledOnce()
})

it('passes the field-options context through to the picker bridge', async () => {
  const bridge = installBridge({ pickerSettingsGetFieldOptions: vi.fn().mockResolvedValue([]) })
  installPickerSettingsApiShim()

  await window.api.getFieldOptions('standalone', 'release', {}, { includeLatestStable: true })

  expect(bridge.pickerSettingsGetFieldOptions).toHaveBeenCalledExactlyOnceWith(
    'standalone',
    'release',
    {},
    { includeLatestStable: true }
  )
})
