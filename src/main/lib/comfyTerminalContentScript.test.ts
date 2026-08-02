import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getComfyTerminalContentScript } from './comfyTerminalContentScript'

describe('getComfyTerminalContentScript', () => {
  const script = getComfyTerminalContentScript()

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    document.body.innerHTML = ''
    Reflect.deleteProperty(window, '__comfyDesktop2')
    Reflect.deleteProperty(window, '__comfyDesktopTerminalStopgap')
    Reflect.deleteProperty(window, 'comfyAPI')
  })

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

  it('adds working popout buttons for Terminal and Logs', () => {
    const openTerminalPopout = vi.fn()
    const openLogsPopout = vi.fn()
    Reflect.set(window, '__comfyDesktop2', {
      openTerminal: vi.fn(),
      Terminal: { openPopout: openTerminalPopout },
      Logs: { openPopout: openLogsPopout }
    })
    Reflect.set(window, 'comfyAPI', {
      app: {
        app: {
          extensions: [],
          extensionManager: {
            bottomPanel: {
              panels: {
                terminal: {
                  tabs: [{ id: 'logs-terminal' }, { id: 'command-terminal' }]
                }
              }
            }
          },
          registerExtension: vi.fn()
        }
      }
    })
    document.body.innerHTML = `
      <div>
        <button role="tab"><span>Logs</span></button>
        <button role="tab"><span>Terminal</span></button>
        <button aria-label="Close"></button>
      </div>
    `

    new Function(script)()

    const terminalButton = document.querySelector<HTMLButtonElement>(
      '[data-popout-kind="terminal"]'
    )
    const logsButton = document.querySelector<HTMLButtonElement>('[data-popout-kind="logs"]')
    if (!terminalButton || !logsButton) throw new Error('Expected popout buttons')
    terminalButton.click()
    logsButton.click()

    expect(openTerminalPopout).toHaveBeenCalledOnce()
    expect(openLogsPopout).toHaveBeenCalledOnce()
  })

  it('memoizes the assembled script', () => {
    expect(getComfyTerminalContentScript()).toBe(script)
  })
})
