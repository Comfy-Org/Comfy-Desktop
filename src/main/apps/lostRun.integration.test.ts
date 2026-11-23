import fs from 'node:fs'
import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import type { IpcMainInvokeEvent, WebContents } from 'electron'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({
  home: '',
  record: {} as Record<string, unknown>,
  command: {} as Record<string, unknown>,
  page: { send: vi.fn(), isDestroyed: () => false }
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => (fake.home ||= fs.mkdtempSync(path.join(os.tmpdir(), 'lost-run-home-'))),
    getVersion: () => '0.0.0-test',
    getLocale: () => 'en',
    on: () => {}
  },
  ipcMain: { handle: vi.fn(), on: vi.fn(), off: vi.fn() },
  dialog: {},
  shell: {},
  WebContentsView: class {},
  BrowserWindow: { getAllWindows: () => [] },
  nativeTheme: { on: vi.fn(), shouldUseDarkColors: false }
}))
vi.mock('../lib/ipc/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof SharedModule>()
  return {
    ...actual,
    keepsComfyRunningWhenWindowCloses: () => true,
    sourceMap: {
      ...actual.sourceMap,
      'fake-comfy': {
        category: 'local',
        skipInstall: true,
        getDefaults: () => ({}),
        getLaunchCommand: () => ({ ...fake.command })
      }
    }
  }
})
vi.mock('../installations', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  list: async () => [fake.record],
  get: async () => fake.record,
  update: async () => null,
  remove: async () => {},
  markLaunched: async () => null
}))
vi.mock('../lib/comfyProcessRecord', () => ({
  resolvePriorProcess: async () => null,
  holderIsInstall: async () => false,
  trackSpawn: () => {},
  markStopRequested: () => {},
  listRecords: () => [],
  probeQueue: async () => null
}))
vi.mock('../lib/comfyDownloadManager', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  initializeModelDownloads: async () => ({ safe: true, unsafePaths: [] })
}))
vi.mock('../host/registry', () => ({ getEntryByInstallationId: () => undefined }))
vi.mock('./appsPages', () => ({
  appsPageAdmits: async () => true,
  liveAppsPages: () => [fake.page]
}))
vi.mock('./localRelay', () => ({
  createLocalRelay: () => ({
    clientId: 'desktop',
    follow: () => {},
    whenOpen: async () => true,
    stop: () => {}
  })
}))

import { _runningSessions, killProcessTree, stopRunning } from '../lib/ipc/shared'
import type * as SharedModule from '../lib/ipc/shared'
import type { InstallationRecord } from '../lib/ipc/shared'
import { handleRemove } from '../lib/ipc/sessionActions/basic'
import { handleLaunch } from '../lib/ipc/sessionActions/launch'
import type { ActionContext } from '../lib/ipc/sessionActions/types'
import * as telemetry from '../lib/telemetry'
import * as local from './localComfy'

const BUILD = 'studio'
const RUN = 'run-1'
const PAGE = fake.page as unknown as WebContents
const QUIET_EVENT = {
  sender: { isDestroyed: () => false, send: () => {} }
} as unknown as IpcMainInvokeEvent
const FAKE_COMFY = `
const http = require('node:http')
http.createServer((req, res) => {
  if (req.url === '/api/exit-with-no-error') process.exit(0)
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify({ prompt_id: '${RUN}', number: 1 }))
}).listen(Number(process.argv[2]), '127.0.0.1')
`

let workDir = ''
let port = 0

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.listen(0, '127.0.0.1', () => {
      const { port: free } = probe.address() as AddressInfo
      probe.close(() => resolve(free))
    })
  })
}

const context = (): ActionContext => ({
  event: QUIET_EVENT,
  installationId: BUILD,
  inst: fake.record as unknown as InstallationRecord
})

async function launch(): Promise<void> {
  const launched = await handleLaunch(context())
  expect(launched.ok, launched.message).toBe(true)
}

async function startARunFromThePage(): Promise<void> {
  await local.localState(PAGE, {})
  await local.localFetch(PAGE, {
    method: 'POST',
    path: '/prompt',
    body: JSON.stringify({ prompt: { 1: { class_type: 'LoadImage' } } })
  })
}

beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lost-run-'))
  fs.mkdirSync(path.join(workDir, 'ComfyUI'))
  fs.writeFileSync(path.join(workDir, 'fake-comfy.cjs'), FAKE_COMFY)
})

beforeEach(async () => {
  vi.spyOn(telemetry, 'emit').mockImplementation(() => {})
  vi.spyOn(telemetry, 'capture').mockReturnValue(true)
  port = await freePort()
  fake.record = {
    id: BUILD,
    name: 'Studio',
    sourceId: 'fake-comfy',
    installPath: workDir,
    status: 'installed'
  }
  fake.command = {
    cmd: process.execPath,
    args: [path.join(workDir, 'fake-comfy.cjs'), String(port)],
    cwd: workDir,
    port,
    skipSharedPaths: true
  }
  await launch()
  await startARunFromThePage()
  fake.page.send.mockClear()
})

afterEach(async () => {
  local._resetForTest()
  const running = [..._runningSessions.values()]
  _runningSessions.clear()
  await Promise.all(running.map((session) => (session.proc ? killProcessTree(session.proc) : null)))
  vi.restoreAllMocks()
})

afterAll(() => {
  fs.rmSync(workDir, { recursive: true, force: true, maxRetries: 3 })
  if (fake.home) fs.rmSync(fake.home, { recursive: true, force: true, maxRetries: 3 })
})

describe('what the app page hears when its ComfyUI process ends', { timeout: 30_000 }, () => {
  it.each([
    ['crashes', 'comfyui_crashed', () => _runningSessions.get(BUILD)?.proc?.kill('SIGKILL')],
    [
      'exits with no error',
      'comfyui_stopped',
      () => fetch(`http://127.0.0.1:${port}/api/exit-with-no-error`).catch(() => {})
    ],
    [
      'is stopped, as Stop, Update and closing its window do',
      'comfyui_stopped',
      () => stopRunning(BUILD)
    ],
    ['is stopped with the others, as quitting does', 'comfyui_stopped', () => stopRunning()],
    ['is restarted', 'comfyui_stopped', () => stopRunning(BUILD).then(launch)],
    ['belongs to a build that is deleted', 'comfyui_stopped', () => handleRemove(context())]
  ])('when it %s: %s', async (_case, reason, end) => {
    await end()
    await vi.waitFor(() => expect(fake.page.send).toHaveBeenCalled(), { timeout: 10_000 })

    expect(fake.page.send.mock.calls).toEqual([
      [local.LOCAL_EVENT_CHANNEL, { type: 'run_failed', data: { prompt_id: RUN, reason } }]
    ])
  })
})
