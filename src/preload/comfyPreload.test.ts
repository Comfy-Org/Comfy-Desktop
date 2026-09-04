import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  send: vi.fn(),
  sendSync: vi.fn()
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mocks.exposeInMainWorld },
  ipcRenderer: {
    invoke: mocks.invoke,
    on: mocks.on,
    removeListener: mocks.removeListener,
    send: mocks.send,
    sendSync: mocks.sendSync
  }
}))

import './comfyPreload'
import type { LegacyTerminalBridge } from './comfyPreload'
import type { ComfyDesktop2BridgeImplementation } from '../types/comfyDesktopBridge'

type HostedFrontendBridge = ComfyDesktop2BridgeImplementation & {
  Terminal: LegacyTerminalBridge
}

function hostedBridge(): HostedFrontendBridge {
  return mocks.exposeInMainWorld.mock.calls[0]![1] as HostedFrontendBridge
}

describe('comfyPreload model access bridge', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.send.mockReset()
  })

  it('forwards hosted frontend exceptions through the scrubbed Desktop telemetry channel', () => {
    const bridge = hostedBridge()
    const error = { message: 'boom', stack: 'Error: boom\n at app.ts:1:1' }

    bridge.Telemetry.captureException!(error, {
      error_type: 'workspace_auth_gate_initialization_failure',
      level: 'error'
    })

    expect(mocks.send).toHaveBeenCalledWith('telemetry:captureException', {
      ...error,
      properties: {
        error_type: 'workspace_auth_gate_initialization_failure',
        level: 'error'
      }
    })
  })

  it('forwards the repository URL through the desktop2 IPC contract', async () => {
    const bridge = hostedBridge()
    const url = 'https://huggingface.co/black-forest-labs/FLUX.1-dev'
    mocks.invoke.mockResolvedValueOnce(true)

    await expect(bridge.openModelAccessPage(url)).resolves.toBe(true)

    expect(mocks.exposeInMainWorld).toHaveBeenCalledWith('__comfyDesktop2', expect.any(Object))
    expect(mocks.invoke).toHaveBeenCalledWith('desktop2-open-model-access-page', { url })
  })

  it('exposes only a navigation request for the hosted terminal', async () => {
    const bridge = hostedBridge()
    mocks.invoke.mockResolvedValueOnce(true)

    await expect(bridge.openTerminal()).resolves.toBe(true)

    expect(mocks.invoke).toHaveBeenCalledWith('desktop2-open-terminal')
  })

  it('redirects legacy terminal calls without invoking PTY channels', async () => {
    const bridge = hostedBridge()
    mocks.invoke.mockResolvedValue(true)

    await bridge.Terminal.subscribe()
    await bridge.Terminal.write('whoami\r')
    await bridge.Terminal.resize(120, 40)
    await bridge.Terminal.restart()
    await bridge.Terminal.restore()
    await bridge.Terminal.openPopout()
    expect(bridge.Terminal.onOutput(() => {})).toEqual(expect.any(Function))
    expect(bridge.Terminal.onExited(() => {})).toEqual(expect.any(Function))

    const invokedChannels = mocks.invoke.mock.calls.map(([channel]) => channel)
    expect(invokedChannels).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^terminal-/)])
    )
    expect(mocks.invoke).toHaveBeenCalledTimes(3)
    expect(mocks.invoke).toHaveBeenCalledWith('desktop2-open-terminal')
    expect(mocks.invoke).toHaveBeenCalledWith('desktop2-open-terminal-popout')
  })
})
