import { beforeEach, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { PICKER_SETTINGS_CHANNELS } from '../../types/ipc'

const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>())

vi.mock('electron', () => ({
  app: {},
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      handlers.set(channel, handler),
    on: vi.fn(),
    _invokeHandlers: handlers
  }
}))

import { registerPickerSettingsIpc } from './pickerSettingsHandlers'

beforeEach(() => {
  handlers.clear()
  registerPickerSettingsIpc({ quitForRelaunch: vi.fn() })
})

it('routes the picker close request to the existing build-window handler', async () => {
  const close = vi.fn().mockReturnValue(true)
  handlers.set('close-comfy-window', close)
  const event = { sender: {} } as IpcMainInvokeEvent
  const opts = { skipConfirm: true, keepDesktopOpen: true }

  expect(
    await handlers.get(PICKER_SETTINGS_CHANNELS.closeComfyWindow)!(event, {
      installationId: 'build-A',
      opts
    })
  ).toBe(true)
  expect(close).toHaveBeenCalledExactlyOnceWith(event, 'build-A', opts)
})

it("passes the picker's field-options context on to the app's handler", async () => {
  const releases = [{ value: 'v0.3.99', label: 'v0.3.99' }]
  const appFieldOptions = vi.fn().mockResolvedValue(releases)
  handlers.set('get-field-options', appFieldOptions)
  const event = { sender: {} } as IpcMainInvokeEvent

  const options = await handlers.get(PICKER_SETTINGS_CHANNELS.getFieldOptions)!(event, {
    sourceId: 'standalone',
    fieldId: 'release',
    selections: {},
    context: { includeLatestStable: true }
  })

  expect(options).toEqual(releases)
  expect(appFieldOptions).toHaveBeenCalledExactlyOnceWith(
    event,
    'standalone',
    'release',
    {},
    { includeLatestStable: true }
  )
})
