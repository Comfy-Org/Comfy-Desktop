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

function call(channel: string, ...args: unknown[]): unknown {
  return handlers.get(channel)!({}, ...args)
}

describe('home tour replay handlers', () => {
  beforeEach(async () => {
    vi.resetModules()
    handlers.clear()
    broadcast.mockClear()
    const { registerHomeTourHandlers } = await import('./registerHomeTourHandlers')
    registerHomeTourHandlers()
  })

  it('has no replay waiting at first', () => {
    expect(call('get-home-tour-replay')).toEqual({ id: 0, pending: false })
  })

  it('gives each replay request a new id and tells every window', () => {
    expect(call('request-home-tour-replay')).toBe(1)
    expect(call('request-home-tour-replay')).toBe(2)

    expect(call('get-home-tour-replay')).toEqual({ id: 2, pending: true })
    expect(broadcast).toHaveBeenLastCalledWith('home-tour-replay-changed', {
      id: 2,
      pending: true,
      finished: false
    })
  })

  it('clears the replay that the finished tour showed, and tells every window the tour is done', () => {
    const id = call('request-home-tour-replay')
    call('finish-home-tour', id)

    expect(call('get-home-tour-replay')).toEqual({ id: 1, pending: false })
    expect(broadcast).toHaveBeenLastCalledWith('home-tour-replay-changed', {
      id: 1,
      pending: false,
      finished: true
    })
  })

  it('keeps a newer replay when an older one finishes', () => {
    const older = call('request-home-tour-replay')
    call('request-home-tour-replay')
    call('finish-home-tour', older)

    expect(call('get-home-tour-replay')).toEqual({ id: 2, pending: true })
  })

  it('keeps a waiting replay when an automatic tour finishes', () => {
    call('request-home-tour-replay')
    call('finish-home-tour', null)

    expect(call('get-home-tour-replay')).toEqual({ id: 1, pending: true })
  })
})
