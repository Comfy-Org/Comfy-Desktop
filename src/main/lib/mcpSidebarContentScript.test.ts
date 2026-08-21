import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getMcpSidebarContentScript } from './mcpSidebarContentScript'

describe('getMcpSidebarContentScript', () => {
  const script = getMcpSidebarContentScript()

  type SidebarTab = {
    id: string
    icon: string
    type: string
    iconBadge: () => string | null
    render: () => void
  }

  const setupComfy = (): {
    capture: ReturnType<typeof vi.fn>
    openMcpSetup: ReturnType<typeof vi.fn>
    toggleSidebarTab: ReturnType<typeof vi.fn>
    tabs: SidebarTab[]
  } => {
    const capture = vi.fn()
    const openMcpSetup = vi.fn(() => Promise.resolve(true))
    const toggleSidebarTab = vi.fn()
    const tabs: SidebarTab[] = []
    Reflect.set(window, '__comfyDesktop2', { openMcpSetup, Telemetry: { capture } })
    Reflect.set(window, 'comfyAPI', {
      app: {
        app: {
          extensionManager: {
            registerSidebarTab: (tab: SidebarTab) => tabs.push(tab),
            getSidebarTabs: () => tabs,
            toggleSidebarTab
          }
        }
      }
    })
    return { capture, openMcpSetup, toggleSidebarTab, tabs }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    window.localStorage.clear()
    Reflect.deleteProperty(window, '__comfyDesktop2')
    Reflect.deleteProperty(window, 'comfyAPI')
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

  it('registers a plug sidebar tab through the extension manager', () => {
    const { tabs } = setupComfy()
    new Function(script)()
    expect(tabs).toHaveLength(1)
    expect(tabs[0]!.id).toBe('comfy-desktop-mcp')
    expect(tabs[0]!.icon).toBe('icon-[lucide--plug]')
    expect(tabs[0]!.type).toBe('custom')
  })

  it('shows the unseen dot until the surface is opened once', () => {
    const { tabs } = setupComfy()
    new Function(script)()
    expect(tabs[0]!.iconBadge()).toBe('•')
  })

  it('opens the desktop modal on select, clears the dot, and closes the phantom panel', () => {
    const { openMcpSetup, toggleSidebarTab, capture, tabs } = setupComfy()
    new Function(script)()
    tabs[0]!.render()
    vi.runAllTimers()

    expect(openMcpSetup).toHaveBeenCalledOnce()
    expect(toggleSidebarTab).toHaveBeenCalledWith('comfy-desktop-mcp')
    expect(capture).toHaveBeenCalledWith('comfy.desktop.mcp.sidebar_opened', {})
    expect(window.localStorage.getItem('comfyDesktopMcpSeen')).toBe('1')
    expect(tabs[0]!.iconBadge()).toBeNull()
  })

  it('does not re-register when the tab already exists', () => {
    const { tabs } = setupComfy()
    new Function(script)()
    Reflect.deleteProperty(window, '__comfyDesktopMcpSidebar')
    new Function(script)()
    expect(tabs).toHaveLength(1)
  })

  it('memoizes the assembled script', () => {
    expect(getMcpSidebarContentScript()).toBe(script)
  })
})
