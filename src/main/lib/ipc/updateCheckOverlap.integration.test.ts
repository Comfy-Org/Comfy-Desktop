import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { EventEmitter } from 'events'
import type { InstallationRecord } from '../../installations'

const installationsStore = new Map<string, InstallationRecord>()

const h = vi.hoisted(() => ({ userDataDir: { value: '' }, handle: vi.fn() }))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: (name: string) => (name === 'userData' ? h.userDataDir.value : os.tmpdir()),
    getVersion: () => '0.0.0-test',
    getLocale: () => 'en'
  },
  ipcMain: { handle: h.handle, on: vi.fn(), off: vi.fn() },
  dialog: {},
  shell: {},
  session: { fromPartition: () => ({ clearStorageData: async () => {} }) },
  BrowserWindow: { getAllWindows: () => [] },
  nativeTheme: { on: vi.fn(), shouldUseDarkColors: false }
}))

vi.mock('../i18n', () => ({
  t: (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  init: vi.fn(async () => {}),
  getMessages: () => ({}),
  getLocale: () => 'en',
  getAvailableLocales: () => []
}))

vi.mock('../../settings', () => ({
  get: vi.fn((_key: string): unknown => undefined),
  set: vi.fn(async () => {}),
  getAll: vi.fn(() => ({})),
  getMirrorConfig: vi.fn(() => ({ pypiMirror: undefined, useChineseMirrors: false })),
  defaults: { modelsDirs: ['/unused'], inputDir: '/unused', outputDir: '/unused' }
}))

vi.mock('../../installations', () => ({
  installationEvents: new EventEmitter(),
  list: vi.fn(async () => Array.from(installationsStore.values())),
  get: vi.fn(async (id: string) => installationsStore.get(id) ?? null),
  update: vi.fn(async (id: string, data: Record<string, unknown>) => {
    const cur = installationsStore.get(id)
    if (!cur) return null
    const next = { ...cur, ...data } as InstallationRecord
    installationsStore.set(id, next)
    return next
  }),
  remove: vi.fn(async (id: string) => {
    installationsStore.delete(id)
  })
}))

vi.mock('../snapshots', () => ({
  saveSnapshot: vi.fn(async () => 'noop.json'),
  getSnapshotCount: vi.fn(async () => 0),
  deduplicatePreUpdateSnapshot: vi.fn(async () => false)
}))
vi.mock('../pip', () => ({
  installFilteredRequirements: vi.fn(async () => 0)
}))

import { registerSessionHandlers } from './registerSessionHandlers'
import { MARKER_FILE, sourceMap } from './shared'
import type { ActionResult } from './sessionActions'

type RunAction = (
  event: unknown,
  installationId: string,
  actionId: string,
  actionData?: Record<string, unknown>
) => Promise<ActionResult>

const BUILD_ID = 'inst-being-checked'

function runAction(actionId: string, actionData?: Record<string, unknown>): Promise<ActionResult> {
  const registered = h.handle.mock.calls.find(([channel]) => channel === 'run-action')
  expect(registered, 'run-action is registered').toBeDefined()
  const handler = registered![1] as RunAction
  const event = { sender: { isDestroyed: () => false, send: vi.fn() } }
  return handler(event, BUILD_ID, actionId, actionData)
}

describe('acting on a build while one of its own actions is still running', () => {
  let tmpRoot = ''
  let installPath = ''
  let finishSourceAction: (result: ActionResult) => void = () => {}

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'update-check-overlap-'))
    h.userDataDir.value = path.join(tmpRoot, 'userData')
    fs.mkdirSync(h.userDataDir.value, { recursive: true })
    installPath = path.join(tmpRoot, 'build')
    fs.mkdirSync(path.join(installPath, 'ComfyUI'), { recursive: true })
    fs.writeFileSync(path.join(installPath, MARKER_FILE), BUILD_ID)
    fs.writeFileSync(path.join(installPath, 'ComfyUI', 'main.py'), '# stub\n')
    installationsStore.clear()
    installationsStore.set(BUILD_ID, {
      id: BUILD_ID,
      name: 'Being checked',
      sourceId: 'standalone',
      installPath,
      status: 'installed',
      browserPartition: 'shared',
      createdAt: new Date(0).toISOString()
    } as InstallationRecord)
    vi.spyOn(sourceMap['standalone']!, 'handleAction').mockImplementation(
      () => new Promise<ActionResult>((resolve) => (finishSourceAction = resolve))
    )
    h.handle.mockClear()
    registerSessionHandlers()
  })

  afterEach(() => {
    finishSourceAction({ ok: true })
    vi.restoreAllMocks()
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  async function sourceActionStarted(): Promise<void> {
    await vi.waitFor(() => expect(sourceMap['standalone']!.handleAction).toHaveBeenCalled())
  }

  it('deletes the build while the update check its settings started is still in flight', async () => {
    const check = runAction('check-update', { silent: true })
    await sourceActionStarted()

    const deleted = await runAction('delete')

    expect(deleted).toEqual({ ok: true, navigate: 'list' })
    expect(fs.existsSync(installPath), 'the build directory is removed').toBe(false)
    expect(installationsStore.has(BUILD_ID), 'the build is forgotten').toBe(false)
    finishSourceAction({ ok: true })
    expect(await check).toEqual({ ok: true })
  })

  it('still refuses to delete the build while an update is being applied to it', async () => {
    const update = runAction('update-comfyui')
    await sourceActionStarted()

    const refused = await runAction('delete')

    expect(refused.ok).toBe(false)
    expect(refused.message).toContain('errors.operationInProgress')
    expect(fs.existsSync(installPath), 'the build directory is kept').toBe(true)
    expect(installationsStore.has(BUILD_ID), 'the build is kept').toBe(true)
    finishSourceAction({ ok: true })
    expect(await update).toEqual({ ok: true })
  })
})
