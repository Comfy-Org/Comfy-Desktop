import fs from 'fs'
import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Real English strings so label/tooltip assertions catch missing locale keys.
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
let mockSettings: Record<string, unknown> = {}

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
import { DEFAULT_MANAGER_SECURITY_LEVEL, MANAGER_SECURITY_LEVELS } from '../managerConfig'

interface SelectField {
  id: string
  label: string
  type: string
  value?: unknown
  options?: { value: string; label: string }[]
  tooltip?: string
}

function managerSecurityField(): { section: string; field: SelectField } {
  const sections = buildSettingsSections()
  for (const section of sections) {
    const field = (section.fields as SelectField[] | undefined)?.find(
      (f) => f.id === 'managerSecurityLevel'
    )
    if (field) return { section: section.title ?? '', field }
  }
  throw new Error('managerSecurityLevel field not found in any settings section')
}

describe('buildSettingsSections managerSecurityLevel', () => {
  beforeEach(() => {
    mockSettings = {}
  })

  it('renders a select in the Advanced section with the default value when unset', () => {
    const { section, field } = managerSecurityField()
    expect(section).toBe(lookup('settings.advanced'))
    expect(field.type).toBe('select')
    expect(field.value).toBe(DEFAULT_MANAGER_SECURITY_LEVEL)
  })

  it('uses the persisted setting as the current value', () => {
    mockSettings = { managerSecurityLevel: 'weak' }
    const { field } = managerSecurityField()
    expect(field.value).toBe('weak')
  })

  it('offers exactly the four security levels in order with localized labels', () => {
    const { field } = managerSecurityField()
    expect(field.options?.map((o) => o.value)).toEqual([...MANAGER_SECURITY_LEVELS])
    expect(field.options?.map((o) => o.label)).toEqual([
      'Strict',
      'Standard (recommended)',
      'Relaxed',
      'Permissive'
    ])
  })

  it('has a localized label and tooltip', () => {
    const { field } = managerSecurityField()
    expect(field.label).toBe('Manager security level')
    expect(field.tooltip).toBe(lookup('settings.managerSecurityLevelDescription'))
    // Guard against a raw key leaking into the UI if the locale entry is removed.
    expect(field.tooltip).not.toContain('settings.')
  })
})
