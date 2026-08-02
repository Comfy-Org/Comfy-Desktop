import { describe, expect, it } from 'vitest'
import { getComfyTerminalContentScript } from './comfyTerminalContentScript'

describe('getComfyTerminalContentScript', () => {
  const script = getComfyTerminalContentScript()

  it('returns a syntactically valid, self-contained IIFE', () => {
    expect(script.startsWith('(function () {')).toBe(true)
    // Throws on a syntax error in the assembled string (escaping bugs, etc.).
    expect(() => new Function(script)).not.toThrow()
  })

  it('bails when the desktop terminal opener is absent', () => {
    expect(script).toContain(`typeof window.__comfyDesktop2.openTerminal !== 'function'`)
  })

  it('guards against double injection', () => {
    expect(script).toContain('window.__comfyDesktopTerminalStopgap')
  })

  it('registers a custom bottom-panel tab through the extension API', () => {
    expect(script).toContain('registerExtension')
    expect(script).toContain('bottomPanelTabs')
    expect(script).toContain(`type: 'custom'`)
    expect(script).toContain(`id: 'command-terminal'`)
    expect(script).toContain(`title: 'Terminal'`)
  })

  it('waits for the native Logs tab so Terminal registers second', () => {
    expect(script).toContain('logs-terminal')
    expect(script).toContain('extensionManager')
  })

  it('dedupes the native Terminal tab via the bottom-panel store', () => {
    // The frontend registers 'command-terminal' directly into the
    // bottom-panel store, so the guard must inspect that shape (not just
    // app.extensions) or it would register a duplicate tab.
    expect(script).toContain('bottomPanelHasTab')
    expect(script).toContain(`bottomPanelHasTab(app, 'command-terminal')`)
  })

  it('opens the trusted Desktop terminal without exposing PTY operations', () => {
    expect(script).toContain('window.__comfyDesktop2.openTerminal()')
    for (const member of ['terminal-write', 'terminal-resize', 'terminal-restart']) {
      expect(script).not.toContain(member)
    }
  })

  it('memoizes the assembled script', () => {
    expect(getComfyTerminalContentScript()).toBe(script)
  })
})
