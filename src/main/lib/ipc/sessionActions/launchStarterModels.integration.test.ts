import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const electronHome = vi.hoisted(() => {
  const overrides = [
    'XDG_CONFIG_HOME',
    'XDG_CACHE_HOME',
    'XDG_DATA_HOME',
    'XDG_STATE_HOME',
    'LOCALAPPDATA'
  ]
  const saved = Object.fromEntries(overrides.map((name) => [name, process.env[name]]))
  for (const name of overrides) delete process.env[name]
  return { dir: '', saved }
})

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () =>
      (electronHome.dir ||= fs.mkdtempSync(path.join(os.tmpdir(), 'launch-starter-home-'))),
    getVersion: () => '0.0.0-test',
    getLocale: () => 'en',
    on: () => {}
  },
  ipcMain: { handle: vi.fn(), on: vi.fn(), off: vi.fn() },
  dialog: {},
  shell: {},
  nativeImage: {},
  net: { isOnline: () => true },
  session: { defaultSession: {}, fromPartition: () => ({}) },
  WebContentsView: class {},
  BrowserWindow: { getAllWindows: () => [] },
  nativeTheme: { on: vi.fn(), shouldUseDarkColors: false }
}))

const builds = vi.hoisted(() => ({
  commands: new Map<string, Record<string, unknown>>()
}))

vi.mock('../shared', async (importOriginal) => {
  const actual = await importOriginal<typeof SharedModule>()
  return {
    ...actual,
    get _onLaunch() {
      return actual._onLaunch
    },
    captureSnapshotIfChanged: async () => ({ saved: false }),
    sourceMap: {
      ...actual.sourceMap,
      standalone: {
        ...actual.sourceMap.standalone,
        getLaunchCommand: (inst: { id: string }) => {
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

interface Transfer {
  url: string
  finalPath: string
  stoppedBy: 'pause' | 'cancel' | null
  settle: (outcome: Record<string, unknown>) => void
}

const network = vi.hoisted(() => ({
  unreachable: false,
  transfers: [] as Transfer[]
}))

vi.mock('../../modelDownloadTransport', () => ({
  startModelTransfer: (opts: { url: string; finalPath: string }) => {
    let settle!: (outcome: Record<string, unknown>) => void
    const done = new Promise<Record<string, unknown>>((resolve) => {
      settle = resolve
    })
    const transfer: Transfer = { url: opts.url, finalPath: opts.finalPath, stoppedBy: null, settle }
    network.transfers.push(transfer)
    if (network.unreachable) settle({ outcome: 'error', error: 'connection reset' })
    return {
      done,
      pause: () => {
        transfer.stoppedBy = 'pause'
        settle({ outcome: 'paused' })
        return true
      },
      cancel: () => {
        transfer.stoppedBy = 'cancel'
        settle({ outcome: 'cancelled' })
        return true
      }
    }
  }
}))

import { handleLaunch } from './launch'
import {
  _operationAborts,
  _pendingPorts,
  _runningSessions,
  killProcessTree,
  setCallbacks
} from '../shared'
import type { InstallationRecord, LaunchCallbackInfo } from '../shared'
import type * as SharedModule from '../shared'
import * as installations from '../../../installations'
import * as i18n from '../../i18n'
import { lookupEnMessage } from '../../localeTestHelper'
import { isPortListening } from '../../process'
import { getVenvDir } from '../../pythonEnv'
import * as telemetry from '../../telemetry'
import { cancelModelDownload, getDownloadsTrayState } from '../../comfyDownloadManager'
import { DEFAULT_LAUNCH_PHASES } from '../../launchPhases'
import {
  forgetTemplateDownload,
  getTemplateDownloadState,
  startTemplateDownload
} from '../../../sources/standalone/templateDownloadTask'
import type { ActionContext, ActionResult } from './types'

const FAKE_COMFY = `
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const args = process.argv.slice(2)
const valueOf = (flag) => args[args.lastIndexOf(flag) + 1]
const port = Number(valueOf('--port'))
const name = valueOf('--name')
const state = valueOf('--state')
const server = http.createServer((req, res) => res.end(name))
fs.writeFileSync(path.join(state, 'starting'), '')
const listenOnceAllowed = () => {
  if (fs.existsSync(path.join(state, 'hold-boot'))) return setTimeout(listenOnceAllowed, 20)
  server.listen(port, '127.0.0.1')
}
listenOnceAllowed()
`

const STARTER_WORKFLOW = 'flux_starter'
const STARTER_MODELS_BYTES = 4 * 1024 * 1024

interface StarterBuild {
  record: InstallationRecord
  model: { name: string; url: string; directory: string }
  progress: Record<string, unknown>[]
}

let workDir = ''
let script = ''
let buildCount = 0
let opened: LaunchCallbackInfo[] = []
const started: StarterBuild[] = []
const launches: Promise<unknown>[] = []

async function freePort(): Promise<number> {
  for (;;) {
    const candidate = 30_000 + Math.floor(Math.random() * 10_000)
    if (!(await isPortListening(candidate))) return candidate
  }
}

function sitePackagesOf(installPath: string): string {
  const venv = getVenvDir(installPath)
  return process.platform === 'win32'
    ? path.join(venv, 'Lib', 'site-packages')
    : path.join(venv, 'lib', 'python3.12', 'site-packages')
}

async function buildWithStarterWorkflow(): Promise<StarterBuild> {
  const slug = `starter-build-${++buildCount}`
  const installPath = path.join(workDir, slug)
  const model = {
    name: `${slug}.safetensors`,
    url: `https://huggingface.co/Comfy-Org/starter/resolve/main/${slug}.safetensors`,
    directory: 'checkpoints'
  }
  const templates = path.join(
    sitePackagesOf(installPath),
    'comfyui_workflow_templates',
    'templates'
  )
  fs.mkdirSync(templates, { recursive: true })
  fs.writeFileSync(
    path.join(templates, `${STARTER_WORKFLOW}.json`),
    JSON.stringify({ models: [model], nodes: [] })
  )
  const record = await installations.add({
    name: slug,
    sourceId: 'standalone',
    installPath,
    status: 'installed',
    launchMode: 'window',
    useSharedModels: false,
    bundledTemplateId: STARTER_WORKFLOW,
    bundledTemplateSizeBytes: STARTER_MODELS_BYTES,
    pendingTemplateOpen: STARTER_WORKFLOW,
    downloadTemplateModels: true
  })
  const port = await freePort()
  builds.commands.set(record.id, {
    cmd: process.execPath,
    args: [script, '--port', String(port), '--name', record.id, '--state', installPath],
    cwd: installPath,
    port,
    skipSharedPaths: true
  })
  const build = { record, model, progress: [] }
  started.push(build)
  return build
}

async function installStartsTheStarterDownload(build: StarterBuild): Promise<void> {
  startTemplateDownload(build.record, STARTER_MODELS_BYTES, { sendOutput: () => {} })
  await vi.waitFor(() => expect(transfersOf(build)).toHaveLength(1), { timeout: 10_000 })
  expect(getTemplateDownloadState(build.record.id)?.status).toBe('downloading')
}

function transfersOf(build: StarterBuild): Transfer[] {
  return network.transfers.filter((transfer) => transfer.url === build.model.url)
}

function downloadsTrayRow(
  build: StarterBuild,
  list: 'active' | 'recent'
): { id?: string; status: string } | undefined {
  return getDownloadsTrayState()[list].find((row) => row.filename === build.model.name)
}

function start(build: StarterBuild): Promise<ActionResult> {
  const ctx: ActionContext = {
    event: {
      sender: {
        isDestroyed: () => false,
        send: (channel: string, payload: Record<string, unknown>) => {
          if (channel === 'install-progress') build.progress.push(payload)
        }
      }
    } as unknown as Electron.IpcMainInvokeEvent,
    installationId: build.record.id,
    inst: build.record
  }
  const launching = handleLaunch(ctx)
  launches.push(launching.catch(() => {}))
  return launching
}

function holdComfyBoot(build: StarterBuild): void {
  fs.writeFileSync(path.join(build.record.installPath, 'hold-boot'), '')
}

async function comfyIsStarting(build: StarterBuild): Promise<void> {
  await vi.waitFor(
    () => expect(fs.existsSync(path.join(build.record.installPath, 'starting'))).toBe(true),
    { timeout: 15_000 }
  )
}

function letComfyFinishBooting(build: StarterBuild): void {
  fs.rmSync(path.join(build.record.installPath, 'hold-boot'))
}

function windowsOpenedFor(): string[] {
  return opened.map((info) => info.installation.id)
}

function launchStepsShown(build: StarterBuild): string[] {
  const steps = build.progress.flatMap((payload) =>
    payload.phase === 'steps' ? (payload.steps as { phase: string }[]) : []
  )
  return [...new Set(steps.map((step) => step.phase))]
}

function stepsShownAsFailed(build: StarterBuild): Record<string, unknown>[] {
  return build.progress.filter((payload) => payload.error === true)
}

async function whoAnswersOn(port: number): Promise<string> {
  return (await fetch(`http://127.0.0.1:${port}/`)).text()
}

function finishDownloading(transfer: Transfer): void {
  fs.mkdirSync(path.dirname(transfer.finalPath), { recursive: true })
  fs.writeFileSync(transfer.finalPath, 'model weights')
  transfer.settle({ outcome: 'completed', savePath: transfer.finalPath, finalBytes: 13 })
}

function loseTheConnection(build: StarterBuild): void {
  network.unreachable = true
  for (const transfer of transfersOf(build)) {
    transfer.settle({ outcome: 'error', error: 'connection reset' })
  }
}

function cancelInTheDownloadsTray(build: StarterBuild): void {
  expect(cancelModelDownload(downloadsTrayRow(build, 'active')!.id!)).toBe(true)
}

beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'launch-starter-'))
  script = path.join(workDir, 'fake-comfy.cjs')
  fs.writeFileSync(script, FAKE_COMFY)
})

beforeEach(() => {
  opened = []
  network.unreachable = false
  setCallbacks({ onLaunch: (info) => opened.push(info) })
  vi.spyOn(telemetry, 'emit').mockImplementation(() => {})
  vi.spyOn(telemetry, 'capture').mockReturnValue(true)
  vi.spyOn(i18n, 't').mockImplementation((key, params) =>
    lookupEnMessage(key).replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))
  )
})

afterEach(async () => {
  for (const build of started.splice(0)) {
    forgetTemplateDownload(build.record.id)
    const row = downloadsTrayRow(build, 'active')
    if (row?.id) cancelModelDownload(row.id)
  }
  for (const abort of _operationAborts.values()) abort.abort()
  await Promise.all(launches.splice(0))
  const running = [..._runningSessions.values()]
  for (const id of [..._runningSessions.keys()]) _runningSessions.delete(id)
  await Promise.all(running.map((session) => (session.proc ? killProcessTree(session.proc) : null)))
  _pendingPorts.clear()
  builds.commands.clear()
  setCallbacks({})
  vi.restoreAllMocks()
})

afterAll(() => {
  for (const [name, value] of Object.entries(electronHome.saved)) {
    if (value !== undefined) process.env[name] = value
  }
  fs.rmSync(workDir, { recursive: true, force: true, maxRetries: 3 })
  if (electronHome.dir) fs.rmSync(electronHome.dir, { recursive: true, force: true, maxRetries: 3 })
})

describe(
  'first launch of a build whose starter models are still downloading',
  {
    timeout: 60_000
  },
  () => {
    it('opens ComfyUI as soon as its server answers, and the download carries on to the end', async () => {
      const build = await buildWithStarterWorkflow()
      await installStartsTheStarterDownload(build)

      const launching = start(build)
      await vi.waitFor(() => expect(windowsOpenedFor()).toEqual([build.record.id]), {
        timeout: 20_000
      })
      const result = await launching

      expect(result.ok, result.message).toBe(true)
      expect(await whoAnswersOn(result.port!)).toBe(build.record.id)
      expect(opened[0]!.port).toBe(result.port)
      expect(
        opened[0]!.installation.pendingTemplateOpen,
        'the window still opens on the starter workflow'
      ).toBe(STARTER_WORKFLOW)
      expect(getTemplateDownloadState(build.record.id)?.status).toBe('downloading')
      expect(downloadsTrayRow(build, 'active'), 'listed in the Downloads tray').toBeDefined()
      expect(transfersOf(build).map((transfer) => transfer.stoppedBy)).toEqual([null])
      expect(launchStepsShown(build)).toEqual(DEFAULT_LAUNCH_PHASES.map((step) => step.phase))
      expect(stepsShownAsFailed(build)).toEqual([])

      finishDownloading(transfersOf(build)[0]!)

      await vi.waitFor(
        () => expect(getTemplateDownloadState(build.record.id)?.status).toBe('done'),
        {
          timeout: 10_000
        }
      )
      expect(downloadsTrayRow(build, 'recent')?.status).toBe('completed')
      expect(transfersOf(build), 'the download was never restarted').toHaveLength(1)
    })

    it.each([
      ['fails', loseTheConnection],
      ['is cancelled in the Downloads tray', cancelInTheDownloadsTray]
    ])(
      'opens ComfyUI with no failed step when the download %s while ComfyUI starts',
      async (_how, breakTheDownload) => {
        const build = await buildWithStarterWorkflow()
        holdComfyBoot(build)
        await installStartsTheStarterDownload(build)

        const launching = start(build)
        await comfyIsStarting(build)
        breakTheDownload(build)
        await vi.waitFor(
          () => expect(getTemplateDownloadState(build.record.id)?.status).toBe('error'),
          { timeout: 10_000 }
        )
        expect(windowsOpenedFor(), 'ComfyUI is still starting').toEqual([])
        letComfyFinishBooting(build)
        const result = await launching

        expect(result.ok, result.message).toBe(true)
        expect(windowsOpenedFor()).toEqual([build.record.id])
        expect(await whoAnswersOn(result.port!)).toBe(build.record.id)
        expect(launchStepsShown(build)).toEqual(DEFAULT_LAUNCH_PHASES.map((step) => step.phase))
        expect(stepsShownAsFailed(build)).toEqual([])
      }
    )
  }
)
