import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getMcpSidebarContentScript } from './mcpSidebarContentScript'

describe('getMcpSidebarContentScript', () => {
  const script = getMcpSidebarContentScript()

  const setupDom = (): void => {
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

  it('injects nothing when the desktop MCP-setup opener is absent', () => {
    Reflect.set(window, '__comfyDesktop2', { Telemetry: { capture: vi.fn() } })
    setupDom()
    new Function(script)()
    expect(
      document.getElementById('comfy-desktop-mcp-btn'),
      'must bail before injecting when openMcpSetup is missing'
    ).toBeNull()
    expect(Reflect.get(window, '__comfyDesktopMcpSidebar')).toBeUndefined()
  })

  it('the re-entry guard stops a second run from re-injecting', () => {
    installBridge()
    setupDom()
    new Function(script)()
    document.getElementById('comfy-desktop-mcp-btn')?.remove()
    new Function(script)()
    expect(
      document.getElementById('comfy-desktop-mcp-btn'),
      'STATE persists, so a second run bails at the top-level guard'
    ).toBeNull()
  })

  it('injects the plug button into the bottom cluster, above the help icon', () => {
    installBridge()
    setupDom()
    new Function(script)()

    const btn = document.getElementById('comfy-desktop-mcp-btn')
    const help = document.querySelector('[data-testid="help-center-button"]')
    expect(btn).not.toBeNull()
    if (!btn || !help) throw new Error('Expected button and help icon')
    expect(btn.parentElement, 'same cluster as help').toBe(help.parentElement)
    expect(
      btn.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING,
      'ordered before help'
    ).toBeTruthy()
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

  it('falls back to the .mt-auto cluster when the help button is absent', () => {
    installBridge()
    document.body.innerHTML = `
      <nav data-testid="side-toolbar"><div class="mt-auto"><button>gear</button></div></nav>
    `
    new Function(script)()
    const btn = document.getElementById('comfy-desktop-mcp-btn')
    expect(btn).not.toBeNull()
    expect(btn?.parentElement?.className).toBe('mt-auto')
  })

  it('re-injects via the observer when the toolbar re-renders the button away', async () => {
    installBridge()
    setupDom()
    new Function(script)()
    expect(document.getElementById('comfy-desktop-mcp-btn')).not.toBeNull()

    document.getElementById('comfy-desktop-mcp-btn')?.remove()
    document.querySelector('.mt-auto')?.appendChild(document.createElement('span'))
    await Promise.resolve()

    expect(document.getElementById('comfy-desktop-mcp-btn')).not.toBeNull()
  })

  it('memoizes the assembled script', () => {
    expect(getMcpSidebarContentScript()).toBe(script)
  })
})
