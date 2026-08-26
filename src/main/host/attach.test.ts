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

  // The finding: `getFlagAsync` can resolve up to ~10s later. If a detach /
  // hot-swap ran `_installCleanup` in the meantime it clears `attachActive`,
  // and because detach leaves `comfyContents` alive the destroyed check passes.
  // Without the attachActive gate this would inject into a detached / re-attached
  // view.
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
