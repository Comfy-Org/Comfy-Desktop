import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getMcpNudgeContentScript } from './mcpNudgeContentScript'

describe('getMcpNudgeContentScript', () => {
  const script = getMcpNudgeContentScript()

  const installBridge = (): { capture: ReturnType<typeof vi.fn>; openTerminal: ReturnType<typeof vi.fn> } => {
    const capture = vi.fn()
    const openTerminal = vi.fn(() => Promise.resolve(true))
    Reflect.set(window, '__comfyDesktop2', {
      openTerminal,
      Telemetry: { capture }
    })
    return { capture, openTerminal }
  }

  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    document.body.innerHTML = ''
    window.localStorage.clear()
    Reflect.deleteProperty(window, '__comfyDesktop2')
    Reflect.deleteProperty(window, '__comfyDesktopMcpNudge')
  })

  it('returns a syntactically valid, self-contained IIFE', () => {
    expect(script.startsWith('(function () {')).toBe(true)
    expect(() => new Function(script)).not.toThrow()
  })

  it('bails when the desktop terminal opener is absent', () => {
    expect(script).toContain(`typeof window.__comfyDesktop2.openTerminal !== 'function'`)
  })

  it('guards against double injection', () => {
    expect(script).toContain('window.__comfyDesktopMcpNudge')
  })

  it('shows the nudge and fires nudge_shown once', () => {
    const { capture } = installBridge()
    new Function(script)()

    expect(document.getElementById('comfy-desktop-mcp-nudge')).not.toBeNull()
    expect(capture).toHaveBeenCalledWith('comfy.desktop.mcp.nudge_shown', {})
  })

  it('stays dismissed across re-injection once closed', () => {
    installBridge()
    new Function(script)()
    const close = document.querySelector<HTMLButtonElement>(
      '#comfy-desktop-mcp-nudge [aria-label="Dismiss"]'
    )
    if (!close) throw new Error('Expected dismiss button')
    close.click()
    expect(document.getElementById('comfy-desktop-mcp-nudge')).toBeNull()

    Reflect.deleteProperty(window, '__comfyDesktopMcpNudge')
    new Function(script)()
    expect(document.getElementById('comfy-desktop-mcp-nudge')).toBeNull()
  })

  it('opens the setup panel from the nudge and reports panel_opened', () => {
    const { capture } = installBridge()
    new Function(script)()
    const connect = Array.from(
      document.querySelectorAll<HTMLButtonElement>('#comfy-desktop-mcp-nudge button')
    ).find((b) => b.textContent === 'Connect')
    if (!connect) throw new Error('Expected Connect button')
    connect.click()

    expect(document.getElementById('comfy-desktop-mcp-panel')).not.toBeNull()
    expect(capture).toHaveBeenCalledWith('comfy.desktop.mcp.panel_opened', { entrypoint: 'nudge' })
  })

  it('copies a connect snippet and tags the client', () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true
    })
    const { capture } = installBridge()
    new Function(script)()
    document
      .querySelector<HTMLButtonElement>('#comfy-desktop-mcp-nudge button:nth-child(2)')
      ?.click()

    const copy = Array.from(
      document.querySelectorAll<HTMLButtonElement>('#comfy-desktop-mcp-panel button')
    ).find((b) => b.textContent === 'Copy')
    if (!copy) throw new Error('Expected a Copy button')
    copy.click()

    expect(writeText).toHaveBeenCalledWith('pip install comfy-mcp')
    expect(capture).toHaveBeenCalledWith('comfy.desktop.mcp.snippet_copied', { client: 'install' })
  })

  it('opens the terminal and records the have_agent path', () => {
    const { capture, openTerminal } = installBridge()
    new Function(script)()
    document
      .querySelector<HTMLButtonElement>('#comfy-desktop-mcp-nudge button:nth-child(2)')
      ?.click()

    const open = Array.from(
      document.querySelectorAll<HTMLButtonElement>('#comfy-desktop-mcp-panel button')
    ).find((b) => b.textContent === 'Open terminal')
    if (!open) throw new Error('Expected Open terminal button')
    open.click()

    expect(openTerminal).toHaveBeenCalledOnce()
    expect(capture).toHaveBeenCalledWith('comfy.desktop.mcp.path_selected', { path: 'have_agent' })
    expect(document.getElementById('comfy-desktop-mcp-panel')).toBeNull()
  })

  it('memoizes the assembled script', () => {
    expect(getMcpNudgeContentScript()).toBe(script)
  })
})
