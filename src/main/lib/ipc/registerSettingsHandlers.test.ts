import { beforeEach, describe, expect, it, vi } from 'vitest'

// Configurable settings store returned by the mocked `./shared` module.
const mockSettings: Record<string, unknown> = {}
const mockSettingsSet = vi.fn((key: string, value: unknown) => {
  mockSettings[key] = value
})

// Stubbed seeding resolver. Held in an object so the vi.mock factory (hoisted
// above this file's statements) reads the value at call time, not at import.
const mockBeta = { resolved: false }

// Real English strings so label assertions catch missing locale keys (see
// lookupEnMessage). Dynamic import: vi.mock factories are hoisted, so they
// can't reference top-level static imports.
vi.mock('./shared', async () => {
  const { lookupEnMessage } = await import('../localeTestHelper')
  return {
    ipcMain: { handle: vi.fn(), on: vi.fn() },
    nativeTheme: {},
    sources: [],
    settings: {
      getAll: vi.fn(() => mockSettings),
      get: (key: string) => mockSettings[key],
      set: (key: string, value: unknown) => mockSettingsSet(key, value),
      getTrackedSettingsTelemetryProperties: () => ({}),
      resolveBetaFeaturesEnabled: () => mockBeta.resolved
    },
    i18n: {
      t: (key: string) => lookupEnMessage(key),
      getLocale: () => 'en',
      init: vi.fn(),
      getMessages: () => ({}),
      getAvailableLocales: () => [{ value: 'en', label: 'English' }]
    },
    getAppVersion: () => '0.0.0-test',
    resolveTheme: vi.fn(),
    _onLocaleChanged: vi.fn(),
    _onThemeChanged: vi.fn(),
    _broadcastToRenderer: vi.fn()
  }
})
vi.mock('../titleBarOverlay', () => ({ updateTitleBarOverlay: vi.fn() }))
vi.mock('../telemetry', () => ({
  capture: vi.fn(),
  setConsentState: vi.fn(),
  registerPersonProperties: vi.fn()
}))
vi.mock('../firstUseDetection', () => ({ detectFirstUseState: vi.fn() }))
vi.mock('../updater', () => ({ notifyAutoUpdateChanged: vi.fn() }))
vi.mock('../globalSettingsEvents', () => ({
  globalSettingsEvents: { on: vi.fn(), emit: vi.fn() }
}))
vi.mock('../e2eOverrides', () => ({ recordIpcInvocation: vi.fn() }))
// Values mirror src/main/settings.ts; mocked because the real module imports electron.
vi.mock('../../settings', () => ({ AUTO_LAUNCH_NONE: 'none', AUTO_LAUNCH_LAST: 'last' }))

import * as mainTelemetry from '../telemetry'
import { settings } from './shared'
import { applySettingSet, buildSettingsSections } from './registerSettingsHandlers'

function resetMockSettings(): void {
  for (const key of Object.keys(mockSettings)) delete mockSettings[key]
  mockSettingsSet.mockClear()
}

describe('buildSettingsSections', () => {
  beforeEach(() => {
    resetMockSettings()
    mockBeta.resolved = false
  })

  // Sourcing this from the raw setting would either re-seed on every read or
  // coerce an undefined store to ON; the resolver owns the one-time seed, so
  // the field must mirror the resolver even when the two disagree.
  it('sources the beta-features field from the seeding resolver', () => {
    mockSettings.betaFeaturesEnabled = false
    mockBeta.resolved = true

    const fields = buildSettingsSections().flatMap(
      (s) => (s.fields as { id?: string; value?: unknown; type?: string }[] | undefined) ?? []
    )

    expect(fields).toContainEqual(
      expect.objectContaining({
        id: 'betaFeaturesEnabled',
        label: 'Opt-in to beta features',
        type: 'boolean',
        value: true
      })
    )
  })

  it('reports the beta-features field as off when the resolver says off', () => {
    mockSettings.betaFeaturesEnabled = true
    mockBeta.resolved = false

    const fields = buildSettingsSections().flatMap(
      (s) => (s.fields as { id?: string; value?: unknown }[] | undefined) ?? []
    )

    expect(fields.find((f) => f.id === 'betaFeaturesEnabled')?.value).toBe(false)
  })

  it('does not offer the Manager security level globally (it is per-install)', () => {
    // The level is per-install, on each install's Startup Args tab
    // (buildLaunchSettingsFields); a global field silently overriding every
    // install's config.ini is the regression this pins against.
    const fields = buildSettingsSections().flatMap(
      (s) => (s.fields as { id?: string }[] | undefined) ?? []
    )
    expect(fields.map((f) => f.id)).not.toContain('managerSecurityLevel')
  })

  it('offers a default-on preference for the multiple-instance warning', () => {
    const fields = buildSettingsSections().flatMap(
      (s) => (s.fields as { id?: string; value?: unknown }[] | undefined) ?? []
    )

    expect(fields).toContainEqual(
      expect.objectContaining({
        id: 'warnBeforeRunningMultipleInstances',
        label: 'Warn before running multiple instances',
        type: 'boolean',
        value: true
      })
    )

    mockSettings.warnBeforeRunningMultipleInstances = false
    const updatedFields = buildSettingsSections().flatMap(
      (s) => (s.fields as { id?: string; value?: unknown }[] | undefined) ?? []
    )
    expect(
      updatedFields.find((field) => field.id === 'warnBeforeRunningMultipleInstances')?.value
    ).toBe(false)
  })

  it('offers hardware acceleration under Advanced with a restart notice', () => {
    const sections = buildSettingsSections()
    const generalFields =
      (sections.find((section) => section.title === 'General')?.fields as
        | { id?: string }[]
        | undefined) ?? []
    const advancedFields =
      (sections.find((section) => section.title === 'Advanced')?.fields as
        | { id?: string; value?: unknown; description?: string }[]
        | undefined) ?? []

    expect(generalFields.map((field) => field.id)).not.toContain('hardwareAcceleration')
    expect(advancedFields).toContainEqual(
      expect.objectContaining({
        id: 'hardwareAcceleration',
        label: 'Use hardware acceleration',
        type: 'boolean',
        value: true,
        description:
          'Uses the GPU to render Comfy Desktop. Restart Comfy Desktop for changes to take effect.'
      })
    )
    expect(advancedFields.at(-1)?.id).toBe('hardwareAcceleration')

    mockSettings.hardwareAcceleration = false
    const updatedFields = buildSettingsSections().find((section) => section.title === 'Advanced')
      ?.fields as { id?: string; value?: unknown }[]
    expect(updatedFields.find((field) => field.id === 'hardwareAcceleration')?.value).toBe(false)
  })
})

describe('applySettingSet beta enrolment consent', () => {
  beforeEach(resetMockSettings)

  it.each([
    [false, false],
    [undefined, undefined]
  ])(
    'rejects new beta enrolment when telemetry consent is %s without writing',
    (telemetryEnabled, betaFeaturesEnabled) => {
      mockSettings.betaFeaturesEnabled = betaFeaturesEnabled
      mockSettings.telemetryEnabled = telemetryEnabled

      applySettingSet('betaFeaturesEnabled', true)

      expect(mockSettingsSet).not.toHaveBeenCalled()
      expect(mockSettings.betaFeaturesEnabled).toBe(betaFeaturesEnabled)
    }
  )

  it('allows new beta enrolment with explicit telemetry consent', () => {
    mockSettings.betaFeaturesEnabled = false
    mockSettings.telemetryEnabled = true

    applySettingSet('betaFeaturesEnabled', true)

    expect(mockSettingsSet).toHaveBeenCalledWith('betaFeaturesEnabled', true)
    expect(mockSettings.betaFeaturesEnabled).toBe(true)
  })

  it('preserves an existing beta opt-in when telemetry is off', () => {
    mockSettings.betaFeaturesEnabled = true
    mockSettings.telemetryEnabled = false

    applySettingSet('betaFeaturesEnabled', true)

    expect(mockSettingsSet).toHaveBeenCalledWith('betaFeaturesEnabled', true)
    expect(mockSettings.betaFeaturesEnabled).toBe(true)
  })

  it('allows opting out of beta features when telemetry is off', () => {
    mockSettings.betaFeaturesEnabled = true
    mockSettings.telemetryEnabled = false

    applySettingSet('betaFeaturesEnabled', false)

    expect(mockSettingsSet).toHaveBeenCalledWith('betaFeaturesEnabled', false)
    expect(mockSettings.betaFeaturesEnabled).toBe(false)
  })
})

describe('applySettingSet settings.changed telemetry', () => {
  const capture = vi.mocked(mainTelemetry.capture)
  const changedEvents = (): unknown[] =>
    capture.mock.calls.filter(([event]) => event === 'comfy.desktop.settings.changed')

  beforeEach(() => {
    resetMockSettings()
    capture.mockClear()
  })

  it('emits the key and new boolean for a user edit', () => {
    mockSettings.autoUpdate = true

    applySettingSet('autoUpdate', false, true)

    expect(changedEvents()).toEqual([
      [
        'comfy.desktop.settings.changed',
        { install_id: undefined, setting_key: 'autoUpdate', bool_value: false }
      ]
    ])
  })

  it('emits nothing when a user edit leaves the value unchanged', () => {
    mockSettings.autoUpdate = true

    applySettingSet('autoUpdate', true, true)

    expect(changedEvents()).toEqual([])
  })

  it('emits nothing when a user re-picks the default an unset setting shows', () => {
    // Language is unset, so the field shows the app locale ('en' here); picking it again
    // stores it but is not a change from what the user saw.
    applySettingSet('language', 'en', true)

    expect(changedEvents()).toEqual([])
  })

  it('still writes when building the shown value throws', () => {
    vi.mocked(settings.getAll).mockImplementationOnce(() => {
      throw new Error('sections broke')
    })

    expect(() => applySettingSet('autoUpdate', false, true)).not.toThrow()
    expect(mockSettingsSet).toHaveBeenCalledWith('autoUpdate', false)
  })

  it('emits nothing when the store refuses the write', () => {
    // An unreadable settings.json makes `set` a no-op; nothing changed, so nothing is reported.
    mockSettings.autoUpdate = true
    mockSettingsSet.mockImplementationOnce(() => {})

    applySettingSet('autoUpdate', false, true)

    expect(changedEvents()).toEqual([])
  })

  it('emits nothing when whitespace in an empty text field leaves it unset', () => {
    // The field shows '' for an unset mirror; `set` keeps it unset, which still shows ''.
    mockSettingsSet.mockImplementationOnce((key: string) => {
      delete mockSettings[key]
    })

    applySettingSet('pypiMirror', '   ', true)

    expect(changedEvents()).toEqual([])
  })

  it('emits nothing for a write that is not a user edit', () => {
    // The bare set-setting IPC: first-use, announcement and coachmark flags.
    applySettingSet('comfyApiAnnouncementSeen', true)

    expect(changedEvents()).toEqual([])
  })

  it('emits nothing for the consent toggle', () => {
    mockSettings.telemetryEnabled = true

    applySettingSet('telemetryEnabled', false, true)

    expect(changedEvents()).toEqual([])
  })
})
