import { beforeEach, describe, expect, it, vi } from 'vitest'

// Configurable settings store returned by the mocked `./shared` module.
const mockSettings: Record<string, unknown> = {}

// Real English strings so label assertions catch missing locale keys (see
// lookupEnMessage). Dynamic import: vi.mock factories are hoisted, so they
// can't reference top-level static imports.
vi.mock('./shared', async () => {
  const { lookupEnMessage } = await import('../localeTestHelper')
  return {
    ipcMain: { handle: vi.fn(), on: vi.fn() },
    nativeTheme: {},
    sources: [],
    settings: { getAll: () => mockSettings },
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

  it('offers an hfMirror text field in Advanced beside pypiMirror', () => {
    const advancedFields =
      (buildSettingsSections().find((section) => section.title === 'Advanced')
        ?.fields as
        | { id?: string; value?: unknown; description?: string }[]
        | undefined) ?? []

    expect(advancedFields).toContainEqual(
      expect.objectContaining({
        id: 'hfMirror',
        label: 'HuggingFace Mirror URL',
        type: 'text',
        value: '',
        description:
          'Optional mirror for HuggingFace downloads. When set, the spawned ComfyUI process is launched with HF_ENDPOINT pointing at this URL.'
      })
    )

    const pypiIndex = advancedFields.findIndex((f) => f.id === 'pypiMirror')
    const hfIndex = advancedFields.findIndex((f) => f.id === 'hfMirror')
    expect(pypiIndex).toBeGreaterThanOrEqual(0)
    expect(hfIndex).toBe(pypiIndex + 1)

    mockSettings.hfMirror = 'https://hf-mirror.com'
    const updatedFields = buildSettingsSections().find((section) => section.title === 'Advanced')
      ?.fields as { id?: string; value?: unknown }[]
    expect(updatedFields.find((field) => field.id === 'hfMirror')?.value).toBe(
      'https://hf-mirror.com'
    )
  })
})
