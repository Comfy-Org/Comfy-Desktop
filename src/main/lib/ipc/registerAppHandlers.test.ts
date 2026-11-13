import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
const existsSync = vi.fn<(target: string) => boolean>()
const openPath = vi.fn<(target: string) => Promise<string>>()

vi.mock('./shared', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      handlers.set(channel, handler),
    on: vi.fn()
  },
  shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
  fs: { existsSync: (target: string) => existsSync(target) },
  path,
  os: {},
  sources: [],
  installations: {},
  settings: {},
  openPath: (target: string) => openPath(target)
}))
vi.mock('systeminformation', () => ({ default: {} }))
vi.mock('../telemetry', () => ({}))
vi.mock('../deviceId', () => ({}))
vi.mock('../../cloud/tokenStore', () => ({}))
vi.mock('../../devplatform/session', () => ({}))
vi.mock('../cloudFreeRuns', () => ({}))
vi.mock('../../apps/appsSwitch', () => ({}))
vi.mock('../userTier', () => ({}))
vi.mock('../comfyui-releases', () => ({}))
vi.mock('../paths', () => ({ defaultBenchmarksDir: () => '/benchmarks' }))
vi.mock('../performanceTestWorkflows', () => ({}))
vi.mock('../performanceTestExampleWorkflows', () => ({ ExampleWorkflowFetchError: class {} }))

import { MISSING_PATH_ERROR, registerAppHandlers } from './registerAppHandlers'

function openPathHandler(): (event: unknown, target: unknown) => unknown {
  const handler = handlers.get('open-path')
  if (!handler) throw new Error('open-path is not registered')
  return handler
}

describe('open-path', () => {
  beforeEach(() => {
    handlers.clear()
    existsSync.mockReset()
    openPath.mockReset()
    registerAppHandlers()
  })

  it('returns an error and opens nothing when the path does not exist', async () => {
    existsSync.mockReturnValue(false)

    expect(await openPathHandler()({}, '/gone/folder')).toBe(MISSING_PATH_ERROR)
    expect(openPath).not.toHaveBeenCalled()
  })

  it('returns an empty string when the path opens', async () => {
    existsSync.mockReturnValue(true)
    openPath.mockResolvedValue('')

    expect(await openPathHandler()({}, '/outputs')).toBe('')
    expect(openPath).toHaveBeenCalledExactlyOnceWith(path.resolve('/outputs'))
  })
})
