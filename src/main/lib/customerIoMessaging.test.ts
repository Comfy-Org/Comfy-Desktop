import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComfyWindowEntry } from '../host/registry'
import { CUSTOMER_IO_READY, CUSTOMER_IO_STATE } from '../../shared/customerIo'

const state = vi.hoisted(() => ({ consent: true, userId: 'verified-user' as string | null }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    app: { isPackaged: true },
    ipcMain: new EventEmitter(),
    shell: { openExternal: vi.fn(async () => {}) }
  }
})
vi.mock('../settings', () => ({ get: () => state.consent }))
vi.mock('./i18n', () => ({ getLocale: () => 'ja' }))
vi.mock('./firebaseAuthIdentity', () => ({ getCustomerIoUserId: () => state.userId }))
vi.mock('./verifiedLocalFirebaseAuth', () => ({
  isLoopbackOrigin: (url: string) => new URL(url).hostname === '127.0.0.1'
}))

import { attachCustomerIoMessaging, customerIoSession } from './customerIoMessaging'
import { customerIoEvents } from './customerIoEvents'
import { ipcMain, shell } from 'electron'
import { CUSTOMER_IO_ACTION } from '../../shared/customerIo'

function fixture() {
  const frame = { send: vi.fn() }
  const contents = Object.assign(new EventEmitter(), {
    mainFrame: frame,
    isDestroyed: () => false,
    getURL: vi.fn(() => 'http://127.0.0.1:8188/')
  })
  const window = Object.assign(new EventEmitter(), {
    isFocused: vi.fn(() => true),
    isMinimized: () => false
  })
  const entry = {
    window,
    installationId: 'local-install',
    sourceCategory: 'local',
    activePanel: 'comfy',
    comfyUrl: 'http://127.0.0.1:8188/',
    comfyView: { webContents: contents, getVisible: () => true }
  } as unknown as ComfyWindowEntry
  return { entry, contents, frame, window }
}

beforeEach(() => {
  state.consent = true
  state.userId = 'verified-user'
  vi.unstubAllEnvs()
  vi.mocked(shell.openExternal).mockClear()
})

describe('Desktop messaging eligibility', () => {
  it('opens a message link externally and prevents the SDK from replacing ComfyUI', () => {
    const { entry, contents, frame } = fixture()
    const stop = attachCustomerIoMessaging(entry)
    const event = { sender: contents, senderFrame: frame, returnValue: false }
    ipcMain.emit(CUSTOMER_IO_ACTION, event, 'gist://loadPage?url=https://comfy.org/learn')
    expect(event.returnValue).toBe(true)
    expect(shell.openExternal).toHaveBeenCalledWith('https://comfy.org/learn')
    const navigation = { preventDefault: vi.fn() }
    contents.emit('will-navigate', navigation, 'https://comfy.org/learn')
    expect(navigation.preventDefault).toHaveBeenCalledOnce()
    stop()
    ipcMain.emit(CUSTOMER_IO_ACTION, event, 'https://comfy.org/learn')
    expect(event.returnValue).toBe(false)
  })

  it('rejects iframe actions and blocks local workflow replacement without opening a link', () => {
    const { entry, contents, frame } = fixture()
    const stop = attachCustomerIoMessaging(entry)
    ipcMain.emit(CUSTOMER_IO_ACTION, { sender: contents, senderFrame: {} }, 'https://comfy.org')
    expect(shell.openExternal).not.toHaveBeenCalled()
    ipcMain.emit(
      CUSTOMER_IO_ACTION,
      { sender: contents, senderFrame: frame },
      'gist://loadPage?url=/other-workflow'
    )
    const navigation = { preventDefault: vi.fn() }
    contents.emit('will-navigate', navigation, 'http://127.0.0.1:8188/other-workflow')
    expect(navigation.preventDefault).toHaveBeenCalledOnce()
    expect(shell.openExternal).not.toHaveBeenCalled()
    stop()
  })

  it('honors the process kill switch', () => {
    vi.stubEnv('COMFY_CUSTOMER_IO_ENABLED', 'false')
    expect(customerIoSession(fixture().entry)).toBeNull()
  })

  it('provides the canonical identity and locale only for local ComfyUI', () => {
    const { entry } = fixture()
    expect(customerIoSession(entry)).toMatchObject({ userId: 'verified-user', locale: 'ja' })
    entry.sourceCategory = 'cloud'
    expect(customerIoSession(entry)).toBeNull()
    entry.sourceCategory = 'remote'
    expect(customerIoSession(entry)).toBeNull()
    entry.sourceCategory = 'local'
    entry.installationId = null
    expect(customerIoSession(entry)).toBeNull()
  })

  it('suppresses denied consent, unresolved identity, other panels, and inactive windows', () => {
    const { entry, window } = fixture()
    state.consent = false
    expect(customerIoSession(entry)).toBeNull()
    state.consent = true
    state.userId = null
    expect(customerIoSession(entry)).toBeNull()
    state.userId = 'verified-user'
    entry.activePanel = 'feedback'
    expect(customerIoSession(entry)).toBeNull()
    entry.activePanel = 'comfy'
    window.isFocused.mockReturnValue(false)
    expect(customerIoSession(entry)).toBeNull()
  })

  it('rejects a navigated document even when the host remains attached', () => {
    const { entry, contents } = fixture()
    for (const url of [
      'https://cloud.comfy.org/',
      'http://127.0.0.1:9999/',
      'file:///tmp/page.html'
    ]) {
      contents.getURL.mockReturnValue(url)
      expect(customerIoSession(entry)).toBeNull()
    }
  })

  it('revokes on blur, consent changes and navigation; ignores iframe handshakes and cleans up', () => {
    const { entry, contents, frame, window } = fixture()
    const baseline = customerIoEvents.listenerCount('changed')
    const stop = attachCustomerIoMessaging(entry)
    contents.emit('ipc-message', { senderFrame: {} }, CUSTOMER_IO_READY)
    expect(frame.send).not.toHaveBeenCalled()
    contents.emit('ipc-message', { senderFrame: frame }, CUSTOMER_IO_READY)
    expect(frame.send).toHaveBeenLastCalledWith(
      CUSTOMER_IO_STATE,
      expect.objectContaining({ userId: 'verified-user' })
    )
    window.isFocused.mockReturnValue(false)
    window.emit('blur')
    expect(frame.send).toHaveBeenLastCalledWith(CUSTOMER_IO_STATE, null)
    window.isFocused.mockReturnValue(true)
    window.emit('focus')
    state.consent = false
    customerIoEvents.emit('changed')
    expect(frame.send).toHaveBeenLastCalledWith(CUSTOMER_IO_STATE, null)
    state.consent = true
    customerIoEvents.emit('changed')
    contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    expect(frame.send).toHaveBeenLastCalledWith(CUSTOMER_IO_STATE, null)
    const count = frame.send.mock.calls.length
    window.emit('focus')
    expect(frame.send).toHaveBeenCalledTimes(count)
    stop()
    expect(customerIoEvents.listenerCount('changed')).toBe(baseline)
    expect(contents.listenerCount('ipc-message')).toBe(0)
    expect(entry.refreshCustomerIo).toBeUndefined()
  })
})
