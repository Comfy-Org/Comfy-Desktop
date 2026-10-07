import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  resolveId: (_id: string) => {},
  deviceIdReady: vi.fn(),
  getDeviceId: vi.fn(() => 'degraded-id')
}))

vi.mock('./shared', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => h.handlers.set(channel, fn),
    on: vi.fn()
  },
  settings: { get: vi.fn(), getAll: vi.fn(() => ({})) },
  sources: [],
  installations: {}
}))
vi.mock('../deviceId', () => ({ deviceIdReady: h.deviceIdReady, getDeviceId: h.getDeviceId }))
vi.mock('systeminformation', () => ({ default: {} }))
vi.mock('../telemetry', () => ({}))
vi.mock('../../cloud/tokenStore', () => ({}))
vi.mock('../../devplatform/session', () => ({}))
vi.mock('../cloudFreeRuns', () => ({}))
vi.mock('../userTier', () => ({}))
vi.mock('../comfyui-releases', () => ({}))
vi.mock('../paths', () => ({ defaultBenchmarksDir: () => '/tmp/benchmarks' }))
vi.mock('../performanceTestWorkflows', () => ({}))
vi.mock('../performanceTestExampleWorkflows', () => ({}))

import { registerAppHandlers } from './registerAppHandlers'

describe('get-device-id', () => {
  beforeEach(() => {
    h.handlers.clear()
    h.deviceIdReady.mockReturnValue(
      new Promise<string>((resolve) => {
        h.resolveId = resolve
      })
    )
    registerAppHandlers()
  })

  it('answers with the resolved installation id, never a pre-resolution one', async () => {
    let answer: unknown = 'pending'
    const reply = Promise.resolve(h.handlers.get('get-device-id')!()).then((id) => {
      answer = id
    })
    await new Promise((r) => setImmediate(r))
    expect(answer, 'the handler waits for the lookup').toBe('pending')

    h.resolveId('final-id')
    await reply
    expect(answer).toBe('final-id')
    expect(h.getDeviceId).not.toHaveBeenCalled()
  })
})
