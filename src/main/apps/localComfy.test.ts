// @vitest-environment node
import type { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as LocalComfyModule from './localComfy'

interface FakeSession {
  proc: null
  port: number
  mode: string
  installationName: string
  startedAt: number
  inputDir?: string
}

interface FakeInstall {
  id: string
  name: string
  sourceId: string
  installPath: string
  status: string
  useSharedInput?: boolean
  inputDir?: string
}

interface FakeComfy {
  version: string
  running: unknown[]
  pending: unknown[]
  history: Record<string, unknown>
  files: Set<string>
  calls: string[]
  replaced: string[]
}

const fake = vi.hoisted(() => ({
  sharedInput: '/shared/input',
  sessions: new Map<string, FakeSession>(),
  lifecycle: null as EventEmitter | null,
  installs: [] as FakeInstall[],
  diskVersion: new Map<string, string>(),
  ports: new Map<string, number>(),
  apps: { id: null as string | null, inst: null as FakeInstall | null },
  versionGate: null as Promise<void> | null,
  promptGate: null as Promise<void> | null,
  queueGate: null as { open: Promise<void>; answerAsAsked: boolean } | null,
  servers: new Map<number, FakeComfy>(),
  sockets: [] as Array<{ url: string; closed: boolean }>
}))

function sessionFor(id: string, mode = 'console'): FakeSession {
  const inst = [...fake.installs, fake.apps.inst].find((i) => i?.id === id)
  return {
    proc: null,
    port: fake.ports.get(id)!,
    mode,
    installationName: inst?.name ?? id,
    startedAt: Date.now(),
    inputDir: inst?.useSharedInput === false ? inst.inputDir : fake.sharedInput
  }
}

const launchConsole = vi.hoisted(() =>
  vi.fn(async (inst: { id: string }) => {
    fake.sessions.set(inst.id, sessionFor(inst.id))
    fake.lifecycle!.emit('changed')
    return { ok: true }
  })
)

const stopRunning = vi.hoisted(() =>
  vi.fn(async (id: string) => {
    fake.sessions.delete(id)
    fake.lifecycle!.emit('changed')
  })
)

vi.mock('../host/registry', () => ({ getEntryByInstallationId: () => undefined }))
vi.mock('../lib/comfyDownloadManager', () => ({ startManagedModelJob: vi.fn() }))
vi.mock('../lib/process', () => ({ COMFY_BOOT_TIMEOUT_MS: 5_000 }))
vi.mock('../lib/ipc/shared', async () => {
  const { EventEmitter: Emitter } = await import('events')
  fake.lifecycle ??= new Emitter()
  return {
    _getActiveLaunchIds: () => [],
    _getLaunchingInstances: () => [],
    _isStopping: () => false,
    _operationAborts: new Map(),
    _runningSessions: fake.sessions,
    sessionLifecycleEvents: fake.lifecycle,
    stopRunning
  }
})
vi.mock('./appsBuild', async () => {
  const { reusableInstalls } = await import('./appsBuildRules')
  return {
    appsBuildId: () => fake.apps.id,
    appsLocalOff: async () => null,
    appsSetupRunning: () => false,
    cancelAppsSetup: () => ({ cancelled: false }),
    ensureAppsBuild: async () => {
      fake.apps.inst = {
        id: 'apps',
        name: 'Apps',
        sourceId: 'standalone',
        installPath: '/apps',
        status: 'installed'
      }
      fake.apps.id = 'apps'
      return fake.apps.inst
    },
    findApps: async () => fake.apps.inst,
    installVersion: async (inst: { id: string }) => {
      const gate = fake.versionGate
      fake.versionGate = null
      if (gate) await gate
      return fake.diskVersion.get(inst.id) ?? null
    },
    launchAppsBuild: launchConsole,
    launchConsole,
    planAppsBuild: async () => ({ data: {}, bytes: 0 }),
    reusableLocal: async () => reusableInstalls(fake.installs, () => 'local'),
    sharedInputDir: () => fake.sharedInput
  }
})

class FakeSocket {
  url: string
  closed = false
  binaryType = ''
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  constructor(url: string) {
    this.url = url
    fake.sockets.push(this)
  }
  close(): void {
    this.closed = true
  }
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })

function fakeFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input))
  const server = fake.servers.get(Number(url.port))
  if (!server || ![...fake.sessions.values()].some((s) => s.port === Number(url.port))) {
    return Promise.reject(new TypeError('fetch failed'))
  }
  const method = init?.method ?? 'GET'
  server.calls.push(`${method} ${url.pathname}`)
  const p = url.pathname
  if (p === '/system_stats')
    return Promise.resolve(json({ system: { comfyui_version: server.version } }))
  if (p === '/prompt' && method === 'GET') {
    return Promise.resolve(
      json({ exec_info: { queue_remaining: server.running.length + server.pending.length } })
    )
  }
  if (p === '/prompt') {
    const id = `apps-${url.port}-${server.calls.length}`
    server.pending.push([server.pending.length, id, {}, {}, []])
    const answer = () => json({ prompt_id: id, number: 1, node_errors: {} })
    return fake.promptGate ? fake.promptGate.then(answer) : Promise.resolve(answer())
  }
  if (p === '/queue' && method === 'GET') {
    const answer = () => json({ queue_running: server.running, queue_pending: server.pending })
    const gate = fake.queueGate
    fake.queueGate = null
    if (!gate) return Promise.resolve(answer())
    if (!gate.answerAsAsked) return gate.open.then(answer)
    const asked = answer()
    return gate.open.then(() => asked)
  }
  if (p.startsWith('/history/')) {
    const id = p.slice('/history/'.length)
    return Promise.resolve(json(id in server.history ? { [id]: server.history[id] } : {}))
  }
  if (p === '/view') {
    const key = [
      url.searchParams.get('type'),
      url.searchParams.get('subfolder'),
      url.searchParams.get('filename')
    ].join('/')
    return Promise.resolve(
      server.files.has(key)
        ? new Response(new TextEncoder().encode(`${url.port}/${key}`))
        : new Response('', { status: 404 })
    )
  }
  if (p === '/upload/image') {
    const form = init!.body as FormData
    const asked = (form.get('image') as File).name
    const overwrite = form.get('overwrite') === 'true'
    const dot = asked.lastIndexOf('.')
    let name = asked
    for (let i = 1; !overwrite && server.files.has(`input//${name}`); i++) {
      name = `${asked.slice(0, dot)} (${i})${asked.slice(dot)}`
    }
    if (server.files.has(`input//${name}`)) server.replaced.push(name)
    server.files.add(`input//${name}`)
    return Promise.resolve(json({ name, subfolder: '', type: 'input' }))
  }
  return Promise.resolve(new Response('', { status: 200 }))
}

function addInstall(id: string, port: number, disk: string, served = disk): FakeComfy {
  fake.installs.push({
    id,
    name: `ComfyUI ${id}`,
    sourceId: 'standalone',
    installPath: `/${id}`,
    status: 'installed'
  })
  fake.diskVersion.set(id, disk)
  fake.ports.set(id, port)
  const server: FakeComfy = {
    version: served,
    running: [],
    pending: [],
    history: {},
    files: new Set(),
    calls: [],
    replaced: []
  }
  fake.servers.set(port, server)
  return server
}

function addAppsServer(port: number): FakeComfy {
  fake.ports.set('apps', port)
  const server: FakeComfy = {
    version: '0.42.1',
    running: [],
    pending: [],
    history: {},
    files: new Set(),
    calls: [],
    replaced: []
  }
  fake.servers.set(port, server)
  return server
}

function run(id: string, mode = 'console'): void {
  fake.sessions.set(id, sessionFor(id, mode))
}

type LocalComfy = typeof LocalComfyModule

async function load(): Promise<LocalComfy> {
  const mod = await import('./localComfy')
  mod.initLocalComfy(() => [{ isDestroyed: () => false, send: () => {} } as never])
  return mod
}

const text = (body: Uint8Array) => new TextDecoder().decode(body)

beforeEach(() => {
  vi.resetModules()
  fake.lifecycle?.removeAllListeners()
  fake.sessions.clear()
  fake.installs.length = 0
  fake.diskVersion.clear()
  fake.ports.clear()
  fake.servers.clear()
  fake.sockets.length = 0
  fake.apps.id = null
  fake.apps.inst = null
  fake.versionGate = null
  fake.promptGate = null
  fake.queueGate = null
  fake.sharedInput = '/shared/input'
  launchConsole.mockClear()
  stopRunning.mockClear()
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
  vi.stubGlobal('WebSocket', FakeSocket)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('an app run keeps its ComfyUI while another app asks for a newer one', () => {
  it('keeps routing the first app run when a second page asks for a higher minimum', async () => {
    const x = addInstall('x', 8188, '0.36.0')
    addInstall('y', 8288, '0.42.4')
    run('x')
    const local = await load()

    expect(await local.getLocal({ minVersion: '0.36.0' })).toMatchObject({
      state: 'running',
      own: true
    })
    const queued = await local.localFetch({ method: 'POST', path: '/prompt', body: { prompt: {} } })
    const runId = JSON.parse(text(queued.body)).prompt_id as string
    x.history[runId] = { status: { completed: false }, outputs: {} }

    await local.getLocal({ minVersion: '0.37.0' })
    const second = await local.startLocal({ minVersion: '0.37.0' })

    expect(second.state, 'the second app waits instead of taking the ComfyUI away').not.toBe(
      'running'
    )
    expect(second.error).toMatch(/busy/)
    expect(launchConsole).not.toHaveBeenCalled()
    const history = await local.localFetch({ method: 'GET', path: `/history/${runId}` })
    expect(history.status).toBe(200)
    expect(JSON.parse(text(history.body))).toHaveProperty(runId)
    expect(fake.sockets.filter((s) => !s.closed).map((s) => s.url)).toEqual([
      expect.stringContaining(':8188/')
    ])
  })

  it('keeps the first ComfyUI while an app run sent to it has not been answered yet', async () => {
    const x = addInstall('x', 8188, '0.36.0')
    addInstall('y', 8288, '0.42.4')
    run('x')
    const local = await load()
    expect(await local.getLocal({ minVersion: '0.36.0' })).toMatchObject({ own: true })

    let answer!: () => void
    fake.promptGate = new Promise<void>((r) => (answer = r))
    const sending = local.localFetch({ method: 'POST', path: '/prompt', body: { prompt: {} } })
    await new Promise((r) => setTimeout(r, 0))
    expect(x.pending, 'ComfyUI x has the run but has not answered').toHaveLength(1)

    await local.getLocal({ minVersion: '0.37.0' })
    const second = await local.startLocal({ minVersion: '0.37.0' })

    expect(second.error).toMatch(/busy/)
    expect(launchConsole).not.toHaveBeenCalled()
    answer()
    const runId = JSON.parse(text((await sending).body)).prompt_id as string
    x.history[runId] = { status: { completed: true }, outputs: {} }
    expect((await local.localFetch({ method: 'GET', path: `/history/${runId}` })).status).toBe(200)
    expect(fake.sockets.filter((s) => !s.closed).map((s) => s.url)).toEqual([
      expect.stringContaining(':8188/')
    ])
  })

  it.each([
    ['answered before the new run reached it', true],
    ['answered after the new run reached it', false]
  ])(
    'keeps the first ComfyUI when an app run is sent and accepted while its queue is checked, %s',
    async (_when, answerAsAsked) => {
      const x = addInstall('x', 8188, '0.37.0')
      addInstall('y', 8288, '0.42.4')
      run('x')
      const local = await load()
      expect(await local.getLocal({ minVersion: '0.37.0' })).toMatchObject({ own: true })
      const earlier = await local.localFetch({
        method: 'POST',
        path: '/prompt',
        body: { prompt: {} }
      })
      expect(earlier.status).toBe(200)
      x.pending.length = 0

      let release!: () => void
      fake.queueGate = { open: new Promise<void>((r) => (release = r)), answerAsAsked }
      const second = local.startLocal({ minVersion: '0.41.0' })
      await vi.waitFor(() => expect(x.calls).toContain('GET /queue'))

      const sent = await local.localFetch({ method: 'POST', path: '/prompt', body: { prompt: {} } })
      expect(sent.status, 'ComfyUI x took the new run').toBe(200)
      const runId = JSON.parse(text(sent.body)).prompt_id as string
      release()

      expect((await second).error).toMatch(/busy/)
      expect(launchConsole).not.toHaveBeenCalled()
      x.history[runId] = { status: { completed: true }, outputs: {} }
      expect((await local.localFetch({ method: 'GET', path: `/history/${runId}` })).status).toBe(
        200
      )
      expect(fake.sockets.filter((s) => !s.closed).map((s) => s.url)).toEqual([
        expect.stringContaining(':8188/')
      ])
    }
  )

  it('keeps the first ComfyUI while its app run waits behind more than 100 of the person runs', async () => {
    const x = addInstall('x', 8188, '0.36.0')
    addInstall('y', 8288, '0.42.4')
    run('x')
    const local = await load()
    expect(await local.getLocal({ minVersion: '0.36.0' })).toMatchObject({ own: true })
    const queued = await local.localFetch({ method: 'POST', path: '/prompt', body: { prompt: {} } })
    const runId = JSON.parse(text(queued.body)).prompt_id as string
    x.pending = [
      ...Array.from({ length: 150 }, (_, i) => [i, `mine-${i}`, {}, {}, []]),
      [150, runId, {}, {}, []]
    ]

    await local.getLocal({ minVersion: '0.37.0' })
    const second = await local.startLocal({ minVersion: '0.37.0' })

    expect(second.error).toMatch(/busy/)
    expect(launchConsole).not.toHaveBeenCalled()
    expect(fake.sockets.filter((s) => !s.closed).map((s) => s.url)).toEqual([
      expect.stringContaining(':8188/')
    ])
  })

  it('drops a page check that finishes after a newer start chose another ComfyUI', async () => {
    addInstall('z', 8188, '0.36.0')
    addInstall('y', 8288, '0.42.4')
    run('z')
    const local = await load()

    let release!: () => void
    fake.versionGate = new Promise<void>((r) => (release = r))
    const slow = local.getLocal({ minVersion: '0.36.0' })
    await new Promise((r) => setTimeout(r, 0))
    const started = await local.startLocal({ minVersion: '0.40.0' })
    expect(started).toMatchObject({ state: 'running', name: 'ComfyUI y' })

    release()
    await slow
    expect(local.ownInUse()).toBe('y')
  })
})

describe('files two ComfyUIs give the same name', () => {
  const made = {
    status: { completed: true },
    outputs: {
      '9': { images: [{ filename: 'ComfyUI_00001_.png', subfolder: '', type: 'output' }] }
    }
  }
  const sameName = '/view?filename=ComfyUI_00001_.png&subfolder=&type=output'

  async function runOnEach(
    pageX: number,
    pageY: number
  ): Promise<{ local: LocalComfy; runX: string; runY: string }> {
    const x = addInstall('x', 8188, '0.37.0')
    const y = addInstall('y', 8288, '0.42.4')
    run('x')
    const local = await load()
    expect(await local.getLocal({ minVersion: '0.37.0' })).toMatchObject({ name: 'ComfyUI x' })
    const queuedX = await local.localFetch(
      { method: 'POST', path: '/prompt', body: { prompt: {} } },
      pageX
    )
    const runX = JSON.parse(text(queuedX.body)).prompt_id as string
    x.pending.length = 0
    x.history[runX] = made
    x.files.add('output//ComfyUI_00001_.png')

    run('y')
    expect(await local.getLocal({ minVersion: '0.41.0' })).toMatchObject({ name: 'ComfyUI y' })
    const queuedY = await local.localFetch(
      { method: 'POST', path: '/prompt', body: { prompt: {} } },
      pageY
    )
    const runY = JSON.parse(text(queuedY.body)).prompt_id as string
    y.pending.length = 0
    y.history[runY] = made
    y.files.add('output//ComfyUI_00001_.png')
    return { local, runX, runY }
  }

  it('gives each page the file from the ComfyUI its run used, whichever history came last', async () => {
    const { local, runX, runY } = await runOnEach(1, 2)

    expect((await local.localFetch({ method: 'GET', path: `/history/${runY}` }, 2)).status).toBe(
      200
    )
    expect((await local.localFetch({ method: 'GET', path: `/history/${runX}` }, 1)).status).toBe(
      200
    )

    const forY = await local.localFetch({ method: 'GET', path: sameName }, 2)
    expect(text(forY.body), 'the Y page gets the picture Y made').toBe(
      '8288/output//ComfyUI_00001_.png'
    )
    const forX = await local.localFetch({ method: 'GET', path: sameName }, 1)
    expect(text(forX.body), 'the X page gets the picture X made').toBe(
      '8188/output//ComfyUI_00001_.png'
    )
  })

  it('keeps the newer run file when a late history of an older run on another ComfyUI arrives', async () => {
    const { local, runX, runY } = await runOnEach(1, 1)

    await local.localFetch({ method: 'GET', path: `/history/${runY}` }, 1)
    await local.localFetch({ method: 'GET', path: `/history/${runX}` }, 1)

    const file = await local.localFetch({ method: 'GET', path: sameName }, 1)
    expect(text(file.body)).toBe('8288/output//ComfyUI_00001_.png')
  })
})

describe('an app that joins a start already under way', () => {
  it('does not get a ComfyUI older than its own minimum', async () => {
    addInstall('x', 8188, '0.36.0')
    addAppsServer(8300)
    const local = await load()

    const [first, second] = await Promise.all([
      local.startLocal({ minVersion: '0.36.0' }),
      local.startLocal({ minVersion: '0.37.0' })
    ])

    expect(first).toMatchObject({ state: 'running', name: 'ComfyUI x', version: '0.36.0' })
    expect(second.state).toBe('running')
    expect(second.name).toBe('Apps')
  })
})

describe('the version of a ComfyUI that is already running', () => {
  it('is what the running process reports, not the files a pull changed', async () => {
    addInstall('x', 8188, '0.42.4', '0.36.0')
    run('x')
    const local = await load()

    const state = await local.getLocal({ minVersion: '0.37.0' })

    expect(state.state).not.toBe('running')
    expect(state.own).toBeUndefined()
  })

  it('still reuses a running ComfyUI whose process is new enough', async () => {
    addInstall('x', 8188, '0.36.0', '0.42.4')
    run('x')
    const local = await load()

    expect(await local.getLocal({ minVersion: '0.37.0' })).toMatchObject({
      state: 'running',
      own: true,
      version: '0.42.4'
    })
  })
})

describe('reusing a ComfyUI old enough to stop every run on interrupt', () => {
  it('leaves a ComfyUI older than targeted interrupt alone even when the app allows it', async () => {
    addInstall('x', 8188, '0.3.56')
    run('x')
    const local = await load()

    const state = await local.getLocal({ minVersion: '0.3.31' })

    expect(state.state).toBe('none')
    expect(state.own).toBeUndefined()
  })

  it('reuses a ComfyUI from the first release that interrupts only the named run', async () => {
    addInstall('x', 8188, '0.3.57')
    run('x')
    const local = await load()

    expect(await local.getLocal({ minVersion: '0.3.31' })).toMatchObject({
      state: 'running',
      own: true,
      version: '0.3.57'
    })
  })
})

describe('a ComfyUI that keeps its own input folder', () => {
  it('is not reused, so apps cannot list or load the files in it', async () => {
    addInstall('x', 8188, '0.42.4')
    Object.assign(fake.installs[0]!, { useSharedInput: false, inputDir: '/x/private-input' })
    run('x')
    const local = await load()

    const state = await local.getLocal({ minVersion: '0.37.0' })

    expect(state.own).toBeUndefined()
    expect(state.name).toBe('Apps')
    expect(fake.servers.get(8188)!.calls).toEqual([])
  })

  it('is not reused even with no folder named, since ComfyUI then reads its own', async () => {
    addInstall('x', 8188, '0.42.4')
    fake.installs[0]!.useSharedInput = false
    run('x')
    const local = await load()

    expect((await local.getLocal({ minVersion: '0.37.0' })).own).toBeUndefined()
  })

  it.each([
    ['its own folder', '/x/private-input'],
    ['no folder named', undefined]
  ])(
    'is not reused while it still runs with %s after shared input is turned on',
    async (_, inputDir) => {
      addInstall('x', 8188, '0.42.4')
      Object.assign(fake.installs[0]!, { useSharedInput: false, inputDir })
      run('x')
      fake.installs[0]!.useSharedInput = true
      const local = await load()

      const state = await local.getLocal({ minVersion: '0.37.0' })

      expect(state.own, 'the running process still reads its private folder').toBeUndefined()
      expect(fake.servers.get(8188)!.calls).toEqual([])
    }
  )

  it('is not reused while it runs with a shared folder that is no longer the shared one', async () => {
    addInstall('x', 8188, '0.42.4')
    run('x')
    fake.sharedInput = '/moved/input'
    const local = await load()

    expect((await local.getLocal({ minVersion: '0.37.0' })).own).toBeUndefined()
  })

  it('is not reused when its session does not say which input folder it reads', async () => {
    addInstall('x', 8188, '0.42.4')
    run('x')
    delete fake.sessions.get('x')!.inputDir
    const local = await load()

    expect((await local.getLocal({ minVersion: '0.37.0' })).own).toBeUndefined()
  })

  it('leaves the next ComfyUI that shares the apps input folder to be reused', async () => {
    addInstall('x', 8188, '0.42.4')
    fake.installs[0]!.useSharedInput = false
    addInstall('y', 8288, '0.42.4')
    fake.installs[1]!.useSharedInput = true
    run('x')
    run('y')
    const local = await load()

    expect(await local.getLocal({ minVersion: '0.37.0' })).toMatchObject({
      state: 'running',
      own: true,
      name: 'ComfyUI y'
    })
  })
})

describe('stopping a ComfyUI that apps started when apps go idle', () => {
  async function startedThenIdle(replace: boolean): Promise<void> {
    vi.useFakeTimers({ toFake: ['setInterval', 'Date'] })
    addInstall('x', 8188, '0.42.4')
    const local = await load()
    expect(await local.startLocal({ minVersion: '0.37.0' })).toMatchObject({ state: 'running' })
    if (replace) {
      fake.sessions.delete('x')
      fake.lifecycle!.emit('changed')
      run('x')
      fake.lifecycle!.emit('changed')
    }
    await vi.advanceTimersByTimeAsync(11 * 60_000)
  }

  it('stops the session apps launched', async () => {
    await startedThenIdle(false)
    expect(stopRunning).toHaveBeenCalledWith('x')
  })

  it('leaves alone a session the person started after the apps one ended', async () => {
    await startedThenIdle(true)
    expect(stopRunning).not.toHaveBeenCalled()
    expect(fake.sessions.has('x')).toBe(true)
  })
})

describe('what apps can see on a ComfyUI the person already uses', () => {
  async function reused(): Promise<{ local: LocalComfy; server: FakeComfy; runId: string }> {
    const server = addInstall('x', 8188, '0.42.4')
    run('x', 'window')
    server.running.push([0, 'mine-1', { secret: {} }, {}, []])
    server.history['mine-0'] = {
      prompt: [0, 'mine-0', { secret: {} }],
      status: { completed: true },
      outputs: { '9': { images: [{ filename: 'private.png', subfolder: '', type: 'output' }] } }
    }
    server.files.add('output//private.png')
    const local = await load()
    expect(await local.getLocal({ minVersion: '0.37.0' })).toMatchObject({
      state: 'running',
      own: true
    })
    const queued = await local.localFetch({ method: 'POST', path: '/prompt', body: { prompt: {} } })
    const runId = JSON.parse(text(queued.body)).prompt_id as string
    server.history[runId] = {
      status: { completed: true },
      outputs: {
        '9': { images: [{ filename: 'apps_00001_.png', subfolder: 'apps', type: 'output' }] }
      }
    }
    server.files.add('output/apps/apps_00001_.png')
    return { local, server, runId }
  }

  const view = (filename: string, subfolder: string, type: string) =>
    `/view?${new URLSearchParams({ filename, subfolder, type })}`

  it('reads the history and output files of the runs apps queued', async () => {
    const { local, runId } = await reused()
    const history = await local.localFetch({ method: 'GET', path: `/history/${runId}` })
    expect(history.status).toBe(200)
    const file = await local.localFetch({
      method: 'GET',
      path: view('apps_00001_.png', 'apps', 'output')
    })
    expect(file.status).toBe(200)
  })

  it('does not read the history or files of the person own runs', async () => {
    const { local, server } = await reused()
    const history = await local.localFetch({ method: 'GET', path: '/history/mine-0' })
    expect(history.status).toBe(403)
    expect(text(history.body)).not.toContain('secret')
    const file = await local.localFetch({ method: 'GET', path: view('private.png', '', 'output') })
    expect(file.status).toBe(403)
    expect(server.calls).not.toContain('GET /view')
  })

  it('cannot stop or remove the person own runs', async () => {
    const { local, server } = await reused()
    const stop = await local.localFetch({
      method: 'POST',
      path: '/interrupt',
      body: { prompt_id: 'mine-1' }
    })
    expect(stop.status).toBe(403)
    const remove = await local.localFetch({
      method: 'POST',
      path: '/queue',
      body: { delete: ['mine-1'] }
    })
    expect(remove.status).toBe(403)
    expect(server.calls).not.toContain('POST /interrupt')
    expect(server.calls).not.toContain('POST /queue')
  })

  it('can stop its own run', async () => {
    const { local, server, runId } = await reused()
    const stop = await local.localFetch({
      method: 'POST',
      path: '/interrupt',
      body: { prompt_id: runId }
    })
    expect(stop.status).toBe(200)
    expect(server.calls).toContain('POST /interrupt')
  })

  it('sees how many runs are ahead in the queue but not the ids of the person own runs', async () => {
    const { local, runId } = await reused()
    const queue = JSON.parse(text((await local.localFetch({ method: 'GET', path: '/queue' })).body))
    expect(queue.running).toEqual([{ id: '', app: null, seconds: null }])
    expect(queue.pending.map((r: { id: string }) => r.id)).toEqual([runId])
  })

  it('views an input file apps uploaded', async () => {
    const { local } = await reused()
    const up = await local.localFetch({
      method: 'POST',
      path: '/upload/image',
      body: new Uint8Array([1]),
      fileName: 'photo.png'
    })
    expect(up.status).toBe(200)
    const file = await local.localFetch({ method: 'GET', path: view('photo.png', '', 'input') })
    expect(file.status).toBe(200)
  })

  it('keeps a run it can read and stop while 2,000 newer runs wait behind it', async () => {
    const { local, server, runId } = await reused()
    const statuses: number[] = []
    for (let i = 0; i < 2000; i++) {
      const queued = await local.localFetch({
        method: 'POST',
        path: '/prompt',
        body: { prompt: {} }
      })
      statuses.push(queued.status)
    }

    expect(statuses.slice(0, 1999).every((s) => s === 200)).toBe(true)
    expect(statuses[1999], 'Desktop refuses a run it could not keep track of').toBe(429)
    const stop = await local.localFetch({
      method: 'POST',
      path: '/interrupt',
      body: { prompt_id: runId }
    })
    expect(stop.status).toBe(200)
    const history = await local.localFetch({ method: 'GET', path: `/history/${runId}` })
    expect(history.status).toBe(200)
    expect(server.calls.filter((c) => c === 'POST /prompt')).toHaveLength(2000)

    const after = await local.localFetch({ method: 'POST', path: '/prompt', body: { prompt: {} } })
    expect(after.status, 'a finished run makes room for a new one').toBe(200)
  })

  it('takes new runs again after the person clears apps runs from the ComfyUI queue', async () => {
    const { local, server, runId } = await reused()
    for (let i = 0; i < 1999; i++) {
      await local.localFetch({ method: 'POST', path: '/prompt', body: { prompt: {} } })
    }
    expect(
      (await local.localFetch({ method: 'POST', path: '/prompt', body: { prompt: {} } })).status
    ).toBe(429)

    server.pending = server.pending.filter((p) => (p as unknown[])[1] === runId)

    const after = await local.localFetch({ method: 'POST', path: '/prompt', body: { prompt: {} } })
    expect(after.status, 'runs ComfyUI dropped no longer hold a place').toBe(200)
    const stop = await local.localFetch({
      method: 'POST',
      path: '/interrupt',
      body: { prompt_id: runId }
    })
    expect(stop.status, 'a run still in the queue stays the app run').toBe(200)
    expect((await local.localFetch({ method: 'GET', path: `/history/${runId}` })).status).toBe(200)
    expect(
      (
        await local.localFetch({
          method: 'POST',
          path: '/interrupt',
          body: { prompt_id: 'mine-1' }
        })
      ).status
    ).toBe(403)
  })

  it('does not replace an input file of the same name already in the person ComfyUI', async () => {
    const { local, server } = await reused()
    server.files.add('input//photo.png')

    const up = await local.localFetch({
      method: 'POST',
      path: '/upload/image',
      body: new Uint8Array([1]),
      fileName: 'photo.png'
    })

    expect(up.status).toBe(200)
    expect(server.replaced).toEqual([])
    const name = JSON.parse(text(up.body)).name as string
    expect(name).toBe('photo (1).png')
    expect(
      (await local.localFetch({ method: 'GET', path: view(name, '', 'input') })).status,
      'the page opens the file under the name ComfyUI gave it'
    ).toBe(200)
    expect(
      (await local.localFetch({ method: 'GET', path: view('photo.png', '', 'input') })).status,
      'the person file stays closed to apps'
    ).toBe(403)
  })

  it('opens every file of a run that made more than 2,000', async () => {
    const { local, server, runId } = await reused()
    const images = Array.from({ length: 2001 }, (_, i) => {
      server.files.add(`output/apps/many_${i}.png`)
      return { filename: `many_${i}.png`, subfolder: 'apps', type: 'output' }
    })
    server.history[runId] = { status: { completed: true }, outputs: { '9': { images } } }

    expect((await local.localFetch({ method: 'GET', path: `/history/${runId}` })).status).toBe(200)
    for (const i of [0, 2000]) {
      const file = await local.localFetch({
        method: 'GET',
        path: view(`many_${i}.png`, 'apps', 'output')
      })
      expect(file.status, `file ${i}`).toBe(200)
    }
  })

  it('keeps reading any run on the Apps build, which only apps use', async () => {
    const server = addAppsServer(8300)
    fake.apps.inst = {
      id: 'apps',
      name: 'Apps',
      sourceId: 'standalone',
      installPath: '/apps',
      status: 'installed'
    }
    fake.apps.id = 'apps'
    run('apps')
    server.history['other'] = { status: { completed: true }, outputs: {} }
    const local = await load()
    expect(await local.getLocal()).toMatchObject({ state: 'running', name: 'Apps' })
    const history = await local.localFetch({ method: 'GET', path: '/history/other' })
    expect(history.status).toBe(200)
  })
})
