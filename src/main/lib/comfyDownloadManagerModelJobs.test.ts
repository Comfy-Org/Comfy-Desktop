import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const netState = vi.hoisted(() => ({ online: true }))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'home') return os.homedir()
      return path.join(os.tmpdir(), 'comfyui-desktop-2-test')
    }
  },
  BrowserWindow: Object.assign(class {}, {
    getAllWindows: () => [],
    fromWebContents: (wc: unknown) =>
      (wc as { __ownerWindow?: unknown } | undefined)?.__ownerWindow ?? null
  }),
  dialog: {},
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  shell: {},
  nativeImage: {},
  net: { isOnline: () => netState.online },
  session: { defaultSession: {}, fromPartition: vi.fn(() => ({})) }
}))

interface FakeTransfer {
  opts: {
    url: string
    jobId?: string
    finalPath: string
    directory: string
    filename: string
    session?: unknown
    sha256?: string
    onProgress?: (p: { receivedBytes: number; totalBytes: number }) => void
  }
  resolve: (outcome: Record<string, unknown>) => void
  pause: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
}
const transfers: FakeTransfer[] = []
const startModelTransfer = vi.fn((opts: FakeTransfer['opts']) => {
  let resolve!: (outcome: Record<string, unknown>) => void
  const done = new Promise((r) => {
    resolve = r
  })
  const t: FakeTransfer = {
    opts,
    resolve,
    pause: vi.fn(() => {
      resolve({ outcome: 'paused' })
      return true
    }),
    cancel: vi.fn(() => {
      resolve({ outcome: 'cancelled' })
      return true
    })
  }
  transfers.push(t)
  return { done, pause: t.pause, cancel: t.cancel }
})
vi.mock('./modelDownloadTransport', () => ({
  startModelTransfer: (opts: FakeTransfer['opts']) => startModelTransfer(opts)
}))

const removeStagedArtifacts = vi.fn((_p: string) => true)
const ensureStagedPlaceholder = vi.fn((_finalPath: string, _meta: unknown) => true)
const scanForStagedDownloads = vi.fn(async (_roots: string[]) => ({
  downloads: [] as unknown[],
  unsafeFinalPaths: [] as string[]
}))
const migrateLegacyModelDownloadArtifacts = vi.fn(async (_roots: string[]) => ({
  finalized: [] as string[],
  staged: [] as string[],
  removedStaleMeta: [] as string[],
  quarantined: [] as string[],
  unsafe: [] as string[]
}))
interface FakeDiscovered {
  finalPath: string
  stagedBytes: number
  meta: unknown
}
const revalidateStagedPair = vi.fn((finalPath: string) => {
  const settled = scanForStagedDownloads.mock.settledResults
  for (let i = settled.length - 1; i >= 0; i--) {
    const result = settled[i]!
    if (result.type !== 'fulfilled') continue
    const value = result.value as { downloads: FakeDiscovered[] }
    const d = value.downloads.find((x) => x.finalPath === finalPath)
    if (d) return { meta: d.meta, stagedBytes: d.stagedBytes }
  }
  return null
})
vi.mock('./modelDownloadStaging', () => ({
  removeStagedArtifacts: (p: string) => removeStagedArtifacts(p),
  ensureStagedPlaceholder: (p: string, meta: unknown) => ensureStagedPlaceholder(p, meta),
  scanForStagedDownloads: (roots: string[]) => scanForStagedDownloads(roots),
  migrateLegacyModelDownloadArtifacts: (roots: string[]) =>
    migrateLegacyModelDownloadArtifacts(roots),
  revalidateStagedPair: (finalPath: string) => revalidateStagedPair(finalPath)
}))

const overrides = vi.hoisted(() => ({
  installationsGet: null as null | ((id: string) => Promise<unknown>),
  collectModelScanRoots: null as null | (() => Promise<string[]>),
  modelsBaseDir: null as null | string
}))
vi.mock('../installations', async (importOriginal) => {
  const actual = await importOriginal<typeof InstallationsModule>()
  return {
    ...actual,
    get: (id: string) =>
      overrides.installationsGet ? overrides.installationsGet(id) : actual.get(id)
  }
})
vi.mock('./modelDownloadPaths', async (importOriginal) => {
  const actual = await importOriginal<typeof ModelDownloadPathsModule>()
  return {
    ...actual,
    collectModelScanRoots: () =>
      overrides.collectModelScanRoots
        ? overrides.collectModelScanRoots()
        : actual.collectModelScanRoots(),
    getModelsBaseDir: () => overrides.modelsBaseDir ?? actual.getModelsBaseDir()
  }
})

import type * as ComfyDownloadManager from './comfyDownloadManager'
import type * as InstallationsModule from '../installations'
import type * as ModelDownloadPathsModule from './modelDownloadPaths'
import { getModelsBaseDir } from './modelDownloadPaths'
import { _registerExtraBroadcastTarget, _unregisterExtraBroadcastTarget } from './ipc/broadcast'

let mod: typeof ComfyDownloadManager

beforeAll(async () => {
  overrides.modelsBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdm-models-'))
  mod = await import('./comfyDownloadManager')
})

afterAll(() => {
  if (overrides.modelsBaseDir) {
    fs.rmSync(overrides.modelsBaseDir, { recursive: true, force: true })
    overrides.modelsBaseDir = null
  }
})

async function waitForTransfers(count: number): Promise<void> {
  await vi.waitFor(() => {
    expect(transfers.length).toBeGreaterThanOrEqual(count)
  })
}

async function flush(): Promise<void> {
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < 6; i++) await Promise.resolve()
    await new Promise((r) => setImmediate(r))
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function gateMkdir(): { open: () => void; restore: () => void } {
  const gate = deferred()
  const spy = vi.spyOn(fs.promises, 'mkdir').mockImplementation(async () => {
    await gate.promise
    return undefined
  })
  return {
    open: () => gate.resolve(),
    restore: () => {
      gate.resolve()
      spy.mockRestore()
    }
  }
}

let seq = 0
function uniqueName(): string {
  return `idjob-${Date.now()}-${seq++}.safetensors`
}

function activeRows(): ComfyDownloadManager.DownloadProgress[] {
  return mod.getDownloadsTrayState().active
}

describe('managed model root locks', () => {
  it('blocks admission inside a locked root until it is released', async () => {
    const root = getModelsBaseDir()
    const release = mod.acquireModelDownloadRootLock(root)
    expect(release).not.toBeNull()
    const before = transfers.length
    const name = uniqueName()

    const blocked = await mod.startManagedModelJob({
      url: `https://models.example/${name}`,
      filename: name,
      directory: 'checkpoints'
    })
    await expect(blocked.completion).resolves.toMatchObject({ status: 'error' })
    expect(transfers).toHaveLength(before)

    release!()
    release!()
    const admitted = await mod.startManagedModelJob({
      url: `https://models.example/${name}`,
      filename: name,
      directory: 'checkpoints'
    })
    await waitForTransfers(before + 1)
    transfers[before]!.resolve({ outcome: 'cancelled' })
    await expect(admitted.completion).resolves.toEqual({ status: 'cancelled' })
  })

  it('refuses a root lock while a managed job owns a destination inside it', async () => {
    const before = transfers.length
    const name = uniqueName()
    const active = await mod.startManagedModelJob({
      url: `https://models.example/${name}`,
      filename: name,
      directory: 'checkpoints'
    })
    await waitForTransfers(before + 1)

    expect(mod.acquireModelDownloadRootLock(getModelsBaseDir())).toBeNull()

    transfers[before]!.resolve({ outcome: 'cancelled' })
    await expect(active.completion).resolves.toEqual({ status: 'cancelled' })
  })

  it('rejects an admission that began resolving before the root was locked', async () => {
    const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cdm-root-lock-'))
    const modelsRoot = path.join(installRoot, 'ComfyUI', 'models')
    let resolveInstallation!: (installation: unknown) => void
    let lookupStarted = false
    let release: (() => void) | null = null
    overrides.installationsGet = async () => {
      lookupStarted = true
      return new Promise((resolve) => {
        resolveInstallation = resolve
      })
    }

    try {
      const before = transfers.length
      const name = uniqueName()
      const admission = mod.startManagedModelJob({
        url: `https://models.example/${name}`,
        filename: name,
        directory: 'checkpoints',
        installationId: 'root-lock-install'
      })
      await vi.waitFor(() => expect(lookupStarted).toBe(true))
      release = mod.acquireModelDownloadRootLock(modelsRoot)
      expect(release).not.toBeNull()
      resolveInstallation({
        id: 'root-lock-install',
        sourceId: 'standalone',
        installPath: installRoot,
        useSharedModels: false
      })

      const blocked = await admission
      await expect(blocked.completion).resolves.toMatchObject({ status: 'error' })
      expect(transfers).toHaveLength(before)
    } finally {
      release?.()
      overrides.installationsGet = null
      fs.rmSync(installRoot, { recursive: true, force: true })
    }
  })
})

describe('managed model-job identity (issue #1322)', () => {
  it('joins concurrent requests for the same canonical destination into one transfer', async () => {
    const name = uniqueName()
    const before = transfers.length
    const url = `https://host-a.example/${name}`
    const h1 = await mod.startManagedModelJob({
      url,
      filename: name,
      directory: 'checkpoints'
    })
    await waitForTransfers(before + 1)
    const h2 = await mod.startManagedModelJob({
      url,
      filename: name,
      directory: 'checkpoints'
    })
    expect(h2.id).toBe(h1.id)
    expect(h2.savePath).toBe(h1.savePath)
    await flush()
    expect(transfers.length).toBe(before + 1)
    expect(transfers[before]!.opts.jobId).toBe(h1.id)

    transfers[before]!.resolve({ outcome: 'completed', savePath: h1.savePath })
    const [o1, o2] = await Promise.all([h1.completion, h2.completion])
    expect(o1.status).toBe('completed')
    expect(o2.status).toBe('completed')
  })

  it('rejects a different-source request for a destination another job is writing', async () => {
    const name = uniqueName()
    const before = transfers.length
    const h1 = await mod.startManagedModelJob({
      url: `https://host-a.example/${name}`,
      filename: name,
      directory: 'checkpoints'
    })
    await waitForTransfers(before + 1)
    const h2 = await mod.startManagedModelJob({
      url: `https://host-b.example/mirror/${name}`,
      filename: name,
      directory: 'checkpoints'
    })
    expect(h2.id).not.toBe(h1.id)
    await expect(h2.completion).resolves.toMatchObject({ status: 'error' })
    await flush()
    expect(transfers.length).toBe(before + 1)
    expect(activeRows().find((r) => r.id === h1.id)?.status).not.toBe('error')
    expect(mod.cancelModelDownload(h1.id)).toBe(true)
    await expect(h1.completion).resolves.toEqual({ status: 'cancelled' })
    await flush()
  })

  it('resumes a parked job when a new caller joins it (template joins a hydrated row)', async () => {
    const name = uniqueName()
    const before = transfers.length
    const url = `https://host.example/${name}`
    const h1 = await mod.startManagedModelJob({ url, filename: name, directory: 'checkpoints' })
    await waitForTransfers(before + 1)
    expect(mod.pauseModelDownload(h1.id)).toBe(true)
    await flush()
    expect(activeRows().find((r) => r.id === h1.id)?.status).toBe('paused')

    const h2 = await mod.startManagedModelJob({ url, filename: name, directory: 'checkpoints' })
    expect(h2.id).toBe(h1.id)
    await waitForTransfers(before + 2)
    expect(transfers[before + 1]!.opts.jobId).toBe(h1.id)
    await flush()
    expect(activeRows().find((r) => r.id === h1.id)?.status).toBe('downloading')

    transfers[before + 1]!.resolve({ outcome: 'completed', savePath: h2.savePath })
    await expect(h2.completion).resolves.toMatchObject({ status: 'completed' })
    await flush()
  })

  it('runs the same URL aimed at different destinations as independent jobs', async () => {
    const name = uniqueName()
    const url = `https://host.example/${name}`
    const before = transfers.length
    const h1 = await mod.startManagedModelJob({ url, filename: name, directory: 'checkpoints' })
    const h2 = await mod.startManagedModelJob({ url, filename: name, directory: 'loras' })
    expect(h1.id).not.toBe(h2.id)
    expect(h1.savePath).not.toBe(h2.savePath)
    await waitForTransfers(before + 2)
    const t1 = transfers[before]!
    const t2 = transfers[before + 1]!
    expect(t1.opts.finalPath).not.toBe(t2.opts.finalPath)

    expect(mod.pauseModelDownload(url)).toBe(false)
    expect(mod.cancelModelDownload(url)).toBe(false)
    expect(t1.pause).not.toHaveBeenCalled()
    expect(t2.pause).not.toHaveBeenCalled()

    expect(mod.pauseModelDownload(h1.id)).toBe(true)
    expect(t1.pause).toHaveBeenCalledTimes(1)
    expect(t2.pause).not.toHaveBeenCalled()
    await flush()

    expect(mod.cancelModelDownload(h2.id)).toBe(true)
    expect(t2.cancel).toHaveBeenCalledTimes(1)
    await expect(h2.completion).resolves.toEqual({ status: 'cancelled' })
    await flush()

    expect(mod.resumeModelDownload(url)).toBe(true)
    await waitForTransfers(before + 3)
    expect(transfers[before + 2]!.opts.finalPath).toBe(t1.opts.finalPath)

    expect(mod.cancelModelDownload(h1.id)).toBe(true)
    await expect(h1.completion).resolves.toEqual({ status: 'cancelled' })
    await flush()
  })

  it('pauses and resumes a single job through its URL (bridge compatibility path)', async () => {
    const name = uniqueName()
    const url = `https://host.example/${name}`
    const before = transfers.length
    const h = await mod.startManagedModelJob({ url, filename: name, directory: 'checkpoints' })
    await waitForTransfers(before + 1)
    const t = transfers[before]!

    expect(mod.pauseModelDownload(url)).toBe(true)
    expect(t.pause).toHaveBeenCalledTimes(1)
    await flush()
    const paused = activeRows().find((r) => r.id === h.id)
    expect(paused?.status).toBe('paused')

    expect(mod.resumeModelDownload(url)).toBe(true)
    await waitForTransfers(before + 2)

    expect(mod.cancelModelDownload(url)).toBe(true)
    await expect(h.completion).resolves.toEqual({ status: 'cancelled' })
    await flush()
    expect(activeRows().find((r) => r.id === h.id)).toBeUndefined()
  })

  it('retries a failed job as a fresh job that replaces the terminal row', async () => {
    const name = uniqueName()
    const url = `https://host.example/${name}`
    const before = transfers.length
    const h = await mod.startManagedModelJob({ url, filename: name, directory: 'checkpoints' })
    await waitForTransfers(before + 1)
    transfers[before]!.resolve({ outcome: 'error', error: 'network gone' })
    await expect(h.completion).resolves.toEqual({ status: 'error', error: 'network gone' })
    await flush()

    const errorRow = mod
      .getDownloadsTrayState()
      .recent.find((r) => r.id === h.id && r.status === 'error')
    expect(errorRow).toBeDefined()

    expect(mod.retryDownload(h.id)).toBe(true)
    await waitForTransfers(before + 2)
    expect(transfers[before + 1]!.opts.url).toBe(url)
    expect(mod.getDownloadsTrayState().recent.find((r) => r.id === h.id)).toBeUndefined()
    const fresh = activeRows().find((r) => r.url === url)
    expect(fresh).toBeDefined()
    expect(fresh!.id).not.toBe(h.id)

    expect(mod.retryDownload(h.id)).toBe(false)

    expect(mod.cancelModelDownload(fresh!.id!)).toBe(true)
    await flush()
  })

  it('parks active jobs on system sleep and auto-resumes them on wake', async () => {
    const nameActive = uniqueName()
    const nameUserPaused = uniqueName()
    const before = transfers.length
    const hActive = await mod.startManagedModelJob({
      url: `https://host.example/${nameActive}`,
      filename: nameActive,
      directory: 'checkpoints'
    })
    const hUserPaused = await mod.startManagedModelJob({
      url: `https://host.example/${nameUserPaused}`,
      filename: nameUserPaused,
      directory: 'checkpoints'
    })
    await waitForTransfers(before + 2)
    const tActive = transfers[before]!
    const tUserPaused = transfers[before + 1]!

    expect(mod.pauseModelDownload(hUserPaused.id)).toBe(true)
    await flush()
    mod.suspendActiveModelDownloadsForSleep()
    expect(tActive.pause).toHaveBeenCalledTimes(1)
    await flush()
    for (const id of [hActive.id, hUserPaused.id]) {
      expect(activeRows().find((r) => r.id === id)?.status).toBe('paused')
    }

    await mod.resumeModelDownloadsAfterWake()
    await waitForTransfers(before + 3)
    expect(transfers[before + 2]!.opts.jobId).toBe(hActive.id)
    expect(transfers.length).toBe(before + 3)
    expect(activeRows().find((r) => r.id === hUserPaused.id)?.status).toBe('paused')

    await mod.resumeModelDownloadsAfterWake()
    await flush()
    expect(transfers.length).toBe(before + 3)
    expect(tUserPaused.pause).toHaveBeenCalledTimes(1)

    expect(mod.cancelModelDownload(hActive.id)).toBe(true)
    expect(mod.cancelModelDownload(hUserPaused.id)).toBe(true)
    await flush()
  })

  it('does not auto-resume a job the user paused during the post-wake connectivity wait', async () => {
    const name = uniqueName()
    const before = transfers.length
    const h = await mod.startManagedModelJob({
      url: `https://host.example/${name}`,
      filename: name,
      directory: 'checkpoints'
    })
    await waitForTransfers(before + 1)
    mod.suspendActiveModelDownloadsForSleep()
    await flush()
    expect(activeRows().find((r) => r.id === h.id)?.status).toBe('paused')

    const wake = mod.resumeModelDownloadsAfterWake()
    expect(mod.pauseModelDownload(h.id)).toBe(true)
    await wake
    await flush()
    expect(activeRows().find((r) => r.id === h.id)?.status).toBe('paused')
    expect(transfers.length).toBe(before + 1)

    expect(mod.cancelModelDownload(h.id)).toBe(true)
    await expect(h.completion).resolves.toEqual({ status: 'cancelled' })
    await flush()
  })

  it('does not let a URL-keyed action touch a job restored for a different destination (hydration)', async () => {
    mod._test_resetModelDownloadsInit()
    const url = 'https://host.example/hydrated-model.safetensors'
    const destA = path.join(os.tmpdir(), 'cdm-idjob-hydrate', 'checkpoints', 'hydrA.safetensors')
    const destB = path.join(os.tmpdir(), 'cdm-idjob-hydrate', 'loras', 'hydrB.safetensors')
    const persistedUrl = 'https://host.example/persisted-id.safetensors'
    const destC = path.join(os.tmpdir(), 'cdm-idjob-hydrate', 'vae', 'hydrC.safetensors')
    const persistedId = 'persisted-job-id-1322'
    scanForStagedDownloads.mockResolvedValueOnce({
      unsafeFinalPaths: [],
      downloads: [
        {
          meta: {
            version: 2,
            url,
            expectedSize: 1000,
            directory: 'checkpoints',
            filename: 'hydrA.safetensors',
            installationId: null
          },
          finalPath: destA,
          stagedBytes: 250
        },
        {
          meta: {
            version: 2,
            url,
            expectedSize: 2000,
            directory: 'loras',
            filename: 'hydrB.safetensors',
            installationId: null
          },
          finalPath: destB,
          stagedBytes: 500
        },
        {
          meta: {
            version: 2,
            jobId: persistedId,
            url: persistedUrl,
            expectedSize: 4000,
            directory: 'vae',
            filename: 'hydrC.safetensors',
            installationId: null
          },
          finalPath: destC,
          stagedBytes: 100
        }
      ]
    })

    await mod.initializeModelDownloads()

    const rows = activeRows().filter((r) => r.url === url)
    expect(rows).toHaveLength(2)
    expect(rows[0]!.id).toBeDefined()
    expect(rows[1]!.id).toBeDefined()
    expect(rows[0]!.id).not.toBe(rows[1]!.id)
    for (const row of rows) expect(row.status).toBe('paused')
    const rowA = rows.find((r) => r.filename === 'hydrA.safetensors')!
    const rowB = rows.find((r) => r.filename === 'hydrB.safetensors')!
    expect(rowA.receivedBytes).toBe(250)
    expect(rowA.totalBytes).toBe(1000)

    const rowC = activeRows().find((r) => r.url === persistedUrl)
    expect(rowC?.id).toBe(persistedId)
    expect(rowC?.status).toBe('paused')

    expect(mod.resumeModelDownload(url)).toBe(false)

    const before = transfers.length
    expect(mod.resumeModelDownload(rowA.id!)).toBe(true)
    await waitForTransfers(before + 1)
    expect(transfers[before]!.opts.finalPath).toBe(destA)

    expect(mod.resumeModelDownload(persistedId)).toBe(true)
    await waitForTransfers(before + 2)
    expect(transfers[before + 1]!.opts.finalPath).toBe(destC)
    expect(transfers[before + 1]!.opts.jobId).toBe(persistedId)
    expect(mod.cancelModelDownload(persistedId)).toBe(true)
    await flush()

    expect(mod.cancelModelDownload(rowB.id!)).toBe(true)
    expect(removeStagedArtifacts).toHaveBeenCalledWith(destB)
    expect(removeStagedArtifacts).not.toHaveBeenCalledWith(destA)

    expect(mod.cancelModelDownload(rowA.id!)).toBe(true)
    await flush()
    expect(activeRows().filter((r) => r.url === url)).toHaveLength(0)
  })

  it('does not let a settling pause park a job the user already resumed', async () => {
    const name = uniqueName()
    const before = transfers.length
    const h = await mod.startManagedModelJob({
      url: `https://host.example/${name}`,
      filename: name,
      directory: 'checkpoints'
    })
    await waitForTransfers(before + 1)

    expect(mod.pauseModelDownload(h.id)).toBe(true)
    expect(mod.resumeModelDownload(h.id)).toBe(true)
    await waitForTransfers(before + 2)
    await flush()

    expect(transfers.length).toBe(before + 2)
    const row = activeRows().find((r) => r.id === h.id)
    expect(row?.status).toBe('downloading')

    expect(mod.cancelModelDownload(h.id)).toBe(true)
    await expect(h.completion).resolves.toEqual({ status: 'cancelled' })
    await flush()
  })

  it('cancel during a settling pause removes the job and its staged state exactly once', async () => {
    const name = uniqueName()
    const before = transfers.length
    const callsBefore = removeStagedArtifacts.mock.calls.length
    const h = await mod.startManagedModelJob({
      url: `https://host.example/${name}`,
      filename: name,
      directory: 'checkpoints'
    })
    await waitForTransfers(before + 1)

    expect(mod.pauseModelDownload(h.id)).toBe(true)
    expect(mod.cancelModelDownload(h.id)).toBe(true)
    await expect(h.completion).resolves.toEqual({ status: 'cancelled' })
    await flush()

    expect(removeStagedArtifacts).toHaveBeenCalledWith(h.savePath)
    expect(removeStagedArtifacts.mock.calls.length).toBe(callsBefore + 1)
    expect(activeRows().find((r) => r.id === h.id)).toBeUndefined()
    expect(transfers.length).toBe(before + 1)
  })

  it('completion wins over a cancel deferred against a finalizing transport', async () => {
    const name = uniqueName()
    const before = transfers.length
    const h = await mod.startManagedModelJob({
      url: `https://host.example/${name}`,
      filename: name,
      directory: 'checkpoints'
    })
    await waitForTransfers(before + 1)
    const t = transfers[before]!

    const callsBefore = removeStagedArtifacts.mock.calls.length
    t.cancel.mockImplementation(() => false)
    expect(mod.cancelModelDownload(h.id)).toBe(true)
    t.resolve({ outcome: 'completed', savePath: h.savePath })
    await expect(h.completion).resolves.toEqual({ status: 'completed', savePath: h.savePath })
    await flush()

    expect(removeStagedArtifacts.mock.calls.length).toBe(callsBefore)
    expect(activeRows().find((r) => r.id === h.id)).toBeUndefined()
  })

  it('a refused cancel whose transport then parks applies destructively at the outcome', async () => {
    const name = uniqueName()
    const before = transfers.length
    const h = await mod.startManagedModelJob({
      url: `https://host.example/${name}`,
      filename: name,
      directory: 'checkpoints'
    })
    await waitForTransfers(before + 1)
    const t = transfers[before]!

    t.cancel.mockImplementation(() => false)
    expect(mod.cancelModelDownload(h.id)).toBe(true)
    t.resolve({ outcome: 'paused' })
    await expect(h.completion).resolves.toEqual({ status: 'cancelled' })
    await flush()
    expect(removeStagedArtifacts).toHaveBeenCalledWith(h.savePath)
    expect(activeRows().find((r) => r.id === h.id)).toBeUndefined()
  })

  it('a deferred cancel whose staged cleanup fails settles as error, not a clean cancel', async () => {
    const name = uniqueName()
    const before = transfers.length
    const h = await mod.startManagedModelJob({
      url: `https://host.example/${name}`,
      filename: name,
      directory: 'checkpoints'
    })
    await waitForTransfers(before + 1)
    const t = transfers[before]!

    t.cancel.mockImplementation(() => false)
    removeStagedArtifacts.mockReturnValueOnce(false)
    expect(mod.cancelModelDownload(h.id)).toBe(true)
    t.resolve({ outcome: 'paused' })
    await expect(h.completion).resolves.toMatchObject({ status: 'error' })
    await flush()
    expect(activeRows().find((r) => r.id === h.id)).toBeUndefined()
  })

  it('a fresh attempt supersedes a deferred cancel (a later park must not destroy the job)', async () => {
    const name = uniqueName()
    const before = transfers.length
    const h = await mod.startManagedModelJob({
      url: `https://host.example/${name}`,
      filename: name,
      directory: 'checkpoints'
    })
    await waitForTransfers(before + 1)
    const t = transfers[before]!

    const callsBefore = removeStagedArtifacts.mock.calls.length
    t.cancel.mockImplementation(() => false)
    expect(mod.cancelModelDownload(h.id)).toBe(true)
    expect(mod.pauseModelDownload(h.id)).toBe(true)
    expect(mod.resumeModelDownload(h.id)).toBe(true)
    await waitForTransfers(before + 2)
    await flush()

    expect(mod.pauseModelDownload(h.id)).toBe(true)
    await flush()
    const row = activeRows().find((r) => r.id === h.id)
    expect(row?.status).toBe('paused')
    expect(removeStagedArtifacts.mock.calls.length).toBe(callsBefore)

    expect(mod.cancelModelDownload(h.id)).toBe(true)
    await expect(h.completion).resolves.toEqual({ status: 'cancelled' })
    await flush()
  })

  it('parks (never cancels) a shared-destination transfer when the LAST lease is released', async () => {
    const name = uniqueName()
    const before = transfers.length
    const url = `https://host-a.example/${name}`
    const h1 = await mod.startManagedModelJob({
      url,
      filename: name,
      directory: 'checkpoints'
    })
    await waitForTransfers(before + 1)
    const t = transfers[before]!
    const h2 = await mod.startManagedModelJob({
      url,
      filename: name,
      directory: 'checkpoints'
    })
    expect(h2.id).toBe(h1.id)

    h1.release()
    h1.release()
    h1.release()
    await flush()
    expect(t.pause).not.toHaveBeenCalled()
    expect(t.cancel).not.toHaveBeenCalled()
    expect(activeRows().find((r) => r.id === h1.id)).toBeDefined()

    h2.release()
    expect(t.pause).toHaveBeenCalledTimes(1)
    expect(t.cancel).not.toHaveBeenCalled()
    await flush()
    expect(activeRows().find((r) => r.id === h1.id)?.status).toBe('paused')

    expect(mod.cancelModelDownload(h1.id)).toBe(true)
    await expect(h1.completion).resolves.toEqual({ status: 'cancelled' })
    await flush()
    expect(activeRows().find((r) => r.id === h1.id)).toBeUndefined()
  })

  it('keeps the UI Cancel control whole-job even when multiple callers hold leases', async () => {
    const name = uniqueName()
    const before = transfers.length
    const url = `https://host-a.example/${name}`
    const h1 = await mod.startManagedModelJob({
      url,
      filename: name,
      directory: 'checkpoints'
    })
    await waitForTransfers(before + 1)
    const h2 = await mod.startManagedModelJob({
      url,
      filename: name,
      directory: 'checkpoints'
    })
    expect(h2.id).toBe(h1.id)

    expect(mod.cancelModelDownload(h1.id)).toBe(true)
    expect(transfers[before]!.cancel).toHaveBeenCalledTimes(1)
    await expect(h1.completion).resolves.toEqual({ status: 'cancelled' })
    await expect(h2.completion).resolves.toEqual({ status: 'cancelled' })
    await flush()
  })

  it('does not cancel on a last-lease release during app quit (quit parks instead)', async () => {
    const { setQuitReason, clearQuitReason } = await import('./quit-state')
    const name = uniqueName()
    const before = transfers.length
    const h = await mod.startManagedModelJob({
      url: `https://host-a.example/${name}`,
      filename: name,
      directory: 'checkpoints'
    })
    await waitForTransfers(before + 1)
    const t = transfers[before]!
    try {
      setQuitReason('user-quit')
      h.release()
      await flush()
      expect(t.cancel).not.toHaveBeenCalled()
      expect(activeRows().find((r) => r.id === h.id)).toBeDefined()
    } finally {
      clearQuitReason()
      mod.cancelModelDownload(h.id)
      await flush()
    }
  })
})

describe('model-job lifecycle races (issue #1322)', () => {
  it('pause then resume during admission preflight starts exactly one transport', async () => {
    const name = uniqueName()
    const url = `https://host.example/${name}`
    const before = transfers.length
    const gate = gateMkdir()
    try {
      const admission = mod.startManagedModelJob({ url, filename: name, directory: 'checkpoints' })
      await vi.waitFor(() => {
        expect(activeRows().find((r) => r.url === url)).toBeDefined()
      })
      expect(mod.hasActiveModelTransfers()).toBe(true)
      expect(mod.pauseModelDownload(url)).toBe(true)
      expect(mod.resumeModelDownload(url)).toBe(true)
      expect(transfers.length).toBe(before)
      gate.open()
      const h = await admission
      await waitForTransfers(before + 1)
      await flush()
      expect(transfers.length).toBe(before + 1)
      expect(transfers[before]!.opts.jobId).toBe(h.id)

      expect(mod.cancelModelDownload(h.id)).toBe(true)
      await expect(h.completion).resolves.toEqual({ status: 'cancelled' })
      await flush()
    } finally {
      gate.restore()
    }
  })

  it('pause during admission preflight parks the job; no transport until an explicit resume', async () => {
    const name = uniqueName()
    const url = `https://host.example/${name}`
    const before = transfers.length
    const gate = gateMkdir()
    try {
      const admission = mod.startManagedModelJob({ url, filename: name, directory: 'checkpoints' })
      await vi.waitFor(() => {
        expect(activeRows().find((r) => r.url === url)).toBeDefined()
      })
      expect(mod.pauseModelDownload(url)).toBe(true)
      gate.open()
      const h = await admission
      await flush()
      expect(transfers.length).toBe(before)
      expect(activeRows().find((r) => r.id === h.id)?.status).toBe('paused')

      expect(mod.resumeModelDownload(h.id)).toBe(true)
      await waitForTransfers(before + 1)
      expect(transfers[before]!.opts.jobId).toBe(h.id)

      expect(mod.cancelModelDownload(h.id)).toBe(true)
      await expect(h.completion).resolves.toEqual({ status: 'cancelled' })
      await flush()
    } finally {
      gate.restore()
    }
  })

  it('cancel during admission preflight settles cancelled without staging or a transport', async () => {
    const name = uniqueName()
    const url = `https://host.example/${name}`
    const before = transfers.length
    const stagedCallsBefore = ensureStagedPlaceholder.mock.calls.length
    const gate = gateMkdir()
    try {
      const admission = mod.startManagedModelJob({ url, filename: name, directory: 'checkpoints' })
      await vi.waitFor(() => {
        expect(activeRows().find((r) => r.url === url)).toBeDefined()
      })
      expect(mod.cancelModelDownload(url)).toBe(true)
      gate.open()
      const h = await admission
      await expect(h.completion).resolves.toEqual({ status: 'cancelled' })
      await flush()
      expect(transfers.length).toBe(before)
      expect(ensureStagedPlaceholder.mock.calls.length).toBe(stagedCallsBefore)
      expect(activeRows().find((r) => r.id === h.id)).toBeUndefined()
    } finally {
      gate.restore()
    }
  })

  it('quit parking waits for the preflight placeholder and refuses any later transport', async () => {
    const name = uniqueName()
    const url = `https://host.example/${name}`
    const before = transfers.length
    const stagedCallsBefore = ensureStagedPlaceholder.mock.calls.length
    const gate = gateMkdir()
    try {
      const admission = mod.startManagedModelJob({ url, filename: name, directory: 'checkpoints' })
      await vi.waitFor(() => {
        expect(activeRows().find((r) => r.url === url)).toBeDefined()
      })
      let quitSettled = false
      const quit = mod.suspendActiveModelDownloadsForQuit(5000).then(() => {
        quitSettled = true
      })
      await flush()
      expect(quitSettled).toBe(false)
      gate.open()
      await quit
      const h = await admission
      await flush()
      expect(ensureStagedPlaceholder.mock.calls.length).toBe(stagedCallsBefore + 1)
      expect(transfers.length).toBe(before)
      expect(mod.resumeModelDownload(h.id)).toBe(false)
      await flush()
      expect(transfers.length).toBe(before)

      mod._test_resetModelDownloadsQuitLatch()
      expect(mod.cancelModelDownload(h.id)).toBe(true)
      await expect(h.completion).resolves.toEqual({ status: 'cancelled' })
      await flush()
    } finally {
      mod._test_resetModelDownloadsQuitLatch()
      gate.restore()
    }
  })

  it('a replacement job at a cancelled destination waits for the old stream and keeps its artifacts', async () => {
    const name = uniqueName()
    const url = `https://host.example/${name}`
    const before = transfers.length
    const h1 = await mod.startManagedModelJob({ url, filename: name, directory: 'checkpoints' })
    await waitForTransfers(before + 1)
    const t1 = transfers[before]!
    t1.pause.mockImplementation(() => true)
    expect(mod.pauseModelDownload(h1.id)).toBe(true)
    expect(mod.cancelModelDownload(h1.id)).toBe(true)
    let h1Settled = false
    void h1.completion.then(() => {
      h1Settled = true
    })
    await flush()
    expect(h1Settled).toBe(false)
    expect(mod.hasActiveModelTransfers()).toBe(true)

    const h2 = await mod.startManagedModelJob({ url, filename: name, directory: 'checkpoints' })
    expect(h2.id).not.toBe(h1.id)
    await flush()
    expect(transfers.length).toBe(before + 1)

    t1.resolve({ outcome: 'paused' })
    await expect(h1.completion).resolves.toEqual({ status: 'cancelled' })
    await waitForTransfers(before + 2)
    expect(transfers[before + 1]!.opts.jobId).toBe(h2.id)
    await flush()
    expect(removeStagedArtifacts).not.toHaveBeenCalledWith(h1.savePath)

    expect(mod.cancelModelDownload(h2.id)).toBe(true)
    await expect(h2.completion).resolves.toEqual({ status: 'cancelled' })
    await flush()
  })

  it("quit parking waits for a cancelled job's closing stream, then cleanup runs unowned", async () => {
    const name = uniqueName()
    const url = `https://host.example/${name}`
    const before = transfers.length
    const h = await mod.startManagedModelJob({ url, filename: name, directory: 'checkpoints' })
    await waitForTransfers(before + 1)
    const t = transfers[before]!
    t.pause.mockImplementation(() => true)
    expect(mod.pauseModelDownload(h.id)).toBe(true)
    expect(mod.cancelModelDownload(h.id)).toBe(true)
    try {
      let quitSettled = false
      const quit = mod.suspendActiveModelDownloadsForQuit(5000).then(() => {
        quitSettled = true
      })
      await flush()
      expect(quitSettled).toBe(false)
      t.resolve({ outcome: 'paused' })
      await expect(h.completion).resolves.toEqual({ status: 'cancelled' })
      await quit
      expect(quitSettled).toBe(true)
      await flush()
      expect(removeStagedArtifacts).toHaveBeenCalledWith(h.savePath)
    } finally {
      mod._test_resetModelDownloadsQuitLatch()
    }
  })

  it('a stale post-wake connectivity waiter cannot resume jobs parked by a newer sleep', async () => {
    const name = uniqueName()
    const url = `https://host.example/${name}`
    const before = transfers.length
    const h = await mod.startManagedModelJob({ url, filename: name, directory: 'checkpoints' })
    await waitForTransfers(before + 1)
    try {
      netState.online = false
      mod.suspendActiveModelDownloadsForSleep()
      await flush()
      expect(activeRows().find((r) => r.id === h.id)?.status).toBe('paused')

      const staleWake = mod.resumeModelDownloadsAfterWake()
      mod.suspendActiveModelDownloadsForSleep()
      netState.online = true
      await staleWake
      await flush()
      expect(transfers.length).toBe(before + 1)
      expect(activeRows().find((r) => r.id === h.id)?.status).toBe('paused')

      await mod.resumeModelDownloadsAfterWake()
      await waitForTransfers(before + 2)
      expect(transfers[before + 1]!.opts.jobId).toBe(h.id)
    } finally {
      netState.online = true
    }
    expect(mod.cancelModelDownload(h.id)).toBe(true)
    await expect(h.completion).resolves.toEqual({ status: 'cancelled' })
    await flush()
  })

  it('cancel while a resumed attempt waits on the old closing stream defers cleanup and settlement', async () => {
    const name = uniqueName()
    const url = `https://host.example/${name}`
    const before = transfers.length
    const h = await mod.startManagedModelJob({ url, filename: name, directory: 'checkpoints' })
    await waitForTransfers(before + 1)
    const t1 = transfers[before]!
    t1.pause.mockImplementation(() => true)
    expect(mod.pauseModelDownload(h.id)).toBe(true)
    expect(mod.resumeModelDownload(h.id)).toBe(true)
    await flush()
    expect(transfers.length).toBe(before + 1)

    const removalsBefore = removeStagedArtifacts.mock.calls.length
    expect(mod.cancelModelDownload(h.id)).toBe(true)
    let settled = false
    void h.completion.then(() => {
      settled = true
    })
    await flush()
    expect(settled).toBe(false)
    expect(removeStagedArtifacts.mock.calls.length).toBe(removalsBefore)
    expect(mod.pauseModelDownload(h.id)).toBe(false)
    expect(mod.resumeModelDownload(h.id)).toBe(false)
    expect(mod.cancelModelDownload(h.id)).toBe(true)

    t1.resolve({ outcome: 'paused' })
    await expect(h.completion).resolves.toEqual({ status: 'cancelled' })
    await flush()
    expect(removeStagedArtifacts).toHaveBeenCalledWith(h.savePath)
    expect(removeStagedArtifacts.mock.calls.length).toBe(removalsBefore + 1)
    expect(transfers.length).toBe(before + 1)
    expect(activeRows().find((r) => r.id === h.id)).toBeUndefined()
  })

  it('refuses admission of a new model job once quit parking has begun', async () => {
    const name = uniqueName()
    const url = `https://host.example/${name}`
    const before = transfers.length
    const placeholdersBefore = ensureStagedPlaceholder.mock.calls.length
    try {
      await mod.suspendActiveModelDownloadsForQuit(50)
      const h = await mod.startManagedModelJob({ url, filename: name, directory: 'checkpoints' })
      await expect(h.completion).resolves.toMatchObject({ status: 'error' })
      await flush()
      expect(transfers.length).toBe(before)
      expect(ensureStagedPlaceholder.mock.calls.length).toBe(placeholdersBefore)
      expect(activeRows().find((r) => r.id === h.id)).toBeUndefined()
    } finally {
      mod._test_resetModelDownloadsQuitLatch()
    }
  })

  it('quit treats an attempt awaiting session resolution as active and parks it', async () => {
    const name = uniqueName()
    const url = `https://host.example/${name}`
    const before = transfers.length
    const h = await mod.startManagedModelJob({
      url,
      filename: name,
      directory: 'checkpoints',
      installationId: 'inst-quit-session'
    })
    await waitForTransfers(before + 1)
    expect(mod.pauseModelDownload(h.id)).toBe(true)
    await flush()
    const gate = deferred()
    overrides.installationsGet = async () => {
      await gate.promise
      return null
    }
    try {
      expect(mod.resumeModelDownload(h.id)).toBe(true)
      await flush()
      expect(transfers.length).toBe(before + 1)
      expect(mod.hasActiveModelTransfers()).toBe(true)
      await mod.suspendActiveModelDownloadsForQuit(5000)
      gate.resolve()
      overrides.installationsGet = null
      await flush()
      expect(transfers.length).toBe(before + 1)
      expect(activeRows().find((r) => r.id === h.id)).toBeDefined()
    } finally {
      gate.resolve()
      overrides.installationsGet = null
      mod._test_resetModelDownloadsQuitLatch()
      mod.cancelModelDownload(h.id)
      await flush()
    }
  })
})

describe('destination-keyed retry (issue #1322)', () => {
  it('an active same-URL job at a different destination does not block a retry', async () => {
    mod._test_resetModelDownloadsInit()
    const url = 'https://host.example/retry-dest-model.safetensors'
    const base = path.join(os.tmpdir(), 'cdm-retry-dest')
    const destA = path.join(base, 'installA', 'checkpoints', 'retryA.safetensors')
    const destB = path.join(base, 'installB', 'checkpoints', 'retryB.safetensors')
    scanForStagedDownloads.mockResolvedValueOnce({
      unsafeFinalPaths: [],
      downloads: [
        {
          meta: {
            version: 2,
            url,
            expectedSize: 1000,
            directory: 'checkpoints',
            filename: 'retryA.safetensors',
            installationId: null
          },
          finalPath: destA,
          stagedBytes: 100
        },
        {
          meta: {
            version: 2,
            url,
            expectedSize: 2000,
            directory: 'checkpoints',
            filename: 'retryB.safetensors',
            installationId: null
          },
          finalPath: destB,
          stagedBytes: 200
        }
      ]
    })
    await mod.initializeModelDownloads()
    const rowA = activeRows().find((r) => r.filename === 'retryA.safetensors')!
    const rowB = activeRows().find((r) => r.filename === 'retryB.safetensors')!
    let before = transfers.length
    expect(mod.resumeModelDownload(rowB.id!)).toBe(true)
    await waitForTransfers(before + 1)

    before = transfers.length
    expect(mod.resumeModelDownload(rowA.id!)).toBe(true)
    await waitForTransfers(before + 1)
    const tA = transfers.find((t) => t.opts.finalPath === destA)!
    tA.resolve({ outcome: 'error', error: 'network interrupted' })
    await flush()
    expect(mod.getDownloadsTrayState().recent.find((r) => r.id === rowA.id)?.status).toBe('error')

    before = transfers.length
    expect(mod.retryDownload(rowA.id!)).toBe(true)
    await waitForTransfers(before + 1)
    const retried = transfers[transfers.length - 1]!
    expect(retried.opts.filename).toBe('retryA.safetensors')

    expect(mod.cancelModelDownload(retried.opts.jobId as string)).toBe(true)
    expect(mod.cancelModelDownload(rowB.id!)).toBe(true)
    await flush()
    mod._test_resetModelDownloadsInit()
  })

  it('refuses a retry while another job owns the same canonical destination', async () => {
    const name = uniqueName()
    const url = `https://host.example/${name}`
    const before = transfers.length
    const h1 = await mod.startManagedModelJob({ url, filename: name, directory: 'checkpoints' })
    await waitForTransfers(before + 1)
    transfers[before]!.resolve({ outcome: 'error', error: 'boom' })
    await expect(h1.completion).resolves.toMatchObject({ status: 'error' })
    await flush()

    const h2 = await mod.startManagedModelJob({ url, filename: name, directory: 'checkpoints' })
    await waitForTransfers(before + 2)
    expect(mod.retryDownload(h1.id)).toBe(false)

    expect(mod.cancelModelDownload(h2.id)).toBe(true)
    await expect(h2.completion).resolves.toEqual({ status: 'cancelled' })
    await flush()
  })
})

describe('owner-window detach (issue #1322)', () => {
  it('detaching an owner window clears a hosted WebContentsView sender', async () => {
    const name = uniqueName()
    const url = `https://host.example/${name}`
    const before = transfers.length
    const fakeWin = {
      isDestroyed: () => false,
      webContents: { isDestroyed: () => false },
      setProgressBar: vi.fn()
    }
    const sender = {
      isDestroyed: () => false,
      session: {},
      send: vi.fn(),
      __ownerWindow: fakeWin
    }
    const h = await mod.startManagedModelJob({
      url,
      filename: name,
      directory: 'checkpoints',
      senderContents: sender as never
    })
    await waitForTransfers(before + 1)
    expect(sender.send).toHaveBeenCalled()
    sender.send.mockClear()

    mod.detachWindowDownloads(fakeWin as never)
    transfers[before]!.resolve({ outcome: 'completed', savePath: h.savePath })
    await expect(h.completion).resolves.toMatchObject({ status: 'completed' })
    await flush()
    expect(sender.send).not.toHaveBeenCalled()
  })
})

describe('renderer model-job snapshot', () => {
  let installSeq = 0
  function uniqueInstallationId(): string {
    return `snapshot-install-${installSeq++}`
  }

  function fakeContents(): { isDestroyed: () => boolean; send: ReturnType<typeof vi.fn> } {
    return { isDestroyed: () => false, send: vi.fn() }
  }

  function progressEvents(contents: ReturnType<typeof fakeContents>): unknown[] {
    return contents.send.mock.calls
      .filter(([channel]) => channel === 'desktop2-download-progress')
      .map(([, progress]) => progress)
  }

  async function startJob(installationId: string): Promise<ComfyDownloadManager.ModelJobHandle> {
    const name = uniqueName()
    const before = transfers.length
    const handle = await mod.startManagedModelJob({
      url: `https://host.example/${name}`,
      filename: name,
      directory: 'checkpoints',
      installationId
    })
    await waitForTransfers(before + 1)
    return handle
  }

  it('lists the paused and in-flight jobs of the caller installation and no others', async () => {
    const installationId = uniqueInstallationId()
    const running = await startJob(installationId)
    const paused = await startJob(installationId)
    expect(mod.pauseModelDownload(paused.id)).toBe(true)
    const completed = await startJob(installationId)
    const completedTransfer = transfers.at(-1)!
    const cancelled = await startJob(installationId)
    const otherInstallation = await startJob(uniqueInstallationId())
    completedTransfer.resolve({ outcome: 'completed', savePath: completed.savePath })
    await expect(completed.completion).resolves.toMatchObject({ status: 'completed' })
    expect(mod.cancelModelDownload(cancelled.id)).toBe(true)
    await expect(cancelled.completion).resolves.toEqual({ status: 'cancelled' })
    await flush()

    const snapshot = mod.subscribeToInstallationModelJobs(installationId, fakeContents() as never)

    expect(snapshot.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: running.id, status: 'pending' },
      { id: paused.id, status: 'paused' }
    ])
    expect(snapshot[0]).toMatchObject({
      url: running.url,
      filename: path.basename(running.savePath),
      directory: 'checkpoints'
    })
    expect(snapshot.every((row) => row.savePath === undefined)).toBe(true)

    for (const handle of [running, paused, otherInstallation]) {
      expect(mod.cancelModelDownload(handle.id)).toBe(true)
      await handle.completion
    }
    await flush()
  })

  it('delivers later progress of a listed job started elsewhere to the listing renderer', async () => {
    const installationId = uniqueInstallationId()
    const job = await startJob(installationId)
    const transfer = transfers.at(-1)!
    const contents = fakeContents()

    mod.subscribeToInstallationModelJobs(installationId, contents as never)
    transfer.resolve({ outcome: 'completed', savePath: job.savePath })
    await expect(job.completion).resolves.toMatchObject({ status: 'completed' })
    await flush()

    expect(progressEvents(contents)).toContainEqual(
      expect.objectContaining({ id: job.id, status: 'completed' })
    )
  })

  it('replays the job state to a renderer that re-requests its own running download', async () => {
    const name = uniqueName()
    const url = `https://host.example/${name}`
    const before = transfers.length
    const win = {
      isDestroyed: () => false,
      webContents: fakeContents(),
      setProgressBar: vi.fn()
    }
    const sender = fakeContents()
    const request = {
      url,
      filename: name,
      directory: 'checkpoints',
      window: win as never,
      senderContents: sender as never
    }
    const first = await mod.startManagedModelJob(request)
    await waitForTransfers(before + 1)
    await flush()
    sender.send.mockClear()

    const rejoined = await mod.startManagedModelJob(request)

    expect(rejoined.id).toBe(first.id)
    expect(progressEvents(sender)).toEqual([expect.objectContaining({ id: first.id })])

    expect(mod.cancelModelDownload(first.id)).toBe(true)
    await first.completion
    await flush()
  })
})

describe('model download startup safety (issue #1322)', () => {
  it('reports unsafe when migration leaves incomplete finals visible, and retries next call', async () => {
    mod._test_resetModelDownloadsInit()
    const lockedPath = path.join(os.tmpdir(), 'locked-model.safetensors')
    migrateLegacyModelDownloadArtifacts.mockResolvedValueOnce({
      finalized: [],
      staged: [],
      removedStaleMeta: [],
      quarantined: [],
      unsafe: [lockedPath]
    })
    const first = await mod.initializeModelDownloads()
    expect(first.safe).toBe(false)
    expect(first.unsafePaths).toEqual([lockedPath])

    const second = await mod.initializeModelDownloads()
    expect(second.safe).toBe(true)
    expect(second.unsafePaths).toEqual([])

    const migrations = migrateLegacyModelDownloadArtifacts.mock.calls.length
    const third = await mod.initializeModelDownloads()
    expect(third.safe).toBe(true)
    expect(migrateLegacyModelDownloadArtifacts.mock.calls.length).toBe(migrations)
    mod._test_resetModelDownloadsInit()
  })

  it('reports unsafe when the migration pass itself fails', async () => {
    mod._test_resetModelDownloadsInit()
    migrateLegacyModelDownloadArtifacts.mockRejectedValueOnce(new Error('io failure'))
    const result = await mod.initializeModelDownloads()
    expect(result.safe).toBe(false)
    expect(result.unsafePaths).toEqual([])
    mod._test_resetModelDownloadsInit()
  })

  it('reports unsafe when collecting the model scan roots fails', async () => {
    mod._test_resetModelDownloadsInit()
    const migrationsBefore = migrateLegacyModelDownloadArtifacts.mock.calls.length
    overrides.collectModelScanRoots = async () => {
      throw new Error('installations listing failed')
    }
    try {
      const result = await mod.initializeModelDownloads()
      expect(result.safe).toBe(false)
      expect(result.unsafePaths).toEqual([])
      expect(migrateLegacyModelDownloadArtifacts.mock.calls.length).toBe(migrationsBefore)
    } finally {
      overrides.collectModelScanRoots = null
    }
    const next = await mod.initializeModelDownloads()
    expect(next.safe).toBe(true)
    mod._test_resetModelDownloadsInit()
  })

  it('a scan-reported unsafe claim marker blocks the pass with one stable warning row', async () => {
    mod._test_resetModelDownloadsInit()
    const marker = path.join(os.tmpdir(), 'cdm-unsafe-scan', 'stuck-marker.safetensors')
    const warningRows = () =>
      mod
        .getDownloadsTrayState()
        .recent.filter((r) => r.filename === 'stuck-marker.safetensors' && r.status === 'error')
    scanForStagedDownloads.mockResolvedValueOnce({ downloads: [], unsafeFinalPaths: [marker] })
    const first = await mod.initializeModelDownloads()
    expect(first.safe).toBe(false)
    expect(first.unsafePaths).toEqual([marker])
    expect(warningRows()).toHaveLength(1)
    const warningId = warningRows()[0]!.id

    scanForStagedDownloads.mockResolvedValueOnce({ downloads: [], unsafeFinalPaths: [marker] })
    const second = await mod.initializeModelDownloads()
    expect(second.safe).toBe(false)
    expect(warningRows()).toHaveLength(1)
    expect(warningRows()[0]!.id).toBe(warningId)

    const third = await mod.initializeModelDownloads()
    expect(third.safe).toBe(true)
    expect(third.unsafePaths).toEqual([])
    expect(warningRows()).toHaveLength(0)
    mod._test_resetModelDownloadsInit()
  })

  it('Retry on an unsafe warning row re-runs the quarantine pass', async () => {
    mod._test_resetModelDownloadsInit()
    const marker = path.join(os.tmpdir(), 'cdm-unsafe-retry', 'stuck-retry.safetensors')
    const warningRows = () =>
      mod
        .getDownloadsTrayState()
        .recent.filter((r) => r.filename === 'stuck-retry.safetensors' && r.status === 'error')
    migrateLegacyModelDownloadArtifacts.mockResolvedValueOnce({
      finalized: [],
      staged: [],
      removedStaleMeta: [],
      quarantined: [],
      unsafe: [marker]
    })
    const first = await mod.initializeModelDownloads()
    expect(first.safe).toBe(false)
    expect(warningRows()).toHaveLength(1)
    const warningId = warningRows()[0]!.id!

    migrateLegacyModelDownloadArtifacts.mockResolvedValueOnce({
      finalized: [],
      staged: [],
      removedStaleMeta: [],
      quarantined: [],
      unsafe: [marker]
    })
    const migrationsBefore = migrateLegacyModelDownloadArtifacts.mock.calls.length
    expect(mod.retryDownload(warningId)).toBe(true)
    const stillStuck = await mod.initializeModelDownloads()
    expect(stillStuck.safe).toBe(false)
    expect(migrateLegacyModelDownloadArtifacts.mock.calls.length).toBe(migrationsBefore + 1)
    expect(warningRows()).toHaveLength(1)
    expect(warningRows()[0]!.id).toBe(warningId)

    expect(mod.retryDownload(warningId)).toBe(true)
    const resolved = await mod.initializeModelDownloads()
    expect(resolved.safe).toBe(true)
    expect(warningRows()).toHaveLength(0)
    mod._test_resetModelDownloadsInit()
  })

  it('a retried unsafe pass does not duplicate hydrated jobs', async () => {
    mod._test_resetModelDownloadsInit()
    const url = 'https://host.example/unsafe-hydrate.safetensors'
    const dest = path.join(
      os.tmpdir(),
      'cdm-unsafe-hydrate',
      'checkpoints',
      'unsafeHydr.safetensors'
    )
    const marker = path.join(os.tmpdir(), 'cdm-unsafe-hydrate', 'checkpoints', 'stuck.safetensors')
    const stagedPair = () => ({
      meta: {
        version: 2,
        url,
        expectedSize: 1000,
        directory: 'checkpoints',
        filename: 'unsafeHydr.safetensors',
        installationId: null
      },
      finalPath: dest,
      stagedBytes: 100
    })
    scanForStagedDownloads.mockResolvedValueOnce({
      downloads: [stagedPair()],
      unsafeFinalPaths: [marker]
    })
    const first = await mod.initializeModelDownloads()
    expect(first.safe).toBe(false)
    const rowsAfterFirst = activeRows().filter((r) => r.url === url)
    expect(rowsAfterFirst).toHaveLength(1)
    const rowId = rowsAfterFirst[0]!.id!

    scanForStagedDownloads.mockResolvedValueOnce({
      downloads: [stagedPair()],
      unsafeFinalPaths: [marker]
    })
    const second = await mod.initializeModelDownloads()
    expect(second.safe).toBe(false)
    const rowsAfterSecond = activeRows().filter((r) => r.url === url)
    expect(rowsAfterSecond).toHaveLength(1)
    expect(rowsAfterSecond[0]!.id).toBe(rowId)

    const third = await mod.initializeModelDownloads()
    expect(third.safe).toBe(true)
    expect(mod.cancelModelDownload(rowId)).toBe(true)
    await flush()
    mod._test_resetModelDownloadsInit()
  })

  it('a staged-scan exception makes the pass unsafe and is not memoized', async () => {
    mod._test_resetModelDownloadsInit()
    scanForStagedDownloads.mockRejectedValueOnce(new Error('walk failed'))
    const first = await mod.initializeModelDownloads()
    expect(first.safe).toBe(false)
    const next = await mod.initializeModelDownloads()
    expect(next.safe).toBe(true)
    mod._test_resetModelDownloadsInit()
  })

  it('a failed producer retains its previous unsafe findings until a clean pass', async () => {
    mod._test_resetModelDownloadsInit()
    const marker = path.join(os.tmpdir(), 'cdm-scan-retain', 'retained.safetensors')
    const rows = () =>
      mod
        .getDownloadsTrayState()
        .recent.filter((r) => r.filename === 'retained.safetensors' && r.status === 'error')
    scanForStagedDownloads.mockResolvedValueOnce({ downloads: [], unsafeFinalPaths: [marker] })
    const first = await mod.initializeModelDownloads()
    expect(first.safe).toBe(false)
    expect(rows()).toHaveLength(1)
    const warningId = rows()[0]!.id

    scanForStagedDownloads.mockRejectedValueOnce(new Error('walk failed'))
    const second = await mod.initializeModelDownloads()
    expect(second.safe).toBe(false)
    expect(second.unsafePaths).toEqual([marker])
    expect(rows()).toHaveLength(1)
    expect(rows()[0]!.id).toBe(warningId)

    const third = await mod.initializeModelDownloads()
    expect(third.safe).toBe(true)
    expect(rows()).toHaveLength(0)
    mod._test_resetModelDownloadsInit()
  })

  it('a path reported by both producers stays warned until both clear it', async () => {
    mod._test_resetModelDownloadsInit()
    const marker = path.join(os.tmpdir(), 'cdm-both-unsafe', 'both.safetensors')
    const rows = () =>
      mod
        .getDownloadsTrayState()
        .recent.filter((r) => r.filename === 'both.safetensors' && r.status === 'error')
    migrateLegacyModelDownloadArtifacts.mockResolvedValueOnce({
      finalized: [],
      staged: [],
      removedStaleMeta: [],
      quarantined: [],
      unsafe: [marker]
    })
    scanForStagedDownloads.mockResolvedValueOnce({ downloads: [], unsafeFinalPaths: [marker] })
    const first = await mod.initializeModelDownloads()
    expect(first.safe).toBe(false)
    expect(first.unsafePaths).toEqual([marker])
    expect(rows()).toHaveLength(1)
    const warningId = rows()[0]!.id

    scanForStagedDownloads.mockResolvedValueOnce({ downloads: [], unsafeFinalPaths: [marker] })
    const second = await mod.initializeModelDownloads()
    expect(second.safe).toBe(false)
    expect(second.unsafePaths).toEqual([marker])
    expect(rows()).toHaveLength(1)
    expect(rows()[0]!.id).toBe(warningId)

    const third = await mod.initializeModelDownloads()
    expect(third.safe).toBe(true)
    expect(rows()).toHaveLength(0)
    mod._test_resetModelDownloadsInit()
  })

  it('refuses a job whose own destination is a still-unquarantined incomplete file', async () => {
    mod._test_resetModelDownloadsInit()
    const name = uniqueName()
    const dest = path.join(getModelsBaseDir(), 'checkpoints', name)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, 'truncated legacy bytes')
    migrateLegacyModelDownloadArtifacts.mockResolvedValueOnce({
      finalized: [],
      staged: [],
      removedStaleMeta: [],
      quarantined: [],
      unsafe: [dest]
    })
    const before = transfers.length
    const h = await mod.startManagedModelJob({
      url: `https://host.example/${name}`,
      filename: name,
      directory: 'checkpoints'
    })
    await expect(h.completion).resolves.toMatchObject({
      status: 'error',
      error: expect.stringContaining('incomplete download is stuck')
    })
    await flush()
    expect(transfers.length).toBe(before)
    fs.rmSync(dest, { force: true })
    const next = await mod.initializeModelDownloads()
    expect(next.safe).toBe(true)
    mod._test_resetModelDownloadsInit()
  })

  it('an unsafe pass does not block jobs for unrelated destinations', async () => {
    mod._test_resetModelDownloadsInit()
    migrateLegacyModelDownloadArtifacts.mockResolvedValueOnce({
      finalized: [],
      staged: [],
      removedStaleMeta: [],
      quarantined: [],
      unsafe: [path.join(os.tmpdir(), 'cdm-unsafe-block', 'locked.safetensors')]
    })
    const name = uniqueName()
    const before = transfers.length
    const h = await mod.startManagedModelJob({
      url: `https://host.example/${name}`,
      filename: name,
      directory: 'checkpoints'
    })
    await waitForTransfers(before + 1)
    expect(mod.cancelModelDownload(h.id)).toBe(true)
    await expect(h.completion).resolves.toEqual({ status: 'cancelled' })
    await flush()
    const next = await mod.initializeModelDownloads()
    expect(next.safe).toBe(true)
    mod._test_resetModelDownloadsInit()
  })

  it('a pass that failed to certify the roots does not refuse new jobs', async () => {
    mod._test_resetModelDownloadsInit()
    migrateLegacyModelDownloadArtifacts.mockRejectedValueOnce(new Error('io failure'))
    const name = uniqueName()
    const before = transfers.length
    const h = await mod.startManagedModelJob({
      url: `https://host.example/${name}`,
      filename: name,
      directory: 'checkpoints'
    })
    await waitForTransfers(before + 1)
    expect(mod.cancelModelDownload(h.id)).toBe(true)
    await expect(h.completion).resolves.toEqual({ status: 'cancelled' })
    await flush()
    const next = await mod.initializeModelDownloads()
    expect(next.safe).toBe(true)
    mod._test_resetModelDownloadsInit()
  })

  it('admission awaits the startup pass, so a legacy truncated final is not already-present', async () => {
    mod._test_resetModelDownloadsInit()
    const name = uniqueName()
    const dest = path.join(getModelsBaseDir(), 'checkpoints', name)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, 'truncated legacy bytes')
    migrateLegacyModelDownloadArtifacts.mockImplementationOnce(async () => {
      fs.rmSync(dest)
      return {
        finalized: [],
        staged: [],
        removedStaleMeta: [],
        quarantined: [dest],
        unsafe: []
      }
    })
    const before = transfers.length
    const h = await mod.startManagedModelJob({
      url: `https://host.example/${name}`,
      filename: name,
      directory: 'checkpoints'
    })
    await waitForTransfers(before + 1)
    expect(h.savePath).toBe(dest)
    expect(transfers[before]!.opts.finalPath).toBe(dest)
    expect(mod.cancelModelDownload(h.id)).toBe(true)
    await expect(h.completion).resolves.toEqual({ status: 'cancelled' })
    await flush()
    mod._test_resetModelDownloadsInit()
  })

  it('invalidating a memoized safe pass makes the next admission rescan', async () => {
    mod._test_resetModelDownloadsInit()
    await mod.initializeModelDownloads()
    const migrations = migrateLegacyModelDownloadArtifacts.mock.calls.length
    await mod.initializeModelDownloads()
    expect(migrateLegacyModelDownloadArtifacts.mock.calls.length).toBe(migrations)

    mod.invalidateModelDownloadStartupPass()
    const name = uniqueName()
    const before = transfers.length
    const h = await mod.startManagedModelJob({
      url: `https://host.example/${name}`,
      filename: name,
      directory: 'checkpoints'
    })
    await waitForTransfers(before + 1)
    expect(migrateLegacyModelDownloadArtifacts.mock.calls.length).toBe(migrations + 1)
    expect(mod.cancelModelDownload(h.id)).toBe(true)
    await expect(h.completion).resolves.toEqual({ status: 'cancelled' })
    await flush()
    mod._test_resetModelDownloadsInit()
  })

  it('invalidating an in-flight pass marks its result stale; the next call rescans', async () => {
    mod._test_resetModelDownloadsInit()
    const gate = deferred()
    migrateLegacyModelDownloadArtifacts.mockImplementationOnce(async () => {
      await gate.promise
      return { finalized: [], staged: [], removedStaleMeta: [], quarantined: [], unsafe: [] }
    })
    const p1 = mod.initializeModelDownloads()
    mod.invalidateModelDownloadStartupPass()
    gate.resolve()
    const s1 = await p1
    expect(s1.safe).toBe(true)
    const migrations = migrateLegacyModelDownloadArtifacts.mock.calls.length

    const s2 = await mod.initializeModelDownloads()
    expect(s2.safe).toBe(true)
    expect(migrateLegacyModelDownloadArtifacts.mock.calls.length).toBe(migrations + 1)
    await mod.initializeModelDownloads()
    expect(migrateLegacyModelDownloadArtifacts.mock.calls.length).toBe(migrations + 1)
    mod._test_resetModelDownloadsInit()
  })
})

describe('hydration revalidation (issue #1322)', () => {
  it('does not restore a staged pair deleted between the scan snapshot and registration', async () => {
    mod._test_resetModelDownloadsInit()
    const url = 'https://host.example/stale-pair.safetensors'
    const dest = path.join(os.tmpdir(), 'cdm-stale-pair', 'checkpoints', 'stalePair.safetensors')
    scanForStagedDownloads.mockResolvedValueOnce({
      downloads: [
        {
          finalPath: dest,
          stagedBytes: 100,
          meta: {
            version: 2,
            url,
            expectedSize: 1000,
            directory: 'checkpoints',
            filename: 'stalePair.safetensors',
            installationId: null
          }
        }
      ],
      unsafeFinalPaths: []
    })
    revalidateStagedPair.mockReturnValueOnce(null)
    const safety = await mod.initializeModelDownloads()
    expect(safety.safe).toBe(true)
    expect(revalidateStagedPair).toHaveBeenCalledWith(dest)
    expect(activeRows().filter((r) => r.url === url)).toHaveLength(0)
    mod._test_resetModelDownloadsInit()
  })

  it('re-reads the staged byte count at registration time', async () => {
    mod._test_resetModelDownloadsInit()
    const url = 'https://host.example/regrown-pair.safetensors'
    const dest = path.join(os.tmpdir(), 'cdm-regrown-pair', 'checkpoints', 'regrown.safetensors')
    const meta = {
      version: 2,
      url,
      expectedSize: 1000,
      directory: 'checkpoints',
      filename: 'regrown.safetensors',
      installationId: null
    }
    scanForStagedDownloads.mockResolvedValueOnce({
      downloads: [{ finalPath: dest, stagedBytes: 100, meta }],
      unsafeFinalPaths: []
    })
    revalidateStagedPair.mockReturnValueOnce({ meta, stagedBytes: 400 })
    const safety = await mod.initializeModelDownloads()
    expect(safety.safe).toBe(true)
    const row = activeRows().find((r) => r.url === url)
    expect(row).toBeDefined()
    expect(row!.receivedBytes).toBe(400)
    expect(row!.progress).toBeCloseTo(0.4)
    expect(mod.cancelModelDownload(row!.id!)).toBe(true)
    await flush()
    mod._test_resetModelDownloadsInit()
  })
})

describe('recent-row eviction (issue #1322)', () => {
  it('broadcasts model-download-removed for rows evicted past the recent cap', async () => {
    const target = {
      send: vi.fn(),
      isDestroyed: () => false,
      once: vi.fn()
    }
    _registerExtraBroadcastTarget(target as unknown as Electron.WebContents)
    try {
      const handles = []
      for (let i = 0; i < 11; i++) {
        const name = `evict-${Date.now()}-${i}.exe`
        handles.push(
          await mod.startManagedModelJob({
            url: `https://host.example/evict/${i}/${name}`,
            filename: name,
            directory: 'checkpoints'
          })
        )
      }
      const first = handles[0]!
      const removedCalls = target.send.mock.calls.filter(
        ([channel, data]) =>
          channel === 'model-download-removed' && (data as { id?: string }).id === first.id
      )
      expect(removedCalls).toHaveLength(1)
      expect(removedCalls[0]![1]).toMatchObject({ id: first.id, url: first.url })
      expect(mod.getDownloadsTrayState().recent.find((r) => r.id === first.id)).toBeUndefined()
      for (const h of handles.slice(1)) {
        expect(
          target.send.mock.calls.filter(
            ([channel, data]) =>
              channel === 'model-download-removed' && (data as { id?: string }).id === h.id
          )
        ).toHaveLength(0)
      }
    } finally {
      _unregisterExtraBroadcastTarget(target as unknown as Electron.WebContents)
    }
  })
})

describe('sha-256 expectations and install-local roots', () => {
  const SHA_A = 'a'.repeat(64)
  const SHA_B = 'b'.repeat(64)

  function installLocalRoot(prefix: string): { installRoot: string; modelsRoot: string } {
    const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    return { installRoot, modelsRoot: path.join(installRoot, 'ComfyUI', 'models') }
  }

  it('passes the expected hash to the transport and keeps it across a retry', async () => {
    const name = uniqueName()
    const url = `https://host.example/${name}`
    const before = transfers.length
    const h = await mod.startManagedModelJob({
      url,
      filename: name,
      directory: 'checkpoints',
      sha256: SHA_A
    })
    await waitForTransfers(before + 1)
    expect(transfers[before]!.opts.sha256).toBe(SHA_A)
    transfers[before]!.resolve({ outcome: 'error', error: 'network gone' })
    await expect(h.completion).resolves.toMatchObject({ status: 'error' })
    await flush()

    expect(mod.retryDownload(h.id)).toBe(true)
    await waitForTransfers(before + 2)
    expect(transfers[before + 1]!.opts.sha256).toBe(SHA_A)
    expect(mod.cancelModelDownload(transfers[before + 1]!.opts.jobId as string)).toBe(true)
    await flush()
  })

  it('refuses a same-destination caller declaring a different hash; a matching one joins', async () => {
    const name = uniqueName()
    const url = `https://host.example/${name}`
    const before = transfers.length
    const h1 = await mod.startManagedModelJob({
      url,
      filename: name,
      directory: 'checkpoints',
      sha256: SHA_A
    })
    await waitForTransfers(before + 1)

    const conflict = await mod.startManagedModelJob({
      url,
      filename: name,
      directory: 'checkpoints',
      sha256: SHA_B
    })
    await expect(conflict.completion).resolves.toMatchObject({ status: 'error' })
    expect(transfers).toHaveLength(before + 1)

    const joined = await mod.startManagedModelJob({
      url,
      filename: name,
      directory: 'checkpoints',
      sha256: SHA_A
    })
    expect(joined.id).toBe(h1.id)

    expect(mod.cancelModelDownload(h1.id)).toBe(true)
    await expect(h1.completion).resolves.toEqual({ status: 'cancelled' })
    await flush()
  })

  it('an explicit destination root overrides the shared models directory', async () => {
    const { installRoot, modelsRoot } = installLocalRoot('cdm-dest-root-')
    try {
      const name = uniqueName()
      const before = transfers.length
      const h = await mod.startManagedModelJob({
        url: `https://host.example/${name}`,
        filename: name,
        directory: 'checkpoints',
        destinationBaseDir: modelsRoot
      })
      await waitForTransfers(before + 1)
      expect(transfers[before]!.opts.finalPath).toBe(path.join(modelsRoot, 'checkpoints', name))
      transfers[before]!.resolve({ outcome: 'cancelled' })
      await expect(h.completion).resolves.toEqual({ status: 'cancelled' })
      await flush()
    } finally {
      fs.rmSync(installRoot, { recursive: true, force: true })
    }
  })

  it('admits a job into a locked root only when the bypass names that exact root', async () => {
    const { installRoot, modelsRoot } = installLocalRoot('cdm-lock-bypass-')
    const otherRoot = path.join(installRoot, 'elsewhere', 'models')
    const release = mod.acquireModelDownloadRootLock(modelsRoot)
    expect(release).not.toBeNull()
    try {
      const before = transfers.length
      const blocked = await mod.startManagedModelJob({
        url: `https://host.example/${uniqueName()}`,
        filename: uniqueName(),
        directory: 'checkpoints',
        destinationBaseDir: modelsRoot
      })
      await expect(blocked.completion).resolves.toMatchObject({ status: 'error' })

      const wrongBypass = await mod.startManagedModelJob({
        url: `https://host.example/${uniqueName()}`,
        filename: uniqueName(),
        directory: 'checkpoints',
        destinationBaseDir: modelsRoot,
        bypassRootLockFor: otherRoot
      })
      await expect(wrongBypass.completion).resolves.toMatchObject({ status: 'error' })
      expect(transfers).toHaveLength(before)

      const name = uniqueName()
      const admitted = await mod.startManagedModelJob({
        url: `https://host.example/${name}`,
        filename: name,
        directory: 'checkpoints',
        destinationBaseDir: modelsRoot,
        bypassRootLockFor: modelsRoot
      })
      await waitForTransfers(before + 1)
      expect(transfers[before]!.opts.finalPath).toBe(path.join(modelsRoot, 'checkpoints', name))
      transfers[before]!.resolve({ outcome: 'cancelled' })
      await expect(admitted.completion).resolves.toEqual({ status: 'cancelled' })
      await flush()
    } finally {
      release?.()
      fs.rmSync(installRoot, { recursive: true, force: true })
    }
  })

  it('releaseParkedModelJobsUnder retires parked rows, keeps staged bytes, and unblocks the lock', async () => {
    mod._test_resetModelDownloadsInit()
    const { installRoot, modelsRoot } = installLocalRoot('cdm-release-parked-')
    const dest = path.join(modelsRoot, 'checkpoints', 'parked.safetensors')
    scanForStagedDownloads.mockResolvedValueOnce({
      unsafeFinalPaths: [],
      downloads: [
        {
          meta: {
            version: 2,
            url: 'https://host.example/parked.safetensors',
            expectedSize: 1000,
            directory: 'checkpoints',
            filename: 'parked.safetensors',
            installationId: null
          },
          finalPath: dest,
          stagedBytes: 100
        }
      ]
    })
    try {
      await mod.initializeModelDownloads()
      const row = activeRows().find((r) => r.filename === 'parked.safetensors')
      expect(row?.status).toBe('paused')
      expect(mod.acquireModelDownloadRootLock(modelsRoot)).toBeNull()

      removeStagedArtifacts.mockClear()
      mod.releaseParkedModelJobsUnder(modelsRoot)
      expect(activeRows().find((r) => r.id === row!.id)).toBeUndefined()
      expect(removeStagedArtifacts).not.toHaveBeenCalled()

      const release = mod.acquireModelDownloadRootLock(modelsRoot)
      expect(release).not.toBeNull()
      release!()
    } finally {
      fs.rmSync(installRoot, { recursive: true, force: true })
    }
  })

  it('releaseParkedModelJobsUnder leaves actively transferring jobs alone', async () => {
    const { installRoot, modelsRoot } = installLocalRoot('cdm-release-active-')
    try {
      const name = uniqueName()
      const before = transfers.length
      const h = await mod.startManagedModelJob({
        url: `https://host.example/${name}`,
        filename: name,
        directory: 'checkpoints',
        destinationBaseDir: modelsRoot
      })
      await waitForTransfers(before + 1)

      mod.releaseParkedModelJobsUnder(modelsRoot)
      expect(activeRows().find((r) => r.id === h.id)).toBeDefined()
      expect(mod.acquireModelDownloadRootLock(modelsRoot)).toBeNull()

      expect(mod.cancelModelDownload(h.id)).toBe(true)
      await expect(h.completion).resolves.toEqual({ status: 'cancelled' })
      await flush()
    } finally {
      fs.rmSync(installRoot, { recursive: true, force: true })
    }
  })

  it('retrying a hydrated job stays in its original root and keeps its hash', async () => {
    mod._test_resetModelDownloadsInit()
    const { installRoot, modelsRoot } = installLocalRoot('cdm-hydrated-retry-')
    const dest = path.join(modelsRoot, 'checkpoints', 'pinned.safetensors')
    const url = 'https://host.example/pinned.safetensors'
    scanForStagedDownloads.mockResolvedValueOnce({
      unsafeFinalPaths: [],
      downloads: [
        {
          meta: {
            version: 2,
            url,
            expectedSize: 1000,
            directory: 'checkpoints',
            filename: 'pinned.safetensors',
            installationId: null,
            sha256: SHA_A
          },
          finalPath: dest,
          stagedBytes: 100
        }
      ]
    })
    try {
      await mod.initializeModelDownloads()
      const row = activeRows().find((r) => r.filename === 'pinned.safetensors')!
      let before = transfers.length
      expect(mod.resumeModelDownload(row.id!)).toBe(true)
      await waitForTransfers(before + 1)
      expect(transfers[before]!.opts.finalPath).toBe(dest)
      expect(transfers[before]!.opts.sha256).toBe(SHA_A)
      transfers[before]!.resolve({ outcome: 'error', error: 'presigned url expired' })
      await flush()

      before = transfers.length
      expect(mod.retryDownload(row.id!)).toBe(true)
      await waitForTransfers(before + 1)
      expect(transfers[before]!.opts.finalPath).toBe(dest)
      expect(transfers[before]!.opts.sha256).toBe(SHA_A)

      expect(mod.cancelModelDownload(transfers[before]!.opts.jobId as string)).toBe(true)
      await flush()
    } finally {
      fs.rmSync(installRoot, { recursive: true, force: true })
    }
  })
})
