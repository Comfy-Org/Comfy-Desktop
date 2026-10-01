import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  _resetQuitStateForTest,
  markRelaunchScheduled,
  relaunchForSecondInstance,
  setQuitReason
} from './quit-state'

describe('relaunchForSecondInstance', () => {
  beforeEach(() => _resetQuitStateForTest())

  it('brings Desktop back once when it is opened again during a quit', () => {
    setQuitReason('user-quit')
    const relaunch = vi.fn()
    expect(relaunchForSecondInstance(relaunch)).toBe(true)
    expect(relaunchForSecondInstance(relaunch)).toBe(false)
    expect(relaunch).toHaveBeenCalledTimes(1)
  })

  it('does nothing while Desktop is not quitting (the window is focused instead)', () => {
    const relaunch = vi.fn()
    expect(relaunchForSecondInstance(relaunch)).toBe(false)
    expect(relaunch).not.toHaveBeenCalled()
  })

  it('leaves an update install to the installer, which starts the new version', () => {
    setQuitReason('update-install')
    const relaunch = vi.fn()
    expect(relaunchForSecondInstance(relaunch)).toBe(false)
    expect(relaunch).not.toHaveBeenCalled()
  })

  it('does not schedule a second relaunch on top of one already scheduled', () => {
    setQuitReason('user-quit')
    markRelaunchScheduled()
    const relaunch = vi.fn()
    expect(relaunchForSecondInstance(relaunch)).toBe(false)
    expect(relaunch).not.toHaveBeenCalled()
  })
})
