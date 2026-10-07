// @vitest-environment node
/**
 * The "Repair ComfyUI files" action (`repair-comfyui`): it runs the update
 * handler as a repair and then checks that tracked files match HEAD. The update
 * run and the git check are mocked; the updater's repair itself is covered by
 * tests/python, and `hasTrackedChanges` by git.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { InstallationRecord } from '../../installations'
import type { UpdateOrchestrationOptions } from './updateOrchestrator'
import type * as GitModule from '../../lib/git'

const masterPython = path.join(os.tmpdir(), `repair-master-py-${process.pid}`)

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '' },
  ipcMain: { handle: vi.fn() }
}))
vi.mock('../../lib/i18n', () => ({ t: (key: string) => key }))
vi.mock('./envPaths', () => ({ getMasterPythonPath: () => masterPython }))
vi.mock('../../lib/release-cache', () => ({ checkForUpdate: vi.fn(async () => ({ ok: true })) }))
vi.mock('../../lib/git', async (importOriginal) => ({
  ...(await importOriginal<typeof GitModule>()),
  hasTrackedChanges: vi.fn(),
  readGitHead: vi.fn(() => 'c0ffee'),
  revParseRef: vi.fn(async () => 'c0ffee')
}))
vi.mock('./updateOrchestrator', () => ({
  runComfyUIUpdate: vi.fn(async (opts: UpdateOrchestrationOptions) => ({
    ok: true,
    installation: opts.installation
  }))
}))

import { handleAction } from './actions'
import { hasTrackedChanges, revParseRef } from '../../lib/git'
import { runComfyUIUpdate } from './updateOrchestrator'
import { IN_PLACE_RELAUNCH, REQUIRES_STOPPED } from '../../../types/ipc'

let installPath: string

beforeEach(() => {
  vi.clearAllMocks()
  fs.writeFileSync(masterPython, '')
  installPath = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-action-'))
  fs.mkdirSync(path.join(installPath, 'ComfyUI', '.git'), { recursive: true })
})

afterEach(() => {
  fs.rmSync(installPath, { recursive: true, force: true })
  fs.rmSync(masterPython, { force: true })
})

function run(
  actionId: string,
  data: Record<string, unknown> = { channel: 'stable', targetTag: 'v0.39.1' }
): ReturnType<typeof handleAction> {
  const installation = {
    id: 'inst',
    name: 'inst',
    sourceId: 'standalone',
    status: 'installed',
    installPath,
    updateChannel: 'stable'
  } as unknown as InstallationRecord
  return handleAction(actionId, installation, data, {
    update: async () => {},
    sendProgress: () => {},
    sendOutput: () => {}
  })
}

const lastRunOptions = (): Partial<UpdateOrchestrationOptions> =>
  vi.mocked(runComfyUIUpdate).mock.calls.at(-1)![0]

describe('standalone handleAction(repair-comfyui)', () => {
  it('runs the update pinned to the installed tag as a repair, and reports a clean tree as repaired', async () => {
    vi.mocked(hasTrackedChanges).mockResolvedValue(false)
    expect((await run('repair-comfyui')).ok).toBe(true)
    expect(lastRunOptions()).toMatchObject({ targetTag: 'v0.39.1', repair: true })
  })

  it('refuses, without running anything, unless the pin is the installed commit', async () => {
    vi.mocked(revParseRef).mockResolvedValueOnce('another-commit')
    expect(await run('repair-comfyui')).toMatchObject({ message: 'standalone.repairNotOnTag' })
    expect(await run('repair-comfyui', { channel: 'stable' })).toMatchObject({
      message: 'standalone.repairNotOnTag'
    })
    expect(await run('repair-comfyui', { channel: 'stable', targetTag: 'latest' })).toMatchObject({
      message: 'standalone.repairNotOnTag'
    })
    expect(revParseRef).toHaveBeenCalledWith(expect.any(String), 'v0.39.1^{commit}')
    expect(runComfyUIUpdate).not.toHaveBeenCalled()
  })

  it('reports a failure only when tracked files still differ, not when git cannot tell', async () => {
    vi.mocked(hasTrackedChanges).mockResolvedValue(true)
    expect(await run('repair-comfyui')).toMatchObject({
      ok: false,
      message: 'standalone.repairIncomplete'
    })
    vi.mocked(hasTrackedChanges).mockResolvedValue(null)
    expect((await run('repair-comfyui')).ok).toBe(true)
  })

  it('stops a running ComfyUI first and relaunches it afterwards, like an update', () => {
    expect(REQUIRES_STOPPED.has('repair-comfyui')).toBe(true)
    expect(IN_PLACE_RELAUNCH.has('repair-comfyui')).toBe(true)
  })

  it('leaves a normal update as it was: no repair, no tree check', async () => {
    expect((await run('update-comfyui')).ok).toBe(true)
    expect(lastRunOptions()).toMatchObject({ repair: false })
    expect(hasTrackedChanges).not.toHaveBeenCalled()
  })
})
