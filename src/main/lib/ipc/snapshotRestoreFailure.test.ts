import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
    getVersion: () => '0.0.0-test',
    getLocale: () => 'en'
  },
  ipcMain: { handle: vi.fn(), on: vi.fn(), off: vi.fn() },
  dialog: {},
  shell: {},
  WebContentsView: class {},
  BrowserWindow: { getAllWindows: () => [] },
  nativeTheme: { on: vi.fn(), shouldUseDarkColors: false }
}))

vi.mock('../i18n', () => ({
  t: (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key
}))

vi.mock('../logsBroadcast', () => ({
  appendLog: vi.fn(() => {
    throw new Error('disk full')
  })
}))

import { snapshotRestoreFailureResult } from './shared'
import { appendLog } from '../logsBroadcast'

describe('snapshotRestoreFailureResult', () => {
  it('returns the failure result even when the diagnostic log write throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const result = snapshotRestoreFailureResult('install-1', 'restore exploded')
      expect(appendLog).toHaveBeenCalled()
      expect(result.ok).toBe(false)
      expect(result.message).toContain('restore exploded')
    } finally {
      warn.mockRestore()
    }
  })
})
