import { spawn, type ChildProcess } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  builds: [] as { id: string; lastLaunchedAt: number }[],
  activeOperations: vi.fn((): { installationId: string; actionId: string }[] => []),
  fetch: vi.fn()
}))

vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() }, net: { fetch: mocks.fetch } }))
vi.mock('../settings', () => ({ get: (key: string) => mocks.settings[key] }))
vi.mock('../installations', () => ({ list: async () => mocks.builds }))
vi.mock('../lib/ipc/shared', () => ({ _operationAborts: new Map() }))
vi.mock('../lib/ipc/sessionActions', () => ({ _getActiveOperations: mocks.activeOperations }))
vi.mock('../lib/modelDownloadTransport', () => ({ startModelTransfer: vi.fn() }))
vi.mock('./buildRuntime', () => ({
  buildRuntime: (build: { id: string }) => ({ python: `python-${build.id}`, sitePackages: null })
}))

import { killProcessTree } from '../lib/process'
import {
  createSearchProcess,
  readCapped,
  SIDECAR_PATH_ENV,
  spawnHelperProcess,
  type SpawnHelper
} from './searchProcess'

const SUPPORTS = JSON.stringify({ sidecar: '0.1.0', accepts: { major: 1, min_minor: 0 } })
const SCRIPTS: Record<string, string> = {
  'python-unsupported': 'process.exit(3)',
  'python-ok': `process.stdout.write(${JSON.stringify(SUPPORTS + '\n')})`,
  'python-stuck': 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'
}

let root: string
let spawned: { python: string; child: ChildProcess }[]

const spawnHelper: SpawnHelper = (python) => {
  const child = spawn(process.execPath, ['-e', SCRIPTS[python] ?? 'process.exit(1)'], {
    stdio: ['ignore', 'pipe', 'ignore'],
    detached: process.platform !== 'win32'
  })
  spawned.push({ python, child })
  return child
}

function setup() {
  const announced: unknown[] = []
  const search = createSearchProcess({
    isLocalInstallation: () => true,
    terminalEnvOf: () => null,
    broadcast: (a) => announced.push(a),
    spawnHelper,
    storeRoot: path.join(root, 'store'),
    cacheRoot: path.join(root, 'cache')
  })
  return { search, announced }
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'search-process-'))
  spawned = []
  mocks.settings = {
    templateSearchEnabled: true,
    templateSearchBundleBase: 'https://b.example.test/'
  }
  mocks.activeOperations.mockReturnValue([])
  mocks.fetch.mockRejectedValue(new Error('offline'))
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
      { id: 'stuck', lastLaunchedAt: 2 },
      { id: 'ok', lastLaunchedAt: 1 }
    ]
    mocks.activeOperations.mockImplementation(() =>
      spawned.length > 0 ? [{ installationId: 'stuck', actionId: 'copy-update' }] : []
    )
    const { search } = setup()
    await search.prepare()
    expect(spawned.map((s) => s.python)).toEqual(['python-unsupported', 'python-ok'])
  })

  it('kills a helper running on a build before an operation on that build', async () => {
    mocks.builds = [{ id: 'stuck', lastLaunchedAt: 1 }]
    const { search } = setup()
    const preparing = search.prepare()
    await vi.waitFor(() => expect(spawned).toHaveLength(1))

    mocks.activeOperations.mockReturnValue([{ installationId: 'stuck', actionId: 'copy-update' }])
    await search.onBuildAction('stuck')

    const { child } = spawned[0]!
    await vi.waitFor(() => expect(child.exitCode ?? child.signalCode).not.toBeNull())
    await preparing
    expect(spawned).toHaveLength(1)
  })
})

describe('spawnHelperProcess', () => {
  it('starts a helper that can be killed with everything it started', async () => {
    const child = spawnHelperProcess(process.execPath, [
      '-e',
      'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'
    ])
    spawned.push({ python: 'node', child })
    await new Promise((resolve) => child.once('spawn', resolve))
    await killProcessTree(child)
    await vi.waitFor(() => expect(child.exitCode ?? child.signalCode).not.toBeNull())
  })
})

describe('readCapped', () => {
  it('reads a small body and refuses one past the limit without reading it all', async () => {
    expect((await readCapped(new Response('hello'), 10)).toString()).toBe('hello')
    await expect(readCapped(new Response('x'.repeat(100)), 10)).rejects.toThrow('more than 10')
  })
})
