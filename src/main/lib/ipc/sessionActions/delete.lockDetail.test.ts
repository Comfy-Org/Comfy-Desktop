// @vitest-environment node
// The EBUSY/EPERM branch of handleDelete: after a locked delete it probes for
// the holding processes and upgrades the generic "in use by another program"
// message in place. What it must NOT do is treat a probe that never finished
// as proof that nothing holds the file - the contract change in
// `file-lock-info` exists so this caller can tell the two apart, and it only
// pays for itself here.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { EventEmitter } from 'events'
import type { InstallationRecord } from '../../../installations'
import type { LockProbeResult } from '../../file-lock-info'

const installationsStore = new Map<string, InstallationRecord>()

const h = vi.hoisted(() => ({
  userDataDir: { value: '' },
  lockedPath: { value: '' },
  probeResult: { value: null as LockProbeResult | null }
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: (name: string) => (name === 'userData' ? h.userDataDir.value : os.tmpdir()),
    getVersion: () => '0.0.0-test',
    getLocale: () => 'en'
  },
  ipcMain: { handle: vi.fn(), on: vi.fn(), off: vi.fn() },
  dialog: {},
  shell: {},
  session: { fromPartition: vi.fn(() => ({ clearStorageData: vi.fn(async () => {}) })) },
  BrowserWindow: { getAllWindows: () => [] },
  nativeTheme: { on: vi.fn(), shouldUseDarkColors: false }
}))

vi.mock('../../i18n', () => ({
  t: (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  init: vi.fn(async () => {}),
  getMessages: () => ({}),
  getLocale: () => 'en',
  getAvailableLocales: () => []
}))

vi.mock('../../../settings', () => ({
  get: vi.fn((_key: string): unknown => undefined),
  set: vi.fn(async () => {}),
  getAll: vi.fn(() => ({})),
  getMirrorConfig: vi.fn(() => ({ pypiMirror: undefined, useChineseMirrors: false })),
  defaults: { modelsDirs: ['/unused'], inputDir: '/unused', outputDir: '/unused' }
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
  remove: vi.fn(async (id: string) => {
    installationsStore.delete(id)
  })
}))

vi.mock('../../snapshots', () => ({
  saveSnapshot: vi.fn(async () => 'noop.json'),
  getSnapshotCount: vi.fn(async () => 0),
  deduplicatePreUpdateSnapshot: vi.fn(async () => false)
}))

vi.mock('../../../lib/pip', () => ({
  installFilteredRequirements: vi.fn(async () => 0)
}))

// A real recursive delete cannot be made to fail with EBUSY on demand across
// platforms, so stand in for it. `shared` re-exports from here, which is what
// `delete.ts` imports.
vi.mock('../../delete', () => ({
  deleteDir: vi.fn(async () => {
    throw Object.assign(new Error('EBUSY: resource busy or locked'), {
      code: 'EBUSY',
      path: h.lockedPath.value
    })
  }),
  formatDeleteStatus: vi.fn(() => 'Deleting…')
}))

vi.mock('../../file-lock-info', () => ({
  findLockingProcesses: vi.fn(async (): Promise<LockProbeResult> => {
    const result = h.probeResult.value
    if (!result) throw new Error('probeResult not set')
    return result
  })
}))

import { handleDelete } from './delete'
import { MARKER_FILE } from '../shared'

type SentMessage = { channel: string; payload: { installationId: string; message: string } }

function makeSender(sent: SentMessage[]): Electron.WebContents {
  return {
    isDestroyed: () => false,
    send: (channel: string, payload: SentMessage['payload']) => sent.push({ channel, payload })
  } as unknown as Electron.WebContents
}

function errorDetails(sent: SentMessage[]): string[] {
  return sent.filter((m) => m.channel === 'error-detail').map((m) => m.payload.message)
}

describe('handleDelete lock detail', () => {
  let tmpRoot: string
  let installPath: string
  let inst: InstallationRecord
  const id = 'inst-locked'

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'delete-lock-'))
    h.userDataDir.value = path.join(tmpRoot, 'userData')
    fs.mkdirSync(h.userDataDir.value, { recursive: true })
    installPath = path.join(tmpRoot, 'locked-install')
    fs.mkdirSync(installPath, { recursive: true })
    fs.writeFileSync(path.join(installPath, MARKER_FILE), id)
    h.lockedPath.value = path.join(installPath, 'ComfyUI', 'main.py')
    h.probeResult.value = null
    installationsStore.clear()
    inst = {
      id,
      name: 'locked',
      sourceId: 'standalone',
      installPath,
      status: 'installed',
      createdAt: new Date(0).toISOString()
    } as InstallationRecord
    installationsStore.set(id, inst)
  })

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  async function runDelete(probe: LockProbeResult): Promise<string[]> {
    h.probeResult.value = probe
    const sent: SentMessage[] = []
    const result = await handleDelete({
      event: { sender: makeSender(sent) } as unknown as Electron.IpcMainInvokeEvent,
      installationId: id,
      inst
    })
    expect(result.ok).toBe(false)
    // `handleDelete` fires the probe without awaiting it. Not a race: the
    // mock resolves synchronously, so its `.then` is queued the moment it is
    // attached and runs ahead of the awaits that carry `handleDelete` back
    // out. These ticks are insurance, not timing - there is no timer or I/O
    // in the chain to lose to.
    await Promise.resolve()
    await Promise.resolve()
    return errorDetails(sent)
  }

  it('names the holding processes when the probe determined them', async () => {
    const details = await runDelete({
      ok: true,
      processes: [
        { pid: 1, name: 'ComfyUI' },
        { pid: 2, name: 'ComfyUI' },
        { pid: 3, name: 'python' }
      ]
    })
    expect(details).toHaveLength(1)
    expect(details[0]).toContain('errors.deleteLockedBy')
    // Deduplicated by name, not by pid.
    expect(details[0]).toContain('ComfyUI, python')
  })

  it('says the holders could not be identified when the probe timed out', async () => {
    const details = await runDelete({ ok: false, reason: 'timeout' })
    expect(details).toHaveLength(1)
    expect(details[0]).toContain('errors.deleteLockedUnidentified')
    expect(details[0]).toContain(h.lockedPath.value)
  })

  it('says the same when the platform tool could not be run at all', async () => {
    const details = await runDelete({ ok: false, reason: 'unavailable' })
    expect(details).toHaveLength(1)
    expect(details[0]).toContain('errors.deleteLockedUnidentified')
  })

  it('stays quiet when the probe determined that nothing holds the file', async () => {
    // Here the generic `errors.deleteLocked` thrown by handleDelete is the
    // whole truth, so there is nothing to upgrade it to.
    expect(await runDelete({ ok: true, processes: [] })).toEqual([])
  })
})
