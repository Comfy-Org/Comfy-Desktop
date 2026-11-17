import { beforeEach, describe, expect, it, vi } from 'vitest'

interface PageEvent {
  sender: object
  senderFrame: object | null
}
type IpcHandler = (event: PageEvent, ...args: unknown[]) => unknown

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: never[]) => unknown>(),
  comfyViews: new Map<object, { installationId: string | null; comfyUrl: string }>(),
  logsWindows: new Map<object, string>(),
  panels: new Set<object>(),
  subscribeLogs: vi.fn(),
  unsubscribeLogs: vi.fn(),
  getLogsBuffer: vi.fn(),
  openLogsPopout: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: never[]) => unknown) => {
      mocks.handlers.set(channel, handler)
    }
  }
}))
vi.mock('../../host/registry', () => ({
  findEntryByComfySender: (sender: object) => mocks.comfyViews.get(sender) ?? null,
  findEntryByTitleBarSender: () => null,
  isPanelSender: (sender: object) => mocks.panels.has(sender)
}))
vi.mock('../../apps/appsPages', () => ({ isAppsPageSender: () => false }))
vi.mock('../embeddedSession', () => ({ isTrustedSender: () => false }))
vi.mock('../logsPopoutWindow', () => ({
  findLogsPopoutInstallationIdBySender: (sender: object) => mocks.logsWindows.get(sender) ?? null,
  openLogsPopout: mocks.openLogsPopout
}))
vi.mock('../logsBroadcast', () => ({
  subscribeLogs: mocks.subscribeLogs,
  unsubscribeLogs: mocks.unsubscribeLogs,
  getLogsBuffer: mocks.getLogsBuffer
}))

import { registerLogsHandlers } from './registerLogsHandlers'

const INSTALL_URL = 'http://127.0.0.1:8188'
const NOTHING = { installationId: '', buffer: [] }

function call(channel: string, event: PageEvent, ...args: unknown[]): unknown {
  const handler = mocks.handlers.get(channel) as IpcHandler | undefined
  expect(handler, `${channel} is registered`).toBeDefined()
  return handler!(event, ...args)
}

function pageAt(url: string): PageEvent {
  const mainFrame = { processId: 3, routingId: 1, url }
  return { sender: { mainFrame }, senderFrame: mainFrame }
}

function comfyViewShowing(url: string, installationId = 'inst-own'): PageEvent {
  const event = pageAt(url)
  mocks.comfyViews.set(event.sender, { installationId, comfyUrl: INSTALL_URL })
  return event
}

function logsWindowFor(
  installationId: string,
  url = 'data:text/html;charset=utf-8,logs'
): PageEvent {
  const event = pageAt(url)
  mocks.logsWindows.set(event.sender, installationId)
  return event
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.handlers.clear()
  mocks.comfyViews.clear()
  mocks.logsWindows.clear()
  mocks.panels.clear()
  mocks.subscribeLogs.mockImplementation((installationId: string) => ({
    installationId,
    buffer: [`${installationId} is ready\n`]
  }))
  mocks.getLogsBuffer.mockReturnValue(['line one\n', 'line two\n'])
  registerLogsHandlers()
})

describe("a ComfyUI page reading its install's logs", () => {
  it('follows its own install, named or not', () => {
    const page = comfyViewShowing(`${INSTALL_URL}/`)

    expect(call('logs-subscribe', page, null)).toEqual({
      installationId: 'inst-own',
      buffer: ['inst-own is ready\n']
    })
    expect(call('logs-subscribe', page, 'inst-own')).toMatchObject({ installationId: 'inst-own' })
    call('logs-unsubscribe', page, null)

    expect(mocks.subscribeLogs).toHaveBeenCalledWith('inst-own', page.sender)
    expect(mocks.unsubscribeLogs).toHaveBeenCalledExactlyOnceWith('inst-own', page.sender)
  })

  it("cannot follow another install by passing that install's id", () => {
    const page = comfyViewShowing(`${INSTALL_URL}/`)

    expect(call('logs-subscribe', page, 'inst-other')).toEqual(NOTHING)
    call('logs-unsubscribe', page, 'inst-other')

    expect(mocks.subscribeLogs).not.toHaveBeenCalled()
    expect(mocks.unsubscribeLogs).not.toHaveBeenCalled()
  })

  it('opens the logs window for its own install only', async () => {
    const page = comfyViewShowing(`${INSTALL_URL}/`)

    await call('logs-popout-open', page, 'inst-other')

    expect(mocks.openLogsPopout).toHaveBeenCalledExactlyOnceWith('inst-own')
  })
})

describe('a page from another site in the ComfyUI view', () => {
  it('reads no logs, with or without an install id, and opens no logs window', async () => {
    const page = comfyViewShowing('https://elsewhere.example.test/')

    expect(call('logs-subscribe', page, null)).toEqual(NOTHING)
    expect(call('logs-subscribe', page, 'inst-own')).toEqual(NOTHING)
    expect(call('logs-snapshot', page, 'inst-own')).toBe('')
    await call('logs-popout-open', page, null)

    expect(mocks.subscribeLogs).not.toHaveBeenCalled()
    expect(mocks.getLogsBuffer).not.toHaveBeenCalled()
    expect(mocks.openLogsPopout).not.toHaveBeenCalled()
  })
})

describe('the logs window', () => {
  it('follows the install it was opened for and no other', () => {
    const logs = logsWindowFor('inst-own')

    expect(call('logs-subscribe', logs, 'inst-own')).toMatchObject({ installationId: 'inst-own' })
    expect(call('logs-subscribe', logs, 'inst-other')).toEqual(NOTHING)

    expect(mocks.subscribeLogs).toHaveBeenCalledExactlyOnceWith('inst-own', logs.sender)
  })

  it('reads nothing once it shows a website', () => {
    const logs = logsWindowFor('inst-own', 'https://elsewhere.example.test/')

    expect(call('logs-subscribe', logs, 'inst-own')).toEqual(NOTHING)
    expect(mocks.subscribeLogs).not.toHaveBeenCalled()
  })
})

describe("Desktop's panel", () => {
  it('reads a snapshot of the install it names', () => {
    const panel = { sender: {}, senderFrame: null }
    mocks.panels.add(panel.sender)

    expect(call('logs-snapshot', panel, 'inst-any')).toBe('line one\nline two\n')
    expect(mocks.getLogsBuffer).toHaveBeenCalledExactlyOnceWith('inst-any')
  })

  it("is the only caller of a snapshot: the install's own page gets none", () => {
    const page = comfyViewShowing(`${INSTALL_URL}/`)

    expect(call('logs-snapshot', page, 'inst-own')).toBe('')
    expect(mocks.getLogsBuffer).not.toHaveBeenCalled()
  })
})
