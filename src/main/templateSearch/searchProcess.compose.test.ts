import type { ChildProcess } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  builds: [] as { id: string; lastLaunchedAt: number }[],
  activeOperations: vi.fn((): { installationId: string; actionId: string }[] => []),
  fetch: vi.fn(),
  transfer: vi.fn()
}))

vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() }, net: { fetch: mocks.fetch } }))
vi.mock('../settings', () => ({ get: (key: string) => mocks.settings[key] }))
vi.mock('../installations', () => ({ list: async () => mocks.builds }))
vi.mock('../lib/ipc/shared', () => ({ _operationAborts: new Map(), _hasActiveLaunch: () => false }))
vi.mock('../lib/ipc/sessionActions', () => ({ _getActiveOperations: mocks.activeOperations }))
vi.mock('../lib/modelDownloadTransport', () => ({ startModelTransfer: mocks.transfer }))
vi.mock('./searchTelemetry', () => ({ reportBundleDownload: vi.fn(), reportStartAttempt: vi.fn() }))
vi.mock(import('./sidecar'), async (importOriginal) => ({
  ...(await importOriginal()),
  startSidecar: vi.fn(async () => ({ ok: false as const, problem: 'failed' as const }))
}))
vi.mock('./buildRuntime', () => ({
  buildRuntime: (build: { id: string }) => ({ python: `python-${build.id}`, sitePackages: null })
}))

import { killProcessTree } from '../lib/process'
import { reportBundleDownload, reportStartAttempt } from './searchTelemetry'
import {
  createSearchProcess,
  helperResult,
  readCapped,
  SIDECAR_PATH_ENV,
  spawnHelperProcess,
  type SpawnHelper
} from './searchProcess'

const BASE = 'https://b.example.test/'
const SUPPORTS = JSON.stringify({ sidecar: '0.1.0', accepts: { major: 1, min_minor: 0 } })
const PRINT_SUPPORTS = `process.stdout.write(${JSON.stringify(SUPPORTS + '\n')})`
const STUCK = 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'
const SCRIPTS: Record<string, string> = {
  'python-unsupported': 'process.exit(3)',
  'python-ok': PRINT_SUPPORTS,
  'python-stuck': STUCK,
  'python-checker': PRINT_SUPPORTS,
  'python-badcheck': PRINT_SUPPORTS
}
const CHECKS: Record<string, string> = {
  'python-checker': STUCK,
  'python-badcheck': 'process.exit(5)'
}

let root: string
let spawned: { python: string; args: string[]; child: ChildProcess }[]

const spawnHelper: SpawnHelper = (python, args) => {
  const script = (args.includes('check') && CHECKS[python]) || SCRIPTS[python] || 'process.exit(1)'
  const child = spawnHelperProcess(process.execPath, ['-e', script])
  spawned.push({ python, args, child })
  return child
}

const sha = (text: string): string => crypto.createHash('sha256').update(text).digest('hex')

function serveBundle(files: Record<string, string>): void {
  const listed = Object.entries(files).map(([file, text]) => ({
    path: file,
    size: Buffer.byteLength(text),
    sha256: sha(text)
  }))
  const manifest = JSON.stringify({ version: '1.0.0', min_sidecar: null, files: listed })
  const small: Record<string, string> = {
    [`${BASE}index.json`]: JSON.stringify({
      bundles: [
        { version: '1.0.0', manifest: 'manifests/1.0.0.json', manifest_sha256: sha(manifest) }
      ]
    }),
    [`${BASE}manifests/1.0.0.json`]: manifest
  }
  mocks.fetch.mockImplementation(async (url: string) =>
    small[url] ? new Response(small[url]) : new Response('', { status: 404 })
  )
  mocks.transfer.mockImplementation((file: { url: string; finalPath: string }) => {
    const text = Object.values(files).find((t) => file.url.endsWith(sha(t)))!
    fs.mkdirSync(path.dirname(file.finalPath), { recursive: true })
    fs.writeFileSync(file.finalPath, text)
    return { done: Promise.resolve({ outcome: 'completed' }) }
  })
}

function bundlesOnDisk(): string[] {
  const dir = path.join(root, 'store', 'bundles')
  return fs.existsSync(dir) ? fs.readdirSync(dir) : []
}

function exited(child: ChildProcess): boolean {
  return (child.exitCode ?? child.signalCode) !== null
}

function setup({ online = false } = {}) {
  const announced: unknown[] = []
  const search = createSearchProcess({
    isLocalInstallation: () => true,
    terminalEnvOf: () => null,
    broadcast: (a) => announced.push(a),
    spawnHelper,
    storeRoot: path.join(root, 'store'),
    cacheRoot: path.join(root, 'cache'),
    isOnline: () => online
  })
  return { search, announced }
}

beforeEach(() => {
  vi.mocked(reportBundleDownload).mockClear()
  vi.mocked(reportStartAttempt).mockClear()
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'search-process-'))
  spawned = []
  mocks.settings = {
    templateSearchEnabled: true,
    templateSearchBundleBase: BASE
  }
  mocks.activeOperations.mockReturnValue([])
  mocks.fetch.mockReset()
  mocks.fetch.mockRejectedValue(new Error('offline'))
  mocks.transfer.mockReset()
  process.env[SIDECAR_PATH_ENV] = '/opt/search.pyz'
})

afterEach(() => {
  for (const { child } of spawned) if (child.exitCode === null) child.kill('SIGKILL')
  delete process.env[SIDECAR_PATH_ENV]
  fs.rmSync(root, { recursive: true, force: true })
})

describe('createSearchProcess', () => {
  it('runs nothing and fetches nothing while search is off', async () => {
    mocks.settings.templateSearchEnabled = false
    mocks.builds = [{ id: 'ok', lastLaunchedAt: 1 }]
    const { search, announced } = setup()
    await search.prepare()
    await search.download()
    expect(spawned).toEqual([])
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(announced).toEqual([{ kind: 'off' }])
  })

  it('labels a background download started at the end of an operation as build_ready', async () => {
    mocks.builds = [{ id: 'ok', lastLaunchedAt: 1 }]
    serveBundle({ 'catalog.json': '{}' })
    const { search } = setup({ online: true })
    expect(await search.downloadInBackground('build_ready')).toBe(true)
    expect(reportBundleDownload).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ result: 'completed', trigger: 'build_ready' })
    )
  })

  it('counts a background download that failed as the attempt, and reports it with its trigger', async () => {
    mocks.builds = [{ id: 'ok', lastLaunchedAt: 1 }]
    serveBundle({ 'catalog.json': '{}' })
    mocks.transfer.mockReturnValue({ done: Promise.resolve({ outcome: 'error', error: 'reset' }) })
    const { search, announced } = setup({ online: true })
    expect(await search.downloadInBackground('launch')).toBe(true)
    expect(reportBundleDownload).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ result: 'failed', trigger: 'launch' })
    )
    expect(announced, 'a quiet failure says nothing').toEqual([])
  })

  it('reports the model download and each start attempt of the search program', async () => {
    mocks.builds = [{ id: 'ok', lastLaunchedAt: 1 }]
    serveBundle({ 'catalog.json': '{}' })
    const { search } = setup()
    await search.download()
    expect(reportBundleDownload).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ result: 'completed', version: '1.0.0', trigger: 'retry' })
    )

    await search.prepare()
    expect(reportStartAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ bundleVersion: '1.0.0', verified: false })
    )
    await search.download()
  })

  it('asks the next build when one Python cannot run the search program', async () => {
    mocks.builds = [
      { id: 'unsupported', lastLaunchedAt: 2 },
      { id: 'ok', lastLaunchedAt: 1 }
    ]
    const { search } = setup()
    await search.prepare()
    expect(spawned.map((s) => s.python)).toEqual(['python-unsupported', 'python-ok'])
  })

  it('skips a build that became busy before its helper would start', async () => {
    mocks.builds = [
      { id: 'unsupported', lastLaunchedAt: 3 },
      { id: 'busy', lastLaunchedAt: 2 },
      { id: 'ok', lastLaunchedAt: 1 }
    ]
    mocks.activeOperations.mockImplementation(() =>
      spawned.length > 0 ? [{ installationId: 'busy', actionId: 'copy-update' }] : []
    )
    const { search } = setup()
    await search.prepare()
    expect(spawned.map((s) => s.python)).toEqual(['python-unsupported', 'python-ok'])
  })

  it('kills a helper running on a build before an operation on that build, and waits for it', async () => {
    mocks.builds = [{ id: 'stuck', lastLaunchedAt: 1 }]
    const { search, announced } = setup()
    const preparing = search.prepare()
    await vi.waitFor(() => expect(spawned).toHaveLength(1))

    mocks.activeOperations.mockReturnValue([{ installationId: 'stuck', actionId: 'copy-update' }])
    await search.onBuildAction('stuck')

    await vi.waitFor(() => expect(exited(spawned[0]!.child)).toBe(true))
    await preparing
    expect(spawned).toHaveLength(1)
    expect(announced.at(-1)).toEqual({ kind: 'waiting_for_build' })
  })

  it('kills a helper on a build about to change even after search was switched off', async () => {
    mocks.builds = [{ id: 'stuck', lastLaunchedAt: 1 }]
    const { search } = setup()
    const preparing = search.prepare()
    await vi.waitFor(() => expect(spawned).toHaveLength(1))

    mocks.settings.templateSearchEnabled = false
    mocks.activeOperations.mockReturnValue([{ installationId: 'stuck', actionId: 'copy-update' }])
    await search.onBuildAction('stuck')

    await vi.waitFor(() => expect(exited(spawned[0]!.child)).toBe(true))
    await preparing
  })

  it('puts a download in place when the build checking it is about to change', async () => {
    mocks.builds = [{ id: 'checker', lastLaunchedAt: 1 }]
    serveBundle({ 'catalog.json': '{}' })
    const { search, announced } = setup()
    const downloading = search.download()
    await vi.waitFor(() => expect(spawned.some(({ args }) => args.includes('check'))).toBe(true), {
      timeout: 10_000
    })

    mocks.activeOperations.mockReturnValue([{ installationId: 'checker', actionId: 'copy-update' }])
    await search.onBuildAction('checker')
    await downloading

    expect(announced.at(-1)).toEqual({ kind: 'idle' })
    expect(bundlesOnDisk()).toEqual(['1.0.0'])
  })

  it('downloads the model in the background, showing no progress, once a free local build can tell which version it reads', async () => {
    mocks.builds = [{ id: 'ok', lastLaunchedAt: 1 }]
    serveBundle({ 'catalog.json': '{}' })
    const { search, announced } = setup({ online: true })
    expect(await search.downloadInBackground('launch')).toBe(true)
    expect(bundlesOnDisk()).toEqual(['1.0.0'])
    expect(reportBundleDownload).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'completed', trigger: 'launch' })
    )
    expect(announced).toEqual([{ kind: 'idle' }])

    const fetches = mocks.fetch.mock.calls.length
    expect(await search.downloadInBackground('build_ready')).toBe(true)
    expect(mocks.fetch.mock.calls.length, 'nothing is fetched once the bundle is on disk').toBe(
      fetches
    )
  })

  it.each([
    ['search is off', { enabled: false, online: true, builds: [{ id: 'ok', lastLaunchedAt: 1 }] }],
    [
      'Desktop is offline',
      { enabled: true, online: false, builds: [{ id: 'ok', lastLaunchedAt: 1 }] }
    ],
    ['there is no local build', { enabled: true, online: true, builds: [] }],
    [
      'no bundle address is set',
      { enabled: true, online: true, builds: [{ id: 'ok', lastLaunchedAt: 1 }], base: null }
    ],
    [
      'the bundle address is not a web address',
      { enabled: true, online: true, builds: [{ id: 'ok', lastLaunchedAt: 1 }], base: '   ' }
    ]
  ])('leaves the background download for later while %s', async (_case, given) => {
    mocks.settings.templateSearchEnabled = given.enabled
    if ('base' in given) mocks.settings.templateSearchBundleBase = given.base
    mocks.builds = given.builds
    serveBundle({ 'catalog.json': '{}' })
    const { search } = setup({ online: given.online })
    expect(await search.downloadInBackground('launch')).toBe(false)
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(spawned).toEqual([])
  })

  it('leaves the background download for later when no build can say which version it reads', async () => {
    mocks.builds = [{ id: 'unsupported', lastLaunchedAt: 1 }]
    serveBundle({ 'catalog.json': '{}' })
    const { search } = setup({ online: true })
    expect(await search.downloadInBackground('launch')).toBe(false)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it("keeps the service's reason when no build can run the search program", async () => {
    mocks.builds = [{ id: 'unsupported', lastLaunchedAt: 1 }]
    serveBundle({ 'catalog.json': '{}' })
    const { search, announced } = setup({ online: true })
    await search.prepare()
    expect(announced.at(-1)).toEqual({ kind: 'unavailable', reason: 'runtime_unsupported' })
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.transfer).not.toHaveBeenCalled()
  })

  it('leaves the background download for later while every build is busy, even after one said which version it reads', async () => {
    mocks.builds = [{ id: 'ok', lastLaunchedAt: 1 }]
    const { search } = setup({ online: true })
    await search.prepare()
    expect(spawned.some(({ args }) => args.includes('--supports'))).toBe(true)

    serveBundle({ 'catalog.json': '{}' })
    mocks.activeOperations.mockReturnValue([{ installationId: 'ok', actionId: 'copy-update' }])
    expect(await search.downloadInBackground('launch')).toBe(false)
    expect(mocks.transfer).not.toHaveBeenCalled()
  })

  it('leaves the background download for later while the only build is busy', async () => {
    mocks.builds = [{ id: 'ok', lastLaunchedAt: 1 }]
    mocks.activeOperations.mockReturnValue([{ installationId: 'ok', actionId: 'copy-update' }])
    serveBundle({ 'catalog.json': '{}' })
    const { search } = setup({ online: true })
    expect(await search.downloadInBackground('launch')).toBe(false)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('gives up on an index that keeps coming past the size limit', async () => {
    mocks.builds = [{ id: 'ok', lastLaunchedAt: 1 }]
    const megabyte = new Uint8Array(1024 * 1024)
    mocks.fetch.mockImplementation(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              controller.enqueue(megabyte)
            }
          })
        )
    )
    const { search, announced } = setup()
    await search.download()
    expect(announced.at(-1)).toEqual({ kind: 'unavailable', reason: 'download_failed' })
  })

  it('refuses a download whose check fails on a build nothing is changing', async () => {
    mocks.builds = [{ id: 'badcheck', lastLaunchedAt: 1 }]
    serveBundle({ 'catalog.json': '{}' })
    const { search, announced } = setup()
    await search.download()

    expect(announced.at(-1)).toEqual({ kind: 'unavailable', reason: 'download_failed' })
    expect(bundlesOnDisk()).toEqual([])
  })

  it('keeps a failed check a failure when its build became busy without the check being stopped', async () => {
    mocks.builds = [{ id: 'badcheck', lastLaunchedAt: 1 }]
    serveBundle({ 'catalog.json': '{}' })
    mocks.activeOperations.mockImplementation(() =>
      spawned.some(({ args }) => args.includes('check'))
        ? [{ installationId: 'badcheck', actionId: 'copy-update' }]
        : []
    )
    const { search, announced } = setup()
    await search.download()

    expect(announced.at(-1)).toEqual({ kind: 'unavailable', reason: 'download_failed' })
    expect(bundlesOnDisk()).toEqual([])
  })
})

describe('readCapped', () => {
  it('reads a body within the limit', async () => {
    expect((await readCapped(new Response('hello'), 10)).toString()).toBe('hello')
  })

  it('stops reading a body that goes past the limit, and cancels the rest of it', async () => {
    let pulls = 0
    const cancel = vi.fn()
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++
        controller.enqueue(new Uint8Array(4))
      },
      cancel
    })
    await expect(readCapped(new Response(endless), 10)).rejects.toThrow('more than 10')
    expect(pulls).toBeLessThan(10)
    expect(cancel).toHaveBeenCalled()
  })
})

describe('spawnHelperProcess', () => {
  it('starts a helper that a tree kill stops even when it ignores SIGTERM', async () => {
    const child = spawnHelperProcess(process.execPath, ['-e', STUCK])
    spawned.push({ python: 'node', args: [], child })
    await new Promise((resolve) => child.once('spawn', resolve))
    await killProcessTree(child)
    await vi.waitFor(() => expect(exited(child)).toBe(true))
  })
})

describe('helperResult', () => {
  it('answers a failed exit for a Python that cannot be started', async () => {
    const child = spawnHelperProcess(path.join(root, 'no-such-python'), [])
    expect(await helperResult(child, 5_000)).toEqual({ code: 1, stdout: '' })
  })

  it('kills a helper that runs past its time', async () => {
    const child = spawnHelperProcess(process.execPath, ['-e', STUCK])
    spawned.push({ python: 'node', args: [], child })
    expect((await helperResult(child, 200)).code).toBe(1)
    expect(exited(child)).toBe(true)
  })
})
