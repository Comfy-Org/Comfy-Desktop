import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as installationsModule from '../../installations'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
    getVersion: () => '0.0.0-test',
    getLocale: () => 'en'
  },
  ipcMain: { handle: vi.fn(), on: vi.fn(), off: vi.fn() },
  dialog: {},
  shell: {},
  WebContentsView: class {},
  BrowserWindow: { getAllWindows: () => [] },
  nativeTheme: { on: vi.fn(), shouldUseDarkColors: false }
}))

const update = vi.hoisted(() => vi.fn(async () => null))

vi.mock('../../installations', async (importOriginal) => ({
  ...(await importOriginal<typeof installationsModule>()),
  update
}))

import {
  _removeSession,
  _test_addRunningSession,
  _test_clearRunningSessions,
  stopRunning
} from './shared'

const STOPPED_AT = 1_800_000_000_000

beforeEach(() => {
  update.mockClear()
  vi.spyOn(Date, 'now').mockReturnValue(STOPPED_AT)
})

afterEach(() => {
  vi.restoreAllMocks()
  _test_clearRunningSessions()
})

describe('the last-used time of a build', () => {
  it('is stamped when the user stops the build', async () => {
    _test_addRunningSession('build-a', 'Build A')

    await stopRunning('build-a')

    expect(update).toHaveBeenCalledWith('build-a', { lastStoppedAt: STOPPED_AT })
  })

  it('is stamped on every build when Desktop stops them all, as quitting does', async () => {
    _test_addRunningSession('build-a', 'Build A')
    _test_addRunningSession('build-b', 'Build B')

    await stopRunning()

    expect(update).toHaveBeenCalledWith('build-a', { lastStoppedAt: STOPPED_AT })
    expect(update).toHaveBeenCalledWith('build-b', { lastStoppedAt: STOPPED_AT })
  })

  it('is stamped when the build exits or crashes on its own', () => {
    _test_addRunningSession('build-a', 'Build A')

    _removeSession('build-a')

    expect(update).toHaveBeenCalledWith('build-a', { lastStoppedAt: STOPPED_AT })
  })

  it('is not stamped for a build that was not running', async () => {
    await stopRunning('build-a')
    _removeSession('build-a')

    expect(update).not.toHaveBeenCalled()
  })
})
