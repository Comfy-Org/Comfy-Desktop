import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  getInstallation: vi.fn(),
  getEntryByInstallationId: vi.fn(),
  runningSessions: new Map<string, { mode: string }>(),
  busy: new Set<string>(),
  settings: { templateSearchEnabled: true } as Record<string, unknown>,
  searchOn: true,
  observer: null as {
    before(id: string, action: string): Promise<void>
    after(id: string, action: string): void
  } | null
}))

vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle } }))
vi.mock('../../installations', () => ({ get: mocks.getInstallation }))
vi.mock('../../host/registry', () => ({ getEntryByInstallationId: mocks.getEntryByInstallationId }))
vi.mock('./sessionActions', () => ({
  setSessionActionObserver: (next: typeof mocks.observer) => {
    mocks.observer = next
  }
}))
vi.mock('../../settings', () => ({ get: (key: string) => mocks.settings[key] }))
vi.mock('./broadcast', () => ({ _broadcastToRenderer: vi.fn() }))
vi.mock('./shared', async () => {
  const { EventEmitter } = await import('events')
  return { _runningSessions: mocks.runningSessions, sessionLifecycleEvents: new EventEmitter() }
})
vi.mock('../../templateSearch/searchProcess', () => ({
  changesBuildEnv: (actionId: string) => actionId !== 'rename',
  isBuildBusy: (installationId: string) => mocks.busy.has(installationId),
  templateSearchOn: () => mocks.searchOn,
  createSearchProcess: vi.fn()
}))
vi.mock('../../templateSearch/desktopSearch', () => ({ createDesktopSearch: vi.fn() }))
vi.mock('../../templateSearch/searchTelemetry', () => ({ reportTemplateLoaded: vi.fn() }))

import { registerTemplateSearchHandlers } from './registerTemplateSearchHandlers'
import { sessionLifecycleEvents } from './shared'
import { createDesktopSearch } from '../../templateSearch/desktopSearch'
import { templateSearchOn } from '../../templateSearch/searchProcess'
import { reportTemplateLoaded } from '../../templateSearch/searchTelemetry'
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
  mocks.busy.clear()
  mocks.settings = { templateSearchEnabled: true }
  mocks.searchOn = true
  dropTemplateOpen('local-1')
  dropTemplateOpen('console-1')
})

describe('template-search:search', () => {
  it('gives search the same on switch that opening a template uses', () => {
    const { process } = fakes()
    registerTemplateSearchHandlers({
      isLocalInstallation: () => true,
      terminalEnvOf: () => null,
      process
    })
    expect(vi.mocked(createDesktopSearch).mock.calls[0]![0].searchOn).toBe(templateSearchOn)
  })

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
  it('gets search ready ahead of the first request', async () => {
    const { process } = register()
    await handler('template-search:prepare')({})
    expect(process.prepare).toHaveBeenCalledTimes(1)
    expect(process.download).not.toHaveBeenCalled()
  })

  it('starts the model download', async () => {
    const { process } = register()
    await handler('template-search:download')({})
    expect(process.download).toHaveBeenCalledTimes(1)
    expect(process.prepare).not.toHaveBeenCalled()
  })
})

describe('build operations', () => {
  it('stops search on a build and forgets its templates before an operation that can change it', async () => {
    const { process, search } = register()
    await mocks.observer!.before('local-1', 'copy-update')
    expect(process.onBuildAction).toHaveBeenCalledWith('local-1')
    expect(search.forget).toHaveBeenCalledWith('local-1')
  })

  it('holds an operation that can change a build until search there has stopped', async () => {
    const { process } = register()
    let stopped!: () => void
    process.onBuildAction.mockReturnValue(
      new Promise<undefined>((resolve) => (stopped = () => resolve(undefined)))
    )
    let ready = false
    const before = mocks.observer!.before('local-1', 'copy-update').then(() => (ready = true))
    await Promise.resolve()
    expect(ready).toBe(false)
    stopped()
    await before
    expect(ready).toBe(true)
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
  const SEARCH_ID = '2b1c7a3e-9f4d-4c8a-8e1b-5d6f7a8b9c0d'

  it('reports a template opened straight away in a running build, with the search it came from', async () => {
    attachedView()
    mocks.runningSessions.set('local-1', { mode: 'window' })
    register()
    await handler('template-search:open')({}, 'local-1', 'poster_template', SEARCH_ID)
    expect(reportTemplateLoaded).toHaveBeenCalledExactlyOnceWith({
      searchId: SEARCH_ID,
      templateId: 'poster_template',
      buildStarted: false,
      pickToLoadMs: null
    })
  })

  it('keeps the search a queued template came from for its launch, and drops one that is not a search id', async () => {
    register()
    await handler('template-search:open')({}, 'local-1', 'poster_template', SEARCH_ID)
    queuedUrl()
    await handler('template-search:open')({}, 'local-1', 'poster_template', 'a poster for my aunt')
    queuedUrl()
    expect(vi.mocked(reportTemplateLoaded).mock.calls.map(([loaded]) => loaded.searchId)).toEqual([
      SEARCH_ID,
      null
    ])
  })

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

  it('refuses to open a template while search is off, even with the setting on', async () => {
    mocks.searchOn = false
    register()
    expect(await handler('template-search:open')({}, 'local-1', 'poster_template')).toBe('refused')
    expect(queuedUrl()).toBe(COMFY_URL)
  })

  it('refuses a running build whose window has closed', async () => {
    mocks.runningSessions.set('local-1', { mode: 'window' })
    register()
    expect(await handler('template-search:open')({}, 'local-1', 'poster_template')).toBe('refused')
    expect(queuedUrl()).toBe(COMFY_URL)
  })

  it('refuses a build Apps started without a window, even with its old window still open', async () => {
    const loadURL = attachedView()
    mocks.runningSessions.set('local-1', { mode: 'console' })
    register()

    expect(await handler('template-search:open')({}, 'local-1', 'poster_template')).toBe('refused')
    expect(loadURL).not.toHaveBeenCalled()
    expect(queuedUrl()).toBe(COMFY_URL)
  })

  it('opens the template straight away in a running build', async () => {
    const loadURL = attachedView()
    mocks.runningSessions.set('local-1', { mode: 'window' })
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
    mocks.runningSessions.set('local-1', { mode: 'window' })
    register()

    expect(await handler('template-search:open')({}, 'local-1', 'poster_template')).toBe('refused')
  })

  it.each([
    ['stopped', false],
    ['running in its window', true]
  ])('refuses a busy build that is %s, and opens or queues nothing', async (_state, running) => {
    const loadURL = attachedView()
    if (running) mocks.runningSessions.set('local-1', { mode: 'window' })
    mocks.busy.add('local-1')
    register()

    expect(await handler('template-search:open')({}, 'local-1', 'poster_template')).toBe('refused')
    expect(loadURL).not.toHaveBeenCalled()
    expect(queuedUrl()).toBe(COMFY_URL)
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
