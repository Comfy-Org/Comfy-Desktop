import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  getInstallation: vi.fn(),
  getEntryByInstallationId: vi.fn(),
  runningSessions: new Map<string, object>(),
  activeOperations: vi.fn((): { installationId: string; actionId: string }[] => []),
  observer: null as {
    before(id: string, action: string): Promise<void>
    after(id: string, action: string): void
  } | null
}))

vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle } }))
vi.mock('../../installations', () => ({ get: mocks.getInstallation }))
vi.mock('../../host/registry', () => ({ getEntryByInstallationId: mocks.getEntryByInstallationId }))
vi.mock('./sessionActions', () => ({
  _getActiveOperations: mocks.activeOperations,
  setSessionActionObserver: (next: typeof mocks.observer) => {
    mocks.observer = next
  }
}))
vi.mock('./broadcast', () => ({ _broadcastToRenderer: vi.fn() }))
vi.mock('./shared', async () => {
  const { EventEmitter } = await import('events')
  return { _runningSessions: mocks.runningSessions, sessionLifecycleEvents: new EventEmitter() }
})
vi.mock('../../templateSearch/searchProcess', () => ({
  changesBuildEnv: (actionId: string) => actionId !== 'rename',
  createSearchProcess: vi.fn()
}))
vi.mock('../../templateSearch/desktopSearch', () => ({ createDesktopSearch: vi.fn() }))

import { registerTemplateSearchHandlers } from './registerTemplateSearchHandlers'
import { sessionLifecycleEvents } from './shared'
import {
  CLAIM_WINDOW_MS,
  dropTemplateOpen,
  queueTemplateOpen,
  takeLaunchUrl
} from '../../templateSearch/openTemplate'
import { TEMPLATE_SEARCH_MAX_QUERY } from '../../../shared/templateSearch'
import type { TemplateSearchResponse, TemplateSearchResult } from '../../../types/ipc'

type IpcHandler = (event: object, ...args: unknown[]) => Promise<unknown> | unknown

function handler(channel: string): IpcHandler {
  const call = [...mocks.handle.mock.calls].reverse().find(([name]) => name === channel)
  expect(call).toBeDefined()
  return call![1] as IpcHandler
}

const RESULT: TemplateSearchResult = {
  outcome: 'agent',
  reply: null,
  run: [],
  download: [],
  alsoTry: []
}
const LOCAL = { id: 'local-1', sourceId: 'standalone' }
const CONSOLE = { id: 'console-1', sourceId: 'standalone', launchMode: 'console' }
const REMOTE = { id: 'remote-1', sourceId: 'remote' }
const COMFY_URL = 'http://127.0.0.1:8390/'
const DEEPLINK = 'http://127.0.0.1:8390/?template=poster_template&source=default'

function fakes(
  search = vi.fn(async (): Promise<TemplateSearchResponse> => ({ kind: 'result', result: RESULT }))
) {
  return {
    process: {
      decide: vi.fn(),
      prepare: vi.fn(async () => undefined),
      download: vi.fn(async () => undefined),
      onBuildAction: vi.fn(async () => undefined),
      onBuildActionEnd: vi.fn()
    },
    search: { search, forget: vi.fn() }
  }
}

function register(parts = fakes()) {
  registerTemplateSearchHandlers({
    isLocalInstallation: (installation) => installation.sourceId === 'standalone',
    terminalEnvOf: () => null,
    ...parts
  })
  return parts
}

function attachedView(loadURL = vi.fn(async () => undefined)): typeof loadURL {
  mocks.getEntryByInstallationId.mockReturnValue({
    comfyUrl: COMFY_URL,
    comfyView: { webContents: { isDestroyed: () => false, loadURL } }
  })
  return loadURL
}

function queuedUrl(installationId = 'local-1'): string {
  mocks.observer!.before(installationId, 'launch').catch(() => {})
  return takeLaunchUrl(installationId, COMFY_URL)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.observer = null
  sessionLifecycleEvents.removeAllListeners()
  mocks.getInstallation.mockImplementation(
    async (id: string) =>
      [LOCAL, CONSOLE, REMOTE].find((installation) => installation.id === id) ?? null
  )
  mocks.getEntryByInstallationId.mockReturnValue(undefined)
  mocks.runningSessions.clear()
  mocks.activeOperations.mockReturnValue([])
  dropTemplateOpen('local-1')
  dropTemplateOpen('console-1')
})

describe('template-search:search', () => {
  it('passes the trimmed request and the build to search, and returns its answer', async () => {
    const { search } = register()
    expect(
      await handler('template-search:search')({}, '  a poster for a bake sale  ', 'local-1')
    ).toEqual({ kind: 'result', result: RESULT })
    expect(search.search).toHaveBeenCalledWith('a poster for a bake sale', 'local-1')
  })

  it.each([
    ['not text', 7],
    ['empty', '']
  ])('searches without a build when the build id is %s', async (_name, installationId) => {
    const { search } = register()
    await handler('template-search:search')({}, 'a poster', installationId)
    expect(search.search).toHaveBeenCalledWith('a poster', null)
  })

  it.each([
    ['an empty request', '   '],
    ['a request that is not text', 42],
    ['an overlong request', 'a'.repeat(TEMPLATE_SEARCH_MAX_QUERY + 1)]
  ])('refuses %s without searching', async (_name, query) => {
    const { search } = register()
    expect(await handler('template-search:search')({}, query, 'local-1')).toEqual({
      kind: 'failed'
    })
    expect(search.search).not.toHaveBeenCalled()
  })

  it('reports a failed search instead of throwing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    register(fakes(vi.fn(async () => Promise.reject(new Error('timed out')))))
    expect(await handler('template-search:search')({}, 'a poster', 'local-1')).toEqual({
      kind: 'failed'
    })
  })
})

describe('template-search:prepare and download', () => {
  it('gets search ready ahead of the first request, and starts the model download', async () => {
    const { process } = register()
    await handler('template-search:prepare')({})
    await handler('template-search:download')({})
    expect(process.prepare).toHaveBeenCalled()
    expect(process.download).toHaveBeenCalled()
  })
})

describe('build operations', () => {
  it('stops search on a build and forgets its templates before an operation that can change it', async () => {
    const { process, search } = register()
    await mocks.observer!.before('local-1', 'copy-update')
    expect(process.onBuildAction).toHaveBeenCalledWith('local-1')
    expect(search.forget).toHaveBeenCalledWith('local-1')
  })

  it("leaves search running for an operation that keeps the build's environment", async () => {
    const { process } = register()
    await mocks.observer!.before('local-1', 'rename')
    expect(process.onBuildAction).not.toHaveBeenCalled()
  })

  it('tells search when a launch that did not come through a session action ends', () => {
    const { process } = register()
    sessionLifecycleEvents.emit('launch-ended', 'local-1')
    expect(process.onBuildActionEnd).toHaveBeenCalled()
  })

  it('tells search when an operation ends', () => {
    const { process } = register()
    mocks.observer!.after('local-1', 'update-comfyui')
    expect(process.onBuildActionEnd).toHaveBeenCalled()
  })

  it('drops a queued template when the launch it waited for ends', async () => {
    register()
    queueTemplateOpen('local-1', 'poster_template')
    await mocks.observer!.before('local-1', 'launch')
    mocks.observer!.after('local-1', 'launch')
    expect(takeLaunchUrl('local-1', COMFY_URL)).toBe(COMFY_URL)
  })
})

describe('template-search:open', () => {
  it('queues the template for a local build that is not running, for its launch to open once', async () => {
    register()
    expect(await handler('template-search:open')({}, 'local-1', 'poster_template')).toBe('launch')
    expect(queuedUrl()).toBe(DEEPLINK)
    expect(takeLaunchUrl('local-1', COMFY_URL)).toBe(COMFY_URL)
  })

  it('does not open a queued template on a launch that starts more than a minute later', () => {
    register()
    queueTemplateOpen('local-1', 'poster_template', Date.now() - CLAIM_WINDOW_MS - 1)
    expect(queuedUrl()).toBe(COMFY_URL)
  })

  it('opens the template straight away in a running build', async () => {
    const loadURL = attachedView()
    mocks.runningSessions.set('local-1', {})
    register()

    expect(await handler('template-search:open')({}, 'local-1', 'poster_template')).toBe('opened')
    expect(loadURL).toHaveBeenCalledWith(DEEPLINK)
    expect(queuedUrl()).toBe(COMFY_URL)
  })

  it('launches a stopped build whose window is still open instead of loading into it', async () => {
    const loadURL = attachedView()
    register()

    expect(await handler('template-search:open')({}, 'local-1', 'poster_template')).toBe('launch')
    expect(loadURL).not.toHaveBeenCalled()
    expect(queuedUrl()).toBe(DEEPLINK)
  })

  it('reports a running build that fails to load the template as not opened', async () => {
    attachedView(vi.fn(async () => Promise.reject(new Error('ERR_CONNECTION_REFUSED'))))
    mocks.runningSessions.set('local-1', {})
    register()

    expect(await handler('template-search:open')({}, 'local-1', 'poster_template')).toBe('refused')
  })

  it('refuses while another operation runs on the build, and queues nothing', async () => {
    mocks.activeOperations.mockReturnValue([{ installationId: 'local-1', actionId: 'copy-update' }])
    register()

    expect(await handler('template-search:open')({}, 'local-1', 'poster_template')).toBe('refused')
    expect(queuedUrl()).toBe(COMFY_URL)
  })

  it('queues behind a launch already in progress on the build', async () => {
    mocks.activeOperations.mockReturnValue([{ installationId: 'local-1', actionId: 'launch' }])
    register()

    expect(await handler('template-search:open')({}, 'local-1', 'poster_template')).toBe('launch')
    expect(queuedUrl()).toBe(DEEPLINK)
  })

  it.each([
    ['a build that is not local', 'remote-1', 'poster_template'],
    ['a build that launches without a window', 'console-1', 'poster_template'],
    ['a build that does not exist', 'missing-1', 'poster_template'],
    ['a template id that could be a path', 'local-1', '../escape'],
    ['an installation id that is not text', 7, 'poster_template']
  ])('refuses %s', async (_name, installationId, templateId) => {
    register()
    expect(await handler('template-search:open')({}, installationId, templateId)).toBe('refused')
    expect(queuedUrl()).toBe(COMFY_URL)
    expect(queuedUrl('console-1')).toBe(COMFY_URL)
  })
})
