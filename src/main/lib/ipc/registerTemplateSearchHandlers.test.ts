import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  observer: null as {
    before(id: string, action: string): Promise<void>
    after(id: string, action: string): void
  } | null
}))

vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle } }))
vi.mock('./sessionActions', () => ({
  setSessionActionObserver: (next: typeof mocks.observer) => {
    mocks.observer = next
  }
}))
vi.mock('./broadcast', () => ({ _broadcastToRenderer: vi.fn() }))
vi.mock('./shared', async () => {
  const { EventEmitter } = await import('events')
  return { sessionLifecycleEvents: new EventEmitter() }
})
vi.mock('../../templateSearch/searchProcess', () => ({
  changesBuildEnv: (actionId: string) => actionId === 'copy-update',
  createSearchProcess: vi.fn()
}))

import { registerTemplateSearchHandlers } from './registerTemplateSearchHandlers'
import { sessionLifecycleEvents } from './shared'

type IpcHandler = (event: object, ...args: unknown[]) => Promise<unknown> | unknown

function handler(channel: string): IpcHandler {
  const call = [...mocks.handle.mock.calls].reverse().find(([name]) => name === channel)
  expect(call).toBeDefined()
  return call![1] as IpcHandler
}

function register() {
  const process = {
    decide: vi.fn(),
    prepare: vi.fn(async () => undefined),
    download: vi.fn(async () => undefined),
    onBuildAction: vi.fn(async () => undefined),
    onBuildActionEnd: vi.fn()
  }
  registerTemplateSearchHandlers({
    isLocalInstallation: () => true,
    terminalEnvOf: () => null,
    process
  })
  return process
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.observer = null
  sessionLifecycleEvents.removeAllListeners()
})

describe('template-search:prepare and download', () => {
  it('gets search ready ahead of the first request', async () => {
    const process = register()
    await handler('template-search:prepare')({})
    expect(process.prepare).toHaveBeenCalledTimes(1)
    expect(process.download).not.toHaveBeenCalled()
  })

  it('starts the model download', async () => {
    const process = register()
    await handler('template-search:download')({})
    expect(process.download).toHaveBeenCalledTimes(1)
    expect(process.prepare).not.toHaveBeenCalled()
  })
})

describe('build operations', () => {
  it('holds an operation that can change a build until search there has stopped', async () => {
    const process = register()
    let stopped!: () => void
    process.onBuildAction.mockReturnValue(
      new Promise<undefined>((resolve) => (stopped = () => resolve(undefined)))
    )
    let ready = false
    const before = mocks.observer!.before('local-1', 'copy-update').then(() => (ready = true))
    await Promise.resolve()
    expect(process.onBuildAction).toHaveBeenCalledWith('local-1')
    expect(ready).toBe(false)
    stopped()
    await before
    expect(ready).toBe(true)
  })

  it("leaves search running for an operation that keeps the build's environment", async () => {
    const process = register()
    await mocks.observer!.before('local-1', 'rename')
    expect(process.onBuildAction).not.toHaveBeenCalled()
  })

  it('tells search when a launch that did not come through a session action ends', () => {
    const process = register()
    sessionLifecycleEvents.emit('launch-ended', 'local-1')
    expect(process.onBuildActionEnd).toHaveBeenCalled()
  })

  it('tells search when an operation ends', () => {
    const process = register()
    mocks.observer!.after('local-1', 'update-comfyui')
    expect(process.onBuildActionEnd).toHaveBeenCalled()
  })
})
