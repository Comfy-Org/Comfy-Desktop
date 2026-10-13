import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  on: vi.fn(),
  removeListener: vi.fn(),
  send: vi.fn()
}))

vi.mock('electron', () => ({
  ipcRenderer: { on: mocks.on, removeListener: mocks.removeListener, send: mocks.send },
  webUtils: {}
}))

import { buildElectronApi } from './api'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('title-bar modal channels', () => {
  it('asks main to close a modal on the channel main handles', () => {
    buildElectronApi().closePanelModal('announcement', 2)

    expect(mocks.send).toHaveBeenCalledWith('comfy-window:close-panel-modal', 'announcement', 2)
  })

  it('passes only known modals from main to the renderer', () => {
    const callback = vi.fn()
    const unsubscribe = buildElectronApi().onDismissPanelModal(callback)
    const [channel, handler] = mocks.on.mock.calls[0] ?? []

    expect(channel).toBe('comfy-panel:dismiss-modal')
    handler({}, 'not-a-modal')
    handler({}, 'announcement')
    expect(callback.mock.calls).toEqual([['announcement']])

    unsubscribe()
    expect(mocks.removeListener).toHaveBeenCalledWith('comfy-panel:dismiss-modal', handler)
  })
})
