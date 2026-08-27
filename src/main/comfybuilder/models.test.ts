// @vitest-environment node
import { blake3 } from '@noble/hashes/blake3.js'
import { createHash, generateKeyPairSync, randomUUID, sign as signBytes } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ModelJobOptions, ModelJobOutcome } from '../lib/comfyDownloadManager'
import sharedModelLedgerFixture from './fixtures/model-ledger-v1.json'
import { governancePolicyPath } from './governance'
import type { GovernanceMarker } from './governance'
import {
  createModelLedgerEntry,
  modelLedgerPath,
  readModelLedger,
  writeModelLedger
} from './modelLedger'
import { stageModels, installModelsRoot, type ModelJobSurface } from './models'
import type { ModelDescriptor, StageProgress } from './types'

const sha = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex')
const blake = (buf: Buffer): string => Buffer.from(blake3(buf)).toString('hex')
const DOMAIN_SEPARATOR = Buffer.from('comfyui-governance-v1\0', 'utf-8')
const BUILD_IDENTITY = 'build-7|release-3|artifact-9|linux/nvidia/cu124|sha256:abcd'

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

function verifiedJobs(bytesByFilename: Readonly<Record<string, Buffer>>) {
  return fakeJobs((opts, dest) => {
    const bytes = bytesByFilename[opts.filename]
    if (!bytes) return { status: 'error', error: 'missing test bytes' }
    if (!opts.digest) return { status: 'error', error: 'missing test digest' }
    const actual = opts.digest.algo === 'blake3' ? blake(bytes) : sha(bytes)
    if (actual !== opts.digest.value) {
      return { status: 'error', error: 'checksum mismatch', code: 'checksum-mismatch' }
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, bytes)
    return { status: 'completed', savePath: dest }
  })
}

function configureGovernedInstall(
  installPath: string,
  models: readonly string[],
  activeForms: readonly string[] = ['model']
): GovernanceMarker {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const rawPublicKey = publicKey.export({ format: 'der', type: 'spki' }).subarray(12)
  const encodedPublicKey = Buffer.from(rawPublicKey).toString('base64url')
  const customNodeMode = activeForms.includes('customNode') ? 'blocklist' : null
  const payload = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      audience: 'comfyui-core',
      versionId: 'version-42',
      buildIdentity: BUILD_IDENTITY,
      sourcesDigest: `sha256:${'a'.repeat(64)}`,
      policyGeneration: 3,
      activeForms,
      customNodeMode,
      packs: [],
      deniedPacks: [],
      disabledNodes: [],
      disabledPartnerNodes: [],
      models
    }),
    'utf-8'
  )
  const signature = signBytes(
    null,
    Buffer.concat([DOMAIN_SEPARATOR, payload]),
    privateKey
  ).toString('base64url')
  const policyPath = governancePolicyPath(installPath)
  fs.mkdirSync(path.dirname(policyPath), { recursive: true })
  fs.writeFileSync(
    policyPath,
    JSON.stringify({ schema: 1, payload: payload.toString('base64url'), signature })
  )
  return {
    governanceMarkerVersion: 1,
    governed: true,
    expectedBuildIdentity: BUILD_IDENTITY,
    publicKey: encodedPublicKey,
    activeForms,
    customNodeMode
  }
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
      digest: { algo: 'sha256', value: sha(bytes) },
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
    expect(jobs.start.mock.calls[0]![0].digest).toEqual({ algo: 'sha256', value: sha(bytes) })
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

  it.each([undefined, '', '   '])(
    'downloads a model without integrity on an ungoverned install',
    async (blank) => {
      const install = freshInstall()
      const jobs = fakeJobs()
      const untrusted: ModelDescriptor = { ...model(), sha256: blank, blake3: blank }
      await stageModels({ models: [untrusted], installPath: install, jobs })
      expect(jobs.start).toHaveBeenCalledTimes(1)
      expect(jobs.start.mock.calls[0]![0].digest).toBeUndefined()
    }
  )

  it.each([undefined, '', '   '])(
    'refuses a model without integrity on a governed install',
    async (blank) => {
      const install = freshInstall()
      const governance = configureGovernedInstall(install, [])
      const jobs = fakeJobs()
      const untrusted: ModelDescriptor = { ...model(), sha256: blank, blake3: blank }
      await expect(
        stageModels({ models: [untrusted], installPath: install, governance, jobs })
      ).rejects.toMatchObject({ kind: 'invalid-model' })
      expect(jobs.start).not.toHaveBeenCalled()
    }
  )

  it('refuses a model without integrity when the governance marker is unreadable', async () => {
    const install = freshInstall()
    const jobs = fakeJobs()
    const untrusted: ModelDescriptor = { ...model(), sha256: undefined }
    await expect(
      stageModels({
        models: [untrusted],
        installPath: install,
        governance: { governed: true } as unknown as GovernanceMarker,
        jobs
      })
    ).rejects.toMatchObject({ kind: 'invalid-model' })
    expect(jobs.start).not.toHaveBeenCalled()
  })

  it.each(['not-a-sha256', 'sha256:'])(
    'rejects a model with malformed SHA-256 before any download',
    async (sha256) => {
      const install = freshInstall()
      const jobs = fakeJobs()
      await expect(
        stageModels({ models: [model({ sha256 })], installPath: install, jobs })
      ).rejects.toMatchObject({ kind: 'invalid-model' })
      expect(jobs.start).not.toHaveBeenCalled()
    }
  )

  it.each(['not-a-blake3', 'blake3:', `sha256:${'a'.repeat(64)}`])(
    'rejects a model with malformed BLAKE3 before any download',
    async (blake3) => {
      const install = freshInstall()
      const jobs = fakeJobs()
      await expect(
        stageModels({
          models: [model({ blake3, sha256: undefined })],
          installPath: install,
          jobs
        })
      ).rejects.toMatchObject({ kind: 'invalid-model' })
      expect(jobs.start).not.toHaveBeenCalled()
    }
  )

  it('stages a nested model type at its nested path', async () => {
    const install = freshInstall()
    const bytes = Buffer.from('gemma-weights')
    const jobs = fakeJobs((_opts, dest) => {
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, bytes)
      return { status: 'completed', savePath: dest }
    })
    await stageModels({
      models: [
        model({
          type: 'text_encoders/gemma_3_12b_it_hf',
          filename: 'gemma.safetensors',
          sha256: sha(bytes)
        })
      ],
      installPath: install,
      jobs
    })
    const dest = path.join(
      installModelsRoot(install),
      'text_encoders',
      'gemma_3_12b_it_hf',
      'gemma.safetensors'
    )
    expect(fs.readFileSync(dest)).toEqual(bytes)
    expect(jobs.start.mock.calls[0]![0].directory).toBe('text_encoders/gemma_3_12b_it_hf')
  })

  // Every accepted value here is one Cloud can seal (`common.ValidModelDir`),
  // so a distribution Cloud built cannot be unstageable on Desktop.
  it.each([
    'checkpoints',
    'text_encoders/gemma_3_12b_it_hf',
    'diffusers/governance-fixture/text_encoder',
    'insightface/models/antelopev2',
    'LLM/Qwen-VL/Qwen3-VL-2B-Instruct',
    'My-Type_1.2'
  ])('accepts %s as a model type', async (type) => {
    const install = freshInstall()
    const jobs = fakeJobs()
    await stageModels({ models: [model({ type })], installPath: install, jobs })
    expect(jobs.start.mock.calls[0]![0].directory).toBe(type)
    expect(fs.existsSync(path.join(installModelsRoot(install), type, 'm.safetensors'))).toBe(true)
  })

  it.each([
    ['a leading traversal segment', '../evil'],
    ['an interior traversal segment', 'text_encoders/../../evil'],
    ['a bare traversal', '..'],
    ['a posix absolute path', '/checkpoints'],
    ['a windows drive path', 'C:/models'],
    ['a backslash separator', 'checkpoints\\evil'],
    ['a doubled separator', 'text_encoders//gemma'],
    ['a trailing separator', 'text_encoders/'],
    ['an empty type', ''],
    ['a dot segment', 'text_encoders/./gemma'],
    ['a hidden segment', 'text_encoders/.hidden'],
    ['a reserved code root', 'custom_nodes/evil'],
    ['a reserved config root', 'configs/evil'],
    ['a dos device segment', 'nul/weights'],
    ['a trailing-dot segment', 'text_encoders/gemma.'],
    ['a whitespace segment', 'text encoders/gemma'],
    ['a NUL byte', 'text_encoders/gem\0ma'],
    ['an over-long path', `${'a/'.repeat(128)}b`]
  ])('rejects %s as a model type before any download', async (_name, type) => {
    const install = freshInstall()
    const jobs = fakeJobs()
    await expect(
      stageModels({ models: [model({ type })], installPath: install, jobs })
    ).rejects.toMatchObject({ kind: 'invalid-model' })
    expect(jobs.start).not.toHaveBeenCalled()
  })

  // A filename is ALWAYS a single segment: accepting nested TYPES must not have
  // relaxed the filename half of `models/<type>/<filename>`.
  it.each([
    ['a traversal', '../../etc/passwd'],
    ['a bare traversal', '..'],
    ['a posix separator', 'a/b.pt'],
    ['a windows separator', 'a\\b.pt'],
    ['a nested fixture path', 'unet/diffusion_pytorch_model.safetensors'],
    ['a dot', '.'],
    ['an absolute path', '/etc/passwd'],
    ['a drive prefix', 'C:evil.pt'],
    ['a NUL byte', 'ev\0il.pt'],
    ['nothing at all', '']
  ])('still rejects a filename containing %s before any download', async (_name, filename) => {
    const install = freshInstall()
    const jobs = fakeJobs()
    await expect(
      stageModels({ models: [model({ filename })], installPath: install, jobs })
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

  it('refuses a nested type whose parent segment symlinks outside the install', async () => {
    const install = freshInstall()
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-escape-nested-'))
    tmpRoots.push(outside)
    const modelsRoot = installModelsRoot(install)
    fs.mkdirSync(modelsRoot, { recursive: true })
    // The grammar cannot see this: every segment of `diffusers/governance-fixture`
    // is valid, and only the realpath check catches the redirected parent.
    fs.symlinkSync(
      outside,
      path.join(modelsRoot, 'diffusers'),
      process.platform === 'win32' ? 'junction' : 'dir'
    )
    const jobs = fakeJobs()
    await expect(
      stageModels({
        models: [model({ type: 'diffusers/governance-fixture', filename: 'model_index.json' })],
        installPath: install,
        jobs
      })
    ).rejects.toMatchObject({ kind: 'invalid-model' })
    expect(jobs.start).not.toHaveBeenCalled()
    expect(fs.existsSync(path.join(outside, 'governance-fixture'))).toBe(true)
    expect(fs.existsSync(path.join(outside, 'governance-fixture', 'model_index.json'))).toBe(false)
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

describe('model governance ledger', () => {
  it('records exactly two successfully staged approved BLAKE3 models', async () => {
    const install = freshInstall()
    const firstBytes = Buffer.from('approved-model-one')
    const secondBytes = Buffer.from('approved-model-two')
    const firstDigest = `blake3:${blake(firstBytes)}`
    const secondDigest = `blake3:${blake(secondBytes)}`
    const governance = configureGovernedInstall(install, [firstDigest, secondDigest])

    await stageModels({
      models: [
        model({ type: 'checkpoints', filename: 'one.safetensors', blake3: firstDigest }),
        model({ type: 'vae', filename: 'two.safetensors', blake3: secondDigest })
      ],
      installPath: install,
      governance,
      jobs: verifiedJobs({
        'one.safetensors': firstBytes,
        'two.safetensors': secondBytes
      })
    })

    const ledger = await readModelLedger(install)
    expect(ledger?.entries).toHaveLength(2)
    const firstPath = fs.realpathSync(
      path.join(installModelsRoot(install), 'checkpoints', 'one.safetensors')
    )
    const secondPath = fs.realpathSync(
      path.join(installModelsRoot(install), 'vae', 'two.safetensors')
    )
    expect(
      ledger?.entries.map(({ path: entryPath, digest }) => ({ path: entryPath, digest }))
    ).toEqual([
      { path: firstPath.replace(/\\/g, '/'), digest: firstDigest },
      { path: secondPath.replace(/\\/g, '/'), digest: secondDigest }
    ])

    for (const entry of ledger!.entries) {
      const stat = fs.statSync(entry.path, { bigint: true })
      expect(entry.size).toBe(Number(stat.size))
      expect(entry.mtimeNs).toBe(stat.mtimeNs.toString())
      expect(entry.inode).toBe(stat.ino.toString())
      expect(entry.dev).toBe(stat.dev.toString())
    }
  })

  it('writes no entry when downloaded bytes fail their declared digest', async () => {
    const install = freshInstall()
    const declaredBytes = Buffer.from('declared-model-bytes')
    const downloadedBytes = Buffer.from('different-downloaded-bytes')
    const digest = `blake3:${blake(declaredBytes)}`
    const governance = configureGovernedInstall(install, [digest])

    await expect(
      stageModels({
        models: [model({ blake3: digest })],
        installPath: install,
        governance,
        jobs: verifiedJobs({ 'm.safetensors': downloadedBytes })
      })
    ).rejects.toMatchObject({ kind: 'model-checksum-mismatch' })

    expect(await readModelLedger(install)).toBeNull()
    expect(fs.existsSync(modelLedgerPath(install))).toBe(false)
  })

  it('writes no entry when valid bytes are outside the verified approved set', async () => {
    const install = freshInstall()
    const bytes = Buffer.from('valid-but-unapproved-model')
    const digest = `blake3:${blake(bytes)}`
    const governance = configureGovernedInstall(install, [])

    await stageModels({
      models: [model({ blake3: digest })],
      installPath: install,
      governance,
      jobs: verifiedJobs({ 'm.safetensors': bytes })
    })

    expect(
      fs.readFileSync(path.join(installModelsRoot(install), 'checkpoints', 'm.safetensors'))
    ).toEqual(bytes)
    expect(await readModelLedger(install)).toBeNull()
    expect(fs.existsSync(modelLedgerPath(install))).toBe(false)
  })

  it('does not consult policy or write a ledger when the model form is inactive', async () => {
    const install = freshInstall()
    const bytes = Buffer.from('ordinary-staged-model')
    const digest = `blake3:${blake(bytes)}`
    const governance = configureGovernedInstall(install, [], ['customNode'])
    fs.rmSync(governancePolicyPath(install))
    const readFileSpy = vi.spyOn(fs.promises, 'readFile')

    try {
      await stageModels({
        models: [model({ blake3: digest })],
        installPath: install,
        governance,
        jobs: verifiedJobs({ 'm.safetensors': bytes })
      })
      expect(readFileSpy).not.toHaveBeenCalled()
    } finally {
      readFileSpy.mockRestore()
    }

    expect(
      fs.readFileSync(path.join(installModelsRoot(install), 'checkpoints', 'm.safetensors'))
    ).toEqual(bytes)
    expect(fs.existsSync(modelLedgerPath(install))).toBe(false)
  })

  it('leaves a complete old or new ledger when publication crashes', async () => {
    const realRename = fs.promises.rename.bind(fs.promises)

    for (const publishBeforeCrash of [false, true]) {
      const install = freshInstall()
      const oldFile = path.join(installModelsRoot(install), 'checkpoints', 'old.safetensors')
      const newFile = path.join(installModelsRoot(install), 'checkpoints', 'new.safetensors')
      fs.mkdirSync(path.dirname(oldFile), { recursive: true })
      fs.writeFileSync(oldFile, 'old')
      fs.writeFileSync(newFile, 'new')
      const oldEntry = await createModelLedgerEntry(oldFile, `blake3:${'1'.repeat(64)}`)
      const newEntry = await createModelLedgerEntry(newFile, `blake3:${'2'.repeat(64)}`)
      await writeModelLedger(install, [oldEntry])

      const renameSpy = vi.spyOn(fs.promises, 'rename').mockImplementationOnce(async (from, to) => {
        if (publishBeforeCrash) await realRename(from, to)
        throw new Error('simulated crash during ledger publication')
      })
      try {
        await expect(writeModelLedger(install, [newEntry])).rejects.toThrow(/simulated crash/)
      } finally {
        renameSpy.mockRestore()
      }

      expect(await readModelLedger(install)).toEqual({
        ledgerVersion: 1,
        entries: publishBeforeCrash ? [newEntry] : [oldEntry]
      })
    }
  })

  it('matches the shared Python ModelLedgerKey tuple field order, units, and wire types', async () => {
    const install = freshInstall()
    const ledgerPath = modelLedgerPath(install)
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true })
    fs.writeFileSync(ledgerPath, JSON.stringify(sharedModelLedgerFixture.ledger))

    const ledger = await readModelLedger(install)
    expect(ledger).not.toBeNull()
    const entry = ledger!.entries[0]!
    expect([entry.path, entry.size, entry.mtimeNs, entry.inode, entry.dev]).toEqual(
      sharedModelLedgerFixture.modelLedgerKey
    )
    expect(Object.keys(ledger!)).toEqual(['ledgerVersion', 'entries'])
    expect(Object.keys(entry)).toEqual(['path', 'size', 'mtimeNs', 'inode', 'dev', 'digest'])
    expect(typeof entry.size).toBe('number')
    expect([typeof entry.mtimeNs, typeof entry.inode, typeof entry.dev]).toEqual([
      'string',
      'string',
      'string'
    ])
  })

  it('starts a freshly installed Builder archive without a ledger and creates it only after staging', async () => {
    const install = freshInstall()
    const bytes = Buffer.from('fresh-archive-model')
    const digest = `blake3:${blake(bytes)}`
    const governance = configureGovernedInstall(install, [digest])

    expect(fs.existsSync(modelLedgerPath(install))).toBe(false)
    await stageModels({
      models: [model({ blake3: digest })],
      installPath: install,
      governance,
      jobs: verifiedJobs({ 'm.safetensors': bytes })
    })
    expect(fs.existsSync(modelLedgerPath(install))).toBe(true)
  })
})
