// @vitest-environment node
import { createHash, randomUUID } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { stageModels, installModelsRoot, type ModelJobSurface } from './models'
import type { ModelJobOptions, ModelJobOutcome } from '../lib/comfyDownloadManager'
import type { ModelDescriptor, StageProgress } from './types'

const sha = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex')

const tmpRoots: string[] = []
function freshInstall(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-models-'))
  tmpRoots.push(dir)
  return dir
}
afterEach(() => {
  for (const d of tmpRoots.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

/** Fake managed-job surface. `behave` decides each started job's outcome;
 *  the default writes `bytes` at the resolved destination and completes,
 *  mimicking a successful verified transfer. */
function fakeJobs(
  behave?: (opts: ModelJobOptions, dest: string) => ModelJobOutcome | Promise<ModelJobOutcome>
) {
  const start = vi.fn(async (opts: ModelJobOptions) => {
    const dest = path.join(opts.destinationBaseDir!, opts.directory, opts.filename)
    const outcome = await (behave
      ? behave(opts, dest)
      : ((): ModelJobOutcome => {
          fs.mkdirSync(path.dirname(dest), { recursive: true })
          fs.writeFileSync(dest, Buffer.from('weights'))
          return { status: 'completed', savePath: dest }
        })())
    return {
      id: randomUUID(),
      url: opts.url,
      savePath: dest,
      completion: Promise.resolve(outcome),
      release: vi.fn()
    }
  })
  const cancel = vi.fn(() => true)
  return { start, cancel } satisfies ModelJobSurface
}

const model = (o: Partial<ModelDescriptor> = {}): ModelDescriptor => ({
  type: 'checkpoints',
  filename: 'm.safetensors',
  sha256: '0'.repeat(64),
  downloadUrl: 'https://models.test/m.safetensors',
  ...o
})

describe('stageModels', () => {
  it('runs one managed job per model, targeted at the install-local models root', async () => {
    const install = freshInstall()
    const bytes = Buffer.from('weights-A')
    const jobs = fakeJobs((_opts, dest) => {
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, bytes)
      return { status: 'completed', savePath: dest }
    })
    await stageModels({
      models: [
        model({ type: 'vae', filename: 'v.pt', sha256: sha(bytes), downloadUrl: 'https://x/v.pt' })
      ],
      installPath: install,
      installationId: 'inst-1',
      jobs
    })
    const dest = path.join(installModelsRoot(install), 'vae', 'v.pt')
    expect(fs.readFileSync(dest)).toEqual(bytes)
    expect(jobs.start).toHaveBeenCalledTimes(1)
    const opts = jobs.start.mock.calls[0]![0]
    expect(opts).toMatchObject({
      url: 'https://x/v.pt',
      filename: 'v.pt',
      directory: 'vae',
      installationId: 'inst-1',
      sha256: sha(bytes),
      destinationBaseDir: installModelsRoot(install),
      bypassRootLockFor: installModelsRoot(install)
    })
  })

  it('normalizes a sha256-prefixed integrity value before handing it to the job', async () => {
    const install = freshInstall()
    const bytes = Buffer.from('verified')
    const jobs = fakeJobs()
    await stageModels({
      models: [model({ filename: 'n.pt', sha256: `sha256:${sha(bytes)}` })],
      installPath: install,
      jobs
    })
    expect(jobs.start.mock.calls[0]![0].sha256).toBe(sha(bytes))
  })

  it('maps a checksum-mismatch outcome to model-checksum-mismatch without retrying', async () => {
    const install = freshInstall()
    const jobs = fakeJobs(() => ({
      status: 'error',
      error: 'checksum mismatch',
      code: 'checksum-mismatch'
    }))
    await expect(
      stageModels({ models: [model()], installPath: install, jobs })
    ).rejects.toMatchObject({ kind: 'model-checksum-mismatch' })
    expect(jobs.start).toHaveBeenCalledTimes(1)
  })

  it('maps an existing-file-mismatch outcome to model-conflict without retrying', async () => {
    const install = freshInstall()
    const jobs = fakeJobs(() => ({
      status: 'error',
      error: 'existing file differs',
      code: 'existing-file-mismatch'
    }))
    await expect(
      stageModels({ models: [model()], installPath: install, jobs })
    ).rejects.toMatchObject({ kind: 'model-conflict' })
    expect(jobs.start).toHaveBeenCalledTimes(1)
  })

  it('retries a transient failure and succeeds when a later attempt completes', async () => {
    const install = freshInstall()
    let attempts = 0
    const jobs = fakeJobs((_opts, dest) => {
      attempts++
      if (attempts < 3) return { status: 'error', error: 'ECONNRESET' }
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, Buffer.from('late'))
      return { status: 'completed', savePath: dest }
    })
    await stageModels({ models: [model()], installPath: install, jobs })
    expect(attempts).toBe(3)
  })

  it('fails with the transport error once the retry budget is exhausted', async () => {
    const install = freshInstall()
    const jobs = fakeJobs(() => ({ status: 'error', error: 'HTTP 503' }))
    await expect(stageModels({ models: [model()], installPath: install, jobs })).rejects.toThrow(
      /HTTP 503/
    )
    expect(jobs.start).toHaveBeenCalledTimes(3)
  })

  it('treats a cancelled job as staging cancellation', async () => {
    const install = freshInstall()
    const jobs = fakeJobs(() => ({ status: 'cancelled' }))
    await expect(stageModels({ models: [model()], installPath: install, jobs })).rejects.toThrow(
      /cancel/i
    )
    expect(jobs.start).toHaveBeenCalledTimes(1)
  })

  it.each([undefined, '', 'not-a-sha256'])(
    'rejects a model without a valid SHA-256 before any download',
    async (sha256) => {
      const install = freshInstall()
      const jobs = fakeJobs()
      const untrusted = { ...model(), sha256 } as unknown as ModelDescriptor
      await expect(
        stageModels({ models: [untrusted], installPath: install, jobs })
      ).rejects.toMatchObject({ kind: 'invalid-model' })
      expect(jobs.start).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['type', { type: '../evil' }],
    ['type sep', { type: 'a/b' }],
    ['filename', { filename: '../../etc/passwd' }],
    ['filename sep', { filename: 'a/b.pt' }]
  ])('rejects an unsafe %s before any download', async (_name, bad) => {
    const install = freshInstall()
    const jobs = fakeJobs()
    await expect(
      stageModels({ models: [model(bad)], installPath: install, jobs })
    ).rejects.toMatchObject({ kind: 'invalid-model' })
    expect(jobs.start).not.toHaveBeenCalled()
  })

  it('rejects a non-https download URL before any download', async () => {
    const install = freshInstall()
    const jobs = fakeJobs()
    await expect(
      stageModels({
        models: [model({ downloadUrl: 'http://insecure/m.safetensors' })],
        installPath: install,
        jobs
      })
    ).rejects.toMatchObject({ kind: 'invalid-model' })
    expect(jobs.start).not.toHaveBeenCalled()
  })

  it('refuses to write through a model dir that symlinks outside the install', async () => {
    const install = freshInstall()
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-escape-'))
    tmpRoots.push(outside)
    // A malicious archive ships ComfyUI/models/<type> as a symlink escaping the install.
    const modelsRoot = installModelsRoot(install)
    fs.mkdirSync(modelsRoot, { recursive: true })
    // A junction on Windows needs no privilege/Developer Mode, unlike a real
    // directory symlink; realpath resolves both, so the escape check still fires.
    fs.symlinkSync(
      outside,
      path.join(modelsRoot, 'evil'),
      process.platform === 'win32' ? 'junction' : 'dir'
    )
    const jobs = fakeJobs()
    await expect(
      stageModels({
        models: [model({ type: 'evil', filename: 'x.pth' })],
        installPath: install,
        jobs
      })
    ).rejects.toMatchObject({ kind: 'invalid-model' })
    expect(jobs.start).not.toHaveBeenCalled()
    expect(fs.existsSync(path.join(outside, 'x.pth'))).toBe(false)
  })

  it('removes a legacy .partial leftover before starting the job', async () => {
    const install = freshInstall()
    const dest = path.join(installModelsRoot(install), 'checkpoints', 'm.safetensors')
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(`${dest}.partial`, Buffer.from('stale'))
    await stageModels({ models: [model()], installPath: install, jobs: fakeJobs() })
    expect(fs.existsSync(`${dest}.partial`)).toBe(false)
  })

  it('reports per-model progress with a 1-based index and total', async () => {
    const install = freshInstall()
    const seen: Array<{ index: number; total: number; percent: number }> = []
    await stageModels({
      models: [
        model({ filename: 'a.pt', sha256: sha(Buffer.from('z')) }),
        model({ filename: 'b.pt', sha256: sha(Buffer.from('z')) })
      ],
      installPath: install,
      jobs: fakeJobs(),
      onProgress: (p) => seen.push({ index: p.index, total: p.total, percent: p.percent })
    })
    expect(seen.some((s) => s.index === 1 && s.total === 2)).toBe(true)
    expect(seen.some((s) => s.index === 2 && s.total === 2 && s.percent === 100)).toBe(true)
  })

  it('forwards byte totals plus a window-sampled speed and ETA in progress', async () => {
    const install = freshInstall()
    const seen: StageProgress[] = []
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const jobs = fakeJobs((opts, dest) => {
      opts.onProgress?.(1_048_576, 10_485_760)
      nowSpy.mockReturnValue(1_001_000) // 1s later
      opts.onProgress?.(3_145_728, 10_485_760) // +2 MiB over that second
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, Buffer.from('weights'))
      return { status: 'completed', savePath: dest }
    })
    try {
      await stageModels({
        models: [model()],
        installPath: install,
        jobs,
        onProgress: (p) => seen.push(p)
      })
    } finally {
      nowSpy.mockRestore()
    }
    // First sample has no prior window, so it carries bytes but no rate.
    const first = seen.find((p) => p.receivedBytes === 1_048_576)!
    expect(first.totalBytes).toBe(10_485_760)
    expect(first.speedBytesPerSec).toBeUndefined()
    expect(first.etaSecs).toBeUndefined()
    // Second sample: 2 MiB in 1s, with the ETA derived from that rate.
    const second = seen.find((p) => p.receivedBytes === 3_145_728)!
    expect(second.speedBytesPerSec).toBeCloseTo(2_097_152)
    expect(second.etaSecs).toBeCloseTo((10_485_760 - 3_145_728) / 2_097_152)
  })

  it('honors an already-aborted signal before starting any job', async () => {
    const install = freshInstall()
    const jobs = fakeJobs()
    await expect(
      stageModels({
        models: [model()],
        installPath: install,
        jobs,
        signal: AbortSignal.abort()
      })
    ).rejects.toThrow(/cancel/i)
    expect(jobs.start).not.toHaveBeenCalled()
  })

  it('cancels the in-flight job destructively when the signal aborts mid-transfer', async () => {
    const install = freshInstall()
    const controller = new AbortController()
    let settle!: (o: ModelJobOutcome) => void
    const completion = new Promise<ModelJobOutcome>((resolve) => {
      settle = resolve
    })
    const cancel = vi.fn((_id: string) => {
      settle({ status: 'cancelled' })
      return true
    })
    const start = vi.fn(async (opts: ModelJobOptions) => ({
      id: 'job-1',
      url: opts.url,
      savePath: path.join(opts.destinationBaseDir!, opts.directory, opts.filename),
      completion,
      release: vi.fn()
    }))
    const staging = stageModels({
      models: [model()],
      installPath: install,
      jobs: { start, cancel },
      signal: controller.signal
    })
    // Let the job start, then abort the install.
    await vi.waitFor(() => expect(start).toHaveBeenCalled())
    controller.abort()
    await expect(staging).rejects.toThrow(/cancel/i)
    expect(cancel).toHaveBeenCalledWith('job-1')
  })
})
