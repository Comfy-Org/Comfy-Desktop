import type { WebContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  records: [] as Record<string, unknown>[],
  sessions: new Map<string, Record<string, unknown>>(),
  launching: new Set<string>(),
  windows: new Map<string, unknown>(),
  pages: [] as { send: (channel: string, event: unknown) => void }[],
  handleLaunch: (_ctx: unknown): Promise<Record<string, unknown>> => Promise.resolve({ ok: false }),
  stopRunning: (_id: string): Promise<void> => Promise.resolve(),
  probeQueue: (_port: number): Promise<unknown> => Promise.resolve({ running: 0, pending: 0 }),
  startModelJob: (_options: Record<string, unknown>): Promise<unknown> => Promise.resolve(null),
  makeRelay: (): unknown => null,
  hearFromComfy: (_message: unknown): void => {}
}))

vi.mock('fs', () => ({
  promises: { readFile: async () => Promise.reject(new Error('ENOENT')) }
}))
vi.mock('../host/registry', () => ({
  getEntryByInstallationId: (id: string) => mocks.windows.get(id)
}))
vi.mock('../installations', () => ({
  list: async () => mocks.records,
  get: async (id: string) => mocks.records.find((record) => record['id'] === id) ?? null
}))
vi.mock('../lib/comfyDownloadManager', () => ({
  startManagedModelJob: (options: Record<string, unknown>) => mocks.startModelJob(options)
}))
vi.mock('../lib/comfyProcessRecord', () => ({
  probeQueue: (port: number) => mocks.probeQueue(port)
}))
vi.mock('../lib/i18n', () => ({
  t: (key: string, params?: Record<string, unknown>) =>
    params ? `${key} ${Object.values(params).join(' ')}` : key
}))
vi.mock('../lib/ipc/sessionActions/launch', () => ({
  handleLaunch: (ctx: unknown) => mocks.handleLaunch(ctx)
}))
vi.mock('../lib/ipc/shared', async () => {
  const { EventEmitter: Emitter } = await import('node:events')
  return {
    _hasActiveLaunch: (id: string) => mocks.launching.has(id),
    _operationAborts: new Map(),
    _runningSessions: mocks.sessions,
    sessionLifecycleEvents: new Emitter(),
    sourceMap: { standalone: { category: 'local' } },
    stopRunning: (id: string) => mocks.stopRunning(id)
  }
})
vi.mock('../lib/models', () => ({
  resolveComfyDir: (installPath: string) => `${installPath}/ComfyUI`
}))
vi.mock('../lib/process', () => ({ COMFY_BOOT_TIMEOUT_MS: 300_000 }))
vi.mock('./appsPages', () => ({ liveAppsPages: () => mocks.pages }))
vi.mock('./localRelay', () => ({
  createLocalRelay: (onMessage: (message: unknown) => void) => {
    mocks.hearFromComfy = onMessage
    return mocks.makeRelay()
  }
}))

import { sessionLifecycleEvents } from '../lib/ipc/shared'
import * as local from './localComfy'

const { LOCAL_EVENT_CHANNEL, LOCAL_IDLE_STOP_MS, _resetForTest } = local

const STUDIO = 'studio'
const PORT = 8190
const LAB = 'lab'
const LAB_PORT = 8191
const RUN = '0b1c2d3e-aaaa-bbbb-cccc-0123456789ab'
const OTHER_RUN = 'ffffffff-aaaa-bbbb-cccc-0123456789ab'
const WANT = { minVersion: '0.41.0' }
const CUTOUT = { filename: 'cutout_00001_.png', subfolder: 'apps', type: 'output' }
const BIREFNET = {
  url: 'https://huggingface.co/Comfy-Org/BiRefNet/resolve/main/background_removal/birefnet.safetensors',
  folder: 'background_removal',
  name: 'birefnet.safetensors'
}

interface Asked {
  port: number
  method: string
  path: string
  body: unknown
}

class FakeComfy {
  asked: Asked[] = []
  queue = {
    queue_running: [[4, OTHER_RUN, { 3: { class_type: 'KSampler' } }, { client_id: 'theirs' }]],
    queue_pending: [[5, RUN, { 1: {} }, { comfy_app: { name: 'Remove Background' } }]]
  }
  promptAnswer: { status: number; body: unknown } = {
    status: 200,
    body: { prompt_id: RUN, number: 5, node_errors: {} }
  }

  answer = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input))
    const path = url.pathname + url.search
    const body =
      typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : (init.body ?? null)
    this.asked.push({ port: Number(url.port), method: init.method ?? 'GET', path, body })
    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { 'content-type': 'application/json' }
      })
    if (![PORT, LAB_PORT].includes(Number(url.port))) throw new TypeError('fetch failed')
    if (url.pathname === '/queue' && init.method !== 'POST') return json(this.queue)
    if (url.pathname === '/prompt') return json(this.promptAnswer.body, this.promptAnswer.status)
    if (url.pathname === `/history/${RUN}`) {
      return json({
        [RUN]: { status: { completed: true }, outputs: { save: { images: [CUTOUT] } } }
      })
    }
    if (url.pathname === '/view') {
      return new Response(new Uint8Array([137, 80, 78, 71]), {
        headers: { 'content-type': 'image/png' }
      })
    }
    if (url.pathname === '/upload/image') {
      return json({ name: 'photo.png', subfolder: 'comfy-apps', type: 'input' })
    }
    return json({})
  }

  calls(path: string): Asked[] {
    return this.asked.filter((asked) => asked.path === path)
  }
}

interface FakeRelay {
  clientId: string
  follow: ReturnType<typeof vi.fn>
  whenOpen: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
}

type FakePage = { send: ReturnType<typeof vi.fn<(channel: string, event: unknown) => void>> }

let comfy: FakeComfy
let relay: FakeRelay
let page: FakePage

const asContents = (from: FakePage): WebContents => from as unknown as WebContents
const localState = (want: unknown, from: FakePage = page) =>
  local.localState(asContents(from), want)
const startLocal = (want: unknown, from: FakePage = page) =>
  local.startLocal(asContents(from), want)
const localFetch = (raw: unknown, from: FakePage = page) => local.localFetch(asContents(from), raw)
const localDownload = (raw: unknown, from: FakePage = page) =>
  local.localDownload(asContents(from), raw)

function fakeRelay(clientId: string): FakeRelay {
  return { clientId, follow: vi.fn(), whenOpen: vi.fn(async () => true), stop: vi.fn() }
}
let launches: Record<string, unknown>[]
let stopped: string[]

function build(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: STUDIO,
    name: 'Studio',
    sourceId: 'standalone',
    installPath: '/builds/studio',
    status: 'installed',
    version: 'v0.42.1',
    ...over
  }
}

function running(id = STUDIO, port = PORT): void {
  mocks.sessions.set(id, { port })
}

function startsWhenLaunched(port = PORT): void {
  mocks.handleLaunch = async (ctx) => {
    const launch = ctx as { installationId: string }
    launches.push(ctx as Record<string, unknown>)
    running(launch.installationId, port)
    return { ok: true, mode: 'console', port }
  }
}

function textOf(answer: { body: Uint8Array }): unknown {
  return JSON.parse(new TextDecoder().decode(answer.body))
}

function post(path: string, body: unknown): Promise<{ status: number; body: Uint8Array }> {
  return localFetch({ method: 'POST', path, body: JSON.stringify(body) })
}

async function startARun(): Promise<void> {
  await post('/prompt', { prompt: { 1: { class_type: 'LoadImage', inputs: {} } } })
}

function sentToPage(): unknown[] {
  return page.send.mock.calls
    .filter(([channel]) => channel === LOCAL_EVENT_CHANNEL)
    .map(([, event]) => event)
}

beforeEach(() => {
  vi.useFakeTimers()
  _resetForTest()
  comfy = new FakeComfy()
  vi.stubGlobal('fetch', vi.fn(comfy.answer))
  relay = fakeRelay('desktop-client')
  page = { send: vi.fn<(channel: string, event: unknown) => void>() }
  launches = []
  stopped = []
  mocks.makeRelay = () => relay
  mocks.pages = [page]
  mocks.records = [build()]
  mocks.sessions.clear()
  mocks.launching.clear()
  mocks.windows.clear()
  mocks.handleLaunch = async () => ({ ok: false })
  mocks.stopRunning = async (id) => {
    stopped.push(id)
    mocks.sessions.delete(id)
  }
  mocks.probeQueue = async () => ({ running: 0, pending: 0 })
  mocks.startModelJob = async () => null
})

afterEach(() => {
  _resetForTest()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('finding a ComfyUI on this computer for an app', () => {
  it('says to add a build when there is none', async () => {
    mocks.records = []

    expect(await localState(WANT)).toEqual({
      state: 'unsupported',
      error: 'apps.local.noBuilds'
    })
  })

  it('says which ComfyUI the app needs when every build is older', async () => {
    mocks.records = [build({ version: 'v0.37.0' })]

    expect(await localState(WANT)).toEqual({
      state: 'unsupported',
      error: 'apps.local.tooOld 0.41.0'
    })
  })

  it('offers a stopped build that fits, by its name and version', async () => {
    expect(await localState(WANT)).toEqual({
      state: 'stopped',
      own: true,
      name: 'Studio',
      version: '0.42.1'
    })
    expect(relay.follow).not.toHaveBeenCalled()
  })

  it('says a build is running and follows it, without starting anything', async () => {
    running()

    expect(await localState(WANT)).toEqual({
      state: 'running',
      own: true,
      name: 'Studio',
      version: '0.42.1',
      clientId: 'desktop-client'
    })
    expect(relay.follow).toHaveBeenCalledWith(PORT)
    expect(launches).toEqual([])
  })
})

describe('starting it', () => {
  it('starts the build without a window and answers once Desktop is listening to it', async () => {
    startsWhenLaunched()

    expect(await startLocal(WANT)).toEqual({
      state: 'running',
      own: true,
      name: 'Studio',
      version: '0.42.1',
      clientId: 'desktop-client'
    })
    expect(launches).toHaveLength(1)
    expect(launches[0]).toMatchObject({
      installationId: STUDIO,
      inst: { id: STUDIO },
      actionData: { launchModeOverride: 'console', autoPortOnConflict: true }
    })
    expect(relay.follow).toHaveBeenCalledWith(PORT)
    expect(relay.whenOpen).toHaveBeenCalled()
  })

  it('starts it once when two pages ask together', async () => {
    startsWhenLaunched()

    const [one, other] = await Promise.all([startLocal(WANT), startLocal(WANT)])

    expect(one.state).toBe('running')
    expect(other.state).toBe('running')
    expect(launches).toHaveLength(1)
  })

  it('leaves a running build as it is', async () => {
    running()
    startsWhenLaunched()

    expect((await startLocal(WANT)).state).toBe('running')
    expect(launches).toEqual([])
  })

  it('waits for a start the person already began instead of starting it again', async () => {
    mocks.launching.add(STUDIO)
    startsWhenLaunched()

    const starting = startLocal(WANT)
    await vi.advanceTimersByTimeAsync(1_200)
    running()
    mocks.launching.delete(STUDIO)
    await vi.advanceTimersByTimeAsync(600)

    expect((await starting).state).toBe('running')
    expect(launches).toEqual([])
  })

  it('says why when the build does not start', async () => {
    mocks.handleLaunch = async () => ({ ok: false, message: 'Port 8188 is in use.' })

    expect(await startLocal(WANT)).toEqual({
      state: 'stopped',
      own: true,
      name: 'Studio',
      version: '0.42.1',
      error: 'Port 8188 is in use.'
    })
  })

  it('names the build when the launch gives no reason, or throws', async () => {
    mocks.handleLaunch = async () => ({ ok: false })
    expect((await startLocal(WANT)).error).toBe('apps.local.couldNotStart Studio')

    mocks.handleLaunch = async () => {
      throw new Error('spawn failed')
    }
    expect((await startLocal(WANT)).error).toBe('spawn failed')
  })

  it('starts nothing when no build fits', async () => {
    mocks.records = []
    startsWhenLaunched()

    expect((await startLocal(WANT)).state).toBe('unsupported')
    expect(launches).toEqual([])
  })
})

describe('a run from an app page', () => {
  beforeEach(async () => {
    running()
    await localState(WANT)
  })

  it("is sent as Desktop's client, whatever client the page named", async () => {
    const prompt = { 1: { class_type: 'LoadImage', inputs: { image: 'a.png' } } }
    const extraData = { comfy_app: { name: 'Remove Background', seconds: 12 } }

    const answer = await post('/prompt', {
      prompt,
      client_id: 'the-page',
      extra_data: extraData
    })

    expect(answer.status).toBe(200)
    expect(textOf(answer)).toMatchObject({ prompt_id: RUN })
    expect(comfy.calls('/prompt')).toEqual([
      {
        port: PORT,
        method: 'POST',
        path: '/prompt',
        body: { prompt, client_id: 'desktop-client', extra_data: extraData }
      }
    ])
    expect(relay.whenOpen).toHaveBeenCalled()
  })

  it('can then be read, and its result files fetched', async () => {
    await startARun()

    const history = await localFetch({ path: `/history/${RUN}` })
    const file = await localFetch({ path: `/view?${new URLSearchParams(CUTOUT)}` })

    expect(textOf(history)).toMatchObject({ [RUN]: { status: { completed: true } } })
    expect(file).toMatchObject({ status: 200, contentType: 'image/png' })
    expect([...file.body]).toEqual([137, 80, 78, 71])
    expect(comfy.calls(`/view?${new URLSearchParams(CUTOUT)}`)).toHaveLength(1)
  })

  it('can be taken out of the queue and stopped', async () => {
    await startARun()

    expect((await post('/queue', { delete: [RUN] })).status).toBe(200)
    expect((await post('/interrupt', { prompt_id: RUN })).status).toBe(200)
    expect(comfy.asked.slice(-2)).toEqual([
      { port: PORT, method: 'POST', path: '/queue', body: { delete: [RUN] } },
      { port: PORT, method: 'POST', path: '/interrupt', body: { prompt_id: RUN } }
    ])
  })

  it("passes ComfyUI's own refusal of a graph back to the page", async () => {
    comfy.promptAnswer = { status: 400, body: { error: { type: 'prompt_no_outputs' } } }

    const answer = await post('/prompt', { prompt: {} })

    expect(answer.status).toBe(400)
    expect(textOf(answer)).toEqual({ error: { type: 'prompt_no_outputs' } })
  })
})

describe("what is not the page's own", () => {
  beforeEach(async () => {
    running()
    await localState(WANT)
  })

  it('cannot be read, fetched, removed or stopped', async () => {
    await startARun()
    const before = comfy.asked.length

    const refused = [
      await localFetch({ path: `/history/${OTHER_RUN}` }),
      await localFetch({ path: '/view?filename=someone-elses.png&type=output' }),
      await post('/queue', { delete: [RUN, OTHER_RUN] }),
      await post('/interrupt', { prompt_id: OTHER_RUN })
    ]

    expect(refused.map((answer) => answer.status)).toEqual([403, 403, 403, 403])
    expect(textOf(refused[0]!)).toEqual({ error: 'apps.local.notForwarded' })
    expect(comfy.asked).toHaveLength(before)
  })

  it('cannot be fetched before the run that made it was read', async () => {
    await startARun()

    const early = await localFetch({ path: `/view?${new URLSearchParams(CUTOUT)}` })

    expect(early.status).toBe(403)
  })

  it('shows in the queue only as something ahead, with no id or graph', async () => {
    await startARun()

    const queue = await localFetch({ path: '/queue' })

    expect(textOf(queue)).toEqual({
      running: [{ n: 4, id: null, app: null, seconds: null }],
      pending: [{ n: 5, id: RUN, app: 'Remove Background', seconds: null }]
    })
    expect(new TextDecoder().decode(queue.body)).not.toContain('KSampler')
  })

  it('is out of reach through any other request, which never gets to ComfyUI', async () => {
    const refused = [
      await localFetch({ path: '/system_stats' }),
      await localFetch({ path: '/history' }),
      await localFetch({ path: '/userdata/workflows' }),
      await post('/free', { unload_models: true }),
      await post('/queue', { clear: true }),
      await localFetch({ method: 'DELETE', path: '/queue' }),
      await localFetch(null)
    ]

    expect(refused.map((answer) => answer.status)).toEqual([403, 403, 403, 403, 403, 403, 403])
    expect(comfy.asked).toEqual([])
  })
})

describe('two app pages open in two windows', () => {
  it('each reach the ComfyUI their own app was given, as its own client', async () => {
    const other: FakePage = { send: vi.fn<(channel: string, event: unknown) => void>() }
    const relays = [fakeRelay('client-for-studio'), fakeRelay('client-for-lab')]
    mocks.makeRelay = () => relays.shift()
    mocks.records = [
      build({ version: 'v0.30.0', lastLaunchedAt: 900 }),
      build({ id: LAB, name: 'Lab', installPath: '/builds/lab', lastLaunchedAt: 100 })
    ]
    running(STUDIO, PORT)
    running(LAB, LAB_PORT)

    const forOlderApp = await localState({ minVersion: '0.21.0' })
    const forNewerApp = await localState({ minVersion: '0.41.0' }, other)
    await post('/prompt', { prompt: { 1: {} } })
    await localFetch(
      { method: 'POST', path: '/prompt', body: JSON.stringify({ prompt: { 2: {} } }) },
      other
    )

    expect(forOlderApp).toMatchObject({ name: 'Studio', clientId: 'client-for-studio' })
    expect(forNewerApp).toMatchObject({ name: 'Lab', clientId: 'client-for-lab' })
    expect(comfy.calls('/prompt').map(({ port, body }) => [port, body])).toEqual([
      [PORT, { prompt: { 1: {} }, client_id: 'client-for-studio', extra_data: {} }],
      [LAB_PORT, { prompt: { 2: {} }, client_id: 'client-for-lab', extra_data: {} }]
    ])
  })
})

describe('sending a picture', () => {
  it("puts it in the apps folder of ComfyUI's input, without replacing a file of that name", async () => {
    running()
    await localState(WANT)

    const answer = await localFetch({
      method: 'POST',
      path: '/upload/image',
      body: new Uint8Array([1, 2, 3]),
      fileName: 'photo.png'
    })

    const [sent] = comfy.calls('/upload/image')
    const form = sent?.body as FormData
    const file = form.get('image') as File
    expect(textOf(answer)).toEqual({ name: 'photo.png', subfolder: 'comfy-apps', type: 'input' })
    expect(file.name).toBe('photo.png')
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([1, 2, 3])
    expect(form.get('subfolder')).toBe('comfy-apps')
    expect(form.get('type')).toBe('input')
    expect(form.has('overwrite')).toBe(false)
  })
})

describe('when ComfyUI is not there', () => {
  it('rejects, so the page can say Desktop could not reach it', async () => {
    await localState(WANT)

    await expect(localFetch({ path: '/queue' })).rejects.toThrow('apps.local.notRunning')
    expect(comfy.asked).toEqual([])
  })

  it('rejects before any build was chosen', async () => {
    await expect(localFetch({ path: '/queue' })).rejects.toThrow('apps.local.notRunning')
  })

  it('rejects when the build stopped answering', async () => {
    running(STUDIO, 9_999)
    await localState(WANT)

    await expect(localFetch({ path: '/queue' })).rejects.toThrow()
  })

  it('stops following a build that has stopped', async () => {
    running()
    await localState(WANT)

    mocks.sessions.delete(STUDIO)
    sessionLifecycleEvents.emit('changed')

    expect(relay.stop).toHaveBeenCalled()
  })
})

describe('what ComfyUI says about a run', () => {
  beforeEach(async () => {
    running()
    await localState(WANT)
    await startARun()
  })

  it("reaches the app page for the page's own run", () => {
    mocks.hearFromComfy({ type: 'execution_start', data: { prompt_id: RUN, timestamp: 1 } })
    mocks.hearFromComfy({
      type: 'progress',
      data: { prompt_id: RUN, node: 'cut', value: 2, max: 8 }
    })

    expect(sentToPage()).toEqual([
      { type: 'execution_start', data: { prompt_id: RUN, timestamp: 1 } },
      { type: 'progress', data: { prompt_id: RUN, node: 'cut', value: 2, max: 8 } }
    ])
  })

  it('does not reach it for another run, or for anything that is not a run update', () => {
    mocks.hearFromComfy({ type: 'executing', data: { prompt_id: OTHER_RUN, node: '3' } })
    mocks.hearFromComfy({ type: 'status', data: { status: { exec_info: { queue_remaining: 2 } } } })
    mocks.hearFromComfy({ type: 'logs', data: { prompt_id: RUN, entries: ['secret path'] } })
    mocks.hearFromComfy({ type: 'executing' })
    mocks.hearFromComfy('junk')
    mocks.hearFromComfy(null)

    expect(sentToPage()).toEqual([])
  })
})

describe('downloading a model for an app', () => {
  function modelJob(outcome: unknown) {
    const release = vi.fn()
    const started: Record<string, unknown>[] = []
    mocks.startModelJob = async (options) => {
      started.push(options)
      return { id: 'job', url: BIREFNET.url, savePath: '/models/x', release, completion: outcome }
    }
    return { release, started }
  }

  beforeEach(async () => {
    running()
    await localState(WANT)
  })

  it('saves it into the build the app runs on, and says when it is there', async () => {
    const job = modelJob(Promise.resolve({ status: 'completed', savePath: '/models/x' }))

    expect(await localDownload(BIREFNET)).toEqual({ state: 'done' })
    expect(job.started).toEqual([
      expect.objectContaining({
        url: BIREFNET.url,
        filename: 'birefnet.safetensors',
        directory: 'background_removal',
        installationId: STUDIO
      })
    ])
    expect(job.release).toHaveBeenCalledTimes(1)
  })

  it('tells the app page how far along it is, without flooding it', async () => {
    const job = modelJob(new Promise(() => {}))
    void localDownload(BIREFNET)
    await vi.advanceTimersByTimeAsync(0)
    const progress = job.started[0]?.['onProgress'] as (done: number, total: number) => void

    progress(10, 400)
    progress(20, 400)
    await vi.advanceTimersByTimeAsync(300)
    progress(200, 400)
    progress(400, 400)

    expect(sentToPage()).toEqual([
      { type: 'download', data: { name: 'birefnet.safetensors', done: 10, total: 400 } },
      { type: 'download', data: { name: 'birefnet.safetensors', done: 200, total: 400 } },
      { type: 'download', data: { name: 'birefnet.safetensors', done: 400, total: 400 } }
    ])
  })

  it('says why a download failed, and when the person cancelled it', async () => {
    const failed = modelJob(Promise.resolve({ status: 'error', error: 'Disk is full.' }))
    expect(await localDownload(BIREFNET)).toEqual({ state: 'failed', error: 'Disk is full.' })
    expect(failed.release).toHaveBeenCalledTimes(1)

    modelJob(Promise.resolve({ status: 'cancelled' }))
    expect(await localDownload(BIREFNET)).toEqual({ state: 'cancelled' })
  })

  it('downloads nothing that is not a safetensors file on Hugging Face', async () => {
    const job = modelJob(Promise.resolve({ status: 'completed', savePath: '/x' }))

    expect(
      await localDownload({ ...BIREFNET, url: 'https://evil.example/birefnet.safetensors' })
    ).toEqual({ state: 'failed', error: 'apps.local.modelRefused' })
    expect(await localDownload({ ...BIREFNET, folder: '../custom_nodes' })).toMatchObject({
      state: 'failed'
    })
    expect(job.started).toEqual([])
  })

  it('downloads nothing while no ComfyUI is running for apps', async () => {
    const job = modelJob(Promise.resolve({ status: 'completed', savePath: '/x' }))
    mocks.sessions.clear()

    expect(await localDownload(BIREFNET)).toEqual({
      state: 'failed',
      error: 'apps.local.notRunning'
    })
    expect(job.started).toEqual([])
  })
})

describe('a ComfyUI that Desktop started for apps', () => {
  beforeEach(async () => {
    startsWhenLaunched()
    await startLocal(WANT)
  })

  it('is stopped once it has sat unused for ten minutes with nothing queued', async () => {
    await vi.advanceTimersByTimeAsync(LOCAL_IDLE_STOP_MS - 1)
    expect(stopped).toEqual([])

    await vi.advanceTimersByTimeAsync(1)

    expect(stopped).toEqual([STUDIO])
  })

  it('keeps running while an app page keeps using it', async () => {
    await vi.advanceTimersByTimeAsync(LOCAL_IDLE_STOP_MS - 1_000)
    await localFetch({ path: '/queue' })
    await vi.advanceTimersByTimeAsync(LOCAL_IDLE_STOP_MS - 1_000)

    expect(stopped).toEqual([])
  })

  it('keeps running while it has work queued, and is stopped after that', async () => {
    mocks.probeQueue = async () => ({ running: 1, pending: 0 })
    await vi.advanceTimersByTimeAsync(LOCAL_IDLE_STOP_MS)
    expect(stopped).toEqual([])

    mocks.probeQueue = async () => ({ running: 0, pending: 0 })
    await vi.advanceTimersByTimeAsync(LOCAL_IDLE_STOP_MS)

    expect(stopped).toEqual([STUDIO])
  })

  it('keeps running when its queue cannot be read', async () => {
    mocks.probeQueue = async () => null
    await vi.advanceTimersByTimeAsync(LOCAL_IDLE_STOP_MS)

    expect(stopped).toEqual([])
  })

  it('keeps running while a model is still downloading for an app, however long that takes', async () => {
    let finish: (outcome: unknown) => void = () => {}
    mocks.startModelJob = async () => ({
      id: 'job',
      release: vi.fn(),
      completion: new Promise((resolve) => (finish = resolve))
    })
    const downloading = localDownload(BIREFNET)
    await vi.advanceTimersByTimeAsync(LOCAL_IDLE_STOP_MS * 3)
    expect(stopped).toEqual([])

    finish({ status: 'completed', savePath: '/models/x' })
    await downloading
    await vi.advanceTimersByTimeAsync(LOCAL_IDLE_STOP_MS)

    expect(stopped).toEqual([STUDIO])
  })

  it('is left alone for good once the person opens its window', async () => {
    mocks.windows.set(STUDIO, { window: {} })
    await vi.advanceTimersByTimeAsync(LOCAL_IDLE_STOP_MS * 3)

    expect(stopped).toEqual([])
  })

  it('is known as running for apps only, so opening it shows a new ComfyUI window', () => {
    expect(local.isRunningForAppsOnly(STUDIO)).toBe(true)
  })

  it('is no longer running for apps only once it stops', () => {
    mocks.sessions.delete(STUDIO)

    expect(local.isRunningForAppsOnly(STUDIO)).toBe(false)
  })

  it('is no longer running for apps only once a window is open for it', () => {
    mocks.windows.set(STUDIO, { window: {} })

    expect(local.isRunningForAppsOnly(STUDIO)).toBe(false)
  })

  it('is stopped when every Desktop window closes', async () => {
    await local.stopBuildsRunningForAppsOnly()

    expect(stopped).toEqual([STUDIO])
    expect(local.isRunningForAppsOnly(STUDIO)).toBe(false)
  })

  it('is not stopped twice once the idle stop comes round after that', async () => {
    await local.stopBuildsRunningForAppsOnly()
    await vi.advanceTimersByTimeAsync(LOCAL_IDLE_STOP_MS * 3)

    expect(stopped).toEqual([STUDIO])
  })

  it('keeps running when every Desktop window closes once the person opened its window', async () => {
    mocks.windows.set(STUDIO, { window: {} })

    await local.stopBuildsRunningForAppsOnly()

    expect(stopped).toEqual([])
  })
})

describe('a ComfyUI the person started themselves', () => {
  it('is never stopped by apps, however long it sits unused', async () => {
    running()
    await startLocal(WANT)
    await localFetch({ path: '/queue' })

    await vi.advanceTimersByTimeAsync(LOCAL_IDLE_STOP_MS * 3)

    expect(stopped).toEqual([])
  })

  it('is not running for apps only, so opening it keeps its own window', async () => {
    running()
    await startLocal(WANT)

    expect(local.isRunningForAppsOnly(STUDIO)).toBe(false)
  })

  it('is not stopped by apps when every Desktop window closes', async () => {
    running()
    await startLocal(WANT)

    await local.stopBuildsRunningForAppsOnly()

    expect(stopped).toEqual([])
  })
})
