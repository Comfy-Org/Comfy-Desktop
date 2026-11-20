import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = vi.hoisted(
  () => new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
)
const broadcast = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) =>
      handlers.set(channel, handler)
  }
}))
vi.mock('./broadcast', () => ({ _broadcastToRenderer: broadcast }))

import { registerHomeTourHandlers } from './registerHomeTourHandlers'

function call(channel: string, ...args: unknown[]): unknown {
  return handlers.get(channel)!({}, ...args)
}

describe('home tour replay handlers', () => {
  beforeEach(() => {
    handlers.clear()
    broadcast.mockClear()
    registerHomeTourHandlers()
    call('set-home-tour-replay', false)
    broadcast.mockClear()
  })

  it('has no replay waiting at first', () => {
    expect(call('get-home-tour-replay')).toBe(false)
  })

  it('keeps a replay asked for in one window and tells every window', () => {
    call('set-home-tour-replay', true)

    expect(call('get-home-tour-replay')).toBe(true)
    expect(broadcast).toHaveBeenCalledWith('home-tour-replay-changed', true)
  })

  it('clears the replay once the tour ends and tells every window', () => {
    call('set-home-tour-replay', true)
    call('set-home-tour-replay', false)

    expect(call('get-home-tour-replay')).toBe(false)
    expect(broadcast).toHaveBeenLastCalledWith('home-tour-replay-changed', false)
  })
})
