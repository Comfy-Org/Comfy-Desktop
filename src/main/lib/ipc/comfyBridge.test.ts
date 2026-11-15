import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  allowed: false,
  exposeInMainWorld: vi.fn(),
  handle: vi.fn(),
  on: vi.fn(),
  invoke: vi.fn(async (): Promise<unknown> => null),
  send: vi.fn(),
  sendSync: vi.fn()
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mocks.exposeInMainWorld },
  ipcMain: { handle: mocks.handle, on: mocks.on },
  ipcRenderer: {
    invoke: mocks.invoke,
    on: vi.fn(),
    removeListener: vi.fn(),
    send: mocks.send,
    sendSync: mocks.sendSync
  }
}))

vi.mock('./bridgeCallers', () => {
  const rule = (): boolean => mocks.allowed
  return {
    anyOf: () => rule,
    installPage: rule,
    logsWindow: rule,
    panelOrTitleBar: rule,
    sessionPage: rule,
    trustedCloudPage: rule
  }
})

import '../../../preload/comfyPreload'
import { answerBridge, COMFY_BRIDGE_CALLERS, handleBridge, onBridge } from './comfyBridge'

type Registered = (event: Record<string, unknown>, ...args: unknown[]) => unknown

function registeredWith(register: typeof mocks.handle, channel: string): Registered {
  const call = register.mock.calls.find(([name]) => name === channel)
  expect(call, `${channel} is registered`).toBeDefined()
  return call![1] as Registered
}

function callEveryFunctionOf(value: unknown, seen = new Set<unknown>()): void {
  if (seen.has(value)) return
  seen.add(value)
  if (typeof value === 'function') {
    try {
      void Promise.resolve(value('a', 'b', 'c', 1)).catch(() => {})
    } catch {}
    return
  }
  if (value && typeof value === 'object') {
    for (const member of Object.values(value)) callEveryFunctionOf(member, seen)
  }
}

function channelsThePageCanCall(): string[] {
  const exposed = mocks.exposeInMainWorld.mock.calls.map(([, api]) => api as unknown)
  mocks.invoke.mockClear()
  mocks.send.mockClear()
  mocks.sendSync.mockClear()
  callEveryFunctionOf(exposed)
  const calls = [...mocks.invoke.mock.calls, ...mocks.send.mock.calls, ...mocks.sendSync.mock.calls]
  return [...new Set(calls.map(([channel]) => String(channel)))].sort()
}

beforeEach(() => {
  mocks.allowed = false
  mocks.handle.mockClear()
  mocks.on.mockClear()
})

describe('what a page in the ComfyUI view can ask Desktop for', () => {
  it('is only channels that have a caller rule', () => {
    const reachable = channelsThePageCanCall()

    expect(reachable).toContain('desktop2-download-model')
    expect(reachable).toContain('desktop2-download-asset')
    expect(reachable).toContain('logs-subscribe')
    expect(reachable.filter((channel) => !(channel in COMFY_BRIDGE_CALLERS))).toEqual([])
  })
})

describe('a bridge channel', () => {
  it('runs for a caller its rule accepts', async () => {
    const download = vi.fn(async (_event: unknown, url: string) => url.length > 0)
    handleBridge('desktop2-download-model', false, download)
    mocks.allowed = true

    const event = { sender: {} }
    await expect(
      registeredWith(mocks.handle, 'desktop2-download-model')(event, 'https://example.test/m')
    ).resolves.toBe(true)
    expect(download).toHaveBeenCalledWith(event, 'https://example.test/m')
  })

  it('answers a refused caller with the refusal and does nothing else', () => {
    const download = vi.fn(async () => true)
    handleBridge('desktop2-download-model', false, download)

    expect(registeredWith(mocks.handle, 'desktop2-download-model')({ sender: {} }, 'x')).toBe(false)
    expect(download).not.toHaveBeenCalled()
  })

  it('drops a one-way message from a refused caller', () => {
    const capture = vi.fn()
    onBridge('telemetry:capture', capture)
    const deliver = registeredWith(mocks.on, 'telemetry:capture')

    deliver({ sender: {} }, { event: 'x' })
    expect(capture).not.toHaveBeenCalled()

    mocks.allowed = true
    deliver({ sender: {} }, { event: 'x' })
    expect(capture).toHaveBeenCalledTimes(1)
  })

  it('always answers a page that is waiting on it, so a refused page is not left hanging', () => {
    const readCategory = vi.fn(() => true)
    answerBridge('desktop2-is-remote', false, readCategory)
    const answer = registeredWith(mocks.on, 'desktop2-is-remote')

    const refused: Record<string, unknown> = { sender: {} }
    answer(refused)
    expect(refused).toHaveProperty('returnValue', false)
    expect(readCategory).not.toHaveBeenCalled()

    mocks.allowed = true
    const accepted: Record<string, unknown> = { sender: {} }
    answer(accepted)
    expect(accepted).toHaveProperty('returnValue', true)
  })
})
