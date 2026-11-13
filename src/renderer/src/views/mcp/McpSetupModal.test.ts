import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import McpSetupModal from './McpSetupModal.vue'
import { emitTelemetryAction } from '../../lib/telemetry'
import { MCP_DOCS_URL } from './mcpSetup'

vi.mock('../../lib/telemetry', () => ({
  emitTelemetryAction: vi.fn()
}))

const openExternal = vi.fn(() => Promise.resolve())

function byTestId(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
  if (!el) throw new Error(`missing [data-testid="${id}"]`)
  return el
}

async function mountModal(port?: number) {
  const wrapper = mount(McpSetupModal, { props: { port }, attachTo: document.body })
  await flushPromises()
  return wrapper
}

async function choosePath(label: string): Promise<void> {
  const item = Array.from(
    byTestId('mcp-setup-path').querySelectorAll<HTMLButtonElement>('button')
  ).find((button) => button.textContent?.trim() === label)
  item!.click()
  await flushPromises()
}

beforeEach(() => {
  vi.mocked(emitTelemetryAction).mockClear()
  openExternal.mockClear()
  window.api = { openExternal } as unknown as typeof window.api
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('McpSetupModal', () => {
  it('opens on "I have an agent" with both ways to connect for this build', async () => {
    await mountModal(8231)
    expect(byTestId('mcp-option-agent').textContent).toContain('Add it to Claude Code')
    expect(byTestId('mcp-option-terminal').textContent).toContain('Or run it in the Comfy terminal')
    expect(document.body.textContent).toContain('COMFY_LOCAL_URL=http://127.0.0.1:8231')
    expect(document.querySelector('[data-testid="mcp-agents"]')).toBeNull()
  })

  it('reports which snippet was copied', async () => {
    await mountModal(8188)
    byTestId('mcp-copy-install').click()
    byTestId('mcp-copy-claude-code').click()
    byTestId('mcp-copy-terminal').click()
    byTestId('mcp-copy-json').click()
    await flushPromises()
    for (const client of ['install', 'claude_code', 'terminal', 'json']) {
      expect(emitTelemetryAction).toHaveBeenCalledWith('comfy.desktop.mcp.snippet_copied', {
        client
      })
    }
  })

  it('opens the terminal and closes from the terminal path', async () => {
    const wrapper = await mountModal(8188)
    byTestId('mcp-open-terminal').click()
    await flushPromises()
    expect(wrapper.emitted('openTerminal')).toHaveLength(1)
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(emitTelemetryAction).toHaveBeenCalledWith('comfy.desktop.mcp.terminal_opened', {})
  })

  it('lists agent install guides on "I need one" and opens them outside the app', async () => {
    await mountModal(8188)
    await choosePath('I need one')
    expect(emitTelemetryAction).toHaveBeenCalledWith('comfy.desktop.mcp.path_selected', {
      path: 'no_agent'
    })
    expect(document.querySelector('[data-testid="mcp-option-agent"]')).toBeNull()
    byTestId('mcp-agent-cursor').click()
    expect(openExternal).toHaveBeenCalledWith('https://docs.cursor.com/get-started/installation')
    expect(emitTelemetryAction).toHaveBeenCalledWith('comfy.desktop.mcp.docs_opened', {
      target: 'cursor'
    })

    await choosePath('I have an agent')
    expect(byTestId('mcp-option-agent')).toBeTruthy()
  })

  it('opens the docs and closes from the X', async () => {
    const wrapper = await mountModal(8188)
    byTestId('mcp-docs').click()
    expect(openExternal).toHaveBeenCalledWith(MCP_DOCS_URL)
    byTestId('mcp-setup-close').click()
    await flushPromises()
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(emitTelemetryAction).toHaveBeenCalledWith('comfy.desktop.mcp.panel_dismissed', {})
  })
})
