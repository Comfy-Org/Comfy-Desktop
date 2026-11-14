// @vitest-environment node
import type { WebContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeBuild {
  id: string
  name: string
  port: number | null
  lastLaunchedAt?: number
}

const mocks = vi.hoisted(() => ({
  records: [] as Record<string, unknown>[],
  builds: [] as FakeBuild[],
  sessions: new Map<string, Record<string, unknown>>(),
  windows: new Map<string, unknown>(),
  launchesUnderWay: new Set<string>(),
  pageBuild: null as string | null,
  launchOnce: vi.fn(),
  launchQuietly: vi.fn(),
  otherLaunchSettled: vi.fn(),
  onLaunch: vi.fn(),
  setActivePanel: vi.fn()
}))

vi.mock('../host/panelView', () => ({ setActivePanel: mocks.setActivePanel }))
vi.mock('../host/registry', () => ({
  getEntryByInstallationId: (id: string) => mocks.windows.get(id)
}))
vi.mock('../installations', () => ({
  CLOUD_SOURCE_ID: 'cloud',
  list: async () => mocks.records,
  get: async (id: string) => mocks.records.find((record) => record['id'] === id) ?? null
}))
vi.mock('../lib/i18n', () => ({
  t: (key: string, params?: Record<string, unknown>) =>
    params ? `${key} ${Object.values(params).join(' ')}` : key
}))
vi.mock('../lib/ipc/shared', () => ({
  _onLaunch: (info: unknown) => mocks.onLaunch(info),
  _hasActiveLaunch: (id: string) => mocks.launchesUnderWay.has(id),
  _runningSessions: mocks.sessions
}))
vi.mock('./localBuild', () => ({
  usableLocalBuilds: async () => mocks.builds,
  runningPortOf: (id: string) => (mocks.sessions.get(id)?.['port'] as number | undefined) ?? null,
  chooseLocalBuild: (builds: FakeBuild[]) => {
    const build = builds.find((one) => one.port !== null) ?? builds[0]
    return build ? { kind: 'build', build } : { kind: 'no-builds' }
  }
}))
vi.mock('./localComfy', () => ({
  launchOnce: mocks.launchOnce,
  launchQuietly: mocks.launchQuietly,
  otherLaunchSettled: mocks.otherLaunchSettled,
  pageBuildId: () => mocks.pageBuild
}))

import {
  _resetForTest,
  LOAD_TIMEOUT_MS,
  localBuilds,
  NO_WORKFLOW_GRACE_MS,
  openInComfy,
  WINDOW_TIMEOUT_MS
} from './openInComfy'
import { COMFY_STATE_SCRIPT, MARK_PAGE_STALE_SCRIPT } from './openRequest'
import type { ComfyPageState } from './openRequest'

const PAGE = {} as WebContents
const STUDIO = { id: 'inst-studio', name: 'Studio', port: null }
const LAB = { id: 'inst-lab', name: 'Lab', port: null }
const CLOUD = { id: 'inst-cloud', name: 'Comfy Cloud', sourceId: 'cloud', status: 'installed' }
const CLOUD_URL = 'https://cloud.comfy.org/'
const PROMPT = { '9': { class_type: 'SaveImage', inputs: { images: ['8', 0] } } }
const ON_THIS_COMPUTER = { prompt: PROMPT, where: 'local', name: 'Remove Background' }
const ON_CLOUD = { prompt: PROMPT, where: 'cloud', name: 'Remove Background' }
const WITH_KEY = { a: { class_type: 'X', inputs: { api_key_comfy_org: 'key' } } }

class FakeWindow {
  comfyUrl: string
  shown = false
  scripts: string[] = []
  state: ComfyPageState = 'ready'
  takesWorkflow = true
  finishesLoading = true
  leftFromAnEarlierRun = false
  markedStale = false
  loadedIntoAnEarlierRun = false
  reloads: string[] = []
  windowKey = 7
  activePanel = 'comfy'

  constructor(comfyUrl: string) {
    this.comfyUrl = comfyUrl
  }

  window = {
    isDestroyed: () => false,
    isMinimized: () => false,
    restore: vi.fn(),
    show: () => {
      this.shown = true
    },
    focus: vi.fn()
  }

  comfyView = {
    webContents: {
      isDestroyed: () => false,
      isLoading: () => false,
      getURL: () => this.comfyUrl,
      executeJavaScript: (script: string): Promise<unknown> => {
        this.scripts.push(script)
        if (script === MARK_PAGE_STALE_SCRIPT) {
          this.markedStale = true
          return Promise.resolve(true)
        }
        if (script === COMFY_STATE_SCRIPT) {
          return Promise.resolve(this.markedStale ? 'starting' : this.state)
        }
        if (!this.finishesLoading) return new Promise(() => {})
        this.loadedIntoAnEarlierRun ||= this.leftFromAnEarlierRun
        return Promise.resolve(this.takesWorkflow)
      }
    }
  }

  reload(comfyUrl: string): void {
    this.reloads.push(comfyUrl)
    this.comfyUrl = comfyUrl
    this.leftFromAnEarlierRun = false
    this.markedStale = false
  }

  loaded(): string[] {
    return this.scripts.filter((script) => script.includes('loadApiJson(JSON.parse'))
  }
}

let launchCount = 0

function runLocal(id: string, port: number, mode = 'console'): void {
  launchCount += 1
  mocks.sessions.set(id, { port, proc: null, mode, startedAt: launchCount })
}

function runCloud(id: string): void {
  launchCount += 1
  mocks.sessions.set(id, {
    port: 0,
    url: CLOUD_URL,
    proc: null,
    mode: 'window',
    startedAt: launchCount
  })
}

function windowFor(id: string, url: string): FakeWindow {
  const window = new FakeWindow(url)
  mocks.windows.set(id, window)
  return window
}

function openWindowsOnLaunch(): void {
  mocks.onLaunch.mockImplementation(
    (info: { installation: { id: string }; port: number; url?: string }) => {
      const comfyUrl = info.url ?? `http://127.0.0.1:${info.port}/`
      const open = mocks.windows.get(info.installation.id) as FakeWindow | undefined
      if (open) open.reload(comfyUrl)
      else windowFor(info.installation.id, comfyUrl)
    }
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  _resetForTest()
  mocks.records = [
    { id: STUDIO.id, name: STUDIO.name, sourceId: 'standalone', status: 'installed' },
    { id: LAB.id, name: LAB.name, sourceId: 'standalone', status: 'installed' }
  ]
  mocks.builds = [{ ...STUDIO }, { ...LAB }]
  mocks.sessions.clear()
  mocks.windows.clear()
  mocks.launchesUnderWay.clear()
  mocks.pageBuild = STUDIO.id
  mocks.launchOnce.mockResolvedValue({ ok: false })
  mocks.launchQuietly.mockResolvedValue({ ok: false })
  mocks.otherLaunchSettled.mockResolvedValue(undefined)
  openWindowsOnLaunch()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('opening a run workflow in the ComfyUI on this computer', () => {
  it('loads it into the window of the build the page runs on and brings it forward', async () => {
    runLocal(STUDIO.id, 8190, 'window')
    const studio = windowFor(STUDIO.id, 'http://127.0.0.1:8190/')

    expect(await openInComfy(PAGE, ON_THIS_COMPUTER)).toEqual({ opened: true })

    expect(studio.shown).toBe(true)
    expect(studio.loaded()).toHaveLength(1)
    expect(studio.loaded()[0]).toContain('Remove Background')
    expect(mocks.setActivePanel).toHaveBeenCalledWith(7, 'comfy')
    expect(mocks.launchOnce).not.toHaveBeenCalled()
    expect(mocks.onLaunch).not.toHaveBeenCalled()
  })

  it('shows a window for the build when it runs without one', async () => {
    runLocal(STUDIO.id, 8190)

    expect(await openInComfy(PAGE, ON_THIS_COMPUTER)).toEqual({ opened: true })

    expect(mocks.onLaunch).toHaveBeenCalledWith(
      expect.objectContaining({ port: 8190, mode: 'window', installation: mocks.records[0] })
    )
    expect(mocks.windows.get(STUDIO.id)).toBeInstanceOf(FakeWindow)
    expect((mocks.windows.get(STUDIO.id) as FakeWindow).loaded()).toHaveLength(1)
  })

  it('starts the build when it is not running, then shows its window', async () => {
    mocks.launchOnce.mockImplementation(async (id: string) => {
      runLocal(id, 8190)
      return { ok: true }
    })

    expect(await openInComfy(PAGE, ON_THIS_COMPUTER)).toEqual({ opened: true })

    expect(mocks.launchOnce).toHaveBeenCalledWith(STUDIO.id)
    expect(mocks.onLaunch).toHaveBeenCalledWith(expect.objectContaining({ mode: 'window' }))
  })

  it('reloads a window left open since the build last stopped, then loads into the fresh page', async () => {
    const studio = windowFor(STUDIO.id, 'http://127.0.0.1:8188/')
    studio.leftFromAnEarlierRun = true
    mocks.launchOnce.mockImplementation(async (id: string) => {
      runLocal(id, 8190)
      return { ok: true }
    })

    expect(await openInComfy(PAGE, ON_THIS_COMPUTER)).toEqual({ opened: true })

    expect(studio.reloads).toEqual(['http://127.0.0.1:8190/'])
    expect(studio.loaded()).toHaveLength(1)
    expect(studio.loadedIntoAnEarlierRun).toBe(false)
  })

  it('never loads into the page of an earlier run while its window reloads', async () => {
    vi.useFakeTimers()
    const studio = windowFor(STUDIO.id, 'http://127.0.0.1:8190/')
    studio.leftFromAnEarlierRun = true
    runLocal(STUDIO.id, 8190)
    mocks.onLaunch.mockImplementation(() => {})

    const opening = openInComfy(PAGE, ON_THIS_COMPUTER)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(studio.loaded()).toHaveLength(0)

    studio.reload('http://127.0.0.1:8190/')
    await vi.advanceTimersByTimeAsync(1_000)

    expect(await opening).toEqual({ opened: true })
    expect(studio.loadedIntoAnEarlierRun).toBe(false)
  })

  it('leaves the window as it is for the next workflow', async () => {
    runLocal(STUDIO.id, 8190)

    expect(await openInComfy(PAGE, ON_THIS_COMPUTER)).toEqual({ opened: true })
    expect(await openInComfy(PAGE, ON_THIS_COMPUTER)).toEqual({ opened: true })

    const studio = mocks.windows.get(STUDIO.id) as FakeWindow
    expect(mocks.onLaunch).toHaveBeenCalledTimes(1)
    expect(studio.reloads).toEqual([])
    expect(studio.loaded()).toHaveLength(2)
  })

  it('waits for ComfyUI to finish starting before it loads the workflow', async () => {
    vi.useFakeTimers()
    runLocal(STUDIO.id, 8190, 'window')
    const studio = windowFor(STUDIO.id, 'http://127.0.0.1:8190/')
    studio.state = 'starting'

    const opening = openInComfy(PAGE, ON_THIS_COMPUTER)
    await vi.advanceTimersByTimeAsync(3_000)

    expect(studio.loaded()).toHaveLength(0)

    studio.state = 'ready'
    await vi.advanceTimersByTimeAsync(1_000)

    expect(await opening).toEqual({ opened: true })
    expect(studio.loaded()).toHaveLength(1)
  })

  it('gives a ComfyUI with no workflow open a few seconds to open one, then loads anyway', async () => {
    vi.useFakeTimers()
    runLocal(STUDIO.id, 8190, 'window')
    const studio = windowFor(STUDIO.id, 'http://127.0.0.1:8190/')
    studio.state = 'no-workflow'

    const opening = openInComfy(PAGE, ON_THIS_COMPUTER)
    await vi.advanceTimersByTimeAsync(NO_WORKFLOW_GRACE_MS - 1_000)

    expect(studio.loaded()).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(2_000)

    expect(await opening).toEqual({ opened: true })
    expect(studio.loaded()).toHaveLength(1)
  })

  it('opens in the build the page names instead of the one it runs on', async () => {
    runLocal(STUDIO.id, 8190, 'window')
    runLocal(LAB.id, 8191, 'window')
    const studio = windowFor(STUDIO.id, 'http://127.0.0.1:8190/')
    const lab = windowFor(LAB.id, 'http://127.0.0.1:8191/')

    expect(await openInComfy(PAGE, { ...ON_THIS_COMPUTER, build: LAB.id })).toEqual({
      opened: true
    })

    expect(lab.loaded()).toHaveLength(1)
    expect(studio.loaded()).toHaveLength(0)
  })

  it('picks a build on this computer when the page has not used one yet', async () => {
    mocks.pageBuild = null
    runLocal(LAB.id, 8191, 'window')
    mocks.builds = [{ ...STUDIO }, { ...LAB, port: 8191 }]
    const lab = windowFor(LAB.id, 'http://127.0.0.1:8191/')

    expect(await openInComfy(PAGE, ON_THIS_COMPUTER)).toEqual({ opened: true })

    expect(lab.loaded()).toHaveLength(1)
  })

  it('refuses a build that is not one of this computer builds and starts nothing', async () => {
    expect(await openInComfy(PAGE, { ...ON_THIS_COMPUTER, build: 'inst-gone' })).toEqual({
      opened: false,
      error: 'apps.local.openUnknownBuild'
    })
    expect(mocks.launchOnce).not.toHaveBeenCalled()
  })

  it('asks for a build when this computer has none', async () => {
    mocks.builds = []

    expect(await openInComfy(PAGE, ON_THIS_COMPUTER)).toEqual({
      opened: false,
      error: 'apps.local.noBuilds'
    })
  })

  it('says why the build did not start', async () => {
    mocks.launchOnce.mockResolvedValueOnce({ ok: false, message: 'Port 8188 is taken.' })

    expect(await openInComfy(PAGE, ON_THIS_COMPUTER)).toEqual({
      opened: false,
      error: 'Port 8188 is taken.'
    })
    expect(await openInComfy(PAGE, ON_THIS_COMPUTER)).toEqual({
      opened: false,
      error: 'apps.local.couldNotStart Studio'
    })
    expect(mocks.onLaunch).not.toHaveBeenCalled()
  })
})

describe('opening a run workflow in Comfy Cloud', () => {
  it('asks the person to add Comfy Cloud when there is none', async () => {
    expect(await openInComfy(PAGE, ON_CLOUD)).toEqual({
      opened: false,
      error: 'apps.local.openNoCloud'
    })
    expect(mocks.launchQuietly).not.toHaveBeenCalled()
  })

  it('loads it into the Comfy Cloud window when Comfy Cloud is open', async () => {
    mocks.records.push(CLOUD)
    runCloud(CLOUD.id)
    const cloud = windowFor(CLOUD.id, CLOUD_URL)

    expect(await openInComfy(PAGE, ON_CLOUD)).toEqual({ opened: true })

    expect(cloud.loaded()).toHaveLength(1)
    expect(mocks.launchQuietly).not.toHaveBeenCalled()
  })

  it('opens Comfy Cloud first when it is not open', async () => {
    mocks.records.push(CLOUD)
    mocks.launchQuietly.mockImplementation(async (inst: { id: string }) => {
      runCloud(inst.id)
      windowFor(inst.id, CLOUD_URL)
      return { ok: true }
    })

    expect(await openInComfy(PAGE, ON_CLOUD)).toEqual({ opened: true })

    expect(mocks.launchQuietly).toHaveBeenCalledWith(CLOUD)
    expect(mocks.onLaunch).not.toHaveBeenCalled()
  })

  it('opens Comfy Cloud once for two workflows sent together', async () => {
    mocks.records.push(CLOUD)
    mocks.launchQuietly.mockImplementation(async (inst: { id: string }) => {
      runCloud(inst.id)
      windowFor(inst.id, CLOUD_URL)
      return { ok: true }
    })

    expect(await Promise.all([openInComfy(PAGE, ON_CLOUD), openInComfy(PAGE, ON_CLOUD)])).toEqual([
      { opened: true },
      { opened: true }
    ])

    expect(mocks.launchQuietly).toHaveBeenCalledTimes(1)
    expect((mocks.windows.get(CLOUD.id) as FakeWindow).loaded()).toHaveLength(2)
  })

  it('waits for a Comfy Cloud that is already opening instead of opening it again', async () => {
    mocks.records.push(CLOUD)
    mocks.launchesUnderWay.add(CLOUD.id)
    mocks.otherLaunchSettled.mockImplementation(async (id: string) => {
      runCloud(id)
      windowFor(id, CLOUD_URL)
      mocks.launchesUnderWay.delete(id)
    })

    expect(await openInComfy(PAGE, ON_CLOUD)).toEqual({ opened: true })

    expect(mocks.launchQuietly).not.toHaveBeenCalled()
    expect((mocks.windows.get(CLOUD.id) as FakeWindow).loaded()).toHaveLength(1)
  })

  it('reports why Comfy Cloud did not open instead of asking to add it again', async () => {
    mocks.records.push(CLOUD)
    mocks.launchQuietly.mockResolvedValueOnce({ ok: false, message: 'Sign in to Comfy first.' })

    expect(await openInComfy(PAGE, ON_CLOUD)).toEqual({
      opened: false,
      error: 'Sign in to Comfy first.'
    })
    expect(await openInComfy(PAGE, ON_CLOUD)).toEqual({
      opened: false,
      error: 'apps.local.openCloudFailed'
    })
  })

  it('skips a Comfy Cloud that is still being set up', async () => {
    mocks.records.push({ ...CLOUD, status: 'installing' })

    expect(await openInComfy(PAGE, ON_CLOUD)).toEqual({
      opened: false,
      error: 'apps.local.openNoCloud'
    })
  })
})

describe('when the workflow does not open', () => {
  it.each([
    ['not a workflow', { ...ON_THIS_COMPUTER, prompt: { a: {} } }, 'apps.local.openNotWorkflow'],
    ['somewhere else', { ...ON_THIS_COMPUTER, where: 'browser' }, 'apps.local.openUnknownPlace'],
    ['a bad build id', { ...ON_THIS_COMPUTER, build: '../x' }, 'apps.local.openUnknownBuild'],
    ['carrying a key', { ...ON_THIS_COMPUTER, prompt: WITH_KEY }, 'apps.local.openCarriesKeys']
  ])('refuses a request %s and starts nothing', async (_what, request, error) => {
    expect(await openInComfy(PAGE, request)).toEqual({ opened: false, error })
    expect(mocks.launchOnce).not.toHaveBeenCalled()
    expect(mocks.launchQuietly).not.toHaveBeenCalled()
  })

  it('says ComfyUI did not take the workflow', async () => {
    runLocal(STUDIO.id, 8190, 'window')
    windowFor(STUDIO.id, 'http://127.0.0.1:8190/').takesWorkflow = false

    expect(await openInComfy(PAGE, ON_THIS_COMPUTER)).toEqual({
      opened: false,
      error: 'apps.local.openNotTaken'
    })
  })

  it('stops waiting on a workflow ComfyUI never finishes loading', async () => {
    vi.useFakeTimers()
    runLocal(STUDIO.id, 8190, 'window')
    windowFor(STUDIO.id, 'http://127.0.0.1:8190/').finishesLoading = false

    const opening = openInComfy(PAGE, ON_THIS_COMPUTER)
    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS + 1_000)

    expect(await opening).toEqual({ opened: false, error: 'apps.local.openNotTaken' })
  })

  it('gives up when no ComfyUI window appears', async () => {
    vi.useFakeTimers()
    mocks.onLaunch.mockImplementation(() => {})
    runLocal(STUDIO.id, 8190)

    const opening = openInComfy(PAGE, ON_THIS_COMPUTER)
    await vi.advanceTimersByTimeAsync(WINDOW_TIMEOUT_MS + 1_000)

    expect(await opening).toEqual({ opened: false, error: 'apps.local.openNoWindow' })
  })
})

describe('the builds a page can pick from', () => {
  it('are this computer builds by id and name', async () => {
    expect(await localBuilds()).toEqual([
      { id: STUDIO.id, name: STUDIO.name },
      { id: LAB.id, name: LAB.name }
    ])
  })

  it('come most recently launched first, which the page labels Last used', async () => {
    mocks.builds = [
      { ...STUDIO, lastLaunchedAt: 100 },
      { ...LAB, lastLaunchedAt: 300 },
      { id: 'inst-never', name: 'Never launched', port: null, lastLaunchedAt: 0 }
    ]

    expect((await localBuilds()).map((build) => build.id)).toEqual([
      LAB.id,
      STUDIO.id,
      'inst-never'
    ])
  })
})
