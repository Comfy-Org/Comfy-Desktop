import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComfyWindowEntry } from '../host/registry'
import { CUSTOMER_IO_READY, CUSTOMER_IO_STATE } from '../../shared/customerIo'

const state = vi.hoisted(() => ({
  consent: true,
  userId: 'verified-user' as string | null,
  getIdentity: vi.fn(),
  onAuthChanged: vi.fn()
}))
vi.mock('../devplatform/session', () => ({
  getCloudSession: () => ({
    getUserIdentity: state.getIdentity,
    onAuthChanged: state.onAuthChanged
  })
}))
vi.mock('../host/registry', () => ({
  computeBodyMode: (entry: ComfyWindowEntry) =>
    entry.installationId === null && entry.activePanel === 'comfy' ? 'chooser' : entry.activePanel
}))
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
    isDestroyed: () => false,
    isFocused: vi.fn(() => true),
    isVisible: () => true,
    isMinimized: () => false
  })
  const entry = {
    window,
    installationId: 'local-install',
    sourceCategory: 'local',
    activePanel: 'comfy',
    firstUseMode: 'none',
    panelView: null,
    comfyUrl: 'http://127.0.0.1:8188/',
    comfyView: { webContents: contents, getVisible: vi.fn(() => true) }
  } as unknown as ComfyWindowEntry
  return { entry, contents, frame, window }
}

beforeEach(() => {
  state.consent = true
  state.userId = 'verified-user'
  vi.unstubAllEnvs()
  vi.mocked(shell.openExternal).mockClear()
  state.getIdentity
    .mockReset()
    .mockResolvedValue({ userId: 'canonical-person', firebaseUid: 'launcher-person' })
  state.onAuthChanged.mockReset().mockReturnValue(() => {})
})

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function launcherFixture() {
  const fixtureEntry = fixture()
  const panelFrame = { send: vi.fn() }
  const panelContents = Object.assign(new EventEmitter(), {
    mainFrame: panelFrame,
    isDestroyed: () => false,
    getURL: vi.fn(() => pathToFileURL(join(__dirname, '../renderer/panel.html')).href)
  })
  const panelVisible = vi.fn(() => true)
  fixtureEntry.entry.panelView = {
    webContents: panelContents,
    getVisible: panelVisible
  } as unknown as ComfyWindowEntry['panelView']
  fixtureEntry.entry.installationId = null
  fixtureEntry.entry.sourceCategory = null
  vi.mocked(fixtureEntry.entry.comfyView.getVisible).mockReturnValue(false)
  const stop = attachCustomerIoMessaging(fixtureEntry.entry)
  cleanups.push(stop)
  const ready = () =>
    panelContents.emit('ipc-message', { senderFrame: panelFrame }, CUSTOMER_IO_READY)
  return { ...fixtureEntry, panelContents, panelFrame, panelVisible, ready }
}

describe('Desktop messaging eligibility', () => {
  it('waits for the launcher document and uses only the server-confirmed Firebase UID', async () => {
    const { panelContents, panelFrame, ready } = launcherFixture()
    expect(state.getIdentity).not.toHaveBeenCalled()
    panelContents.emit('ipc-message', { senderFrame: {} }, CUSTOMER_IO_READY)
    expect(state.getIdentity).not.toHaveBeenCalled()
    ready()
    expect(panelFrame.send).toHaveBeenLastCalledWith(CUSTOMER_IO_STATE, null)
    await Promise.resolve()
    expect(panelFrame.send).toHaveBeenLastCalledWith(
      CUSTOMER_IO_STATE,
      expect.objectContaining({
        page: 'desktop/launcher',
        userId: 'launcher-person'
      })
    )
    expect(state.getIdentity).toHaveBeenCalledOnce()
  })

  it('keeps a legacy OAuth session without Firebase provenance ineligible', async () => {
    state.getIdentity.mockResolvedValue({ userId: 'canonical-person' })
    const { panelFrame, ready } = launcherFixture()
    ready()
    await Promise.resolve()
    expect(panelFrame.send.mock.calls).toEqual([[CUSTOMER_IO_STATE, null]])
  })

  it('ignores a late launcher identity after consent is revoked', async () => {
    let resolve!: (identity: { firebaseUid: string }) => void
    state.getIdentity.mockReturnValue(
      new Promise((done) => {
        resolve = done
      })
    )
    const { panelFrame, ready } = launcherFixture()
    ready()
    state.consent = false
    customerIoEvents.emit('changed')
    resolve({ firebaseUid: 'old-person' })
    await Promise.resolve()
    expect(panelFrame.send.mock.calls).toEqual([[CUSTOMER_IO_STATE, null]])
  })

  it('revokes launcher identity synchronously on auth changes and rejects the old response', async () => {
    const { panelFrame, ready } = launcherFixture()
    ready()
    await Promise.resolve()
    let resolve!: (identity: { firebaseUid: string }) => void
    state.getIdentity.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      })
    )
    const authChanged = state.onAuthChanged.mock.calls[0]![0] as () => void
    authChanged()
    expect(panelFrame.send).toHaveBeenLastCalledWith(CUSTOMER_IO_STATE, null)
    state.getIdentity.mockResolvedValue(null)
    authChanged()
    resolve({ firebaseUid: 'stale-person' })
    await Promise.resolve()
    expect(panelFrame.send.mock.calls.filter(([, state]) => state !== null)).toHaveLength(1)
  })

  it('hands messaging from the launcher to visible local ComfyUI without granting both', async () => {
    const { entry, contents, frame, panelFrame, panelVisible, ready } = launcherFixture()
    ready()
    await Promise.resolve()
    contents.emit('ipc-message', { senderFrame: frame }, CUSTOMER_IO_READY)
    entry.installationId = 'local-install'
    entry.sourceCategory = 'local'
    panelVisible.mockReturnValue(false)
    vi.mocked(entry.comfyView.getVisible).mockReturnValue(true)
    entry.refreshCustomerIo!()
    expect(panelFrame.send).toHaveBeenLastCalledWith(CUSTOMER_IO_STATE, null)
    expect(frame.send).toHaveBeenLastCalledWith(
      CUSTOMER_IO_STATE,
      expect.objectContaining({
        page: 'desktop/comfyui',
        userId: 'verified-user'
      })
    )
    expect(panelFrame.send.mock.invocationCallOrder.at(-1)).toBeLessThan(
      frame.send.mock.invocationCallOrder.at(-1)!
    )
    entry.sourceCategory = 'cloud'
    entry.refreshCustomerIo!()
    expect(frame.send).toHaveBeenLastCalledWith(CUSTOMER_IO_STATE, null)
  })

  it('suppresses launcher takeovers, hidden views and replaced documents', async () => {
    const { entry, panelContents, panelFrame, panelVisible, ready } = launcherFixture()
    entry.firstUseMode = 'post-consent'
    ready()
    expect(state.getIdentity).not.toHaveBeenCalled()
    entry.firstUseMode = 'none'
    panelVisible.mockReturnValue(false)
    entry.refreshCustomerIo!()
    expect(state.getIdentity).not.toHaveBeenCalled()
    panelVisible.mockReturnValue(true)
    entry.refreshCustomerIo!()
    await Promise.resolve()
    expect(panelFrame.send).toHaveBeenLastCalledWith(
      CUSTOMER_IO_STATE,
      expect.objectContaining({ userId: 'launcher-person' })
    )
    entry.panelView = null
    entry.refreshCustomerIo!()
    expect(panelFrame.send).toHaveBeenLastCalledWith(CUSTOMER_IO_STATE, null)
    expect(panelContents.listenerCount('ipc-message')).toBe(0)
  })

  it('rejects a launcher document that navigates outside the bundled panel', async () => {
    const { panelContents, panelFrame, ready } = launcherFixture()
    ready()
    await Promise.resolve()
    panelContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    panelContents.getURL.mockReturnValue('https://cloud.comfy.org/panel.html')
    ready()
    await Promise.resolve()
    expect(panelFrame.send).toHaveBeenLastCalledWith(CUSTOMER_IO_STATE, null)
    expect(state.getIdentity).toHaveBeenCalledOnce()
  })

  it('opens a message link externally and prevents the SDK from replacing ComfyUI', () => {
    const { entry, contents, frame } = fixture()
    const stop = attachCustomerIoMessaging(entry)
    contents.emit('ipc-message', { senderFrame: frame }, CUSTOMER_IO_READY)
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
    contents.emit('ipc-message', { senderFrame: frame }, CUSTOMER_IO_READY)
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

  it('provides the verified Firebase identity and locale only for local ComfyUI', () => {
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
