// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ipc = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  listeners: new Map<string, (...args: unknown[]) => unknown>()
}))

const pages = vi.hoisted(() => {
  const made: Array<{ mainFrame: { url: string } }> = []
  const webContents = () => {
    const wc = {
      mainFrame: { url: '' },
      on: () => wc,
      setWindowOpenHandler: () => {},
      loadURL: () => Promise.resolve(),
      isDestroyed: () => false,
      getURL: () => wc.mainFrame.url,
      focus: () => {},
      close: () => {}
    }
    made.push(wc)
    return wc
  }
  return { made, webContents }
})

vi.mock('electron', () => ({
  app: { isPackaged: true },
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => ipc.handlers.set(channel, fn),
    on: (channel: string, fn: (...args: unknown[]) => unknown) => ipc.listeners.set(channel, fn)
  },
  session: {
    fromPartition: () => ({
      setPermissionCheckHandler: () => {},
      setPermissionRequestHandler: () => {}
    })
  },
  shell: {},
  WebContentsView: class {
    webContents = pages.webContents()
    setBorderRadius() {}
    setBounds() {}
    setVisible() {}
    getVisible() {
      return false
    }
  }
}))

const windows = vi.hoisted(() => new Map<number, unknown>())
vi.mock('./appsBuild', () => ({ findApps: async () => null }))
vi.mock('../lib/outputFolders', () => ({ allowedPath: () => false, outputLocator: () => null }))
vi.mock('../host/registry', () => ({ comfyWindows: windows }))

vi.mock('../cloud/config', () => ({
  CLOUD_CONFIG: { issuer: 'https://cloud.comfy.org', apiBase: 'https://cloud.comfy.org/api' }
}))

vi.mock('../devplatform/session', () => ({
  getCloudSession: () => ({
    getAccessToken: async () => 'tok',
    status: () => ({ signedIn: true })
  })
}))

vi.mock('../lib/ipc/registerDevPlatformHandlers', () => ({ signInToCloud: async () => {} }))
vi.mock('../settings', () => ({ get: () => '' }))
vi.mock('./localComfy', () => ({
  cancelSetup: () => {},
  getLocal: async () => ({}),
  initLocalComfy: () => {},
  localDownload: async () => ({}),
  localFetch: async () => ({}),
  startLocal: async () => ({}),
  syncLocalSocket: () => {}
}))
vi.mock('./openInComfy', () => ({ localBuilds: async () => [], openInComfy: async () => ({}) }))
vi.mock('./appsSwitch', () => ({ isAppsEnabled: () => true, onAppsEnabledChanged: () => {} }))
vi.mock('./appEvents', () => ({ trackFromPage: () => {} }))

const desktopApps = vi.hoisted(() => ({
  desktopAppIds: vi.fn(async (): Promise<ReadonlySet<string>> => new Set())
}))
vi.mock('./desktopApps', () => desktopApps)

const fetchMock = vi.fn(
  async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify({ prompt_id: 'run-1' }), { status: 200 })
)
vi.stubGlobal('fetch', fetchMock)

import { registerAppsIpc } from './appsView'

const workflow = { '1': { class_type: 'SaveImage', inputs: {} } }
const panel = {}

registerAppsIpc()
windows.set(1, {
  panelView: { webContents: panel, getBounds: () => ({ x: 0, y: 0, width: 100, height: 100 }) },
  window: { once: () => {}, contentView: { addChildView: () => {} } }
})
ipc.listeners.get('comfy-apps:show')!({ sender: panel }, { x: 0, y: 0, width: 10, height: 10 })
const page = pages.made[0]!

async function runFrom(url: string, ...args: unknown[]): Promise<unknown> {
  page.mainFrame.url = url
  return ipc.handlers.get('comfy-apps:run')!({ sender: page, senderFrame: page.mainFrame }, ...args)
}

function posted(): { prompt: unknown; extra_data: Record<string, unknown> } {
  const prompt = fetchMock.mock.calls.find(([url]) => url.endsWith('/prompt'))
  expect(prompt, 'the run was posted to Cloud').toBeDefined()
  return JSON.parse(prompt![1]!.body as string)
}

beforeEach(() => {
  fetchMock.mockClear()
  desktopApps.desktopAppIds.mockResolvedValue(new Set(['remove-background', 'upscale']))
})

describe('a Cloud run from an app page', () => {
  it('tags the run with the open app, not the app the page names', async () => {
    await runFrom('https://comfy.org/apps/remove-background/desktop.html', workflow, {
      app: 'upscale'
    })

    expect(posted().extra_data['comfy_app']).toEqual({ id: 'remove-background', where: 'cloud' })
  })

  it('tags the run with the open app and the model the page gives', async () => {
    await runFrom('https://comfy.org/apps/remove-background/desktop.html', workflow, {
      model: 'birefnet'
    })

    expect(posted().extra_data['comfy_app']).toEqual({
      id: 'remove-background',
      model: 'birefnet',
      where: 'cloud'
    })
  })

  it('still runs with no tag when the open app is not on the Desktop app list', async () => {
    const result = await runFrom('https://comfy.org/apps/secret-beta/desktop.html', workflow, {
      app: 'secret-beta',
      model: 'flux-2'
    })

    expect(result).toEqual({ runId: 'run-1' })
    expect(posted()).toEqual({ prompt: workflow, extra_data: { auth_token_comfy_org: 'tok' } })
  })

  it('still runs with no tag when the Desktop app list could not be read', async () => {
    desktopApps.desktopAppIds.mockResolvedValue(new Set())
    const result = await runFrom('https://comfy.org/apps/upscale/desktop.html', workflow)

    expect(result).toEqual({ runId: 'run-1' })
    expect(posted().extra_data).toEqual({ auth_token_comfy_org: 'tok' })
  })

  it('tags a run from a page that predates the options', async () => {
    await runFrom('https://comfy.org/apps/upscale/desktop.html', workflow)

    expect(posted().extra_data['comfy_app']).toEqual({ id: 'upscale', where: 'cloud' })
  })

  it('sends no tag from the list page, which has no app open', async () => {
    await runFrom('https://comfy.org/apps/#/upscale', workflow, { app: 'upscale' })

    expect(posted().extra_data).toEqual({ auth_token_comfy_org: 'tok' })
  })
})
