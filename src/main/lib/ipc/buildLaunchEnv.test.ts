import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getPath: () => '/tmp',
    getVersion: () => '2.3.4',
    getLocale: () => 'en'
  },
  ipcMain: { handle: vi.fn(), on: vi.fn(), off: vi.fn() },
  dialog: {},
  shell: {},
  BrowserWindow: { getAllWindows: () => [] },
  nativeTheme: { on: vi.fn(), shouldUseDarkColors: false }
}))

import type { InstallationRecord } from '../../installations'
import { buildLaunchEnv } from './shared'

function inst(sourceId: string, envVars?: Record<string, string>): InstallationRecord {
  return {
    id: 'i1',
    name: 'test',
    createdAt: '2026-01-01T00:00:00.000Z',
    installPath: '/tmp/install',
    sourceId,
    ...(envVars ? { envVars } : {})
  } as InstallationRecord
}

describe('buildLaunchEnv __COMFYUI_DESKTOP_VERSION__', () => {
  it.each(['standalone', 'desktop', 'comfybuilder'])(
    'sets the app version for desktop-managed source %s',
    (sourceId) => {
      expect(buildLaunchEnv(inst(sourceId)).__COMFYUI_DESKTOP_VERSION__).toBe('2.3.4')
    }
  )

  it.each(['portable', 'git'])('leaves it unset for user-managed source %s', (sourceId) => {
    expect(buildLaunchEnv(inst(sourceId))).not.toHaveProperty('__COMFYUI_DESKTOP_VERSION__')
  })

  it('ignores a user env var override', () => {
    const env = buildLaunchEnv(inst('git', { __COMFYUI_DESKTOP_VERSION__: '9.9.9' }))
    expect(env).not.toHaveProperty('__COMFYUI_DESKTOP_VERSION__')
  })
})
