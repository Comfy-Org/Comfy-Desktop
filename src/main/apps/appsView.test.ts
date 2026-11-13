import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ipcListeners = vi.hoisted(() => new Map<string, (...args: unknown[]) => void>())
const createdViews = vi.hoisted(() => [] as Array<{ setVisible: (visible: boolean) => void }>)
const comfyWindows = vi.hoisted(() => new Map<number, unknown>())
const cloud = vi.hoisted(() => ({
  status: { signedIn: false } as { signedIn: boolean; email?: string },
  authListeners: [] as Array<(status: unknown) => void>
}))

vi.mock('electron', () => {
  class WebContentsView {
    webContents = {
      isDestroyed: () => false,
      on: () => {},
      setWindowOpenHandler: () => {},
      loadURL: () => Promise.resolve(),
      close: () => {}
    }
    setBorderRadius = vi.fn()
    setBounds = vi.fn()
    setVisible = vi.fn()
    constructor() {
      createdViews.push(this)
    }
  }
  return {
    app: { isPackaged: true },
    ipcMain: {
      on: (channel: string, listener: (...args: unknown[]) => void) =>
        ipcListeners.set(channel, listener),
      handle: () => {}
    },
    session: {
      fromPartition: () => ({
        setPermissionCheckHandler: () => {},
        setPermissionRequestHandler: () => {}
      })
    },
    shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
    WebContentsView
  }
})

vi.mock('../cloud/config', () => ({
  CLOUD_CONFIG: { issuer: 'https://cloud.comfy.org', apiBase: 'https://cloud.comfy.org/api' }
}))
vi.mock('../devplatform/session', () => ({
  getCloudSession: () => ({ status: () => cloud.status })
}))
vi.mock('../host/registry', () => ({ comfyWindows }))
vi.mock('../lib/ipc/registerDevPlatformHandlers', () => ({
  signInToCloud: vi.fn(),
  onCloudAuthChanged: (listener: (status: unknown) => void) => {
    cloud.authListeners.push(listener)
    return () => {}
  }
}))
vi.mock('../settings', () => ({}))
vi.mock('./localComfy', () => ({
  cancelSetup: vi.fn(),
  getLocal: vi.fn(),
  initLocalComfy: vi.fn(),
  localDownload: vi.fn(),
  localFetch: vi.fn(),
  startLocal: vi.fn(),
  syncLocalSocket: vi.fn()
}))
vi.mock('./openInComfy', () => ({ localBuilds: vi.fn(), openInComfy: vi.fn() }))

const getOpsFlagResult = vi.fn()
vi.mock('../lib/telemetry', () => ({
  getOpsFlagResult: (...args: unknown[]) => getOpsFlagResult(...args)
}))

let testConfigDir = ''
vi.mock('../lib/paths', () => ({
  configDir: () => testConfigDir
}))

const settle = () => new Promise((resolve) => setImmediate(resolve))
const rect = { x: 0, y: 0, width: 400, height: 300, fresh: true }

function lateRemoteAnswer(): (value: boolean) => void {
  let answer: (result: unknown) => void = () => {}
  getOpsFlagResult.mockReturnValue(new Promise((resolve) => (answer = resolve)))
  return (value) => answer({ kind: 'value', value, payload: undefined })
}

function openPanel() {
  const webContents = { isDestroyed: () => false, send: vi.fn() }
  comfyWindows.set(1, {
    panelView: { webContents, getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }) },
    window: { once: vi.fn(), contentView: { addChildView: vi.fn() } }
  })
  return webContents
}

async function startDesktop(stored?: boolean) {
  if (stored !== undefined) {
    fs.writeFileSync(
      path.join(testConfigDir, 'ops-flags.json'),
      JSON.stringify({ desktop_apps_enabled: { value: stored, payload: null, fetchedAt: 1 } })
    )
  }
  vi.resetModules()
  const view = await import('./appsView')
  const appsSwitch = await import('./appsSwitch')
  view.registerAppsIpc()
  await appsSwitch.initAppsSwitch({ distinctId: 'anon' })
  return appsSwitch
}

function cloudAuthChanged(status: { signedIn: boolean; email?: string }): void {
  cloud.status = status
  for (const listener of cloud.authListeners) listener(status)
}

function showApps(sender: unknown): void {
  ipcListeners.get('comfy-apps:show')!({ sender }, rect)
}

beforeEach(() => {
  getOpsFlagResult.mockReset()
  ipcListeners.clear()
  createdViews.length = 0
  comfyWindows.clear()
  cloud.status = { signedIn: false }
  cloud.authListeners.length = 0
  testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apps-view-'))
})

afterEach(() => {
  fs.rmSync(testConfigDir, { recursive: true, force: true })
})

describe('Apps page and the remote switch', () => {
  it('tells the panel when a late remote answer turns Apps on', async () => {
    const panel = openPanel()
    const remote = lateRemoteAnswer()
    const appsSwitch = await startDesktop(false)
    expect(appsSwitch.isAppsEnabled()).toBe(false)

    remote(true)
    await settle()

    expect(panel.send).toHaveBeenCalledWith('comfy-apps:enabled', { enabled: true })
  })

  it('hides the open Apps page and tells the panel when a late remote answer turns Apps off', async () => {
    const panel = openPanel()
    const remote = lateRemoteAnswer()
    await startDesktop(true)
    showApps(panel)
    const page = createdViews[0]!
    expect(page.setVisible).toHaveBeenLastCalledWith(true)

    remote(false)
    await settle()

    expect(page.setVisible).toHaveBeenLastCalledWith(false)
    expect(panel.send).toHaveBeenCalledWith('comfy-apps:enabled', { enabled: false })
  })

  it('shows the Apps tab when a staff member signs in, without a restart', async () => {
    const panel = openPanel()
    getOpsFlagResult.mockResolvedValue({ kind: 'value', value: false, payload: undefined })
    const appsSwitch = await startDesktop()
    expect(appsSwitch.isAppsEnabled()).toBe(false)

    getOpsFlagResult.mockResolvedValue({ kind: 'value', value: true, payload: undefined })
    cloudAuthChanged({ signedIn: true, email: 'ada@comfy.org' })
    await settle()

    expect(getOpsFlagResult.mock.calls.at(-1)?.[4]).toEqual({ email: 'ada@comfy.org' })
    expect(appsSwitch.isAppsEnabled()).toBe(true)
    expect(panel.send).toHaveBeenCalledWith('comfy-apps:enabled', { enabled: true })
  })

  it('hides the Apps tab again when that person signs out', async () => {
    cloud.status = { signedIn: true, email: 'ada@comfy.org' }
    const panel = openPanel()
    getOpsFlagResult.mockResolvedValue({ kind: 'value', value: true, payload: undefined })
    const appsSwitch = await startDesktop()
    expect(appsSwitch.isAppsEnabled()).toBe(true)

    getOpsFlagResult.mockResolvedValue({ kind: 'value', value: false, payload: undefined })
    cloudAuthChanged({ signedIn: false })
    await settle()

    expect(getOpsFlagResult.mock.calls.at(-1)?.[4]).toEqual({})
    expect(appsSwitch.isAppsEnabled()).toBe(false)
    expect(panel.send).toHaveBeenCalledWith('comfy-apps:enabled', { enabled: false })
  })

  it('answers an open it refuses, so the panel can leave the Apps page', async () => {
    const panel = openPanel()
    getOpsFlagResult.mockResolvedValue({ kind: 'unreachable' })
    await startDesktop()

    showApps(panel)

    expect(createdViews).toHaveLength(0)
    expect(panel.send).toHaveBeenCalledWith('comfy-apps:enabled', { enabled: false })
  })
})
