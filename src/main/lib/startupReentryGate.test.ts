import { describe, expect, it, vi } from 'vitest'

import { createStartupReentryGate } from './startupReentryGate'

describe('createStartupReentryGate', () => {
  it('queues an action while closed and runs it on open', () => {
    const gate = createStartupReentryGate()
    const action = vi.fn()

    gate.runOrQueue(action)
    expect(action).not.toHaveBeenCalled()

    gate.open()
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('retains only the latest queued action while closed', () => {
    const gate = createStartupReentryGate()
    const first = vi.fn()
    const second = vi.fn()

    gate.runOrQueue(first)
    gate.runOrQueue(second)
    gate.open()

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('runs actions immediately once open', () => {
    const gate = createStartupReentryGate()
    gate.open()

    const action = vi.fn()
    gate.runOrQueue(action)
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('opens cleanly with nothing queued and does not rerun on a second open', () => {
    const gate = createStartupReentryGate()
    expect(() => gate.open()).not.toThrow()

    const action = vi.fn()
    gate.runOrQueue(action)
    gate.open()

    expect(action).toHaveBeenCalledTimes(1)
  })

  it('executes a nested runOrQueue from the queued action immediately', () => {
    const gate = createStartupReentryGate()
    const inner = vi.fn()

    gate.runOrQueue(() => {
      gate.runOrQueue(inner)
    })
    gate.open()

    expect(inner).toHaveBeenCalledTimes(1)
  })
})
