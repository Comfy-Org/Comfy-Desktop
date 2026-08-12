import { describe, it, expect, vi, beforeAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const netState = vi.hoisted(() => ({ online: true }))

// Managed model-job identity semantics (issue #1322): jobs are keyed by a
// stable job id, joined only by canonical final destination, and URL-based
// control refs (the in-Comfy bridge compatibility path) resolve only when
// unambiguous. The transport is mocked with controllable fake transfers so
// each test drives pause/cancel/error/completion outcomes deterministically.

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'home') return os.homedir()
      return path.join(os.tmpdir(), 'comfyui-desktop-2-test')
    }
  },
  BrowserWindow: Object.assign(class {}, {
    getAllWindows: () => [],
    // Resolve a (fake) hosted WebContentsView back to its owner window, the
    // way the real BrowserWindow.fromWebContents does for hosted views.
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

// Returns true like the real implementation when removal succeeds (the
// deferred-cancel path branches on this to decide cancelled vs error).
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
// Hydration re-reads the pair from disk right before registering it. Default:
// agree with the most recent scan result that mentioned the path, so tests
// that fabricate discovered pairs need no real files. Tests exercising the
// stale-snapshot guard override this to return null.
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

// Targeted overrides for otherwise-real modules: a test flips one on, runs,
// and restores null so every other test keeps the real behavior.
const overrides = vi.hoisted(() => ({
  installationsGet: null as null | ((id: string) => Promise<unknown>),
  collectModelScanRoots: null as null | (() => Promise<string[]>)
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
        : actual.collectModelScanRoots()
  }
})

import type * as ComfyDownloadManager from './comfyDownloadManager'
import type * as InstallationsModule from '../installations'
import type * as ModelDownloadPathsModule from './modelDownloadPaths'
import { getModelsBaseDir } from './modelDownloadPaths'
import { _registerExtraBroadcastTarget, _unregisterExtraBroadcastTarget } from './ipc/broadcast'

let mod: typeof ComfyDownloadManager

beforeAll(async () => {
  mod = await import('./comfyDownloadManager')
})

/** Wait until the fake transport for the most recent job(s) exists. */
async function waitForTransfers(count: number): Promise<void> {
  await vi.waitFor(() => {
    expect(transfers.length).toBeGreaterThanOrEqual(count)
  })
}

/** Let the runModelTransport continuation (after `done` settles) run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve()
  await new Promise((r) => setImmediate(r))
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/** Gate `fs.promises.mkdir` so a test can hold a job inside its admission
 *  preflight and land controls (pause/resume/cancel/quit) mid-flight. */
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
    // A second request for the same source and final file (concurrent
    // install / template + manual download) joins the active transfer
    // instead of writing the same model twice.
    const h2 = await mod.startManagedModelJob({
      url,
      filename: name,
      directory: 'checkpoints'
    })
    expect(h2.id).toBe(h1.id)
    expect(h2.savePath).toBe(h1.savePath)
    await flush()
    expect(transfers.length).toBe(before + 1)
    // The transport is told the job id so it persists into the sidecar and
    // restart hydration restores the same stable identity.
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
    // Same final file, DIFFERENT source URL: joining would silently hand this
    // caller another URL's bytes. It must fail as a conflict instead - and
    // must not start a second transport racing the first for one .part file.
    const h2 = await mod.startManagedModelJob({
      url: `https://host-b.example/mirror/${name}`,
      filename: name,
      directory: 'checkpoints'
    })
    expect(h2.id).not.toBe(h1.id)
    await expect(h2.completion).resolves.toMatchObject({ status: 'error' })
    await flush()
    expect(transfers.length).toBe(before + 1)
    // The original transfer is untouched by the rejected request.
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

    // A new caller (e.g. template orchestration after restart hydration)
    // joining a parked job must restart the transfer - otherwise the
    // caller's awaited completion would never settle and the template
    // launch step would hang forever.
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

    // URL-based control refs are ambiguous while both jobs are active - the
    // manager must refuse rather than act on an arbitrary job.
    expect(mod.pauseModelDownload(url)).toBe(false)
    expect(mod.cancelModelDownload(url)).toBe(false)
    expect(t1.pause).not.toHaveBeenCalled()
    expect(t2.pause).not.toHaveBeenCalled()

    // Id-based controls target exactly one job.
    expect(mod.pauseModelDownload(h1.id)).toBe(true)
    expect(t1.pause).toHaveBeenCalledTimes(1)
    expect(t2.pause).not.toHaveBeenCalled()
    await flush()

    // With h1 parked, cancel h2 by id; only its transfer is torn down.
    expect(mod.cancelModelDownload(h2.id)).toBe(true)
    expect(t2.cancel).toHaveBeenCalledTimes(1)
    await expect(h2.completion).resolves.toEqual({ status: 'cancelled' })
    await flush()

    // h2 is gone, so the URL now resolves unambiguously to h1.
    expect(mod.resumeModelDownload(url)).toBe(true)
    await waitForTransfers(before + 3)
    expect(transfers[before + 2]!.opts.finalPath).toBe(t1.opts.finalPath)

    // Cleanup: cancel h1's resumed transfer.
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

    // Retry by the terminal row's id: dispatches a NEW managed job.
    expect(mod.retryDownload(h.id)).toBe(true)
    await waitForTransfers(before + 2)
    expect(transfers[before + 1]!.opts.url).toBe(url)
    // The old terminal row is removed in favor of the new attempt.
    expect(mod.getDownloadsTrayState().recent.find((r) => r.id === h.id)).toBeUndefined()
    const fresh = activeRows().find((r) => r.url === url)
    expect(fresh).toBeDefined()
    expect(fresh!.id).not.toBe(h.id)

    // While the equivalent retry is active, a second retry request is refused.
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

    // The user pauses one job; sleep then parks the other.
    expect(mod.pauseModelDownload(hUserPaused.id)).toBe(true)
    await flush()
    mod.suspendActiveModelDownloadsForSleep()
    expect(tActive.pause).toHaveBeenCalledTimes(1)
    await flush()
    for (const id of [hActive.id, hUserPaused.id]) {
      expect(activeRows().find((r) => r.id === id)?.status).toBe('paused')
    }

    // Wake resumes only the sleep-parked job, reusing its stable id.
    await mod.resumeModelDownloadsAfterWake()
    await waitForTransfers(before + 3)
    expect(transfers[before + 2]!.opts.jobId).toBe(hActive.id)
    expect(transfers.length).toBe(before + 3)
    expect(activeRows().find((r) => r.id === hUserPaused.id)?.status).toBe('paused')

    // A second wake with nothing parked resumes nothing.
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

    // Wake fires; while the connectivity wait is still pending, the user
    // explicitly pauses the job. Their decision owns the job now - the wake
    // waiter must not auto-resume over it.
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
    // Earlier tests memoized a safe startup pass through the admission
    // barrier; reset so THIS test's scan result is consumed.
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

    // The sidecar's persisted job id survives hydration as the row identity.
    const rowC = activeRows().find((r) => r.url === persistedUrl)
    expect(rowC?.id).toBe(persistedId)
    expect(rowC?.status).toBe('paused')

    // Ambiguous URL -> no-op; exact ids remain fully actionable.
    expect(mod.resumeModelDownload(url)).toBe(false)

    const before = transfers.length
    expect(mod.resumeModelDownload(rowA.id!)).toBe(true)
    await waitForTransfers(before + 1)
    expect(transfers[before]!.opts.finalPath).toBe(destA)

    // Resuming the restored job hands the SAME persisted id to the transport
    // so the refreshed sidecar keeps the stable identity.
    expect(mod.resumeModelDownload(persistedId)).toBe(true)
    await waitForTransfers(before + 2)
    expect(transfers[before + 1]!.opts.finalPath).toBe(destC)
    expect(transfers[before + 1]!.opts.jobId).toBe(persistedId)
    expect(mod.cancelModelDownload(persistedId)).toBe(true)
    await flush()

    // Cancelling the parked job B removes ITS staged artifacts only.
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

    // Pause then resume back-to-back: the resume lands while the paused
    // transport's `done` continuation is still queued. The stale attempt must
    // not re-park the job or leak a second concurrent transport.
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

    // Pause, then cancel while the transport is still settling: the cancel
    // must win, remove the staged artifacts (after the old stream is done),
    // and the stale pause attempt must not resurrect a paused row.
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

    // The transport refuses the cancel: finalize verification already holds
    // its terminal claim (the completed model may be mid-install). The cancel
    // is deferred to the outcome - and the outcome is 'completed', so the
    // installed model must win; nothing may report cancelled or delete it.
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

    // The transport refuses the cancel (another path holds its terminal
    // claim), so the cancel defers to the outcome. The transport then parks:
    // the deferred cancel must apply destructively - staged state removed,
    // job settled cancelled, nothing left to rehydrate.
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

    // Refused cancel deferred to the outcome; the transport parks, but the
    // staged removal leaves resumable metadata behind - the job WOULD
    // rehydrate next launch, so a clean 'cancelled' would lie; it must
    // surface as an error.
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

    // Cancel is refused and deferred, then the user pauses and resumes before
    // the old outcome lands. The resume is the latest user intent: the stale
    // deferred cancel must not linger and destroy the resumed attempt the
    // next time it parks.
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

    // Cleanup: a cancel on the parked job is still destructive.
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
    // A second caller (e.g. another install's template) joins the same
    // canonical destination.
    const h2 = await mod.startManagedModelJob({
      url,
      filename: name,
      directory: 'checkpoints'
    })
    expect(h2.id).toBe(h1.id)

    // One caller abandons its lease (template abort): the other caller's
    // transfer keeps running. Releasing the SAME lease again is idempotent -
    // it can never eat the other caller's lease.
    h1.release()
    h1.release()
    h1.release()
    await flush()
    expect(t.pause).not.toHaveBeenCalled()
    expect(t.cancel).not.toHaveBeenCalled()
    expect(activeRows().find((r) => r.id === h1.id)).toBeDefined()

    // The last lease going away PARKS the transfer resumably (staged bytes +
    // sidecar kept, row shows paused): a closing window must not destroy
    // bytes the Downloads UI can resume. Only the user's explicit Downloads
    // Cancel is destructive.
    h2.release()
    expect(t.pause).toHaveBeenCalledTimes(1)
    expect(t.cancel).not.toHaveBeenCalled()
    await flush()
    expect(activeRows().find((r) => r.id === h1.id)?.status).toBe('paused')

    // Cleanup: the explicit Cancel control removes the parked job.
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

    // The user's explicit Cancel in the Downloads UI tears the job down for
    // everyone - it is not a lease release.
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
      // App quit destroys host windows BEFORE `will-quit` parking runs, and
      // window teardown releases the install's template leases. That release
      // must NOT cancel (it would delete the staged bytes the quit dialog
      // promised to preserve) - the quit path parks the job resumably.
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
      // The job is admitted but its preflight has not finished: quit must
      // treat it as active (its durable placeholder has not landed yet).
      expect(mod.hasActiveModelTransfers()).toBe(true)
      // Pause -> resume land while the preflight is mid-flight. Only the
      // preflight completion may start the first transport - the resume must
      // not race it into a second one.
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
      // The preflight completed but the pause owns the job: it stays parked.
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
      // The late preflight completion saw the job was gone: it must not
      // recreate staging artifacts for a cancelled job or start a transport.
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
      // Quit must not report parked while the admitted job's durable
      // placeholder has not landed on disk - the job would be lost on restart.
      expect(quitSettled).toBe(false)
      gate.open()
      await quit
      const h = await admission
      await flush()
      // The placeholder landed before quit resolved...
      expect(ensureStagedPlaceholder.mock.calls.length).toBe(stagedCallsBefore + 1)
      // ...but no transport may start once quit parking has begun, not even
      // through an explicit resume.
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
    // The old stream keeps flushing: pause() is accepted but `done` stays
    // pending, then cancel lands while the transport is still settling.
    t1.pause.mockImplementation(() => true)
    expect(mod.pauseModelDownload(h1.id)).toBe(true)
    expect(mod.cancelModelDownload(h1.id)).toBe(true)
    // The cancel is committed but must not report/settle while the old
    // stream is still flushing - a clean 'cancelled' before the staged
    // cleanup outcome is known would lie about the on-disk state.
    let h1Settled = false
    void h1.completion.then(() => {
      h1Settled = true
    })
    await flush()
    expect(h1Settled).toBe(false)
    // The closing stream still holds the destination; quit would wait for it.
    expect(mod.hasActiveModelTransfers()).toBe(true)

    const h2 = await mod.startManagedModelJob({ url, filename: name, directory: 'checkpoints' })
    expect(h2.id).not.toBe(h1.id)
    await flush()
    // The replacement must not open the staging file while the old stream is
    // still closing (Windows cannot even unlink an open file).
    expect(transfers.length).toBe(before + 1)

    t1.resolve({ outcome: 'paused' })
    await expect(h1.completion).resolves.toEqual({ status: 'cancelled' })
    await waitForTransfers(before + 2)
    expect(transfers[before + 1]!.opts.jobId).toBe(h2.id)
    await flush()
    // The old cancel's deferred cleanup saw the destination re-owned and did
    // not delete the replacement's staged artifacts.
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
      // Exiting before the old stream closes could truncate staged bytes.
      expect(quitSettled).toBe(false)
      t.resolve({ outcome: 'paused' })
      // The deferred cancel settles only after the stream closed and the
      // staged artifacts were removed.
      await expect(h.completion).resolves.toEqual({ status: 'cancelled' })
      await quit
      expect(quitSettled).toBe(true)
      await flush()
      // No new job claimed the destination, so the deferred cancel cleanup
      // removed the staged artifacts once the stream had closed - and quit
      // waited for that cleanup, not just the stream close.
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

      // Wake fires while the network is still down: the waiter starts
      // polling for connectivity. The machine then sleeps AGAIN before the
      // network returns - the old waiter is now stale.
      const staleWake = mod.resumeModelDownloadsAfterWake()
      mod.suspendActiveModelDownloadsForSleep()
      netState.online = true
      await staleWake
      await flush()
      // The stale waiter saw connectivity but was superseded: it must not
      // resume a job the newer sleep parked.
      expect(transfers.length).toBe(before + 1)
      expect(activeRows().find((r) => r.id === h.id)?.status).toBe('paused')

      // Only the newest wake pass resumes it.
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
    // Pause claims the transport but its stream keeps flushing (`done` stays
    // pending), then an immediate resume starts a new attempt that parks the
    // old `done` as the destination's closing stream and waits on it - at
    // this point the job has NO live transport.
    t1.pause.mockImplementation(() => true)
    expect(mod.pauseModelDownload(h.id)).toBe(true)
    expect(mod.resumeModelDownload(h.id)).toBe(true)
    await flush()
    expect(transfers.length).toBe(before + 1)

    // Cancel lands in that window. The old stream could still recreate the
    // staged artifacts after an eager deletion, so the teardown must neither
    // delete nor settle until the stream has closed.
    const removalsBefore = removeStagedArtifacts.mock.calls.length
    expect(mod.cancelModelDownload(h.id)).toBe(true)
    let settled = false
    void h.completion.then(() => {
      settled = true
    })
    await flush()
    expect(settled).toBe(false)
    expect(removeStagedArtifacts.mock.calls.length).toBe(removalsBefore)
    // The committed teardown owns the job: no control may revive or re-park it.
    expect(mod.pauseModelDownload(h.id)).toBe(false)
    expect(mod.resumeModelDownload(h.id)).toBe(false)
    // A second cancel is an idempotent success, not a second teardown.
    expect(mod.cancelModelDownload(h.id)).toBe(true)

    // Old stream closes: the superseded resumed attempt must NOT start a
    // transport, and the deferred teardown removes the artifacts and settles.
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
      // Admitted after the quit snapshot, nothing would await this job's
      // preflight or transport - it must be refused outright: settled error,
      // no registry row, no staging placeholder, no transport.
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
    // Clean pause: the transport settles immediately, leaving no live
    // transport and no closing stream for this destination.
    expect(mod.pauseModelDownload(h.id)).toBe(true)
    await flush()
    // Resume, but hold the new attempt inside its install/session lookup:
    // the job now has NO transport, is NOT in preflight, and owns NO closing
    // stream - the exact window a one-shot quit snapshot used to miss.
    const gate = deferred()
    overrides.installationsGet = async () => {
      await gate.promise
      return null
    }
    try {
      expect(mod.resumeModelDownload(h.id)).toBe(true)
      await flush()
      expect(transfers.length).toBe(before + 1)
      // Quit must see this in-between attempt as active work needing parking.
      expect(mod.hasActiveModelTransfers()).toBe(true)
      await mod.suspendActiveModelDownloadsForQuit(5000)
      // The session lookup resolves after quit parking: the parked attempt
      // must not start a transport during shutdown.
      gate.resolve()
      overrides.installationsGet = null
      await flush()
      expect(transfers.length).toBe(before + 1)
      // The job stays registered with its durable staged pair: it hydrates
      // as an actionable paused row on the next launch instead of vanishing.
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

    // Job A fails; its row becomes a retryable terminal entry.
    before = transfers.length
    expect(mod.resumeModelDownload(rowA.id!)).toBe(true)
    await waitForTransfers(before + 1)
    const tA = transfers.find((t) => t.opts.finalPath === destA)!
    tA.resolve({ outcome: 'error', error: 'network interrupted' })
    await flush()
    expect(mod.getDownloadsTrayState().recent.find((r) => r.id === rowA.id)?.status).toBe('error')

    // Job B matches A's URL AND directory exactly - only the canonical
    // resolved destination distinguishes them. B being active must not block
    // A's retry (URL + directory dedupe would wrongly refuse it).
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

    // A fresh job now owns the destination the failed row would retry into:
    // dispatching the retry would race two transports for one .part file.
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
    // The initiating sender received the admission report.
    expect(sender.send).toHaveBeenCalled()
    sender.send.mockClear()

    // The download was initiated by a ComfyUI WebContentsView HOSTED by the
    // window - not the window's own webContents. Closing the window must
    // still detach the sender, or later reports would target a destroyed
    // WebContents (and pin it in memory).
    mod.detachWindowDownloads(fakeWin as never)
    transfers[before]!.resolve({ outcome: 'completed', savePath: h.savePath })
    await expect(h.completion).resolves.toMatchObject({ status: 'completed' })
    await flush()
    expect(sender.send).not.toHaveBeenCalled()
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

    // An unsafe pass is NOT memoized: the next launch attempt re-runs the
    // migration (the lock may have been released) instead of reusing a stale
    // "checked" result - and this time it comes back safe.
    const second = await mod.initializeModelDownloads()
    expect(second.safe).toBe(true)
    expect(second.unsafePaths).toEqual([])

    // A safe pass IS memoized: no further migration runs.
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
      // Without the full root list nothing can be certified: the migration
      // must not have run against a silently-partial scan.
      expect(migrateLegacyModelDownloadArtifacts.mock.calls.length).toBe(migrationsBefore)
    } finally {
      overrides.collectModelScanRoots = null
    }
    // Fail-closed passes are not memoized: the next attempt reruns and passes.
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

    // The unsafe pass is retried (not memoized); the same still-stuck marker
    // updates its existing warning row instead of stacking a duplicate on
    // every blocked launch attempt.
    scanForStagedDownloads.mockResolvedValueOnce({ downloads: [], unsafeFinalPaths: [marker] })
    const second = await mod.initializeModelDownloads()
    expect(second.safe).toBe(false)
    expect(warningRows()).toHaveLength(1)
    expect(warningRows()[0]!.id).toBe(warningId)

    // A later pass that finds the marker cleared dismisses the stale warning.
    const third = await mod.initializeModelDownloads()
    expect(third.safe).toBe(true)
    expect(third.unsafePaths).toEqual([])
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

    // The retried unsafe pass rescans the same staged pair; the existing
    // paused row must be kept, not duplicated into a second job.
    scanForStagedDownloads.mockResolvedValueOnce({
      downloads: [stagedPair()],
      unsafeFinalPaths: [marker]
    })
    const second = await mod.initializeModelDownloads()
    expect(second.safe).toBe(false)
    const rowsAfterSecond = activeRows().filter((r) => r.url === url)
    expect(rowsAfterSecond).toHaveLength(1)
    expect(rowsAfterSecond[0]!.id).toBe(rowId)

    // Final safe pass, then remove the hydrated job.
    const third = await mod.initializeModelDownloads()
    expect(third.safe).toBe(true)
    expect(mod.cancelModelDownload(rowId)).toBe(true)
    await flush()
    mod._test_resetModelDownloadsInit()
  })

  it('a staged-scan exception makes the pass unsafe and is not memoized', async () => {
    mod._test_resetModelDownloadsInit()
    // The staged scan is what finds zero-byte final-name claim markers; a
    // failed scan cannot certify that nothing broken is visible under a
    // final model name, so the whole pass must fail closed.
    scanForStagedDownloads.mockRejectedValueOnce(new Error('walk failed'))
    const first = await mod.initializeModelDownloads()
    expect(first.safe).toBe(false)
    // Fail-closed passes are not memoized: the next attempt reruns clean.
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

    // The scan itself fails on the retried pass: its previous findings are
    // still unresolved, so the marker stays unsafe and its warning row stays
    // visible - a producer failure must not launder away known-bad paths.
    scanForStagedDownloads.mockRejectedValueOnce(new Error('walk failed'))
    const second = await mod.initializeModelDownloads()
    expect(second.safe).toBe(false)
    expect(second.unsafePaths).toEqual([marker])
    expect(rows()).toHaveLength(1)
    expect(rows()[0]!.id).toBe(warningId)

    // A later successful scan that proves the marker gone clears it.
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

    // Migration clears its report but the scan still sees the marker: the
    // path stays unsafe with the SAME stable row (keying rows by path once
    // let a clean migration pass dismiss the scan's only warning).
    scanForStagedDownloads.mockResolvedValueOnce({ downloads: [], unsafeFinalPaths: [marker] })
    const second = await mod.initializeModelDownloads()
    expect(second.safe).toBe(false)
    expect(second.unsafePaths).toEqual([marker])
    expect(rows()).toHaveLength(1)
    expect(rows()[0]!.id).toBe(warningId)

    // Only when BOTH producers stop reporting it is the warning dismissed.
    const third = await mod.initializeModelDownloads()
    expect(third.safe).toBe(true)
    expect(rows()).toHaveLength(0)
    mod._test_resetModelDownloadsInit()
  })

  it('an unsafe startup pass blocks new managed model jobs', async () => {
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
    await expect(h.completion).resolves.toMatchObject({
      status: 'error',
      error: expect.stringContaining('attention')
    })
    await flush()
    // No staging, no transport: the job was refused at admission.
    expect(transfers.length).toBe(before)
    // The unsafe pass was not memoized; a clean retry recovers.
    const next = await mod.initializeModelDownloads()
    expect(next.safe).toBe(true)
    mod._test_resetModelDownloadsInit()
  })

  it('admission awaits the startup pass, so a legacy truncated final is not already-present', async () => {
    mod._test_resetModelDownloadsInit()
    const name = uniqueName()
    const dest = path.join(getModelsBaseDir(), 'checkpoints', name)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    // A truncated download from an affected release sits under the FINAL
    // model name. Checking existence before the migration pass finishes
    // would certify it as a complete model (`alreadyPresent`) - the exact
    // corruption #1322 is about.
    fs.writeFileSync(dest, 'truncated legacy bytes')
    migrateLegacyModelDownloadArtifacts.mockImplementationOnce(async () => {
      // Quarantine: the truncated final leaves the model namespace.
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
    // A real transfer started for the migrated-away destination instead of
    // reporting the truncated file complete.
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
    // Memoized while safe: another call runs no new migration.
    await mod.initializeModelDownloads()
    expect(migrateLegacyModelDownloadArtifacts.mock.calls.length).toBe(migrations)

    // A new installation was created: its (possibly reused, pre-existing)
    // model dirs were never covered by the memoized pass.
    mod.invalidateModelDownloadStartupPass()
    const name = uniqueName()
    const before = transfers.length
    const h = await mod.startManagedModelJob({
      url: `https://host.example/${name}`,
      filename: name,
      directory: 'checkpoints'
    })
    await waitForTransfers(before + 1)
    // Admission re-ran the migration over the current roots first.
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
    // The roots changed while the pass was already walking them: its result
    // cannot certify the new roots and must not be reused.
    mod.invalidateModelDownloadStartupPass()
    gate.resolve()
    const s1 = await p1
    expect(s1.safe).toBe(true)
    const migrations = migrateLegacyModelDownloadArtifacts.mock.calls.length

    const s2 = await mod.initializeModelDownloads()
    expect(s2.safe).toBe(true)
    expect(migrateLegacyModelDownloadArtifacts.mock.calls.length).toBe(migrations + 1)
    // The fresh pass is memoized again.
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
    // A destructive cancel finished (and deleted the pair) after the scan's
    // async walk snapshotted it: the synchronous re-read right before
    // registration sees nothing, so the cancelled row is NOT resurrected.
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
    // The pair changed on disk after the scan snapshot; hydration registers
    // the FRESH byte count, not the stale one.
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
    // Renderer stores keep every row they were sent; an eviction that is not
    // broadcast leaves the row visible forever in open windows (a later
    // dismissal finds nothing in the recent buffer, so emits nothing).
    const target = {
      send: vi.fn(),
      isDestroyed: () => false,
      once: vi.fn()
    }
    _registerExtraBroadcastTarget(target as unknown as Electron.WebContents)
    try {
      // Invalid model extension: each job settles as an immediate terminal
      // error row with a unique URL, filling the recent buffer past its cap
      // of 10 without touching staging or the network.
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
      // The evicted row really left the recent snapshot.
      expect(mod.getDownloadsTrayState().recent.find((r) => r.id === first.id)).toBeUndefined()
      // The 10 newest rows were kept, not broadcast as removed.
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
