// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const telemetry = vi.hoisted(() => ({ capture: vi.fn(), emit: vi.fn() }))
vi.mock('../lib/telemetry', () => telemetry)
vi.mock('./appsSwitch', () => ({ isAppsEnabled: () => true }))

const sessions = vi.hoisted(() => new Map<string, unknown>())
vi.mock('../lib/ipc/shared', async () => ({
  _getActiveLaunchIds: () => [],
  _getLaunchingInstances: () => [],
  _isStopping: () => false,
  _operationAborts: new Map(),
  _runningSessions: sessions,
  sessionLifecycleEvents: new (await import('events')).EventEmitter(),
  stopRunning: vi.fn()
}))
vi.mock('../host/registry', () => ({ getEntryByInstallationId: () => undefined }))
vi.mock('../lib/process', () => ({ COMFY_BOOT_TIMEOUT_MS: 1000 }))
vi.mock('../lib/gpu', () => ({
  detectGPUCached: async () => ({ id: 'nvidia', label: 'NVIDIA', model: null })
}))

const downloads = vi.hoisted(() => ({ startManagedModelJob: vi.fn() }))
vi.mock('../lib/comfyDownloadManager', () => downloads)

const build = vi.hoisted(() => {
  class SetupCancelled extends Error {}
  const appsInstall = { id: 'apps-1', name: 'ComfyUI for apps', status: 'installed' }
  return {
    appsInstall,
    SetupCancelled,
    appsBuildId: () => 'apps-1',
    appsLocalOff: async () => null,
    appsSetupRunning: () => false,
    cancelAppsSetup: () => ({ cancelled: false }),
    ensureAppsBuild: vi.fn(),
    findApps: vi.fn(async () => appsInstall as unknown),
    installVersion: async () => '0.42.1',
    launchAppsBuild: vi.fn(),
    launchConsole: vi.fn(),
    planAppsBuild: async () => ({ data: {}, bytes: 0 }),
    reusableLocal: async () => []
  }
})
vi.mock('./appsBuild', () => build)

class FakeSocket {
  static last: FakeSocket | null = null
  binaryType = ''
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  constructor(readonly url: string) {
    FakeSocket.last = this
  }
  close(): void {}
}

import { initLocalComfy, localDownload, localFetch, startLocal } from './localComfy'

const appsSession = {
  port: 8190,
  mode: 'console',
  installationName: 'ComfyUI for apps',
  getAcceleratorInfo: () => ({ vramMb: 12_200, ramMb: 31_900 })
}

const page = { isDestroyed: () => false, send: vi.fn() }
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve))
}

let nextId = 0
function runId(): string {
  nextId += 1
  return `00000000-0000-4000-8000-${String(nextId).padStart(12, '0')}`
}

function answerWith(body: unknown): void {
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  )
}

async function submit(id: string, tag: Record<string, unknown> | null, pageApp: string | null) {
  answerWith({ prompt_id: id, number: 1, node_errors: {} })
  await localFetch(
    {
      method: 'POST',
      path: '/prompt',
      body: {
        prompt: { '1': { class_type: 'SaveImage', inputs: {} } },
        client_id: 'c',
        ...(tag ? { extra_data: { comfy_app: tag } } : {})
      }
    },
    pageApp
  )
}

function socketSays(type: string, data: Record<string, unknown>): void {
  FakeSocket.last!.onmessage!({ data: JSON.stringify({ type, data }) })
}

function captured(name: string): Array<Record<string, unknown>> {
  return [...telemetry.capture.mock.calls, ...telemetry.emit.mock.calls]
    .filter(([event]) => event === `comfy.desktop.apps.${name}`)
    .map(([, props]) => props as Record<string, unknown>)
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  vi.stubGlobal('fetch', vi.fn())
  vi.stubGlobal('WebSocket', FakeSocket)
  initLocalComfy(() => [page as never])
})

afterAll(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  vi.mocked(fetch).mockReset()
  telemetry.capture.mockReset()
  telemetry.emit.mockReset()
  sessions.clear()
  sessions.set('apps-1', appsSession)
})

describe('run_finished for This computer app runs', () => {
  it.each<[string, string, Record<string, unknown>, Record<string, unknown>]>([
    ['success', 'execution_success', {}, { outcome: 'success' }],
    ['cancelled', 'execution_interrupted', {}, { outcome: 'cancelled' }],
    [
      'failed',
      'execution_error',
      {
        exception_type: 'torch.OutOfMemoryError',
        exception_message: 'CUDA out of memory at /home/someone/models',
        traceback: ['File "/home/someone/ComfyUI/nodes.py"']
      },
      { outcome: 'failed', error_class: 'OutOfMemoryError' }
    ]
  ])('sends one run_finished for a %s run', async (_name, type, data, expected) => {
    const id = runId()
    await submit(id, { name: 'Upscale', id: 'upscale' }, 'remove-background')
    socketSays('execution_start', { prompt_id: id })
    socketSays(type, { prompt_id: id, ...data })
    socketSays(type, { prompt_id: id, ...data })
    await settle()

    const sent = captured('run_finished')
    expect(sent).toHaveLength(1)
    expect(sent[0]).toEqual({
      app: 'upscale',
      where: 'local',
      comfy: 'apps_build',
      comfy_version: '0.42.1',
      gpu: 'nvidia',
      vram_gb: 12,
      ram_gb: 31,
      os: process.platform,
      run_seconds: expect.any(Number),
      queue_seconds: expect.any(Number),
      apps_enabled: true,
      ...expected
    })
    expect(JSON.stringify(sent[0])).not.toMatch(/someone|memory at|nodes\.py/)
  })

  it('takes the app from the page address when the run names none', async () => {
    const id = runId()
    await submit(id, { name: 'Remove background' }, 'remove-background')
    socketSays('execution_success', { prompt_id: id })
    await settle()

    expect(captured('run_finished').map((p) => p['app'])).toEqual(['remove-background'])
  })

  it('sends nothing for a run no app can be named for', async () => {
    const id = runId()
    await submit(id, null, null)
    socketSays('execution_success', { prompt_id: id })
    await settle()

    expect(captured('run_finished')).toEqual([])
  })

  it('sends one run_finished for a run that ends before Desktop reads its submit answer', async () => {
    const id = runId()
    let answer: (res: Response) => void = () => {}
    vi.mocked(fetch).mockReturnValueOnce(new Promise<Response>((resolve) => (answer = resolve)))
    const submitted = localFetch(
      {
        method: 'POST',
        path: '/prompt',
        body: {
          prompt: { '1': { class_type: 'SaveImage', inputs: {} } },
          extra_data: { comfy_app: { name: 'Upscale', id: 'upscale' } }
        }
      },
      null
    )
    socketSays('execution_start', { prompt_id: id })
    socketSays('execution_cached', { prompt_id: id, nodes: ['1'] })
    socketSays('execution_success', { prompt_id: id })
    answer(new Response(JSON.stringify({ prompt_id: id, number: 1, node_errors: {} })))
    await submitted
    await settle()

    const sent = captured('run_finished')
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ app: 'upscale', outcome: 'success' })
  })

  it('sends nothing for runs Desktop did not submit for an app', async () => {
    socketSays('execution_success', { prompt_id: runId() })
    await settle()

    expect(captured('run_finished')).toEqual([])
  })
})

describe('stopping a This computer run that is still queued', () => {
  function answerEmpty(): void {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 200 }))
  }

  async function stop(id: string, queue: unknown, history: unknown): Promise<void> {
    answerEmpty()
    answerWith(queue)
    answerWith(history)
    await localFetch({ method: 'POST', path: '/queue', body: { delete: [id] } })
    await settle()
    answerEmpty()
    await localFetch({ method: 'POST', path: '/interrupt', body: { prompt_id: id } })
    await settle()
  }

  it('sends one cancelled run_finished when ComfyUI drops the queued run', async () => {
    const id = runId()
    await submit(id, { name: 'Upscale', id: 'upscale' }, null)
    await stop(id, { queue_running: [], queue_pending: [] }, {})

    const sent = captured('run_finished')
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ app: 'upscale', outcome: 'cancelled' })
    expect(sent[0]).not.toHaveProperty('queue_seconds')
  })

  it('reports how the run ended when it started before the delete reached ComfyUI', async () => {
    const id = runId()
    await submit(id, { name: 'Upscale', id: 'upscale' }, null)
    await stop(id, { queue_running: [[1, id, {}, {}, ['9']]], queue_pending: [] }, {})
    socketSays('execution_start', { prompt_id: id })
    socketSays('execution_success', { prompt_id: id })
    await settle()

    expect(captured('run_finished').map((p) => p['outcome'])).toEqual(['success'])
  })

  it('reports how the run ended when it finished before the delete reached ComfyUI', async () => {
    const id = runId()
    await submit(id, { name: 'Upscale', id: 'upscale' }, null)
    await stop(id, { queue_running: [], queue_pending: [] }, { [id]: { outputs: {} } })
    socketSays('execution_start', { prompt_id: id })
    socketSays('execution_success', { prompt_id: id })
    await settle()

    expect(captured('run_finished').map((p) => p['outcome'])).toEqual(['success'])
  })
})

describe('setting up This computer', () => {
  beforeEach(() => {
    sessions.clear()
    build.findApps.mockResolvedValueOnce(null)
  })

  it('reports a failed Apps build setup as run_failed at setup', async () => {
    build.ensureAppsBuild.mockRejectedValueOnce(new Error('disk full at /Users/someone'))

    await startLocal({}, 'upscale')

    expect(captured('run_failed')).toEqual([
      { app: 'upscale', where: 'local', step: 'setup', error_class: 'Error', apps_enabled: true }
    ])
  })

  it('reports nothing when the person cancels the setup', async () => {
    build.ensureAppsBuild.mockRejectedValueOnce(new build.SetupCancelled('cancelled'))

    await startLocal({}, 'upscale')

    expect(captured('run_failed')).toEqual([])
  })

  it('reports a ComfyUI that does not start as run_failed at start_comfy', async () => {
    build.ensureAppsBuild.mockResolvedValueOnce(build.appsInstall)
    build.launchAppsBuild.mockResolvedValueOnce({ ok: false, message: 'port taken' })

    await startLocal({}, 'upscale')

    expect(captured('run_failed')).toEqual([
      { app: 'upscale', where: 'local', step: 'start_comfy', apps_enabled: true }
    ])
  })
})

describe('model downloads', () => {
  const req = {
    url: 'https://huggingface.co/org/repo/resolve/main/4x-UltraSharp.pth',
    folder: 'upscale_models',
    name: '4x-UltraSharp.pth'
  }

  it('sends setup started and finished without the model file name', async () => {
    downloads.startManagedModelJob.mockResolvedValueOnce({
      completion: Promise.resolve({ status: 'done', savePath: '/nonexistent/4x-UltraSharp.pth' }),
      release: vi.fn()
    })

    expect(await localDownload(req, 'upscale')).toEqual({ state: 'done' })

    const sent = captured('setup')
    expect(sent.map((p) => p['outcome'])).toEqual(['started', 'finished'])
    for (const props of sent) {
      expect(props).toMatchObject({ app: 'upscale', stage: 'model' })
      expect(props).not.toHaveProperty('model_file')
      expect(JSON.stringify(props)).not.toMatch(
        /UltraSharp|\.pth|huggingface|nonexistent|upscale_models/
      )
    }
    expect(captured('run_failed')).toEqual([])
  })

  it('sends setup failed and run_failed at model_download when a download fails', async () => {
    downloads.startManagedModelJob.mockResolvedValueOnce({
      completion: Promise.resolve({ status: 'error', error: 'HTTP 403 for /Users/someone' }),
      release: vi.fn()
    })

    await localDownload(req, 'upscale')

    expect(captured('setup').map((p) => p['outcome'])).toEqual(['started', 'failed'])
    expect(captured('run_failed')).toEqual([
      { app: 'upscale', where: 'local', step: 'model_download', apps_enabled: true }
    ])
  })

  it('sends no failure when the download is cancelled', async () => {
    downloads.startManagedModelJob.mockResolvedValueOnce({
      completion: Promise.resolve({ status: 'cancelled' }),
      release: vi.fn()
    })

    await localDownload(req, 'upscale')

    expect(captured('setup').map((p) => p['outcome'])).toEqual(['started'])
    expect(captured('run_failed')).toEqual([])
  })
})
