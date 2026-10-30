import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _resetQuitStateForTest,
  relaunchIfQuitting,
  scheduleRelaunch,
  setQuitReason
} from './quit-state'

beforeEach(() => {
  _resetQuitStateForTest()
})

describe('scheduleRelaunch', () => {
  it('relaunches once however often it is asked', () => {
    const relaunch = vi.fn()
    scheduleRelaunch(relaunch)
    scheduleRelaunch(relaunch)
    expect(relaunch).toHaveBeenCalledTimes(1)
  })

  it('stays unscheduled when the relaunch throws', () => {
    expect(() =>
      scheduleRelaunch(() => {
        throw new Error('sandboxed')
      })
    ).toThrow('sandboxed')
    const relaunch = vi.fn()
    scheduleRelaunch(relaunch)
    expect(relaunch).toHaveBeenCalledTimes(1)
  })
})

describe('relaunchIfQuitting (a launch click while quitting)', () => {
  it('is not handled when no quit is in progress', () => {
    const relaunch = vi.fn()
    expect(relaunchIfQuitting(relaunch)).toBe(false)
    expect(relaunch).not.toHaveBeenCalled()
  })

  it('relaunches once after a user quit', () => {
    setQuitReason('user-quit')
    const relaunch = vi.fn()
    expect(relaunchIfQuitting(relaunch)).toBe(true)
    expect(relaunchIfQuitting(relaunch)).toBe(true)
    expect(relaunch).toHaveBeenCalledTimes(1)
  })

  it('does not relaunch over an update install (the installer starts the new version)', () => {
    setQuitReason('update-install')
    const relaunch = vi.fn()
    expect(relaunchIfQuitting(relaunch)).toBe(true)
    expect(relaunch).not.toHaveBeenCalled()
  })

  it('does not add a second relaunch to a restart already relaunching', () => {
    const relaunch = vi.fn()
    scheduleRelaunch(relaunch)
    setQuitReason('user-quit')
    expect(relaunchIfQuitting(relaunch)).toBe(true)
    expect(relaunch).toHaveBeenCalledTimes(1)
  })
})
