import fs from 'fs'
import path from 'path'
import { describe, expect, it, vi } from 'vitest'

// Real English strings so label assertions catch missing locale keys.
const enMessages = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../../locales/en.json'), 'utf-8')
) as Record<string, unknown>

function lookup(key: string): string {
  let val: unknown = enMessages
  for (const part of key.split('.')) {
    if (val == null || typeof val !== 'object') return key
    val = (val as Record<string, unknown>)[part]
  }
  return typeof val === 'string' ? val : key
}

// Configurable settings store returned by the mocked `./shared` module.
const mockSettings: Record<string, unknown> = {}

vi.mock('./shared', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  nativeTheme: {},
  sources: [],
  settings: { getAll: () => mockSettings },
  i18n: {
    t: (key: string) => lookup(key),
    getLocale: () => 'en',
    getAvailableLocales: () => [{ value: 'en', label: 'English' }]
  },
  getAppVersion: () => '0.0.0-test',
  resolveTheme: vi.fn(),
  _onLocaleChanged: vi.fn(),
  _onThemeChanged: vi.fn(),
  _broadcastToRenderer: vi.fn()
}))
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
  it('does not offer the Manager security level globally (it is per-install)', () => {
    // The level moved to each install's Startup Args tab
    // (buildLaunchSettingsFields); a global field silently overriding every
    // install's config.ini is the regression this pins against.
    const fields = buildSettingsSections().flatMap(
      (s) => (s.fields as { id?: string }[] | undefined) ?? []
    )
    expect(fields.map((f) => f.id)).not.toContain('managerSecurityLevel')
  })
})
