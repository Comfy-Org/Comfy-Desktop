import { describe, expect, it, vi } from 'vitest'

type InvokeHandler = (...args: unknown[]) => unknown

const electron = vi.hoisted(() => {
  const invokeHandlers = new Map<string, InvokeHandler>()
  return {
    invokeHandlers,
    ipcMain: {
      _invokeHandlers: invokeHandlers,
      handle: (channel: string, handler: InvokeHandler): void => {
        invokeHandlers.set(channel, handler)
      },
      on: vi.fn()
    }
  }
})

vi.mock('electron', () => ({ app: { relaunch: vi.fn() }, ipcMain: electron.ipcMain }))

import { PICKER_SETTINGS_CHANNELS } from '../../types/ipc'
import { registerPickerSettingsIpc } from './pickerSettingsHandlers'

describe('picker settings requests', () => {
  it("reach the app's field-options handler with the context the picker sent", async () => {
    const releases = [{ value: 'v0.3.99', label: 'v0.3.99' }]
    const appFieldOptions = vi.fn().mockResolvedValue(releases)
    electron.invokeHandlers.set('get-field-options', appFieldOptions)
    registerPickerSettingsIpc({ quitForRelaunch: vi.fn() })
    const pickerFieldOptions = electron.invokeHandlers.get(PICKER_SETTINGS_CHANNELS.getFieldOptions)
    const event = { sender: { id: 7 } }

    const options = await pickerFieldOptions?.(event, {
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
})
