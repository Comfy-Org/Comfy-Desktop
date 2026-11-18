import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  isAppsPage: true,
  appsEnabled: true,
  recentAssets: vi.fn(async (_page: unknown, _request: unknown): Promise<unknown> => []),
  assetFromPath: vi.fn(
    async (_page: unknown, _path: unknown, _request: unknown): Promise<unknown> => ({
      ref: 'r1'
    })
  ),
  readAsset: vi.fn(async (_page: unknown, _ref: unknown): Promise<unknown> => ({ mime: 'x' })),
  assetRunValue: vi.fn(
    async (_page: unknown, _ref: unknown, _request: unknown): Promise<unknown> => ({
      value: 'apps/cutout.png [output]'
    })
  )
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => mocks.handlers.set(channel, handler)
  }
}))
vi.mock('../../apps/appsConfig', () => ({ areAppsEnabled: async () => mocks.appsEnabled }))
vi.mock('../../apps/appsPages', () => ({ isAppsPageSender: () => mocks.isAppsPage }))
vi.mock('../../apps/appAssets', () => ({
  recentAssets: mocks.recentAssets,
  assetFromPath: mocks.assetFromPath,
  readAsset: mocks.readAsset,
  assetRunValue: mocks.assetRunValue
}))

import { APPS_ASSETS_CHANNELS, registerAppsAssetsHandlers } from './registerAppsAssetsHandlers'

const SENDER = {}
const EVENT = { sender: SENDER, senderFrame: {} }

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
  registerAppsAssetsHandlers()
})

describe('the app page assets channels', () => {
  it('answer on the channels the Apps preload invokes', () => {
    expect(APPS_ASSETS_CHANNELS).toEqual({
      recent: 'apps-assets:recent',
      fromPath: 'apps-assets:from-path',
      read: 'apps-assets:read',
      valueFor: 'apps-assets:value-for'
    })
    expect([...mocks.handlers.keys()].sort()).toEqual(Object.values(APPS_ASSETS_CHANNELS).sort())
  })

  it('pass the request and the sending page on', async () => {
    const recent = { kinds: ['image'], where: 'local' }

    expect(await call(APPS_ASSETS_CHANNELS.recent, recent)).toEqual([])
    expect(await call(APPS_ASSETS_CHANNELS.fromPath, '/p/a.png', { kinds: ['image'] })).toEqual({
      ref: 'r1'
    })
    expect(await call(APPS_ASSETS_CHANNELS.read, 'r1')).toEqual({ mime: 'x' })
    expect(await call(APPS_ASSETS_CHANNELS.valueFor, 'r1', { where: 'local' })).toEqual({
      value: 'apps/cutout.png [output]'
    })

    expect(mocks.recentAssets).toHaveBeenCalledExactlyOnceWith(SENDER, recent)
    expect(mocks.assetFromPath).toHaveBeenCalledExactlyOnceWith(SENDER, '/p/a.png', {
      kinds: ['image']
    })
    expect(mocks.readAsset).toHaveBeenCalledExactlyOnceWith(SENDER, 'r1')
    expect(mocks.assetRunValue).toHaveBeenCalledExactlyOnceWith(SENDER, 'r1', { where: 'local' })
  })

  it('answer nothing to a sender that is not the hosted Apps page, or while Apps is off', async () => {
    for (const state of [
      { isAppsPage: false, appsEnabled: true },
      { isAppsPage: true, appsEnabled: false }
    ]) {
      Object.assign(mocks, state)

      expect(await call(APPS_ASSETS_CHANNELS.recent, { kinds: ['image'], where: 'local' })).toEqual(
        []
      )
      expect(await call(APPS_ASSETS_CHANNELS.fromPath, '/p/a.png', { kinds: ['image'] })).toEqual({
        error: 'missing'
      })
      expect(await call(APPS_ASSETS_CHANNELS.read, 'r1')).toEqual({ error: 'missing' })
      expect(await call(APPS_ASSETS_CHANNELS.valueFor, 'r1', { where: 'local' })).toEqual({
        error: 'missing'
      })
    }

    expect(mocks.recentAssets).not.toHaveBeenCalled()
    expect(mocks.assetFromPath).not.toHaveBeenCalled()
    expect(mocks.readAsset).not.toHaveBeenCalled()
    expect(mocks.assetRunValue).not.toHaveBeenCalled()
  })

  it('answer an empty list or missing when Desktop fails, so the page uploads as before', async () => {
    mocks.recentAssets.mockRejectedValueOnce(new Error('Cloud is down'))
    mocks.readAsset.mockRejectedValueOnce(new Error('disk gone'))

    expect(await call(APPS_ASSETS_CHANNELS.recent, { kinds: ['image'], where: 'cloud' })).toEqual(
      []
    )
    expect(await call(APPS_ASSETS_CHANNELS.read, 'r1')).toEqual({ error: 'missing' })
  })
})
