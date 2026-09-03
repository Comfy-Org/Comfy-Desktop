import { beforeEach, describe, expect, it, vi } from 'vitest'

// Configurable settings store returned by the mocked `./shared` module.
const mockSettings: Record<string, unknown> = {}

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
      getAll: () => mockSettings,
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
vi.mock('../telemetry', () => ({}))
vi.mock('../firstUseDetection', () => ({ detectFirstUseState: vi.fn() }))
vi.mock('../updater', () => ({}))
vi.mock('../globalSettingsEvents', () => ({
  globalSettingsEvents: { on: vi.fn(), emit: vi.fn() }
}))
vi.mock('../e2eOverrides', () => ({ recordIpcInvocation: vi.fn() }))
// Values mirror src/main/settings.ts; mocked because the real module imports electron.
vi.mock('../../settings', () => ({ AUTO_LAUNCH_NONE: 'none', AUTO_LAUNCH_LAST: 'last' }))

import { buildSettingsSections } from './registerSettingsHandlers'

describe('buildSettingsSections', () => {
  beforeEach(() => {
    for (const key of Object.keys(mockSettings)) delete mockSettings[key]
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
        label: 'Opt in to beta features',
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
