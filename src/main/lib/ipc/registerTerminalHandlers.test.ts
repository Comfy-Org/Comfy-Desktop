import { beforeEach, describe, expect, it, vi } from 'vitest'

type IpcHandler = (event: { sender: object }, ...args: unknown[]) => unknown

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>(),
  findEntryByComfySender: vi.fn(),
  isTitlePopupSender: vi.fn(),
  findTerminalPopoutInstallationIdBySender: vi.fn(),
  openTerminalPopout: vi.fn(),
  subscribeTerminal: vi.fn(),
  unsubscribeTerminal: vi.fn(),
  writeTerminal: vi.fn(),
  resizeTerminal: vi.fn(),
  restartTerminal: vi.fn(),
  getTerminalRestore: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      mocks.handlers.set(channel, handler)
    })
  }
}))

vi.mock('../../popups/titlePopup', () => ({
  isTitlePopupSender: mocks.isTitlePopupSender
}))

vi.mock('../../host/registry', () => ({
  findEntryByComfySender: mocks.findEntryByComfySender
}))

vi.mock('../terminalPopoutWindow', () => ({
  findTerminalPopoutInstallationIdBySender: mocks.findTerminalPopoutInstallationIdBySender,
  openTerminalPopout: mocks.openTerminalPopout
}))

vi.mock('../terminal', () => ({
  subscribeTerminal: mocks.subscribeTerminal,
  unsubscribeTerminal: mocks.unsubscribeTerminal,
  writeTerminal: mocks.writeTerminal,
  resizeTerminal: mocks.resizeTerminal,
  restartTerminal: mocks.restartTerminal,
  getTerminalRestore: mocks.getTerminalRestore
}))

import { registerTerminalHandlers } from './registerTerminalHandlers'

function getHandler(channel: string): IpcHandler {
  const handler = mocks.handlers.get(channel)
  expect(handler).toBeDefined()
  return handler!
}

describe('registerTerminalHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.handlers.clear()
    mocks.findEntryByComfySender.mockReturnValue(null)
    mocks.isTitlePopupSender.mockReturnValue(false)
    mocks.findTerminalPopoutInstallationIdBySender.mockReturnValue(null)
    registerTerminalHandlers()
  })

  it('rejects PTY access from an untrusted sender with an explicit installation', async () => {
    const event = { sender: {} }

    await getHandler('terminal-write')(event, 'inst-a', 'whoami\r')
    await getHandler('terminal-unsubscribe')(event, 'inst-a')
    await getHandler('terminal-resize')(event, 'inst-a', 120, 40)
    const subscribeRestore = await getHandler('terminal-subscribe')(event, 'inst-a')
    const restartRestore = await getHandler('terminal-restart')(event, 'inst-a')
    const restore = await getHandler('terminal-restore')(event, 'inst-a')
    await getHandler('terminal-popout-open')(event, 'inst-a')
    await getHandler('desktop2-open-terminal-popout')(event, 'inst-a')

    expect(mocks.writeTerminal).not.toHaveBeenCalled()
    expect(mocks.unsubscribeTerminal).not.toHaveBeenCalled()
    expect(mocks.resizeTerminal).not.toHaveBeenCalled()
    expect(mocks.subscribeTerminal).not.toHaveBeenCalled()
    expect(mocks.restartTerminal).not.toHaveBeenCalled()
    expect(mocks.getTerminalRestore).not.toHaveBeenCalled()
    expect(mocks.openTerminalPopout).not.toHaveBeenCalled()
    const emptyRestore = {
      buffer: [],
      size: { cols: 80, rows: 30 },
      exited: true
    }
    expect(subscribeRestore).toEqual(emptyRestore)
    expect(restartRestore).toEqual(emptyRestore)
    expect(restore).toEqual(emptyRestore)
  })

  it('opens a popout bound to the local installation resolved by main', async () => {
    const event = { sender: {} }
    mocks.findEntryByComfySender.mockReturnValue({
      installationId: 'inst-a',
      sourceCategory: 'local'
    })

    await getHandler('desktop2-open-terminal-popout')(event, 'inst-b')

    expect(mocks.openTerminalPopout).toHaveBeenCalledWith('inst-a')
  })

  it('allows the trusted title popup to operate on its selected installation', async () => {
    const event = { sender: {} }
    mocks.isTitlePopupSender.mockReturnValue(true)

    await getHandler('terminal-write')(event, 'inst-a', 'pwd\r')

    expect(mocks.writeTerminal).toHaveBeenCalledWith('inst-a', 'pwd\r')
  })

  it('binds a terminal popout to the installation registered by main', async () => {
    const event = { sender: {} }
    mocks.findTerminalPopoutInstallationIdBySender.mockReturnValue('inst-a')

    await getHandler('terminal-resize')(event, null, 120, 40)

    expect(mocks.resizeTerminal).toHaveBeenCalledWith('inst-a', 120, 40)
  })

  it('rejects a popout request for a different installation', async () => {
    const event = { sender: {} }
    mocks.findTerminalPopoutInstallationIdBySender.mockReturnValue('inst-a')

    await getHandler('terminal-write')(event, 'inst-b', 'pwd\r')

    expect(mocks.writeTerminal).not.toHaveBeenCalled()
  })
})
