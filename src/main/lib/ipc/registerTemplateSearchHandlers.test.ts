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
vi.mock('../../templateSearch/searchProcess', () => ({
  changesBuildEnv: (actionId: string) => actionId !== 'rename' && actionId !== 'open-folder',
  createSearchProcess: vi.fn()
}))

import { registerTemplateSearchHandlers } from './registerTemplateSearchHandlers'

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
})

describe('template-search:prepare and download', () => {
  it('gets search ready ahead of the first request, and starts the model download', async () => {
    const process = register()
    await handler('template-search:prepare')({})
    await handler('template-search:download')({})
    expect(process.prepare).toHaveBeenCalled()
    expect(process.download).toHaveBeenCalled()
  })
})

describe('build operations', () => {
  it('stops search on a build before an operation that can change it', async () => {
    const process = register()
    await mocks.observer!.before('local-1', 'copy-update')
    expect(process.onBuildAction).toHaveBeenCalledWith('local-1')
  })

  it.each(['rename', 'open-folder'])('leaves search running for %s', async (actionId) => {
    const process = register()
    await mocks.observer!.before('local-1', actionId)
    expect(process.onBuildAction).not.toHaveBeenCalled()
  })

  it('tells search when an operation ends', () => {
    const process = register()
    mocks.observer!.after('local-1', 'update-comfyui')
    expect(process.onBuildActionEnd).toHaveBeenCalled()
  })
})
