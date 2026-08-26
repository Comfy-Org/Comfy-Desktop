import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
    getVersion: () => '0.0.0-test',
    getLocale: () => 'en',
    on: () => {}
  },
  ipcMain: { handle: vi.fn(), on: vi.fn(), off: vi.fn() },
  dialog: { showMessageBox: vi.fn() },
  shell: {},
  WebContentsView: class {},
  BrowserWindow: { getAllWindows: () => [] },
  nativeTheme: { on: vi.fn(), shouldUseDarkColors: false }
}))

import { shouldInjectMcpSidebar } from './attach'

describe('shouldInjectMcpSidebar', () => {
  it('injects when the attach is live, the flag is enabled, and the view is alive', () => {
    expect(shouldInjectMcpSidebar({ attachActive: true, enabled: true, destroyed: false })).toBe(
      true
    )
  })
  it('does not inject when the attach was retired before the flag resolved', () => {
    expect(shouldInjectMcpSidebar({ attachActive: false, enabled: true, destroyed: false })).toBe(
      false
    )
  })

  it('does not inject when the flag resolved disabled', () => {
    expect(shouldInjectMcpSidebar({ attachActive: true, enabled: false, destroyed: false })).toBe(
      false
    )
  })

  it('does not inject when the view was destroyed', () => {
    expect(shouldInjectMcpSidebar({ attachActive: true, enabled: true, destroyed: true })).toBe(
      false
    )
  })
})
