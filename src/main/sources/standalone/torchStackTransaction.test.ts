// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'events'
import fs from 'fs'
import os from 'os'
import path from 'path'

vi.mock('electron', () => ({
  app: { getPath: () => '' },
}))

interface FakeChild extends EventEmitter {
  pid: number | undefined
  stdout: EventEmitter
  stderr: EventEmitter
}

function makeFakeChild(pid: number | undefined): FakeChild {
  const child = new EventEmitter() as FakeChild
  child.pid = pid
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  return child
}

let fakeChild: FakeChild

vi.mock('child_process', async (importOriginal) => {
  const actual: object = await importOriginal()
  return {
    ...actual,
    spawn: vi.fn(() => fakeChild),
  }
})

import { applyTorchStackTransaction, runStreamed, undeclaredFamilyPackages } from './torchStackTransaction'
import type { PreparedBundleStack } from './torchStackTransaction'
import type { TorchStackEntry } from './torchStackCatalog'
import type { InstallationRecord } from '../../installations'

const tools = {
  sendProgress: (): void => {},
  update: async (): Promise<void> => {},
}

/** Whether the promise has settled yet, sampled without awaiting it. */
async function settled(p: Promise<unknown>): Promise<boolean> {
  let done = false
  void p.then(() => { done = true }, () => { done = true })
  // Give already-queued reactions a chance to run.
  await new Promise((r) => setImmediate(r))
  return done
}

describe('runStreamed', () => {
  it('resolves on exit code 0', async () => {
    fakeChild = makeFakeChild(1234)
    const p = runStreamed('uv', [], 'failed', tools)
    fakeChild.emit('close', 0)
    await expect(p).resolves.toBeUndefined()
  })

  it('rejects with the fail message on a non-zero exit code', async () => {
    fakeChild = makeFakeChild(1234)
    const p = runStreamed('uv', [], 'pip install failed', tools)
    fakeChild.emit('close', 3)
    await expect(p).rejects.toThrow('pip install failed (exit code 3)')
  })

  it('does not settle on abort until the child has actually exited', async () => {
    fakeChild = makeFakeChild(1234)
    const p = runStreamed('uv', [], 'failed', tools)

    // Abort surfaces as an 'error' event while the process is still dying.
    // Settling here would let the caller start rollback against a venv that
    // a live pip/uv still holds locks in.
    fakeChild.emit('error', new Error('The operation was aborted'))
    expect(await settled(p)).toBe(false)

    fakeChild.emit('close', null)
    expect(await settled(p)).toBe(true)
    await expect(p).rejects.toThrow('The operation was aborted')
  })

  it('rejects immediately on a spawn failure (no pid, close never fires)', async () => {
    fakeChild = makeFakeChild(undefined)
    const p = runStreamed('does-not-exist', [], 'failed', tools)
    fakeChild.emit('error', new Error('spawn does-not-exist ENOENT'))
    await expect(p).rejects.toThrow('ENOENT')
  })
})

describe('undeclaredFamilyPackages', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'torchstack-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function distInfo(name: string, version: string): void {
    const dir = path.join(tmpDir, `${name}-${version}.dist-info`)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'METADATA'), `Name: ${name}\nVersion: ${version}\n`)
  }

  it('lists installed optional family packages the tuple omits', () => {
    distInfo('torch', '2.10.0+cu126')
    distInfo('torchvision', '0.25.0+cu126')
    distInfo('torchaudio', '2.10.0+cu126')
    expect(undeclaredFamilyPackages({ torch: '2.11.0+cu126' }, tmpDir).sort()).toEqual([
      'torchaudio', 'torchvision'
    ])
  })

  it('keeps optional packages the tuple declares', () => {
    distInfo('torchvision', '0.25.0+cu126')
    expect(
      undeclaredFamilyPackages({ torch: '2.11.0+cu126', torchvision: '0.26.0+cu126' }, tmpDir)
    ).toEqual([])
  })

  it('ignores optional packages that are not installed', () => {
    expect(undeclaredFamilyPackages({ torch: '2.11.0+cu126' }, tmpDir)).toEqual([])
  })

  it('returns [] when the site dir is unknown', () => {
    expect(undeclaredFamilyPackages({ torch: '2.11.0+cu126' }, null)).toEqual([])
  })
})

describe('applyTorchStackTransaction (bundle path, real fs)', () => {
  let tmpDir: string
  let installPath: string
  let venvDir: string
  let venvSite: string
  let stagingDir: string
  let srcSite: string

  const sitePathIn = (venv: string): string =>
    process.platform === 'win32'
      ? path.join(venv, 'Lib', 'site-packages')
      : path.join(venv, 'lib', 'python3.12', 'site-packages')

  function distInfoIn(site: string, name: string, version: string): void {
    const dir = path.join(site, `${name}-${version}.dist-info`)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'METADATA'), `Name: ${name}\nVersion: ${version}\n`)
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'torchtxn-test-'))
    installPath = path.join(tmpDir, 'install')
    venvDir = path.join(installPath, 'ComfyUI', '.venv')
    venvSite = sitePathIn(venvDir)
    fs.mkdirSync(venvSite, { recursive: true })
    // Original venv contents: old torch payload + a non-torch survivor.
    distInfoIn(venvSite, 'torch', '2.1.0')
    fs.mkdirSync(path.join(venvSite, 'torch'), { recursive: true })
    fs.writeFileSync(path.join(venvSite, 'torch', 'old-payload.py'), 'old')
    fs.writeFileSync(path.join(venvSite, 'unrelated.py'), 'keep me')

    // Bundle payload staging: the new torch family.
    stagingDir = path.join(tmpDir, 'staging')
    srcSite = path.join(stagingDir, 'site-packages')
    fs.mkdirSync(srcSite, { recursive: true })
    distInfoIn(srcSite, 'torch', '2.9.9')
    fs.mkdirSync(path.join(srcSite, 'torch'), { recursive: true })
    fs.writeFileSync(path.join(srcSite, 'torch', 'new-payload.py'), 'new')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function makeInstallation(): InstallationRecord {
    return {
      id: 'txn-test',
      installPath,
      lastVerifiedTorchStack: { stackId: 'comfy-bundle:win-cpu:old-env' },
    } as unknown as InstallationRecord
  }

  function makePrepared(): PreparedBundleStack {
    const entry: TorchStackEntry = {
      stackId: 'comfy-bundle:win-cpu:test-env',
      variant: 'win-cpu',
      pythonVersion: '3.12.9',
      packages: { torch: '2.9.9' },
      source: { kind: 'comfy-bundle', variant: 'win-cpu', bundleTag: 'test-env' },
      date: '2026-01-01',
      comfyuiVersion: '0.0.0',
    }
    return { kind: 'bundle', srcSite, stagingDir, entry }
  }

  it('rolls the venv back intact and leaves stack metadata untouched when verification fails', async () => {
    // The graft succeeds (dist-info matches the tuple) but the venv has no
    // python interpreter, so verifyStack fails AFTER mutation - exercising
    // the full rollback path.
    const update = vi.fn(async () => {})
    const result = await applyTorchStackTransaction(makeInstallation(), makePrepared(), {
      sendProgress: () => {}, update,
    })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('the previous environment was restored')

    // Original venv is back byte-for-byte in shape: old dist-info + payload
    // restored, grafted new stack gone, non-torch file intact.
    expect(fs.existsSync(path.join(venvSite, 'torch-2.1.0.dist-info'))).toBe(true)
    expect(fs.existsSync(path.join(venvSite, 'torch-2.9.9.dist-info'))).toBe(false)
    expect(fs.readFileSync(path.join(venvSite, 'torch', 'old-payload.py'), 'utf-8')).toBe('old')
    expect(fs.existsSync(path.join(venvSite, 'torch', 'new-payload.py'))).toBe(false)
    expect(fs.readFileSync(path.join(venvSite, 'unrelated.py'), 'utf-8')).toBe('keep me')

    // No transaction debris: backup renamed back, no gc dir, journal removed.
    expect(fs.existsSync(venvDir + '.torch-backup')).toBe(false)
    expect(fs.existsSync(venvDir + '.torch-gc')).toBe(false)
    expect(fs.existsSync(path.join(installPath, '.torch-stack-journal.json'))).toBe(false)

    // The new stack ref must never be persisted - a rolled-back venv with
    // the new ref recorded would hand repair a false acquisition source. The
    // rollback path re-persists the PRIOR refs (an idempotent reset that also
    // covers a failure landing after the step-7 persist).
    for (const call of update.mock.calls as unknown as Array<[Record<string, unknown>]>) {
      const persisted = call[0]['lastVerifiedTorchStack'] as { stackId?: string } | null
      expect(persisted?.stackId).not.toBe('comfy-bundle:win-cpu:test-env')
    }
    expect(update).toHaveBeenLastCalledWith({
      lastVerifiedTorchStack: { stackId: 'comfy-bundle:win-cpu:old-env' },
      observedTorchStack: null,
    })

    // The staging dir is always cleaned up.
    expect(fs.existsSync(stagingDir)).toBe(false)
  })

  it('does not touch the venv when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const update = vi.fn(async () => {})
    const result = await applyTorchStackTransaction(makeInstallation(), makePrepared(), {
      sendProgress: () => {}, update, signal: controller.signal,
    })

    expect(result.ok).toBe(false)
    expect(result.message).toBe('Cancelled')
    expect(fs.existsSync(path.join(venvSite, 'torch-2.1.0.dist-info'))).toBe(true)
    expect(fs.existsSync(venvDir + '.torch-backup')).toBe(false)
    expect(fs.existsSync(path.join(installPath, '.torch-stack-journal.json'))).toBe(false)
    expect(update).not.toHaveBeenCalled()
  })

  it('refuses to start over the backup debris of a previous unfinished run', async () => {
    fs.mkdirSync(venvDir + '.torch-backup', { recursive: true })
    const update = vi.fn(async () => {})
    const result = await applyTorchStackTransaction(makeInstallation(), makePrepared(), {
      sendProgress: () => {}, update,
    })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('did not finish')
    // The live venv and the recovery-owned backup are both untouched.
    expect(fs.existsSync(path.join(venvSite, 'torch-2.1.0.dist-info'))).toBe(true)
    expect(fs.existsSync(venvDir + '.torch-backup')).toBe(true)
    expect(update).not.toHaveBeenCalled()
  })
})
