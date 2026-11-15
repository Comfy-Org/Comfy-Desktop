import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, type EffectScope } from 'vue'
import { flushPromises } from '@vue/test-utils'

import { useAutoStartBuild } from './useAutoStartBuild'

let saved: unknown
let settingsChanged: (change: { key: string }) => void
const unsubscribe = vi.fn()
const getSetting = vi.fn(async (_key: string): Promise<unknown> => saved)
const setSetting = vi.fn(async (_key: string, value: unknown): Promise<void> => {
  saved = value
})
let scope: EffectScope

beforeEach(() => {
  vi.clearAllMocks()
  saved = 'none'
  ;(window as unknown as { api: unknown }).api = {
    getSetting,
    setSetting,
    onSettingsChanged: vi.fn((callback: (change: { key: string }) => void) => {
      settingsChanged = callback
      return unsubscribe
    })
  }
})

afterEach(() => {
  scope?.stop()
})

async function start() {
  scope = effectScope()
  const autoStart = scope.run(() => useAutoStartBuild())!
  await flushPromises()
  return autoStart
}

describe('useAutoStartBuild', () => {
  it('reads the Auto-launch on startup setting and ticks only the build it names', async () => {
    saved = 'build-a'
    const autoStart = await start()

    expect(getSetting).toHaveBeenCalledWith('autoLaunchOnStartup')
    expect(autoStart.startsOnOpen('build-a')).toBe(true)
    expect(autoStart.startsOnOpen('build-b')).toBe(false)
  })

  it('ticks no build for None or Last used build', async () => {
    const autoStart = await start()
    expect(autoStart.startsOnOpen('build-a')).toBe(false)

    saved = 'last'
    settingsChanged({ key: 'autoLaunchOnStartup' })
    await flushPromises()

    expect(autoStart.startsOnOpen('build-a')).toBe(false)
  })

  it('moves the tick to a newly ticked build and saves its id in the same setting', async () => {
    saved = 'build-a'
    const autoStart = await start()

    await autoStart.setStartsOnOpen('build-b', true)

    expect(setSetting).toHaveBeenCalledWith('autoLaunchOnStartup', 'build-b')
    expect(autoStart.startsOnOpen('build-b')).toBe(true)
    expect(autoStart.startsOnOpen('build-a')).toBe(false)
  })

  it('replaces Last used build with the build that is ticked', async () => {
    saved = 'last'
    const autoStart = await start()

    await autoStart.setStartsOnOpen('build-a', true)

    expect(setSetting).toHaveBeenCalledWith('autoLaunchOnStartup', 'build-a')
  })

  it('sets None when the ticked build is unticked', async () => {
    saved = 'build-a'
    const autoStart = await start()

    await autoStart.setStartsOnOpen('build-a', false)

    expect(setSetting).toHaveBeenCalledWith('autoLaunchOnStartup', 'none')
    expect(autoStart.startsOnOpen('build-a')).toBe(false)
  })

  it('writes nothing when a build is already in the state asked for', async () => {
    saved = 'build-a'
    const autoStart = await start()

    await autoStart.setStartsOnOpen('build-a', true)
    await autoStart.setStartsOnOpen('build-b', false)

    expect(setSetting).not.toHaveBeenCalled()
  })

  it('follows a change made in Settings without a restart, and ignores other settings', async () => {
    saved = 'build-a'
    const autoStart = await start()
    getSetting.mockClear()

    saved = 'build-b'
    settingsChanged({ key: 'hideCloudFromPicker' })
    await flushPromises()
    expect(getSetting).not.toHaveBeenCalled()
    expect(autoStart.startsOnOpen('build-a')).toBe(true)

    settingsChanged({ key: 'autoLaunchOnStartup' })
    await flushPromises()
    expect(autoStart.startsOnOpen('build-b')).toBe(true)
    expect(autoStart.startsOnOpen('build-a')).toBe(false)
  })

  it('keeps a tick made while the first read is still on its way', async () => {
    let answer: (value: unknown) => void = () => {}
    getSetting.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve
        })
    )
    scope = effectScope()
    const autoStart = scope.run(() => useAutoStartBuild())!

    await autoStart.setStartsOnOpen('build-b', true)
    answer('build-a')
    await flushPromises()

    expect(autoStart.startsOnOpen('build-b')).toBe(true)
    expect(autoStart.startsOnOpen('build-a')).toBe(false)
  })

  it('shows the saved choice again when saving fails', async () => {
    saved = 'build-a'
    const autoStart = await start()
    setSetting.mockRejectedValueOnce(new Error('settings.json is unreadable'))

    await autoStart.setStartsOnOpen('build-b', true)

    expect(autoStart.startsOnOpen('build-a')).toBe(true)
    expect(autoStart.startsOnOpen('build-b')).toBe(false)
  })

  it('shows the saved choice again when saving and reading it back both fail, so a second tick saves again', async () => {
    saved = 'build-a'
    const autoStart = await start()
    setSetting.mockRejectedValueOnce(new Error('settings.json is unreadable'))
    getSetting.mockRejectedValueOnce(new Error('settings.json is unreadable'))

    await autoStart.setStartsOnOpen('build-b', true)

    expect(autoStart.startsOnOpen('build-a')).toBe(true)
    expect(autoStart.startsOnOpen('build-b')).toBe(false)

    await autoStart.setStartsOnOpen('build-b', true)

    expect(setSetting).toHaveBeenCalledTimes(2)
    expect(setSetting).toHaveBeenLastCalledWith('autoLaunchOnStartup', 'build-b')
    expect(autoStart.startsOnOpen('build-b')).toBe(true)
  })

  it('keeps a newer tick when the read after a failed save also fails', async () => {
    saved = 'build-a'
    const autoStart = await start()
    let failRead: (error: Error) => void = () => {}
    setSetting.mockRejectedValueOnce(new Error('settings.json is unreadable'))
    getSetting.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          failRead = reject
        })
    )

    const failedSave = autoStart.setStartsOnOpen('build-b', true)
    await flushPromises()
    await autoStart.setStartsOnOpen('build-c', true)
    failRead(new Error('settings.json is unreadable'))
    await failedSave

    expect(autoStart.startsOnOpen('build-c')).toBe(true)
    expect(autoStart.startsOnOpen('build-a')).toBe(false)
  })

  it('stops listening for setting changes when its page goes away', async () => {
    await start()

    scope.stop()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
