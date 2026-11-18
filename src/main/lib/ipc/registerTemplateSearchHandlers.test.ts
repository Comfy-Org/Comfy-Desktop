import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  templateSearchPartnersOn: () => true,
  createSearchProcess: vi.fn()
}))
vi.mock('../../templateSearch/desktopSearch', () => ({ createDesktopSearch: vi.fn() }))
vi.mock('../telemetry', () => ({ gateEventsByPrefix: vi.fn() }))

import { registerTemplateSearchHandlers, STARTUP_SETTLE_MS } from './registerTemplateSearchHandlers'
import { sessionLifecycleEvents } from './shared'
import type { BackgroundTrigger } from '../../templateSearch/bundles'
import { createDesktopSearch } from '../../templateSearch/desktopSearch'
import { templateSearchOn, templateSearchPartnersOn } from '../../templateSearch/searchProcess'
import { gateEventsByPrefix } from '../telemetry'
import {
  CLAIM_WINDOW_MS,
  dropTemplateOpen,
  queueTemplateOpen,
  takeLaunchUrl
} from '../../templateSearch/openTemplate'
import { TEMPLATE_SEARCH_MAX_QUERY } from '../../../shared/templateSearch'
import type { TemplateSearchResponse, TemplateSearchResult } from '../../../types/ipc'
import { LOAD_RETRY_DELAY_MS, navigatorFor } from '../../host/buildNavigator'
import type { ComfyWindowEntry } from '../../host/registry'

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
  more: [],
  alsoTry: [],
  partnerSwitch: false,
  partnersShown: true
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
      downloadInBackground: vi.fn<(trigger: BackgroundTrigger) => Promise<boolean>>(
        async () => true
      ),
      onBuildAction: vi.fn(async () => undefined),
      onBuildActionEnd: vi.fn()
    },
    search: { search, forget: vi.fn() }
  }
}

function register(parts = fakes(), settled: Promise<unknown> = new Promise(() => {})) {
  registerTemplateSearchHandlers({
    isLocalInstallation: (installation) => installation.sourceId === 'standalone',
    terminalEnvOf: () => null,
    settled,
    ...parts
  })
  return parts
}

function attachedView(loadURL = vi.fn(async () => undefined)): typeof loadURL {
  mocks.getEntryByInstallationId.mockReturnValue(windowEntry(loadURL))
  return loadURL
}

function windowEntry(loadURL: (url: string) => Promise<void>) {
  return {
    comfyUrl: COMFY_URL,
    window: { isDestroyed: () => false },
    comfyView: { webContents: { isDestroyed: () => false, loadURL, stop: vi.fn() } }
  }
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
  it('gives search the same on switch that opening a template uses, and the partner setting', () => {
    const { process } = fakes()
    registerTemplateSearchHandlers({
      isLocalInstallation: () => true,
      terminalEnvOf: () => null,
      settled: new Promise(() => {}),
      process
    })
    const options = vi.mocked(createDesktopSearch).mock.calls[0]![0]
    expect(options.searchOn).toBe(templateSearchOn)
    expect(options.partnersOn).toBe(templateSearchPartnersOn)
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
  it('forgets the templates read during an operation that changed the build once it ends', async () => {
    const { search } = register()
    await mocks.observer!.before('local-1', 'copy-update')
    search.forget.mockClear()
    mocks.observer!.after('local-1', 'copy-update')
    expect(search.forget).toHaveBeenCalledWith('local-1')

    search.forget.mockClear()
    mocks.observer!.after('local-1', 'rename')
    expect(search.forget).not.toHaveBeenCalled()
  })

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

describe('search events', () => {
  it('lets search events through only while search is switched on', () => {
    register()
    expect(gateEventsByPrefix).toHaveBeenCalledWith(
      'comfy.desktop.template_search.',
      templateSearchOn
    )
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

  it('opens through the build window navigator, so a pending load retry cannot replace the template', async () => {
    vi.useFakeTimers()
    const loadURL = vi.fn(async (_url: string) => undefined)
    const entry = windowEntry(loadURL)
    mocks.getEntryByInstallationId.mockReturnValue(entry)
    mocks.runningSessions.set('local-1', { mode: 'window' })
    const navigator = navigatorFor(entry as unknown as ComfyWindowEntry)
    navigator.attach({ reloadUrl: () => COMFY_URL, mayReload: () => true })
    navigator.retryAfterFailure()
    register()

    expect(await handler('template-search:open')({}, 'local-1', 'poster_template')).toBe('opened')
    await vi.advanceTimersByTimeAsync(LOAD_RETRY_DELAY_MS)
    expect(loadURL.mock.calls.map(([url]) => url)).toEqual([DEEPLINK])
    vi.useRealTimers()
  })

  it('reports a template load overtaken by another load of the window as not opened', async () => {
    let finishFirst!: () => void
    const loadURL = vi
      .fn<(url: string) => Promise<void>>()
      .mockImplementationOnce(() => new Promise<void>((resolve) => (finishFirst = resolve)))
      .mockResolvedValue(undefined)
    const entry = windowEntry(loadURL)
    mocks.getEntryByInstallationId.mockReturnValue(entry)
    mocks.runningSessions.set('local-1', { mode: 'window' })
    register()

    const first = handler('template-search:open')({}, 'local-1', 'poster_template')
    await vi.waitFor(() => expect(loadURL).toHaveBeenCalledWith(DEEPLINK))
    await navigatorFor(entry as unknown as ComfyWindowEntry).open(COMFY_URL)
    finishFirst()
    expect(await first).toBe('refused')
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

describe('the background download', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts once Desktop has finished starting up and a short wait has passed', async () => {
    let finishStartup!: () => void
    const { process } = register(fakes(), new Promise<void>((resolve) => (finishStartup = resolve)))
    await vi.advanceTimersByTimeAsync(STARTUP_SETTLE_MS)
    expect(process.downloadInBackground).not.toHaveBeenCalled()

    finishStartup()
    await vi.advanceTimersByTimeAsync(STARTUP_SETTLE_MS - 1)
    expect(process.downloadInBackground).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(process.downloadInBackground).toHaveBeenCalledExactlyOnceWith('launch')
  })

  it('tries again when an operation or a launch ends, until one attempt has been made', async () => {
    const { process } = register(fakes(), Promise.resolve())
    process.downloadInBackground.mockResolvedValueOnce(false)
    await vi.advanceTimersByTimeAsync(STARTUP_SETTLE_MS)
    expect(process.downloadInBackground).toHaveBeenCalledTimes(1)

    mocks.observer!.after('local-1', 'update-comfyui')
    await vi.advanceTimersByTimeAsync(0)
    expect(process.downloadInBackground).toHaveBeenCalledTimes(2)
    expect(process.downloadInBackground).toHaveBeenLastCalledWith('build_ready')

    sessionLifecycleEvents.emit('launch-ended', 'local-1')
    mocks.observer!.after('local-1', 'update-comfyui')
    await vi.advanceTimersByTimeAsync(0)
    expect(process.downloadInBackground).toHaveBeenCalledTimes(2)
  })

  it('starts nothing when an operation ends before the startup wait is over, and keeps the first attempt for it', async () => {
    const { process } = register(fakes(), Promise.resolve())
    await vi.advanceTimersByTimeAsync(0)
    mocks.observer!.after('local-1', 'update-comfyui')
    sessionLifecycleEvents.emit('launch-ended', 'local-1')
    await vi.advanceTimersByTimeAsync(0)
    expect(process.downloadInBackground).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(STARTUP_SETTLE_MS)
    expect(process.downloadInBackground).toHaveBeenCalledExactlyOnceWith('launch')
  })

  it('tries again later when checking for the background download fails', async () => {
    const { process } = register(fakes(), Promise.resolve())
    process.downloadInBackground.mockRejectedValueOnce(new Error('installations unreadable'))
    await vi.advanceTimersByTimeAsync(STARTUP_SETTLE_MS)

    sessionLifecycleEvents.emit('launch-ended', 'local-1')
    await vi.advanceTimersByTimeAsync(0)
    expect(process.downloadInBackground).toHaveBeenCalledTimes(2)
  })
})
