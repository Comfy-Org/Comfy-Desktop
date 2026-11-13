import { describe, expect, it } from 'vitest'
import { buildMcpSnippets } from './mcpSetup'

describe('buildMcpSnippets', () => {
  it('installs the comfy-cli engine with the server', () => {
    const { install, terminal } = buildMcpSnippets(8188)
    expect(install).toBe('pip install "comfy-cli>=1.14.0" comfy-mcp')
    expect(terminal.startsWith('pip install "comfy-cli>=1.14.0" comfy-mcp && ')).toBe(true)
  })

  it("points every snippet at this build's port", () => {
    const { register, json, terminal } = buildMcpSnippets(8231)
    expect(register).toBe(
      'claude mcp add comfy-mcp -e COMFY_LOCAL_URL=http://127.0.0.1:8231 -- comfy-mcp'
    )
    expect(JSON.parse(json)).toEqual({
      mcpServers: {
        'comfy-mcp': { command: 'comfy-mcp', env: { COMFY_LOCAL_URL: 'http://127.0.0.1:8231' } }
      }
    })
    expect(terminal.endsWith(' -- comfy-mcp && claude')).toBe(true)
  })

  it('falls back to the comfy-mcp default address when the port is unknown', () => {
    const { register, json } = buildMcpSnippets()
    expect(register).not.toContain('COMFY_LOCAL_URL')
    expect(JSON.parse(json)).toEqual({ mcpServers: { 'comfy-mcp': { command: 'comfy-mcp' } } })
  })
})
