import { beforeEach, describe, expect, it, vi } from 'vitest'

type Listener = (event: unknown, payload: unknown) => void

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, Listener>(),
  isAppsPage: true,
  appsEnabled: true,
  capture: vi.fn(() => true)
}))

vi.mock('electron', () => ({
  ipcMain: {
    on: (channel: string, listener: Listener) => mocks.listeners.set(channel, listener)
  }
}))
vi.mock('../../apps/appsConfig', () => ({ areAppsEnabled: async () => mocks.appsEnabled }))
vi.mock('../../apps/appsPages', () => ({ isAppsPageSender: () => mocks.isAppsPage }))
vi.mock('../telemetry', () => ({ capture: mocks.capture }))

import {
  APPS_TELEMETRY_TRACK_CHANNEL,
  registerAppsTelemetryHandlers,
  trackFromAppsPage
} from './registerAppsTelemetryHandlers'

const EVENT = { sender: {}, senderFrame: {} } as unknown as Electron.IpcMainEvent
const RUN = { name: 'run_started', props: { app: 'remove-background', where: 'cloud' } }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listeners.clear()
  mocks.isAppsPage = true
  mocks.appsEnabled = true
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
        app_id: 'remove-background',
        where: 'cloud'
      })
    )
  })

  it('sends a good event through Desktop telemetry with the Apps prefix', async () => {
    expect(
      await trackFromAppsPage(EVENT, {
        name: 'run_started',
        props: { app: 'genjutsu', where: 'local', model: 'scail-2', quality: 'fast', seconds: 90 }
      })
    ).toBe(true)
    expect(
      await trackFromAppsPage(EVENT, {
        name: 'example_used',
        props: { app: 'genjutsu', example: 'dance-1' }
      })
    ).toBe(true)
    expect(
      await trackFromAppsPage(EVENT, {
        name: 'open_in_comfyui',
        props: { app: 'genjutsu', where: 'cloud' }
      })
    ).toBe(true)

    expect(mocks.capture.mock.calls).toEqual([
      [
        'comfy.desktop.apps.run_started',
        { app_id: 'genjutsu', where: 'local', model: 'scail-2', quality: 'fast', seconds: 90 }
      ],
      ['comfy.desktop.apps.example_used', { app_id: 'genjutsu', example: 'dance-1' }],
      ['comfy.desktop.apps.open_in_comfyui', { app_id: 'genjutsu', where: 'cloud' }]
    ])
  })

  it.each([
    ['a sender that is not the hosted Apps page', { isAppsPage: false, appsEnabled: true }],
    ['the Apps page while Apps is switched off', { isAppsPage: true, appsEnabled: false }]
  ])('refuses %s', async (_who, state) => {
    Object.assign(mocks, state)

    expect(await trackFromAppsPage(EVENT, RUN)).toBe(false)

    expect(mocks.capture).not.toHaveBeenCalled()
  })

  it.each([
    ['app_opened, which Desktop sends itself', { name: 'app_opened', props: { app: 'genjutsu' } }],
    [
      'an event it does not know',
      { name: 'run_finished', props: { app: 'genjutsu', where: 'cloud' } }
    ],
    ['a payload with no name', { props: { app: 'genjutsu', where: 'cloud' } }],
    ['a payload that is not an object', 'run_started'],
    ['no payload', undefined]
  ])('drops %s', async (_what, payload) => {
    expect(await trackFromAppsPage(EVENT, payload)).toBe(false)

    expect(mocks.capture).not.toHaveBeenCalled()
  })

  it('drops bad and unknown properties before sending', async () => {
    await trackFromAppsPage(EVENT, {
      name: 'run_started',
      props: {
        app: 'genjutsu',
        where: 'cloud',
        model: 'Not A Slug',
        quality: 'ultra',
        seconds: -1,
        prompt: 'a cat on the moon',
        file: '/Users/someone/me.png'
      }
    })

    expect(mocks.capture).toHaveBeenCalledWith('comfy.desktop.apps.run_started', {
      app_id: 'genjutsu',
      where: 'cloud'
    })
  })

  it('drops an event whose app or required property is bad', async () => {
    await trackFromAppsPage(EVENT, {
      name: 'run_started',
      props: { app: 'Genjutsu!', where: 'cloud' }
    })
    await trackFromAppsPage(EVENT, {
      name: 'open_in_comfyui',
      props: { app: 'genjutsu', where: 'web' }
    })
    await trackFromAppsPage(EVENT, { name: 'example_used', props: { app: 'genjutsu' } })

    expect(mocks.capture).not.toHaveBeenCalled()
  })
})
