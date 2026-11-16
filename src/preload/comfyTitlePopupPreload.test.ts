import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  send: vi.fn()
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mocks.exposeInMainWorld },
  ipcRenderer: {
    invoke: mocks.invoke,
    on: mocks.on,
    removeListener: mocks.removeListener,
    send: mocks.send
  }
}))

import './comfyTitlePopupPreload'
import type { ComfyTitlePopupBridge } from './comfyTitlePopupPreload'
import type { GlobalSettingsSnapshot } from '../types/titlePopup'

const GLOBAL_SETTINGS_CHANNEL = 'comfy-titlepopup:global-settings-changed'

function popupBridge(): ComfyTitlePopupBridge {
  const exposed = mocks.exposeInMainWorld.mock.calls[0]?.[1]
  return (exposed ??
    (globalThis as Record<string, unknown>)['__comfyTitlePopup']) as ComfyTitlePopupBridge
}

function validSnapshot(): GlobalSettingsSnapshot {
  return {
    initialTab: null,
    highlightFieldId: null,
    languageFields: [],
    generalFields: [],
    telemetryFields: [],
    desktopUpdateFields: [],
    cacheFields: [],
    advancedFields: [],
    sharedDirectoriesFields: [],
    installLocationFields: [],
    modelsDirs: [],
    modelsSystemDefault: '',
    telemetryGranted: false,
    appUpdate: {
      state: {},
      progress: null,
      isDownloading: false,
      capabilities: { systemManaged: false, canSelfUpdate: true },
      installedVersion: '0.0.0-test',
      platform: 'linux',
      lastCheckedAt: null
    },
    githubUrl: '',
    githubStars: null,
    githubStarsLoading: false,
    i18n: {
      overview: '',
      updates: '',
      storage: '',
      models: '',
      advanced: '',
      logs: '',
      sharedDirectories: ''
    }
  }
}

function deliver(payload: unknown): unknown[] {
  const received: unknown[] = []
  popupBridge().onGlobalSettingsSnapshot((snapshot) => received.push(snapshot))
  const handler = mocks.on.mock.calls.find(([channel]) => channel === GLOBAL_SETTINGS_CHANNEL)?.[1]
  expect(handler).toBeTypeOf('function')
  ;(handler as (event: unknown, data: unknown) => void)(undefined, payload)
  return received
}

describe('global-settings snapshot guard', () => {
  beforeEach(() => {
    mocks.on.mockClear()
  })

  it('accepts a snapshot carrying a boolean telemetryGranted', () => {
    const snapshot = validSnapshot()
    snapshot.telemetryGranted = true

    expect(deliver(snapshot)).toEqual([snapshot])
  })

  it('rejects a snapshot with telemetryGranted missing', () => {
    const { telemetryGranted: _dropped, ...withoutGrant } = validSnapshot()

    expect(deliver(withoutGrant)).toEqual([])
  })

  it('rejects a truthy non-boolean telemetryGranted', () => {
    expect(deliver({ ...validSnapshot(), telemetryGranted: 'true' })).toEqual([])
  })

  it('rejects a null telemetryGranted', () => {
    expect(deliver({ ...validSnapshot(), telemetryGranted: null })).toEqual([])
  })

  it('still rejects snapshots that fail the pre-existing field checks', () => {
    expect(deliver({ ...validSnapshot(), modelsSystemDefault: 7 })).toEqual([])
  })
})

describe('picker settings requests', () => {
  beforeEach(() => {
    mocks.invoke.mockClear()
    mocks.on.mockClear()
    mocks.removeListener.mockClear()
  })

  it('sends main the context a field-options request was made with', () => {
    void popupBridge().pickerSettingsGetFieldOptions(
      'standalone',
      'release',
      {},
      { includeLatestStable: true }
    )

    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      'comfy-titlepopup:picker-settings-get-field-options',
      {
        sourceId: 'standalone',
        fieldId: 'release',
        selections: {},
        context: { includeLatestStable: true }
      }
    )
  })

  it('tells a subscriber which setting changed, until it unsubscribes', () => {
    const changedKeys: string[] = []
    const unsubscribe = popupBridge().pickerSettingsOnSettingsChanged(({ key }) =>
      changedKeys.push(key)
    )
    const handler = mocks.on.mock.calls.find(([channel]) => channel === 'settings-changed')?.[1]
    expect(handler).toBeTypeOf('function')

    ;(handler as (event: unknown, data: unknown) => void)(undefined, {
      key: 'betaFeaturesEnabled'
    })
    unsubscribe()

    expect(changedKeys).toEqual(['betaFeaturesEnabled'])
    expect(mocks.removeListener).toHaveBeenCalledExactlyOnceWith('settings-changed', handler)
  })
})
