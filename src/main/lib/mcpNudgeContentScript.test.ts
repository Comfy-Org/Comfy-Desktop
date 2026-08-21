import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getMcpNudgeContentScript } from './mcpNudgeContentScript'

describe('getMcpNudgeContentScript', () => {
  const script = getMcpNudgeContentScript()

  const installBridge = (): {
    capture: ReturnType<typeof vi.fn>
    openMcpSetup: ReturnType<typeof vi.fn>
  } => {
    const capture = vi.fn()
    const openMcpSetup = vi.fn(() => Promise.resolve(true))
    Reflect.set(window, '__comfyDesktop2', {
      openMcpSetup,
      Telemetry: { capture }
    })
    return { capture, openMcpSetup }
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    document.body.innerHTML = ''
    Reflect.deleteProperty(window, '__comfyDesktop2')
    Reflect.deleteProperty(window, '__comfyDesktopMcpNudge')
  })

  it('returns a syntactically valid, self-contained IIFE', () => {
    expect(script.startsWith('(function () {')).toBe(true)
    expect(() => new Function(script)).not.toThrow()
  })

  it('bails when the desktop MCP-setup opener is absent', () => {
    expect(script).toContain(`typeof window.__comfyDesktop2.openMcpSetup !== 'function'`)
  })

  it('guards against double injection', () => {
    expect(script).toContain('window.__comfyDesktopMcpNudge')
  })

  it('shows the branded banner and fires nudge_shown once', () => {
    const { capture } = installBridge()
    new Function(script)()

    const nudge = document.getElementById('comfy-desktop-mcp-nudge')
    expect(nudge).not.toBeNull()
    expect(nudge?.textContent).toContain('Comfy has an MCP')
    expect(capture).toHaveBeenCalledWith('comfy.desktop.mcp.nudge_shown', {})
  })

  it('uses the brand yellow on the CTA', () => {
    installBridge()
    new Function(script)()
    const connect = Array.from(
      document.querySelectorAll<HTMLButtonElement>('#comfy-desktop-mcp-nudge button')
    ).find((b) => b.textContent === 'CONNECT')
    if (!connect) throw new Error('Expected Connect button')
    expect(connect.style.background.replace(/\s/g, '')).toBe('#f2ff59')
  })

  it('opens the desktop MCP setup modal from Connect and reports panel_opened', () => {
    const { capture, openMcpSetup } = installBridge()
    new Function(script)()
    const connect = Array.from(
      document.querySelectorAll<HTMLButtonElement>('#comfy-desktop-mcp-nudge button')
    ).find((b) => b.textContent === 'CONNECT')
    if (!connect) throw new Error('Expected Connect button')
    connect.click()

    expect(openMcpSetup).toHaveBeenCalledOnce()
    expect(capture).toHaveBeenCalledWith('comfy.desktop.mcp.panel_opened', { entrypoint: 'nudge' })
    // Banner removes itself once the modal is requested.
    expect(document.getElementById('comfy-desktop-mcp-nudge')).toBeNull()
  })

  it('dismisses for the session and re-shows on the next injection', () => {
    const { capture } = installBridge()
    new Function(script)()
    const close = document.querySelector<HTMLButtonElement>(
      '#comfy-desktop-mcp-nudge [aria-label="Dismiss"]'
    )
    if (!close) throw new Error('Expected dismiss button')
    close.click()
    expect(document.getElementById('comfy-desktop-mcp-nudge')).toBeNull()
    expect(capture).toHaveBeenCalledWith('comfy.desktop.mcp.panel_dismissed', { stage: 'nudge' })

    Reflect.deleteProperty(window, '__comfyDesktopMcpNudge')
    new Function(script)()
    expect(document.getElementById('comfy-desktop-mcp-nudge')).not.toBeNull()
  })

  it('memoizes the assembled script', () => {
    expect(getMcpNudgeContentScript()).toBe(script)
  })
})
