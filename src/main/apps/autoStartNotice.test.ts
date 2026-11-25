import type { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  broadcasts: [] as [string, unknown][],
  windows: new Set<string>(),
  handlers: new Map<string, (...args: unknown[]) => unknown>()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      mocks.handlers.set(channel, handler)
  }
}))
vi.mock('../lib/ipc/broadcast', () => ({
  _broadcastToRenderer: (channel: string, data: unknown) => mocks.broadcasts.push([channel, data])
}))
vi.mock('../host/registry', async () => {
  const { EventEmitter: Emitter } = await import('node:events')
  return {
    hostInstallEvents: new Emitter(),
    getEntryByInstallationId: (id: string) => (mocks.windows.has(id) ? { id } : undefined)
  }
})

import { hostInstallEvents } from '../host/registry'
import {
  _resetForTest,
  AUTO_START_READY_CHANNEL,
  autoStartReadyBuild,
  dismissAutoStartReady,
  noteAutoStartReady,
  registerAutoStartNoticeHandlers
} from './autoStartNotice'

beforeEach(() => {
  _resetForTest()
  mocks.broadcasts.length = 0
  mocks.windows.clear()
})

describe('the notice that the Auto start build is ready', () => {
  it('tells Home which build is ready and keeps it for a Home that opens later', () => {
    noteAutoStartReady('studio')

    expect(mocks.broadcasts).toEqual([[AUTO_START_READY_CHANNEL, { installationId: 'studio' }]])
    expect(autoStartReadyBuild()).toBe('studio')
  })

  it('says nothing when that build already has its ComfyUI window open', () => {
    mocks.windows.add('studio')

    noteAutoStartReady('studio')

    expect(mocks.broadcasts).toEqual([])
    expect(autoStartReadyBuild()).toBeNull()
  })

  it('is taken back once a ComfyUI window opens for that build, by any route', () => {
    noteAutoStartReady('studio')
    mocks.broadcasts.length = 0

    mocks.windows.add('other')
    ;(hostInstallEvents as EventEmitter).emit('changed')
    expect(autoStartReadyBuild()).toBe('studio')

    mocks.windows.add('studio')
    ;(hostInstallEvents as EventEmitter).emit('changed')
    expect(autoStartReadyBuild()).toBeNull()
    expect(mocks.broadcasts).toEqual([[AUTO_START_READY_CHANNEL, { installationId: null }]])
  })

  it('is dismissed from Home only for the build it names', () => {
    registerAutoStartNoticeHandlers()
    noteAutoStartReady('studio')
    const dismiss = mocks.handlers.get('dismiss-auto-start-ready')!
    const read = mocks.handlers.get('get-auto-start-ready')!

    dismiss({}, 'other')
    expect(read({})).toBe('studio')

    dismiss({}, 'studio')
    expect(read({})).toBeNull()
    dismissAutoStartReady()
    expect(mocks.broadcasts.at(-1)).toEqual([AUTO_START_READY_CHANNEL, { installationId: null }])
    expect(mocks.broadcasts).toHaveLength(2)
  })
})
