// @vitest-environment node
import { createHash } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Stub the heavy libs so importing `./models` (via `./install`) does not pull
// Electron. Every test injects its own `download`, so the real one is unused.
vi.mock('../lib/download', () => ({ download: vi.fn() }))
vi.mock('../lib/extract', () => ({ extractNested: vi.fn() }))

import { stageModels, installModelsRoot } from './models'
import type { ModelDescriptor } from './types'

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

/** A download stub that writes `bytes` to the requested path (the `.partial`). */
function fakeDownload(bytes: Buffer) {
  return vi.fn(async (_url: string, dest: string) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, bytes)
    return dest
  })
}

const model = (o: Partial<ModelDescriptor> = {}): ModelDescriptor => ({
  type: 'checkpoints',
  filename: 'm.safetensors',
  downloadUrl: 'https://models.test/m.safetensors',
  ...o
})

describe('stageModels', () => {
  it('downloads, verifies, and places each model at models/<type>/<filename>', async () => {
    const install = freshInstall()
    const bytes = Buffer.from('weights-A')
    const dl = fakeDownload(bytes)
    await stageModels({
      models: [
        model({ type: 'vae', filename: 'v.pt', sha256: sha(bytes), downloadUrl: 'https://x/v.pt' })
      ],
      installPath: install,
      download: dl
    })
    const dest = path.join(installModelsRoot(install), 'vae', 'v.pt')
    expect(fs.existsSync(dest)).toBe(true)
    expect(fs.readFileSync(dest)).toEqual(bytes)
    expect(fs.existsSync(`${dest}.partial`)).toBe(false)
  })

  it('fails with checksum-mismatch and leaves no file when bytes do not match the hash', async () => {
    const install = freshInstall()
    const dl = fakeDownload(Buffer.from('corrupt'))
    await expect(
      stageModels({
        models: [model({ sha256: sha(Buffer.from('expected')) })],
        installPath: install,
        download: dl
      })
    ).rejects.toMatchObject({ kind: 'model-checksum-mismatch' })
    const dest = path.join(installModelsRoot(install), 'checkpoints', 'm.safetensors')
    expect(fs.existsSync(dest)).toBe(false)
    expect(fs.existsSync(`${dest}.partial`)).toBe(false)
  })

  it('installs without verification when the model has no sha256', async () => {
    const install = freshInstall()
    const dl = fakeDownload(Buffer.from('unverified'))
    await stageModels({ models: [model({ filename: 'n.pt' })], installPath: install, download: dl })
    expect(fs.existsSync(path.join(installModelsRoot(install), 'checkpoints', 'n.pt'))).toBe(true)
  })

  it.each([
    ['type', { type: '../evil' }],
    ['type sep', { type: 'a/b' }],
    ['filename', { filename: '../../etc/passwd' }],
    ['filename sep', { filename: 'a/b.pt' }]
  ])('rejects an unsafe %s before any download', async (_name, bad) => {
    const install = freshInstall()
    const dl = fakeDownload(Buffer.from('x'))
    await expect(
      stageModels({ models: [model(bad)], installPath: install, download: dl })
    ).rejects.toMatchObject({
      kind: 'invalid-model'
    })
    expect(dl).not.toHaveBeenCalled()
  })

  it('rejects a non-https download URL before any download', async () => {
    const install = freshInstall()
    const dl = fakeDownload(Buffer.from('x'))
    await expect(
      stageModels({
        models: [model({ downloadUrl: 'http://insecure/m.safetensors' })],
        installPath: install,
        download: dl
      })
    ).rejects.toMatchObject({ kind: 'invalid-model' })
    expect(dl).not.toHaveBeenCalled()
  })

  it('refuses to write through a model dir that symlinks outside the install', async () => {
    const install = freshInstall()
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-escape-'))
    tmpRoots.push(outside)
    // A malicious archive ships ComfyUI/models/<type> as a symlink escaping the install.
    const modelsRoot = installModelsRoot(install)
    fs.mkdirSync(modelsRoot, { recursive: true })
    fs.symlinkSync(outside, path.join(modelsRoot, 'evil'))
    const dl = fakeDownload(Buffer.from('payload'))
    await expect(
      stageModels({
        models: [model({ type: 'evil', filename: 'x.pth' })],
        installPath: install,
        download: dl
      })
    ).rejects.toMatchObject({ kind: 'invalid-model' })
    // Nothing was written into the escape target.
    expect(fs.existsSync(path.join(outside, 'x.pth'))).toBe(false)
    expect(fs.existsSync(path.join(outside, 'x.pth.partial'))).toBe(false)
  })

  it('skips a model already present with a matching hash (idempotent re-run)', async () => {
    const install = freshInstall()
    const bytes = Buffer.from('already-here')
    const dest = path.join(installModelsRoot(install), 'loras', 'l.safetensors')
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, bytes)
    const dl = fakeDownload(Buffer.from('should-not-run'))
    await stageModels({
      models: [model({ type: 'loras', filename: 'l.safetensors', sha256: sha(bytes) })],
      installPath: install,
      download: dl
    })
    expect(dl).not.toHaveBeenCalled()
    expect(fs.readFileSync(dest)).toEqual(bytes)
  })

  it('re-fetches a present-but-wrong file instead of trusting bad bytes', async () => {
    const install = freshInstall()
    const good = Buffer.from('good-bytes')
    const dest = path.join(installModelsRoot(install), 'checkpoints', 'm.safetensors')
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, Buffer.from('stale-wrong'))
    const dl = fakeDownload(good)
    await stageModels({
      models: [model({ sha256: sha(good) })],
      installPath: install,
      download: dl
    })
    expect(dl).toHaveBeenCalledTimes(1)
    expect(fs.readFileSync(dest)).toEqual(good)
  })

  it('reports per-model progress with a 1-based index and total', async () => {
    const install = freshInstall()
    const seen: Array<{ index: number; total: number; percent: number }> = []
    await stageModels({
      models: [model({ filename: 'a.pt' }), model({ filename: 'b.pt' })],
      installPath: install,
      download: fakeDownload(Buffer.from('z')),
      onProgress: (p) => seen.push({ index: p.index, total: p.total, percent: p.percent })
    })
    expect(seen.some((s) => s.index === 1 && s.total === 2)).toBe(true)
    expect(seen.some((s) => s.index === 2 && s.total === 2 && s.percent === 100)).toBe(true)
  })

  it('honors an already-aborted signal', async () => {
    const install = freshInstall()
    const dl = fakeDownload(Buffer.from('x'))
    await expect(
      stageModels({
        models: [model()],
        installPath: install,
        download: dl,
        signal: AbortSignal.abort()
      })
    ).rejects.toThrow(/cancel/i)
    expect(dl).not.toHaveBeenCalled()
  })
})
