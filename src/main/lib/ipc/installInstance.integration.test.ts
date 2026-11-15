import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { EventEmitter } from 'events'
import { execFileSync } from 'child_process'
import type { ChildProcess } from 'child_process'
import type { Readable } from 'stream'
import type * as ChildProcessModule from 'child_process'
import type * as DownloadModule from '../download'
import type * as ReleasesModule from '../comfyui-releases'
import type * as SnapshotsModule from '../snapshots'
import type * as MigrationModule from '../standaloneMigration'
import type { DownloadProgress } from '../download'
import type { ExtractProgress } from '../extract'
import type { InstallationRecord } from '../../installations'

const BUNDLED_TAG = 'v0.3.48'
const NEWEST_STABLE_TAG = 'v0.3.50'
const ARCHIVE = 'comfyui-standalone-test.tar.gz'
const ARCHIVE_BYTES = 3 * 1048576

const h = vi.hoisted(() => ({
  handle: vi.fn(),
  records: new Map<string, Record<string, unknown>>(),
  cacheDir: '',
  bundleDir: '',
  masterSha: '',
  updateScriptExitCode: 0,
  updateScriptRuns: [] as string[][],
  restoredSnapshots: [] as string[]
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => os.tmpdir(),
    getVersion: () => '0.0.0-test',
    getLocale: () => 'en'
  },
  ipcMain: { handle: h.handle, on: vi.fn(), off: vi.fn() },
  dialog: {},
  shell: {},
  session: {},
  WebContentsView: class {},
  BrowserWindow: { getAllWindows: () => [] },
  nativeTheme: { on: vi.fn(), shouldUseDarkColors: false }
}))

vi.mock('../i18n', async () => {
  const { lookupEnMessage } = await import('../localeTestHelper')
  return {
    t: (key: string, params?: Record<string, string | number>) =>
      lookupEnMessage(key).replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? '')),
    init: vi.fn(),
    getMessages: () => ({}),
    getLocale: () => 'en',
    getAvailableLocales: () => []
  }
})

vi.mock('../../settings', () => ({
  get: vi.fn((key: string): unknown => {
    if (key === 'cacheDir') return h.cacheDir
    if (key === 'maxCachedDownloads') return 5
    return undefined
  }),
  set: vi.fn(async () => {}),
  getAll: vi.fn(() => ({})),
  getMirrorConfig: vi.fn(() => ({ pypiMirror: undefined, useChineseMirrors: false })),
  defaults: { modelsDirs: ['/unused'], inputDir: '/unused', outputDir: '/unused' }
}))

vi.mock('../../installations', () => ({
  installationEvents: new EventEmitter(),
  CLOUD_SOURCE_ID: 'cloud',
  list: vi.fn(async () => Array.from(h.records.values())),
  get: vi.fn(async (id: string) => h.records.get(id) ?? null),
  update: vi.fn(async (id: string, data: Record<string, unknown>) => {
    const current = h.records.get(id)
    if (!current) return null
    const next = { ...current, ...data }
    h.records.set(id, next)
    return next
  }),
  remove: vi.fn(async (id: string) => {
    h.records.delete(id)
  })
}))

vi.mock('../download', async (importOriginal) => ({
  ...(await importOriginal<typeof DownloadModule>()),
  download: vi.fn(
    async (_url: string, dest: string, onProgress: ((p: DownloadProgress) => void) | null) => {
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, 'archive bytes')
      onProgress?.({
        percent: 100,
        receivedBytes: 3 * 1048576,
        receivedMB: '3',
        totalMB: '3',
        speedMBs: 3,
        elapsedSecs: 1,
        etaSecs: 0
      })
      return dest
    }
  )
}))

vi.mock('../extract', () => ({
  extractNested: vi.fn(
    async (_archive: string, dest: string, onProgress?: ((p: ExtractProgress) => void) | null) => {
      onProgress?.({ percent: 50, elapsedSecs: 1, etaSecs: 1 })
      fs.cpSync(h.bundleDir, dest, { recursive: true })
      onProgress?.({ percent: 100, elapsedSecs: 2, etaSecs: 0 })
    }
  )
}))

vi.mock('../comfyui-releases', async (importOriginal) => ({
  ...(await importOriginal<typeof ReleasesModule>()),
  fetchLatestRelease: vi.fn(async (channel: string) =>
    channel === 'latest'
      ? { tag_name: h.masterSha.slice(0, 7), commitSha: h.masterSha }
      : { tag_name: 'v0.3.50' }
  )
}))

vi.mock('../snapshots', async (importOriginal) => ({
  ...(await importOriginal<typeof SnapshotsModule>()),
  saveSnapshot: vi.fn(async (_installPath: string, _installation: unknown, trigger: string) => {
    return `${trigger}-snapshot.json`
  }),
  getSnapshotCount: vi.fn(async () => 1),
  deduplicatePreUpdateSnapshot: vi.fn(async () => false)
}))

vi.mock('../standaloneMigration', async (importOriginal) => ({
  ...(await importOriginal<typeof MigrationModule>()),
  restoreSnapshotIntoInstallation: vi.fn(
    async (
      _entry: unknown,
      stagedFile: string,
      _owned: boolean,
      tools: { sendProgress: (phase: string, detail: Record<string, unknown>) => void }
    ) => {
      h.restoredSnapshots.push(stagedFile)
      tools.sendProgress('restore-nodes', { percent: 100, status: 'Nodes restored' })
      tools.sendProgress('restore-pip', { percent: 100, status: 'Packages restored' })
    }
  )
}))

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcessModule>()
  const toolName = (command: string): string => path.basename(command).replace(/\.exe$/, '')

  const sitePackagesOf = (envRoot: string): string =>
    process.platform === 'win32'
      ? path.join(envRoot, 'Lib', 'site-packages')
      : path.join(envRoot, 'lib', 'python3.13', 'site-packages')

  const createVenv = (venvPath: string): void => {
    fs.mkdirSync(sitePackagesOf(venvPath), { recursive: true })
    const python =
      process.platform === 'win32'
        ? path.join(venvPath, 'Scripts', 'python.exe')
        : path.join(venvPath, 'bin', 'python3')
    fs.mkdirSync(path.dirname(python), { recursive: true })
    fs.writeFileSync(python, '')
  }

  const stream = (chunks: string[]): Readable => {
    const readable = new EventEmitter() as Readable
    process.nextTick(() => {
      for (const chunk of chunks) readable.emit('data', Buffer.from(chunk))
    })
    return readable
  }

  const finishedProcess = (stdout: string[], exitCode: number): ChildProcess => {
    const proc = new EventEmitter() as ChildProcess
    proc.stdout = stream(stdout)
    proc.stderr = stream([])
    proc.kill = () => true
    process.nextTick(() => process.nextTick(() => proc.emit('close', exitCode, null)))
    return proc
  }

  const git = (cwd: string, ...args: string[]): string =>
    actual.execFileSync('git', args, { cwd, stdio: 'pipe', windowsHide: true }).toString().trim()

  const runUpdateScript = (args: string[]): ChildProcess => {
    h.updateScriptRuns.push(args)
    const comfyuiDir = args[2]!
    if (h.updateScriptExitCode !== 0) {
      return finishedProcess(
        ['Fetching from origin...\n', '[ERROR] Failed to fetch from origin.\n'],
        h.updateScriptExitCode
      )
    }
    const tagFlag = args.indexOf('--tag')
    const target =
      tagFlag >= 0 ? args[tagFlag + 1]! : args.includes('--stable') ? 'v0.3.50' : 'master'
    const before = git(comfyuiDir, 'rev-parse', 'HEAD')
    git(comfyuiDir, 'checkout', '--detach', target)
    const after = git(comfyuiDir, 'rev-parse', 'HEAD')
    return finishedProcess(
      [
        `[PRE_UPDATE_HEAD] ${before}\n`,
        'Fetching from origin...\n',
        target === 'master' ? 'Resetting to origin/master…\n' : `Checking out tag: ${target}\n`,
        `[WRITING_TARGET] ${target}\n`,
        ...(target === 'master' ? [] : [`[CHECKED_OUT_TAG] ${target}\n`]),
        `[POST_UPDATE_HEAD] ${after}\n`,
        'Done!\n'
      ],
      0
    )
  }

  return {
    ...actual,
    execFile: vi.fn((...call: unknown[]) => {
      const [command, args] = call as [string, string[]]
      const done = call[call.length - 1] as (err: Error | null, out: string, err2: string) => void
      const tool = toolName(command)
      if (tool === 'uv' && args[0] === 'venv') {
        createVenv(args[3]!)
        process.nextTick(() => done(null, '', ''))
        return new EventEmitter() as ChildProcess
      }
      if (tool === 'xattr' || tool === 'codesign') {
        process.nextTick(() => done(null, '', ''))
        return new EventEmitter() as ChildProcess
      }
      return (actual.execFile as (...a: unknown[]) => ChildProcess)(...call)
    }),
    spawn: vi.fn((command: string, args?: readonly string[], options?: object) => {
      const tool = toolName(command)
      if (tool === 'python3' || tool === 'python') return runUpdateScript([...(args ?? [])])
      if (tool === 'uv') {
        return finishedProcess(
          ['Resolved 12 packages in 31ms\n', 'Installed 2 packages in 8ms\n'],
          0
        )
      }
      return actual.spawn(command, args as string[], options as Parameters<typeof actual.spawn>[2])
    })
  }
})

import { registerInstallationHandlers } from './registerInstallationHandlers'
import { getLogsBuffer } from '../logsBroadcast'
import { clearVersionCache } from '../version-resolve'
import { standalone } from '../../sources/standalone'
import { getVenvDir } from '../../sources/standalone/envPaths'

interface ProgressEvent {
  installationId: string
  phase: string
  percent?: number
  status?: string
  steps?: { phase: string; label: string }[]
}

type InstallHandler = (
  event: { sender: Electron.WebContents },
  installationId: string,
  express?: boolean
) => Promise<{ ok: boolean; message?: string }>

function gitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore', windowsHide: true })
    return true
  } catch {
    return false
  }
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    'git',
    [
      '-c',
      'user.email=test@example.com',
      '-c',
      'user.name=Test',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'tag.gpgsign=false',
      ...args
    ],
    { cwd, stdio: 'pipe', windowsHide: true }
  )
    .toString()
    .trim()
}

function sitePackagesOf(envRoot: string): string {
  return process.platform === 'win32'
    ? path.join(envRoot, 'Lib', 'site-packages')
    : path.join(envRoot, 'lib', 'python3.13', 'site-packages')
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

function buildBundle(root: string): void {
  const bundle = path.join(root, 'bundle')
  const env = path.join(bundle, 'standalone-env')
  const binDir = process.platform === 'win32' ? env : path.join(env, 'bin')
  writeFile(path.join(binDir, process.platform === 'win32' ? 'python.exe' : 'python3'), '')
  writeFile(path.join(binDir, process.platform === 'win32' ? 'uv.exe' : 'uv'), '')
  const sitePackages = sitePackagesOf(env)
  writeFile(path.join(sitePackages, 'torch', '__init__.py'), 'torch\n')
  writeFile(path.join(sitePackages, 'torch', '_C.so'), 'not a real binary\n')
  writeFile(path.join(sitePackages, 'nvidia', 'cudnn.py'), 'cudnn\n')
  writeFile(path.join(sitePackages, 'requests', '__init__.py'), 'requests\n')

  const comfyui = path.join(bundle, 'ComfyUI')
  fs.mkdirSync(comfyui, { recursive: true })
  git(comfyui, 'init')
  git(comfyui, 'symbolic-ref', 'HEAD', 'refs/heads/master')
  writeFile(path.join(comfyui, 'main.py'), 'print("ComfyUI")\n')
  writeFile(path.join(comfyui, 'requirements.txt'), 'torch\ncomfyui-frontend-package==1.0.0\n')
  git(comfyui, 'add', '.')
  git(comfyui, 'commit', '-m', 'release 0.3.48')
  git(comfyui, 'tag', BUNDLED_TAG)
  writeFile(path.join(comfyui, 'requirements.txt'), 'torch\ncomfyui-frontend-package==1.2.0\n')
  git(comfyui, 'add', '.')
  git(comfyui, 'commit', '-m', 'release 0.3.50')
  git(comfyui, 'tag', NEWEST_STABLE_TAG)
  writeFile(path.join(comfyui, 'nightly.py'), 'nightly = True\n')
  git(comfyui, 'add', '.')
  git(comfyui, 'commit', '-m', 'work after the release')
  h.masterSha = git(comfyui, 'rev-parse', 'HEAD')

  const origin = path.join(root, 'origin.git')
  git(root, 'clone', '--bare', comfyui, origin)
  git(comfyui, 'remote', 'add', 'origin', origin)
  git(comfyui, 'checkout', '--detach', BUNDLED_TAG)
  h.bundleDir = bundle
}

function standaloneRecord(
  id: string,
  installPath: string,
  pick: { release: 'stable' | 'latest' | 'v0.3.48-env1'; comfyVersion?: string }
): Record<string, unknown> {
  const variant = 'test-cpu'
  const url = `https://downloads.example.com/${ARCHIVE}`
  const data = standalone.buildInstallation({
    release: { value: pick.release, label: pick.release },
    ...(pick.comfyVersion
      ? { comfyVersion: { value: pick.comfyVersion, label: pick.comfyVersion } }
      : {}),
    variant: {
      value: variant,
      label: variant,
      data: {
        variantId: variant,
        manifest: { id: variant, comfyui_ref: '0.3.48', python_version: '3.13.12' },
        downloadUrl: url,
        downloadFiles: [{ url, filename: ARCHIVE, size: ARCHIVE_BYTES }],
        r2Release: {
          tag: 'v0.3.48-env1',
          comfyui_version: '0.3.48',
          comfyui_commit: 'abc123',
          build: 1,
          date: '2026-11-01T00:00:00Z',
          file: ARCHIVE,
          size: ARCHIVE_BYTES,
          python_version: '3.13.12',
          torch_version: '2.7.1'
        }
      }
    }
  })
  return {
    id,
    name: 'ComfyUI',
    sourceId: 'standalone',
    installPath,
    status: 'installing',
    createdAt: new Date(0).toISOString(),
    ...data
  }
}

let installCount = 0

describe.skipIf(!gitAvailable())('installing a standalone build', () => {
  let root: string
  let installId: string
  let installPath: string
  let sent: { channel: string; payload: Record<string, unknown> }[]
  let sender: Electron.WebContents

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'install-journey-')))
    installId = `build-${++installCount}`
    installPath = path.join(root, 'ComfyUI Build')
    h.cacheDir = path.join(root, 'cache')
    h.records.clear()
    h.updateScriptExitCode = 0
    h.updateScriptRuns = []
    h.restoredSnapshots = []
    buildBundle(root)
    clearVersionCache()
    sent = []
    sender = {
      isDestroyed: () => false,
      send: (channel: string, payload: Record<string, unknown>) => {
        sent.push({ channel, payload })
      }
    } as unknown as Electron.WebContents
    h.handle.mockClear()
    registerInstallationHandlers()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    fs.rmSync(root, { recursive: true, force: true })
  })

  function picked(pick: Parameters<typeof standaloneRecord>[2]): Record<string, unknown> {
    return standaloneRecord(installId, installPath, pick)
  }

  async function install(record: Record<string, unknown>): Promise<{ ok: boolean }> {
    h.records.set(installId, record)
    const registered = h.handle.mock.calls.find(([channel]) => channel === 'install-instance')
    expect(registered, 'install-instance is registered').toBeDefined()
    return (registered![1] as InstallHandler)({ sender }, installId)
  }

  function progressEvents(): ProgressEvent[] {
    return sent
      .filter((message) => message.channel === 'install-progress')
      .map((message) => message.payload as unknown as ProgressEvent)
  }

  function stepList(): { phase: string; label: string }[] {
    const lists = progressEvents().filter((event) => event.phase === 'steps')
    expect(lists, 'the step list is sent once').toHaveLength(1)
    return lists[0]!.steps!
  }

  function reportedPhases(): string[] {
    return [
      ...new Set(
        progressEvents()
          .map((event) => event.phase)
          .filter((phase) => phase !== 'steps' && phase !== 'done')
      )
    ]
  }

  function statusesOf(phase: string): string[] {
    return progressEvents()
      .filter((event) => event.phase === phase)
      .map((event) => event.status ?? '')
  }

  function log(): string {
    return sent
      .filter((message) => message.channel === 'comfy-output')
      .map((message) => message.payload.text as string)
      .join('')
  }

  function record(): InstallationRecord {
    return h.records.get(installId) as unknown as InstallationRecord
  }

  it('lists four steps for the default install and names the version it will get', async () => {
    const result = await install(picked({ release: 'stable', comfyVersion: NEWEST_STABLE_TAG }))

    expect(result).toEqual({ ok: true })
    expect(stepList()).toEqual([
      { phase: 'download', label: 'Download' },
      { phase: 'extract', label: 'Extract' },
      { phase: 'setup', label: 'Set up environment' },
      { phase: 'update', label: 'Get ComfyUI v0.3.50' }
    ])
    expect(reportedPhases()).toEqual(['download', 'extract', 'setup', 'update'])
    expect(statusesOf('update').at(-1)).toBe('Now on ComfyUI v0.3.50')
    expect(record().status).toBe('installed')
    expect(record().comfyVersion).toMatchObject({ baseTag: NEWEST_STABLE_TAG, commitsAhead: 0 })
  })

  it('writes what each step does to the log the window shows', async () => {
    await install(picked({ release: 'stable', comfyVersion: NEWEST_STABLE_TAG }))

    const lines = log().split('\n')
    expect(lines).toContain(`[download] Downloading ${ARCHIVE} (3 MB)`)
    expect(lines).toContain(`[extract] Extracting ${ARCHIVE}`)
    expect(lines).toContain(
      '[setup] Creating the Python environment and copying the bundled packages into it'
    )
    expect(lines).toContain('[setup] This download contains ComfyUI v0.3.48')
    expect(lines).toContain('[update] Getting ComfyUI v0.3.50')
    expect(lines, 'the update script’s own output').toContain('Checking out tag: v0.3.50')
    expect(lines, 'uv’s own output').toContain('Resolved 12 packages in 31ms')
    expect(lines).toContain('[update] Now on ComfyUI v0.3.50')
    expect(getLogsBuffer(installId).join(''), 'the build’s saved log').toBe(log())
  })

  it('keeps the housekeeping after the package copy inside Set up environment', async () => {
    await install(picked({ release: 'stable', comfyVersion: NEWEST_STABLE_TAG }))

    const setup = statusesOf('setup')
    const lastCopyTick = setup.findLastIndex((status) => status.startsWith('Copying packages…'))
    expect(lastCopyTick).toBeGreaterThan(-1)
    expect(setup.slice(lastCopyTick + 1)).toEqual([
      ...(process.platform === 'darwin' ? ['Signing the copied binaries…'] : []),
      'Removing duplicate packages…',
      'Fetching version tags…',
      'Saving a snapshot of the fresh install…'
    ])
    const masterPackages = sitePackagesOf(path.join(installPath, 'standalone-env'))
    const venvPackages = sitePackagesOf(getVenvDir(installPath))
    expect(fs.existsSync(path.join(venvPackages, 'torch', '__init__.py'))).toBe(true)
    expect(fs.existsSync(path.join(venvPackages, 'requests', '__init__.py'))).toBe(true)
    expect(fs.existsSync(path.join(masterPackages, 'torch'))).toBe(false)
    expect(fs.existsSync(path.join(masterPackages, 'nvidia'))).toBe(false)
    expect(fs.existsSync(path.join(masterPackages, 'requests'))).toBe(true)
  })

  it('names a pinned version and never calls it the latest', async () => {
    await install(picked({ release: 'stable', comfyVersion: BUNDLED_TAG }))

    expect(stepList().at(-1)).toEqual({ phase: 'update', label: 'Get ComfyUI v0.3.48' })
    expect(statusesOf('update').at(-1)).toBe('Already included in this download')
    expect(h.updateScriptRuns, 'nothing to fetch when the download already has it').toEqual([])
    expect(record().comfyVersion).toMatchObject({ baseTag: BUNDLED_TAG, commitsAhead: 0 })
    const shown = [...stepList().map((step) => step.label), ...statusesOf('update')].join('\n')
    expect(shown).not.toMatch(/latest/i)
    expect(log()).toContain('[update] The download already has ComfyUI v0.3.48')
  })

  it('says "latest" and never "stable" on the Latest channel', async () => {
    await install(picked({ release: 'latest' }))

    expect(stepList().at(-1)).toEqual({ phase: 'update', label: 'Get the latest ComfyUI' })
    expect(reportedPhases()).toEqual(['download', 'extract', 'setup', 'update'])
    const shown = [...stepList().map((step) => step.label), ...statusesOf('update')].join('\n')
    expect(shown).not.toMatch(/stable/i)
    expect(h.updateScriptRuns).toHaveLength(1)
    expect(h.updateScriptRuns[0]).not.toContain('--stable')
    expect(h.updateScriptRuns[0]).not.toContain('--tag')
    expect(record().comfyVersion).toMatchObject({ commit: h.masterSha })
    expect(statusesOf('update').at(-1)).toBe('Now on ComfyUI v0.3.50+1')
  })

  it('leaves the version step out when the build keeps the ComfyUI it came with', async () => {
    const result = await install(picked({ release: 'v0.3.48-env1' }))

    expect(result).toEqual({ ok: true })
    expect(stepList().map((step) => step.phase)).toEqual(['download', 'extract', 'setup'])
    expect(reportedPhases()).toEqual(['download', 'extract', 'setup'])
    expect(log()).not.toContain('[update]')
    expect(h.updateScriptRuns).toEqual([])
  })

  it('adds the two restore steps after the install steps when a snapshot is waiting', async () => {
    const staged = path.join(root, 'staged-snapshot.json')
    fs.writeFileSync(staged, '{}')
    const result = await install({
      ...picked({ release: 'v0.3.48-env1' }),
      pendingSnapshotRestore: staged
    })

    expect(result).toEqual({ ok: true })
    expect(stepList()).toEqual([
      { phase: 'download', label: 'Download' },
      { phase: 'extract', label: 'Extract' },
      { phase: 'setup', label: 'Set up environment' },
      { phase: 'restore-nodes', label: 'Restore Nodes' },
      { phase: 'restore-pip', label: 'Restore Packages' }
    ])
    expect(reportedPhases()).toEqual([
      'download',
      'extract',
      'setup',
      'restore-nodes',
      'restore-pip'
    ])
    expect(h.restoredSnapshots).toEqual([staged])
  })

  it('finishes on the downloaded version and says why when the new one cannot be fetched', async () => {
    h.updateScriptExitCode = 1
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await install(picked({ release: 'stable', comfyVersion: NEWEST_STABLE_TAG }))
    warned.mockRestore()

    expect(result).toEqual({ ok: true })
    expect(statusesOf('update').at(-1)).toBe(
      "Couldn't get it. Staying on ComfyUI v0.3.48 from this download."
    )
    const lines = log().split('\n')
    expect(lines, 'the script’s own error').toContain('[ERROR] Failed to fetch from origin.')
    expect(lines).toContain(
      '[update] Could not get ComfyUI v0.3.50: Update process failed with exit code 1.'
    )
    expect(lines).toContain('[update] Staying on ComfyUI v0.3.48 from the download')
    expect(record().status).toBe('installed')
    expect(record().comfyVersion).toMatchObject({ baseTag: BUNDLED_TAG, commitsAhead: 0 })
  })

  it.skipIf(process.platform === 'win32')(
    'reports signing the bundled Python on a Mac under Set up environment',
    async () => {
      const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!
      Object.defineProperty(process, 'platform', { ...realPlatform, value: 'darwin' })
      try {
        await install(picked({ release: 'stable', comfyVersion: NEWEST_STABLE_TAG }))
      } finally {
        Object.defineProperty(process, 'platform', realPlatform)
      }

      expect(reportedPhases()).toEqual(['download', 'extract', 'setup', 'update'])
      const setup = statusesOf('setup')
      expect(setup.slice(0, 3)).toEqual([
        'Removing quarantine flags…',
        'Codesigning binaries…',
        'Creating Python environment…'
      ])
      expect(setup).toContain('Signing the copied binaries…')
      expect(log()).toContain(
        '[setup] Clearing macOS quarantine flags and signing the bundled Python'
      )
    }
  )
})
