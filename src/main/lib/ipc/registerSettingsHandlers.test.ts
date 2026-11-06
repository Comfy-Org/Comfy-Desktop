import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSettings: Record<string, unknown> = {}
const mockSettingsSet = vi.fn((key: string, value: unknown) => {
  mockSettings[key] = value
})

const mockBeta = { resolved: false }

vi.mock('./shared', async () => {
  const { lookupEnMessage } = await import('../localeTestHelper')
  return {
    ipcMain: { handle: vi.fn(), on: vi.fn() },
    nativeTheme: {},
    sources: [],
    settings: {
      getAll: () => mockSettings,
      get: (key: string) => mockSettings[key],
      set: (key: string, value: unknown) => mockSettingsSet(key, value),
      getTrackedSettingsTelemetryProperties: () => ({}),
      resolveBetaFeaturesEnabled: () => mockBeta.resolved
    },
    i18n: {
      t: (key: string) => lookupEnMessage(key),
      getLocale: () => 'en',
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
  setConsentState: vi.fn(),
  registerPersonProperties: vi.fn()
}))
vi.mock('../firstUseDetection', () => ({ detectFirstUseState: vi.fn() }))
vi.mock('../updater', () => ({ notifyAutoUpdateChanged: vi.fn() }))
vi.mock('../globalSettingsEvents', () => ({
  globalSettingsEvents: { on: vi.fn(), emit: vi.fn() }
}))
vi.mock('../e2eOverrides', () => ({ recordIpcInvocation: vi.fn() }))
vi.mock('../../settings', () => ({ AUTO_LAUNCH_NONE: 'none', AUTO_LAUNCH_LAST: 'last' }))

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
    const fields = buildSettingsSections().flatMap(
      (s) => (s.fields as { id?: string }[] | undefined) ?? []
    )
    expect(fields.map((f) => f.id)).not.toContain('managerSecurityLevel')
  })

  it('offers a default-on preference for the multiple-build warning', () => {
    const fields = buildSettingsSections().flatMap(
      (s) => (s.fields as { id?: string; value?: unknown }[] | undefined) ?? []
    )

    expect(fields).toContainEqual(
      expect.objectContaining({
        id: 'warnBeforeRunningMultipleInstances',
        label: 'Warn before running multiple builds',
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
