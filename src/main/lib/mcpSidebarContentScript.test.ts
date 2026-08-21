import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getMcpSidebarContentScript } from './mcpSidebarContentScript'

describe('getMcpSidebarContentScript', () => {
  const script = getMcpSidebarContentScript()

  const setupDom = (): void => {
    // Minimal left-toolbar shape: a bottom (.mt-auto) cluster with the help
    // button, which the script anchors off.
    document.body.innerHTML = `
      <nav data-testid="side-toolbar">
        <div class="top"></div>
        <div class="mt-auto">
          <button data-testid="help-center-button">?</button>
          <button data-testid="settings">gear</button>
        </div>
      </nav>
    `
  }

  const installBridge = (): {
    capture: ReturnType<typeof vi.fn>
    openMcpSetup: ReturnType<typeof vi.fn>
  } => {
    const capture = vi.fn()
    const openMcpSetup = vi.fn(() => Promise.resolve(true))
    Reflect.set(window, '__comfyDesktop2', { openMcpSetup, Telemetry: { capture } })
    return { capture, openMcpSetup }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    window.localStorage.clear()
  })

  afterEach(() => {
    const state = Reflect.get(window, '__comfyDesktopMcpSidebar') as
      | { observer?: MutationObserver }
      | undefined
    state?.observer?.disconnect()
    vi.clearAllTimers()
    vi.useRealTimers()
    document.body.innerHTML = ''
    window.localStorage.clear()
    Reflect.deleteProperty(window, '__comfyDesktop2')
    Reflect.deleteProperty(window, '__comfyDesktopMcpSidebar')
  })

  it('returns a syntactically valid, self-contained IIFE', () => {
    expect(script.startsWith('(function () {')).toBe(true)
    expect(() => new Function(script)).not.toThrow()
  })

  it('bails when the desktop MCP-setup opener is absent', () => {
    expect(script).toContain(`typeof window.__comfyDesktop2.openMcpSetup !== 'function'`)
  })

  it('guards against double injection', () => {
    expect(script).toContain('window.__comfyDesktopMcpSidebar')
  })

  it('injects the plug button into the bottom cluster, above the help icon', () => {
    installBridge()
    setupDom()
    new Function(script)()

    const btn = document.getElementById('comfy-desktop-mcp-btn')
    const help = document.querySelector('[data-testid="help-center-button"]')
    expect(btn).not.toBeNull()
    if (!btn || !help) throw new Error('Expected button and help icon')
    // Same cluster as help, and ordered before it.
    expect(btn.parentElement).toBe(help.parentElement)
    expect(btn.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(btn.querySelector('.icon-\\[lucide--plug\\]')).not.toBeNull()
  })

  it('shows the unseen dot until the surface is opened once', () => {
    installBridge()
    setupDom()
    new Function(script)()
    const dot = document.querySelector<HTMLElement>('#comfy-desktop-mcp-btn .comfy-mcp-dot')
    expect(dot?.style.display).not.toBe('none')
  })

  it('opens the modal on click, clears the dot, and persists seen', () => {
    const { openMcpSetup, capture } = installBridge()
    setupDom()
    new Function(script)()
    document.getElementById('comfy-desktop-mcp-btn')?.click()

    expect(openMcpSetup).toHaveBeenCalledOnce()
    expect(capture).toHaveBeenCalledWith('comfy.desktop.mcp.sidebar_opened', {})
    expect(window.localStorage.getItem('comfyDesktopMcpSeen')).toBe('1')
    const dot = document.querySelector<HTMLElement>('#comfy-desktop-mcp-btn .comfy-mcp-dot')
    expect(dot?.style.display).toBe('none')
  })

  it('hides the dot from the start when already seen', () => {
    window.localStorage.setItem('comfyDesktopMcpSeen', '1')
    installBridge()
    setupDom()
    new Function(script)()
    const dot = document.querySelector<HTMLElement>('#comfy-desktop-mcp-btn .comfy-mcp-dot')
    expect(dot?.style.display).toBe('none')
  })

  it('does not inject twice', () => {
    installBridge()
    setupDom()
    new Function(script)()
    Reflect.deleteProperty(window, '__comfyDesktopMcpSidebar')
    new Function(script)()
    expect(document.querySelectorAll('#comfy-desktop-mcp-btn')).toHaveLength(1)
  })

  it('memoizes the assembled script', () => {
    expect(getMcpSidebarContentScript()).toBe(script)
  })
})
