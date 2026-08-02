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

type ModelAccessBridge = {
  openModelAccessPage: (url: string) => Promise<boolean>
}

type HostedFrontendBridge = ModelAccessBridge & {
  openTerminal: () => Promise<boolean>
  Terminal: {
    subscribe: () => Promise<{
      buffer: string[]
      size: { cols: number; rows: number }
      exited: boolean
    }>
    write: (data: string) => Promise<void>
    resize: (cols: number, rows: number) => Promise<void>
    restart: () => Promise<{
      buffer: string[]
      size: { cols: number; rows: number }
      exited: boolean
    }>
    restore: () => Promise<{
      buffer: string[]
      size: { cols: number; rows: number }
      exited: boolean
    }>
    openPopout: () => Promise<void>
    onOutput: (callback: (data: string) => void) => () => void
    onExited: (callback: () => void) => () => void
  }
}

function hostedBridge(): HostedFrontendBridge {
  return mocks.exposeInMainWorld.mock.calls[0]![1] as HostedFrontendBridge
}

describe('comfyPreload model access bridge', () => {
  beforeEach(() => {
    mocks.invoke.mockClear()
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

    expect(mocks.invoke).not.toHaveBeenCalledWith(
      expect.stringMatching(/^terminal-/),
      expect.anything()
    )
    expect(mocks.invoke).toHaveBeenCalledTimes(3)
    expect(mocks.invoke).toHaveBeenCalledWith('desktop2-open-terminal')
    expect(mocks.invoke).toHaveBeenCalledWith('desktop2-open-terminal-popout')
  })
})
