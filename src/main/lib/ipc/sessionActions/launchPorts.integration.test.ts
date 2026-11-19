import fs from 'node:fs'
import { createServer } from 'node:net'
import type { Server, Socket } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const electronHome = vi.hoisted(() => {
  const overrides = ['XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME']
  const saved = Object.fromEntries(overrides.map((name) => [name, process.env[name]]))
  for (const name of overrides) delete process.env[name]
  return { dir: '', saved }
})

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () =>
      (electronHome.dir ||= fs.mkdtempSync(path.join(os.tmpdir(), 'launch-ports-home-'))),
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

const builds = vi.hoisted(() => ({
  commands: new Map<string, Record<string, unknown>>(),
  unreadable: new Set<string>()
}))

vi.mock('../shared', async (importOriginal) => {
  const actual = await importOriginal<typeof SharedModule>()
  return {
    ...actual,
    sourceMap: {
      ...actual.sourceMap,
      'fake-comfy': {
        skipInstall: true,
        getDefaults: () => ({}),
        getLaunchCommand: (inst: { id: string }) => {
          if (builds.unreadable.has(inst.id)) throw new Error('pyvenv.cfg is unreadable')
          const command = builds.commands.get(inst.id)
          return command ? { ...command, args: [...(command.args as string[])] } : null
        }
      }
    }
  }
})

vi.mock('../../comfyProcessRecord', () => ({
  resolvePriorProcess: async () => null,
  holderIsInstall: async () => false,
  trackSpawn: () => {},
  markStopRequested: () => {},
  listRecords: () => []
}))

vi.mock('../../comfyDownloadManager', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  initializeModelDownloads: async () => ({ safe: true, unsafePaths: [] })
}))

import { handleLaunch } from './launch'
import { _operationAborts, _pendingPorts, _runningSessions, killProcessTree } from '../shared'
import type { InstallationRecord } from '../shared'
import type * as SharedModule from '../shared'
import * as i18n from '../../i18n'
import { lookupEnMessage } from '../../localeTestHelper'
import { isPortListening } from '../../process'
import * as telemetry from '../../telemetry'
import * as settings from '../../../settings'
import type { ActionContext, ActionResult } from './types'

const FAKE_COMFY = `
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const args = process.argv.slice(2)
const valueOf = (flag) => args[args.lastIndexOf(flag) + 1]
const port = Number(valueOf('--port'))
const name = valueOf('--name')
if (fs.existsSync(path.join(valueOf('--state'), 'crash-on-boot'))) {
  process.stderr.write('RuntimeError: Torch not compiled with CUDA enabled\\n')
  process.exit(1)
}
const bootFile = path.join(valueOf('--state'), 'boot-ms')
const bootMs = fs.existsSync(bootFile) ? Number(fs.readFileSync(bootFile, 'utf-8')) : 0
const server = http.createServer((req, res) => {
  if (req.url !== '/restart') return res.end(name)
  res.end('restarting')
  fs.writeFileSync(process.env.__COMFY_CLI_SESSION__ + '.reboot', '')
  setTimeout(() => process.exit(0), 20)
})
server.on('error', (err) => {
  if (err.code !== 'EADDRINUSE') throw err
  process.stderr.write(
    'Port ' + port + ' is already in use on address 127.0.0.1. Please close the other ' +
      'application or use a different port with --port.\\n'
  )
  process.exit(1)
})
setTimeout(() => server.listen(port, '127.0.0.1'), bootMs)
`

const QUIET_EVENT = {
  sender: { isDestroyed: () => false, send: () => {} }
} as unknown as Electron.IpcMainInvokeEvent

let workDir = ''
let script = ''
let defaultPort = 0
const outsiders: { server: Server; callers: Socket[] }[] = []

async function freePortWithRoomAbove(): Promise<number> {
  for (;;) {
    const candidate = 20_000 + Math.floor(Math.random() * 10_000)
    const taken = await Promise.all(
      [0, 1, 2, 3].map((offset) => isPortListening(candidate + offset))
    )
    if (!taken.some(Boolean)) return candidate
  }
}

function build(id: string, record: Record<string, unknown> = {}): InstallationRecord {
  const installPath = path.join(workDir, id)
  fs.mkdirSync(path.join(installPath, 'ComfyUI'), { recursive: true })
  builds.commands.set(id, {
    cmd: process.execPath,
    args: [script, '--port', String(defaultPort), '--name', id, '--state', installPath],
    cwd: installPath,
    port: defaultPort,
    skipSharedPaths: true
  })
  return { id, name: id, sourceId: 'fake-comfy', installPath, ...record } as InstallationRecord
}

function start(inst: InstallationRecord): Promise<ActionResult> {
  const ctx: ActionContext = { event: QUIET_EVENT, installationId: inst.id, inst }
  return handleLaunch(ctx)
}

async function whoAnswersOn(port: number): Promise<string> {
  return (await fetch(`http://127.0.0.1:${port}/`)).text()
}

function crashOnBoot(inst: InstallationRecord): void {
  fs.writeFileSync(path.join(inst.installPath, 'crash-on-boot'), '')
}

function slowNextBoot(inst: InstallationRecord, ms: number): void {
  fs.writeFileSync(path.join(inst.installPath, 'boot-ms'), String(ms))
}

async function restartFromInside(port: number): Promise<void> {
  await fetch(`http://127.0.0.1:${port}/restart`)
  await vi.waitFor(async () => expect(await isPortListening(port)).toBe(false), { timeout: 5_000 })
}

function occupyFromOutside(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const callers: Socket[] = []
    const server = createServer((caller) => callers.push(caller))
    outsiders.push({ server, callers })
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve())
  })
}

function stopOutsider(outsider: { server: Server; callers: Socket[] }): Promise<void> {
  for (const caller of outsider.callers) caller.destroy()
  return new Promise((resolve) => outsider.server.close(() => resolve()))
}

beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'launch-ports-'))
  script = path.join(workDir, 'fake-comfy.cjs')
  fs.writeFileSync(script, FAKE_COMFY)
})

beforeEach(async () => {
  defaultPort = await freePortWithRoomAbove()
  vi.spyOn(telemetry, 'emit').mockImplementation(() => {})
  vi.spyOn(telemetry, 'capture').mockReturnValue(true)
  vi.spyOn(i18n, 't').mockImplementation((key, params) =>
    lookupEnMessage(key).replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))
  )
})

afterEach(async () => {
  for (const abort of _operationAborts.values()) abort.abort()
  const running = [..._runningSessions.values()]
  for (const id of [..._runningSessions.keys()]) _runningSessions.delete(id)
  await Promise.all(running.map((session) => (session.proc ? killProcessTree(session.proc) : null)))
  await Promise.all(outsiders.splice(0).map(stopOutsider))
  _pendingPorts.clear()
  builds.commands.clear()
  builds.unreadable.clear()
  settings.set('autoLaunchOnStartup', undefined)
  settings.set('autoStartAwaitingFirstStart', undefined)
  vi.restoreAllMocks()
})

afterAll(() => {
  for (const [name, value] of Object.entries(electronHome.saved)) {
    if (value !== undefined) process.env[name] = value
  }
  fs.rmSync(workDir, { recursive: true, force: true, maxRetries: 3 })
  if (electronHome.dir) fs.rmSync(electronHome.dir, { recursive: true, force: true, maxRetries: 3 })
})

describe('two builds that want the same port', { timeout: 30_000 }, () => {
  it('opens a build started while another is running on the next free port', async () => {
    const first = await start(build('studio'))
    const second = await start(build('fresh-install'))

    expect(first).toMatchObject({ ok: true, port: defaultPort })
    expect(second.ok, second.message).toBe(true)
    expect(second.port).not.toBe(defaultPort)
    expect(await whoAnswersOn(defaultPort)).toBe('studio')
    expect(await whoAnswersOn(second.port!)).toBe('fresh-install')
  })

  it('gives each build its own port when both start at the same moment', async () => {
    const [onboarding, other] = await Promise.all([
      start(build('onboarding-install')),
      start(build('studio'))
    ])

    expect(onboarding.ok, onboarding.message).toBe(true)
    expect(other.ok, other.message).toBe(true)
    expect(onboarding.port).not.toBe(other.port)
    expect(await whoAnswersOn(onboarding.port!)).toBe('onboarding-install')
    expect(await whoAnswersOn(other.port!)).toBe('studio')
  })

  it('keeps a restarting build on its port and starts the next build on another', async () => {
    const studio = build('studio')
    await start(studio)
    slowNextBoot(studio, 1_500)
    await restartFromInside(defaultPort)

    const second = await start(build('onboarding-install'))

    expect(second.ok, second.message).toBe(true)
    expect(second.port, 'the restarting build still owns its port').not.toBe(defaultPort)
    await vi.waitFor(async () => expect(await whoAnswersOn(defaultPort)).toBe('studio'), {
      timeout: 10_000,
      interval: 100
    })
    expect(await whoAnswersOn(second.port!)).toBe('onboarding-install')
    expect([..._runningSessions.keys()].sort()).toEqual(['onboarding-install', 'studio'])
  })

  it('asks what to do when a build set to ask loses its port while starting', async () => {
    const studio = build('studio', { portConflict: 'ask' })
    slowNextBoot(studio, 800)

    const launching = start(studio)
    await vi.waitFor(() => expect(_pendingPorts.has(defaultPort)).toBe(true), { interval: 5 })
    await occupyFromOutside(defaultPort)
    const result = await launching

    expect(result.ok).toBe(false)
    expect(result.portConflict).toMatchObject({ port: defaultPort, isComfy: false })
    expect(result.portConflict?.nextPort, 'offers a free port to move to').toBeGreaterThan(
      defaultPort
    )
    expect(result.message).toContain(`Port ${defaultPort} is already in use`)
    expect(_runningSessions.has('studio')).toBe(false)
  })
})

describe('Auto start on the first build, decided by its first start', { timeout: 30_000 }, () => {
  function justInstalled(inst: InstallationRecord): void {
    settings.set('autoLaunchOnStartup', inst.id)
    settings.set('autoStartAwaitingFirstStart', inst.id)
  }

  it('keeps Auto start on once the new build starts', async () => {
    const fresh = build('fresh-install')
    justInstalled(fresh)

    const result = await start(fresh)

    expect(result.ok, result.message).toBe(true)
    expect(settings.get('autoLaunchOnStartup')).toBe('fresh-install')
  })

  it('turns Auto start off when the new build fails to start', async () => {
    const fresh = build('fresh-install')
    crashOnBoot(fresh)
    justInstalled(fresh)

    const result = await start(fresh)

    expect(result.ok).toBe(false)
    expect(settings.get('autoLaunchOnStartup')).toBe('none')
  })

  it('turns Auto start off when the new build cannot even be set up to start', async () => {
    const fresh = build('fresh-install')
    builds.unreadable.add(fresh.id)
    justInstalled(fresh)

    await expect(start(fresh)).rejects.toThrow('pyvenv.cfg is unreadable')

    expect(settings.get('autoLaunchOnStartup')).toBe('none')
  })

  it('leaves Auto start on when a build that already started once fails later', async () => {
    const studio = build('studio')
    justInstalled(studio)
    expect((await start(studio)).ok).toBe(true)
    for (const id of [..._runningSessions.keys()]) {
      const session = _runningSessions.get(id)
      _runningSessions.delete(id)
      if (session?.proc) await killProcessTree(session.proc)
    }
    crashOnBoot(studio)

    const result = await start(studio)

    expect(result.ok).toBe(false)
    expect(settings.get('autoLaunchOnStartup')).toBe('studio')
  })
})
