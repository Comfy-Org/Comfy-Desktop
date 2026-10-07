// @vitest-environment node
/**
 * The "Repair ComfyUI files" action: `update-comfyui` with `repair: true`. Drives
 * `handleAction` against a real git checkout, with the update run itself mocked
 * (the Python updater's repair is covered by tests/python). Checks what the
 * handler asks the orchestrator for, and that it verifies the tree afterwards.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import type { InstallationRecord } from '../../installations'
import type { UpdateOrchestrationOptions } from './updateOrchestrator'

const masterPython = path.join(os.tmpdir(), `repair-master-py-${process.pid}`)

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '' },
  ipcMain: { handle: vi.fn() }
}))
vi.mock('../../lib/i18n', () => ({ t: (key: string) => key }))
vi.mock('./envPaths', () => ({ getMasterPythonPath: () => masterPython }))
vi.mock('../../lib/release-cache', () => ({ checkForUpdate: vi.fn(async () => ({ ok: true })) }))

// The update run: records its options, then leaves the tree as the test says.
const run = vi.hoisted(() => ({
  opts: undefined as undefined | Record<string, unknown>,
  after: (_dir: string): void => {}
}))
vi.mock('./updateOrchestrator', () => ({
  runComfyUIUpdate: vi.fn(async (opts: UpdateOrchestrationOptions) => {
    run.opts = opts as unknown as Record<string, unknown>
    run.after(path.join(opts.installPath, 'ComfyUI'))
    return { ok: true, installation: opts.installation }
  })
}))

import { handleAction } from './actions'

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim()

let installPath: string
let comfyuiDir: string

beforeEach(() => {
  fs.writeFileSync(masterPython, '')
  installPath = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-action-'))
  comfyuiDir = path.join(installPath, 'ComfyUI')
  fs.mkdirSync(path.join(comfyuiDir, 'app', 'database'), { recursive: true })
  git(comfyuiDir, 'init', '-q')
  fs.writeFileSync(
    path.join(comfyuiDir, 'app', 'database', 'db.py'),
    'def lock_holder_db_path(): pass\n'
  )
  git(comfyuiDir, 'add', '-A')
  git(comfyuiDir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'v0.39.1')
  // The D4 state: HEAD on the release, an older db.py left behind, no marker.
  fs.writeFileSync(path.join(comfyuiDir, 'app', 'database', 'db.py'), '# older db.py\n')
  run.opts = undefined
})

afterEach(() => {
  fs.rmSync(installPath, { recursive: true, force: true })
  fs.rmSync(masterPython, { force: true })
})

function repair(data: Record<string, unknown>): ReturnType<typeof handleAction> {
  const installation = {
    id: 'inst',
    name: 'inst',
    sourceId: 'standalone',
    status: 'installed',
    installPath,
    updateChannel: 'stable'
  } as unknown as InstallationRecord
  return handleAction('update-comfyui', installation, data, {
    update: async () => {},
    sendProgress: () => {},
    sendOutput: () => {}
  })
}

describe('standalone handleAction(update-comfyui) with repair', () => {
  it('pins the installed tag, forces a dependency sync, and reports a clean tree as repaired', async () => {
    run.after = (dir) => git(dir, 'checkout', '--', '.')
    const result = await repair({ channel: 'stable', repair: true, targetTag: 'v0.39.1' })
    expect(result.ok).toBe(true)
    expect(run.opts).toMatchObject({ targetTag: 'v0.39.1', forceDepsSync: true })
  })

  it('reports a failure when tracked files still differ after the run', async () => {
    run.after = () => {}
    const result = await repair({ channel: 'stable', repair: true, targetTag: 'v0.39.1' })
    expect(result).toMatchObject({ ok: false, message: 'standalone.repairIncomplete' })
  })

  it('leaves a normal update as it was: no forced sync, no tree check', async () => {
    run.after = () => {}
    const result = await repair({ channel: 'stable' })
    expect(result.ok).toBe(true)
    expect(run.opts).toMatchObject({ forceDepsSync: false })
  })
})
