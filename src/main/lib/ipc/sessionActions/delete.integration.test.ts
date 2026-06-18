// @vitest-environment node
// Integration test for the delete path's browser-partition cleanup. Runs the
// real handleDelete + deleteBrowserPartition against a seeded install tree and
// a tmp userData/Partitions dir, asserting unique partitions are removed (and
// their session cleared) while shared partitions are left untouched.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { EventEmitter } from 'events'
import type { InstallationRecord } from '../../../installations'

const installationsStore = new Map<string, InstallationRecord>()

const h = vi.hoisted(() => {
  const clearStorageData = vi.fn(async () => {})
  const fromPartition = vi.fn((_partition: string) => ({ clearStorageData }))
  return { userDataDir: { value: '' }, clearStorageData, fromPartition }
})
const { clearStorageData, fromPartition } = h

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: (name: string) => (name === 'userData' ? h.userDataDir.value : os.tmpdir()),
    getVersion: () => '0.0.0-test',
    getLocale: () => 'en',
  },
  ipcMain: { handle: vi.fn(), on: vi.fn(), off: vi.fn() },
  dialog: {},
  shell: {},
  session: { fromPartition: h.fromPartition },
  BrowserWindow: { getAllWindows: () => [] },
  nativeTheme: { on: vi.fn(), shouldUseDarkColors: false },
}))

vi.mock('../../i18n', () => ({
  t: (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  init: vi.fn(async () => {}),
  getMessages: () => ({}),
  getLocale: () => 'en',
  getAvailableLocales: () => [],
}))

vi.mock('../../../settings', () => ({
  get: vi.fn((_key: string): unknown => undefined),
  set: vi.fn(async () => {}),
  getAll: vi.fn(() => ({})),
  getMirrorConfig: vi.fn(() => ({ pypiMirror: undefined, useChineseMirrors: false })),
  defaults: { modelsDirs: ['/unused'], inputDir: '/unused', outputDir: '/unused' },
}))

vi.mock('../../../installations', () => ({
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
  remove: vi.fn(async (id: string) => { installationsStore.delete(id) }),
}))

vi.mock('../../snapshots', () => ({
  saveSnapshot: vi.fn(async () => 'noop.json'),
  getSnapshotCount: vi.fn(async () => 0),
  deduplicatePreUpdateSnapshot: vi.fn(async () => false),
}))
vi.mock('../../../lib/pip', () => ({
  installFilteredRequirements: vi.fn(async () => 0),
}))

import { handleDelete } from './delete'
import { MARKER_FILE, sweepOrphanPartitions } from '../shared'

function makeSender(): Electron.WebContents {
  return { isDestroyed: () => false, send: vi.fn() } as unknown as Electron.WebContents
}

function invokeDelete(id: string, inst: InstallationRecord) {
  return handleDelete({
    event: { sender: makeSender() } as unknown as Electron.IpcMainInvokeEvent,
    installationId: id,
    inst,
  })
}

function seedInstall(installPath: string, id: string): void {
  fs.mkdirSync(installPath, { recursive: true })
  fs.writeFileSync(path.join(installPath, MARKER_FILE), id)
  // A little content so deleteDir has something to walk.
  fs.mkdirSync(path.join(installPath, 'ComfyUI'), { recursive: true })
  fs.writeFileSync(path.join(installPath, 'ComfyUI', 'main.py'), '# stub\n')
}

function partitionDir(id: string): string {
  return path.join(h.userDataDir.value, 'Partitions', id)
}

describe('handleDelete browser-partition cleanup', () => {
  let tmpRoot: string

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'delete-partition-'))
    h.userDataDir.value = path.join(tmpRoot, 'userData')
    fs.mkdirSync(h.userDataDir.value, { recursive: true })
    installationsStore.clear()
    clearStorageData.mockClear()
    fromPartition.mockClear()
  })

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('removes the unique install partition dir and clears its session', async () => {
    const id = 'inst-unique'
    const installPath = path.join(tmpRoot, 'unique-install')
    seedInstall(installPath, id)
    fs.mkdirSync(partitionDir(id), { recursive: true })
    fs.writeFileSync(path.join(partitionDir(id), 'cookies.db'), 'x')

    const inst = { id, name: 'unique', sourceId: 'standalone', installPath, status: 'installed', browserPartition: 'unique', createdAt: new Date(0).toISOString() } as InstallationRecord
    installationsStore.set(id, inst)

    const result = await invokeDelete(id, inst)

    expect(result.ok).toBe(true)
    expect(fs.existsSync(installPath)).toBe(false)
    expect(fs.existsSync(partitionDir(id))).toBe(false)
    expect(fromPartition).toHaveBeenCalledWith(`persist:${id}`)
    expect(clearStorageData).toHaveBeenCalledTimes(1)
    expect(installationsStore.has(id)).toBe(false)
  })

  it('leaves the shared partition untouched and never clears a session', async () => {
    const id = 'inst-shared'
    const installPath = path.join(tmpRoot, 'shared-install')
    seedInstall(installPath, id)
    const sharedDir = partitionDir('shared')
    fs.mkdirSync(sharedDir, { recursive: true })
    fs.writeFileSync(path.join(sharedDir, 'cookies.db'), 'x')

    const inst = { id, name: 'shared', sourceId: 'standalone', installPath, status: 'installed', browserPartition: 'shared', createdAt: new Date(0).toISOString() } as InstallationRecord
    installationsStore.set(id, inst)

    const result = await invokeDelete(id, inst)

    expect(result.ok).toBe(true)
    expect(fs.existsSync(installPath)).toBe(false)
    expect(fs.existsSync(sharedDir)).toBe(true)
    expect(fromPartition).not.toHaveBeenCalled()
    expect(clearStorageData).not.toHaveBeenCalled()
    expect(installationsStore.has(id)).toBe(false)
  })

  it('removes a per-install partition dir even after the setting was toggled to shared', async () => {
    // browserPartition is user-editable: an install created as 'unique' (which
    // already created Partitions/<id>) can later read as 'shared'. Its own dir
    // must still be cleaned up on delete, while persist:shared is untouched.
    const id = 'inst-toggled'
    const installPath = path.join(tmpRoot, 'toggled-install')
    seedInstall(installPath, id)
    fs.mkdirSync(partitionDir(id), { recursive: true })
    fs.writeFileSync(path.join(partitionDir(id), 'cookies.db'), 'x')
    const sharedDir = partitionDir('shared')
    fs.mkdirSync(sharedDir, { recursive: true })

    const inst = { id, name: 'toggled', sourceId: 'standalone', installPath, status: 'installed', browserPartition: 'shared', createdAt: new Date(0).toISOString() } as InstallationRecord
    installationsStore.set(id, inst)

    const result = await invokeDelete(id, inst)

    expect(result.ok).toBe(true)
    expect(fs.existsSync(partitionDir(id))).toBe(false)
    expect(fs.existsSync(sharedDir)).toBe(true)
    expect(fromPartition).toHaveBeenCalledWith(`persist:${id}`)
    expect(installationsStore.has(id)).toBe(false)
  })

  it('still completes the delete when clearing the session storage fails', async () => {
    clearStorageData.mockRejectedValueOnce(new Error('session busy'))
    const id = 'inst-clear-fail'
    const installPath = path.join(tmpRoot, 'clear-fail-install')
    seedInstall(installPath, id)
    fs.mkdirSync(partitionDir(id), { recursive: true })

    const inst = { id, name: 'clear-fail', sourceId: 'standalone', installPath, status: 'installed', browserPartition: 'unique', createdAt: new Date(0).toISOString() } as InstallationRecord
    installationsStore.set(id, inst)

    const result = await invokeDelete(id, inst)

    expect(result.ok).toBe(true)
    expect(fs.existsSync(installPath)).toBe(false)
    // Record removal must not depend on partition cleanup succeeding.
    expect(installationsStore.has(id)).toBe(false)
    // rm still runs even though clearStorageData rejected.
    expect(fs.existsSync(partitionDir(id))).toBe(false)
  })

  it('cleans up the unique partition even when the install dir is already gone', async () => {
    const id = 'inst-gone'
    const installPath = path.join(tmpRoot, 'missing-install')
    fs.mkdirSync(partitionDir(id), { recursive: true })

    const inst = { id, name: 'gone', sourceId: 'standalone', installPath, status: 'installed', browserPartition: 'unique', createdAt: new Date(0).toISOString() } as InstallationRecord
    installationsStore.set(id, inst)

    const result = await invokeDelete(id, inst)

    expect(result.ok).toBe(true)
    expect(fs.existsSync(partitionDir(id))).toBe(false)
    expect(fromPartition).toHaveBeenCalledWith(`persist:${id}`)
    expect(installationsStore.has(id)).toBe(false)
  })
})

describe('sweepOrphanPartitions', () => {
  let tmpRoot: string

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-partition-'))
    h.userDataDir.value = path.join(tmpRoot, 'userData')
    fs.mkdirSync(path.join(h.userDataDir.value, 'Partitions'), { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  function seedPartition(name: string): void {
    const d = partitionDir(name)
    fs.mkdirSync(d, { recursive: true })
    fs.writeFileSync(path.join(d, 'data.txt'), 'x')
  }

  it('removes orphan per-install partitions but keeps known ones, shared, and non-install dirs', () => {
    seedPartition('inst-keep-1')
    seedPartition('inst-keep-2')
    seedPartition('inst-orphan-1')
    seedPartition('inst-orphan-2')
    seedPartition('shared')
    seedPartition('some-other-session') // not install-id shaped

    sweepOrphanPartitions(new Set(['inst-keep-1', 'inst-keep-2']))

    expect(fs.existsSync(partitionDir('inst-keep-1'))).toBe(true)
    expect(fs.existsSync(partitionDir('inst-keep-2'))).toBe(true)
    expect(fs.existsSync(partitionDir('inst-orphan-1'))).toBe(false)
    expect(fs.existsSync(partitionDir('inst-orphan-2'))).toBe(false)
    // Never touch the shared bucket or anything not install-id shaped.
    expect(fs.existsSync(partitionDir('shared'))).toBe(true)
    expect(fs.existsSync(partitionDir('some-other-session'))).toBe(true)
  })

  it('is a no-op when there is no Partitions directory', () => {
    fs.rmSync(path.join(h.userDataDir.value, 'Partitions'), { recursive: true, force: true })
    expect(() => sweepOrphanPartitions(new Set())).not.toThrow()
  })
})
