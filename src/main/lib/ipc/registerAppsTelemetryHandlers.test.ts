import { beforeEach, describe, expect, it, vi } from 'vitest'

type Listener = (event: unknown, payload: unknown) => void
interface LoadedPage {
  appId: string
  document: number
}

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, Listener>(),
  isAppsPage: true,
  appsEnabled: true,
  page: { appId: 'remove-background', document: 1 } as LoadedPage | null,
  whileAuthorizing: () => {},
  capture: vi.fn<(event: string, properties: unknown) => boolean>(() => true)
}))

vi.mock('electron', () => ({
  ipcMain: {
    on: (channel: string, listener: Listener) => mocks.listeners.set(channel, listener)
  }
}))
vi.mock('../../apps/appsConfig', () => ({
  areAppsEnabled: async () => {
    mocks.whileAuthorizing()
    return mocks.appsEnabled
  }
}))
vi.mock('../../apps/appsPages', () => ({ isAppsPageSender: () => mocks.isAppsPage }))
vi.mock('../../apps/appPageView', () => ({ loadedAppPage: () => mocks.page }))
vi.mock('../telemetry', () => ({
  capture: mocks.capture,
  DEFAULT_EVENT_PROPERTY_NAMES: new Set(['app_version', 'installation_id'])
}))

import {
  APPS_TELEMETRY_TRACK_CHANNEL,
  registerAppsTelemetryHandlers,
  trackFromAppsPage
} from './registerAppsTelemetryHandlers'

const EVENT = { sender: {}, senderFrame: {} } as unknown as Electron.IpcMainEvent
const RUN = { name: 'run_started', props: { where: 'cloud' } }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listeners.clear()
  mocks.isAppsPage = true
  mocks.appsEnabled = true
  mocks.page = { appId: 'remove-background', document: 1 }
  mocks.whileAuthorizing = () => {}
  registerAppsTelemetryHandlers()
})

describe('usage events from the hosted Apps page', () => {
  it('listens on the channel the Apps preload sends on', async () => {
    const listener = mocks.listeners.get(APPS_TELEMETRY_TRACK_CHANNEL)
    expect(APPS_TELEMETRY_TRACK_CHANNEL).toBe('apps-telemetry:track')
    expect(listener).toBeTypeOf('function')

    listener?.(EVENT, RUN)

    await vi.waitFor(() =>
      expect(mocks.capture).toHaveBeenCalledWith('comfy.desktop.apps.run_started', {
        where: 'cloud',
        app_id: 'remove-background'
      })
    )
  })

  it('sends any well-formed event through Desktop telemetry with the Apps prefix', async () => {
    expect(await trackFromAppsPage(EVENT, { name: 'click', props: { target: 'run' } })).toBe(true)
    expect(
      await trackFromAppsPage(EVENT, {
        name: 'example_used',
        props: { example: 'dance-1', first: true, index: 2 }
      })
    ).toBe(true)

    expect(mocks.capture.mock.calls).toEqual([
      ['comfy.desktop.apps.click', { target: 'run', app_id: 'remove-background' }],
      [
        'comfy.desktop.apps.example_used',
        { example: 'dance-1', first: true, index: 2, app_id: 'remove-background' }
      ]
    ])
  })

  it('fills app_id from the app Desktop loaded in that view, not from the page', async () => {
    mocks.page = { appId: 'upscale', document: 3 }

    await trackFromAppsPage(EVENT, {
      name: 'click',
      props: { app: 'remove-background', app_id: 'remove-background', target: 'run' }
    })

    expect(mocks.capture).toHaveBeenCalledWith('comfy.desktop.apps.click', {
      target: 'run',
      app_id: 'upscale'
    })
  })

  it.each([
    ['a sender that is not the hosted Apps page', { isAppsPage: false }],
    ['the Apps page while Apps is switched off', { appsEnabled: false }],
    ['a page Desktop holds no loaded app for, as while the next app loads', { page: null }]
  ])('refuses %s', async (_who, state) => {
    Object.assign(mocks, state)

    expect(await trackFromAppsPage(EVENT, RUN)).toBe(false)

    expect(mocks.capture).not.toHaveBeenCalled()
  })

  it.each([
    ['the next app loads', () => (mocks.page = null)],
    [
      'the page is replaced by another document',
      () => (mocks.page = { appId: 'remove-background', document: 2 })
    ],
    ['the view moves to another app', () => (mocks.page = { appId: 'upscale', document: 2 })]
  ])('drops an event when %s while Desktop checks the sender', async (_what, change) => {
    mocks.whileAuthorizing = change

    expect(await trackFromAppsPage(EVENT, RUN)).toBe(false)

    expect(mocks.capture).not.toHaveBeenCalled()
  })

  it.each([
    ['app_opened, which Desktop sends itself', { name: 'app_opened', props: {} }],
    ['app_page_failed, which Desktop sends itself', { name: 'app_page_failed', props: {} }],
    ['a name outside the pattern', { name: 'Run Started', props: {} }],
    ['a payload with no name', { props: { where: 'cloud' } }],
    ['a payload that is not an object', 'run_started'],
    ['no payload', undefined]
  ])('drops %s', async (_what, payload) => {
    expect(await trackFromAppsPage(EVENT, payload)).toBe(false)

    expect(mocks.capture).not.toHaveBeenCalled()
  })

  it('drops free text and properties Desktop sets itself before sending', async () => {
    await trackFromAppsPage(EVENT, {
      name: 'run_started',
      props: {
        where: 'cloud',
        prompt: 'a cat on the moon',
        file: '/Users/someone/me.png',
        app_version: '9.9.9',
        installation_id: 'fake'
      }
    })

    expect(mocks.capture).toHaveBeenCalledWith('comfy.desktop.apps.run_started', {
      where: 'cloud',
      app_id: 'remove-background'
    })
  })
})
