import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  killByPort: vi.fn(async () => {}),
  findPidsByPort: vi.fn(async (): Promise<number[]> => []),
  isPortListening: vi.fn(async () => false),
  removePortLock: vi.fn()
}))

vi.mock('./shared', () => ({
  ipcMain: { handle: mocks.handle, on: vi.fn() },
  installations: {},
  i18n: { t: (k: string) => k },
  killByPort: mocks.killByPort,
  findPidsByPort: mocks.findPidsByPort,
  isPortListening: mocks.isPortListening,
  removePortLock: mocks.removePortLock,
  REQUIRES_STOPPED: new Set(),
  _onStop: null,
  _operationAborts: new Map(),
  _getPublicSessions: () => [],
  _getLaunchingInstances: () => [],
  _getStoppingInstallationIds: () => [],
  hasRunningSessionForInstallation: () => false,
  stopRunning: vi.fn()
}))
vi.mock('./sessionActions', () => ({
  dispatchSessionAction: vi.fn(),
  _getActiveOperations: () => []
}))
vi.mock('../e2eOverrides', () => ({ recordIpcInvocation: vi.fn() }))

import { registerSessionHandlers } from './registerSessionHandlers'

type Handler = (_event: unknown, port: number) => Promise<{ ok: boolean }>

function killPortProcess(): Handler {
  const call = mocks.handle.mock.calls.find(([name]) => name === 'kill-port-process')
  expect(call).toBeDefined()
  return call![1] as Handler
}

describe('kill-port-process', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    vi.spyOn(console, 'info').mockImplementation(() => {})
    registerSessionHandlers()
  })

  async function run(port: number): Promise<{ ok: boolean }> {
    const pending = killPortProcess()(null, port)
    await vi.runAllTimersAsync()
    return pending
  }

  it('reports success and drops the port lock once the port is really free', async () => {
    mocks.findPidsByPort.mockResolvedValueOnce([4242]).mockResolvedValueOnce([])
    mocks.isPortListening.mockResolvedValue(false)
    expect(await run(8188)).toEqual({ ok: true })
    expect(mocks.removePortLock).toHaveBeenCalledWith(8188)
  })

  it('does not claim success, and keeps the lock, for a holder no listener list shows', async () => {
    // lsof sees nothing (another user's or namespace's process), but the port is still taken:
    // the lock is what lets the retry recognise this installation's ComfyUI.
    mocks.findPidsByPort.mockResolvedValue([])
    mocks.isPortListening.mockResolvedValue(true)
    expect(await run(8188)).toEqual({ ok: false })
    expect(mocks.removePortLock).not.toHaveBeenCalled()
  })
})
