import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  isAppsPage: true,
  appsEnabled: true,
  localState: vi.fn(),
  startLocal: vi.fn(),
  localFetch: vi.fn(),
  localDownload: vi.fn(),
  openInComfy: vi.fn(),
  localBuilds: vi.fn(),
  loadedApp: 'product-ads' as string | null,
  document: 1,
  whileChecking: () => {}
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => mocks.handlers.set(channel, handler)
  }
}))
vi.mock('../../apps/appsConfig', () => ({
  areAppsEnabled: async () => {
    mocks.whileChecking()
    return mocks.appsEnabled
  }
}))
vi.mock('../../apps/appPageView', () => ({
  loadedAppPage: () =>
    mocks.loadedApp ? { appId: mocks.loadedApp, document: mocks.document } : null
}))
vi.mock('../../apps/appsPages', () => ({ isAppsPageSender: () => mocks.isAppsPage }))
vi.mock('../../apps/localComfy', () => ({
  localState: mocks.localState,
  startLocal: mocks.startLocal,
  localFetch: mocks.localFetch,
  localDownload: mocks.localDownload
}))
vi.mock('../../apps/openInComfy', () => ({
  openInComfy: mocks.openInComfy,
  localBuilds: mocks.localBuilds
}))
vi.mock('../i18n', () => ({ t: (key: string) => key }))

import { APPS_LOCAL_CHANNELS, registerAppsLocalHandlers } from './registerAppsLocalHandlers'

const EVENT = { sender: {}, senderFrame: {} }
const WANT = { minVersion: '0.41.0' }
const RUNNING = { state: 'running', own: true, name: 'Studio', clientId: 'desktop-client' }
const OPEN = {
  prompt: { '9': { class_type: 'SaveImage', inputs: {} } },
  where: 'local',
  name: 'Remove Background'
}
const BUILDS = [{ id: 'inst-1', name: 'Studio' }]

function call(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error(`No handler for ${channel}`)
  return handler(EVENT, ...args)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.handlers.clear()
  mocks.isAppsPage = true
  mocks.appsEnabled = true
  mocks.loadedApp = 'product-ads'
  mocks.document = 1
  mocks.whileChecking = () => {}
  mocks.localState.mockResolvedValue({ state: 'stopped', own: true, name: 'Studio' })
  mocks.startLocal.mockResolvedValue(RUNNING)
  mocks.localFetch.mockResolvedValue({ status: 200, contentType: 'application/json', body: null })
  mocks.localDownload.mockResolvedValue({ state: 'done' })
  mocks.openInComfy.mockResolvedValue({ opened: true })
  mocks.localBuilds.mockResolvedValue(BUILDS)
  registerAppsLocalHandlers()
})

describe('the ComfyUI on this computer, for the hosted Apps page', () => {
  it('is found, started, called and given a model on behalf of the page', async () => {
    const request = { path: '/queue' }
    const model = { url: 'https://huggingface.co/a/b/resolve/main/vae/x.safetensors' }

    expect(await call(APPS_LOCAL_CHANNELS.get, WANT)).toMatchObject({ state: 'stopped' })
    expect(await call(APPS_LOCAL_CHANNELS.start, WANT)).toEqual(RUNNING)
    expect(await call(APPS_LOCAL_CHANNELS.fetch, request)).toMatchObject({ status: 200 })
    expect(await call(APPS_LOCAL_CHANNELS.download, model)).toEqual({ state: 'done' })

    expect(mocks.localState).toHaveBeenCalledWith(EVENT.sender, WANT)
    expect(mocks.startLocal).toHaveBeenCalledWith(EVENT.sender, WANT, 'product-ads')
    expect(mocks.localFetch).toHaveBeenCalledWith(EVENT.sender, request, 'product-ads')
    expect(mocks.localDownload).toHaveBeenCalledWith(EVENT.sender, model, 'product-ads')
  })

  it('names no app when the view has no app page loaded', async () => {
    mocks.loadedApp = null
    const request = { path: '/queue' }

    await call(APPS_LOCAL_CHANNELS.start, WANT)
    await call(APPS_LOCAL_CHANNELS.fetch, request)

    expect(mocks.startLocal).toHaveBeenCalledWith(EVENT.sender, WANT, null)
    expect(mocks.localFetch).toHaveBeenCalledWith(EVENT.sender, request, null)
  })

  describe('when the view loads another app while Desktop checks the call', () => {
    beforeEach(() => {
      mocks.whileChecking = () => {
        mocks.loadedApp = 'upscale'
        mocks.document = 2
      }
    })

    it('refuses to start ComfyUI for either app', async () => {
      expect(await call(APPS_LOCAL_CHANNELS.start, WANT)).toMatchObject({ state: 'unsupported' })
      expect(mocks.startLocal).not.toHaveBeenCalled()
    })

    it('refuses to call ComfyUI for either app', async () => {
      await expect(call(APPS_LOCAL_CHANNELS.fetch, { path: '/queue' })).rejects.toThrow()
      expect(mocks.localFetch).not.toHaveBeenCalled()
    })

    it('refuses to download a model for either app', async () => {
      expect(await call(APPS_LOCAL_CHANNELS.download, {})).toMatchObject({ state: 'failed' })
      expect(mocks.localDownload).not.toHaveBeenCalled()
    })
  })

  it('opens a workflow in ComfyUI and lists this computer builds for the page', async () => {
    expect(await call(APPS_LOCAL_CHANNELS.openInComfy, OPEN)).toEqual({ opened: true })
    expect(await call(APPS_LOCAL_CHANNELS.builds)).toEqual(BUILDS)

    expect(mocks.openInComfy).toHaveBeenCalledWith(EVENT.sender, OPEN)
  })

  it.each([
    ['a sender that is not the hosted Apps page', { isAppsPage: false, appsEnabled: true }],
    ['the Apps page while Apps is switched off', { isAppsPage: true, appsEnabled: false }]
  ])('does nothing for %s', async (_who, state) => {
    Object.assign(mocks, state)

    expect(await call(APPS_LOCAL_CHANNELS.get, WANT)).toMatchObject({ state: 'unsupported' })
    expect(await call(APPS_LOCAL_CHANNELS.start, WANT)).toMatchObject({ state: 'unsupported' })
    await expect(call(APPS_LOCAL_CHANNELS.fetch, { path: '/queue' })).rejects.toThrow()
    expect(await call(APPS_LOCAL_CHANNELS.download, {})).toMatchObject({ state: 'failed' })
    expect(await call(APPS_LOCAL_CHANNELS.openInComfy, OPEN)).toEqual({
      opened: false,
      error: 'apps.local.notRunning'
    })
    expect(await call(APPS_LOCAL_CHANNELS.builds)).toEqual([])

    expect(mocks.localState).not.toHaveBeenCalled()
    expect(mocks.startLocal).not.toHaveBeenCalled()
    expect(mocks.localFetch).not.toHaveBeenCalled()
    expect(mocks.localDownload).not.toHaveBeenCalled()
    expect(mocks.openInComfy).not.toHaveBeenCalled()
    expect(mocks.localBuilds).not.toHaveBeenCalled()
  })
})
