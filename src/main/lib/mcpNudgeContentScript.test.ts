import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getMcpNudgeContentScript,
  MCP_NUDGE_DISMISSED_KEY,
  MCP_NUDGE_ELEMENT_ID
} from './mcpNudgeContentScript'

const NUDGE = `#${MCP_NUDGE_ELEMENT_ID}`

function installBridge(withOpener = true): {
  capture: ReturnType<typeof vi.fn>
  openMcpSetup: ReturnType<typeof vi.fn>
} {
  const capture = vi.fn()
  const openMcpSetup = vi.fn(() => Promise.resolve(true))
  Reflect.set(window, '__comfyDesktop2', {
    Telemetry: { capture },
    ...(withOpener && { openMcpSetup })
  })
  return { capture, openMcpSetup }
}

function runScript(): void {
  new Function(getMcpNudgeContentScript())()
}

function click(testId: string): void {
  document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!.click()
}

afterEach(() => {
  document.body.innerHTML = ''
  localStorage.clear()
  Reflect.deleteProperty(window, '__comfyDesktop2')
  Reflect.deleteProperty(window, '__comfyDesktopMcpNudge')
})

describe('getMcpNudgeContentScript', () => {
  it('shows the nudge once and reports it', () => {
    const { capture } = installBridge()
    runScript()
    runScript()
    expect(document.querySelectorAll(NUDGE)).toHaveLength(1)
    expect(document.querySelector(NUDGE)!.textContent).toContain(
      'Run this build from your AI agent'
    )
    expect(capture).toHaveBeenCalledWith('comfy.desktop.mcp.nudge_shown', {})
  })

  it('opens the setup modal from Connect and stays hidden after', () => {
    const { capture, openMcpSetup } = installBridge()
    runScript()
    click('mcp-nudge-connect')
    expect(openMcpSetup).toHaveBeenCalledOnce()
    expect(capture).toHaveBeenCalledWith('comfy.desktop.mcp.panel_opened', { entrypoint: 'nudge' })
    expect(document.querySelector(NUDGE)).toBeNull()
    expect(localStorage.getItem(MCP_NUDGE_DISMISSED_KEY)).toBe('1')
  })

  it('stays hidden on the next load once dismissed', () => {
    const { capture } = installBridge()
    runScript()
    click('mcp-nudge-dismiss')
    expect(capture).toHaveBeenCalledWith('comfy.desktop.mcp.nudge_dismissed', {})
    expect(document.querySelector(NUDGE)).toBeNull()

    Reflect.deleteProperty(window, '__comfyDesktopMcpNudge')
    runScript()
    expect(document.querySelector(NUDGE)).toBeNull()
  })

  it('does nothing on a desktop build without the setup opener', () => {
    installBridge(false)
    runScript()
    expect(document.querySelector(NUDGE)).toBeNull()
  })
})
