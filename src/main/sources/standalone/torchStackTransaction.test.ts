// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'events'
import fs from 'fs'
import os from 'os'
import path from 'path'

vi.mock('electron', () => ({
  app: { getPath: () => '' }
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
    spawn: vi.fn(() => fakeChild)
  }
})

import {
  applyBundleGraft,
  applyTorchStackTransaction,
  runStreamed,
  undeclaredFamilyPackages,
  preparePipStack,
  pipInstallSpecs,
  pipIndexArgs,
  planPipReconciliation,
  amdOverlayCoherenceError,
  preflightDiskSpace,
  DiskSpaceError
} from './torchStackTransaction'
import { AMD_MULTI_ARCH_INDEX_URL } from './torchStackTypes'
import type { PreparedBundleStack, PreparedPipStack } from './torchStackTransaction'
import type { TorchStackEntry } from './torchStackCatalog'
import type { TorchStackPackages } from './torchStackTypes'
import type { InstallationRecord } from '../../installations'

const tools = {
  sendProgress: (): void => {},
  update: async (): Promise<void> => {}
}

/** Whether the promise has settled yet, sampled without awaiting it. */
async function settled(p: Promise<unknown>): Promise<boolean> {
  let done = false
  void p.then(
    () => {
      done = true
    },
    () => {
      done = true
    }
  )
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
      'torchaudio',
      'torchvision'
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

describe('planPipReconciliation', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'torchstack-rocm-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function distInfo(name: string, version: string): void {
    const dir = path.join(tmpDir, `${name}-${version}.dist-info`)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'METADATA'), `Name: ${name}\nVersion: ${version}\n`)
  }

  const multiArch = (
    packages: TorchStackPackages
  ): Pick<PreparedPipStack, 'packages' | 'source'> => ({
    packages,
    source: { kind: 'amd-multi-arch-index', indexTag: 'rocm7.14.0' }
  })
  const pytorchIndex = (
    packages: TorchStackPackages
  ): Pick<PreparedPipStack, 'packages' | 'source'> => ({
    packages,
    source: { kind: 'pytorch-index', backend: 'rocm', indexTag: 'rocm7.1' }
  })
  const fullTuple: TorchStackPackages = {
    torch: '2.12.0+rocm7.14.0',
    torchvision: '0.27.0+rocm7.14.0',
    torchaudio: '2.11.0+rocm7.14.0'
  }

  it('entering multi-arch sweeps the universal SDK packages and a pytorch.org triton-rocm', () => {
    // pip writes `rocm_sdk_core-7.2.1.dist-info` (underscores) for the
    // package named rocm-sdk-core.
    distInfo('rocm_sdk_core', '7.2.1')
    distInfo('rocm_sdk_devel', '7.2.1')
    distInfo('rocm_bootstrap', '7.2.1')
    distInfo('rocm', '7.2.1')
    distInfo('triton_rocm', '3.6.0')
    // Core dists are removed too - pip would otherwise keep a same-version
    // wheel from the other index (torch is declared by the target).
    distInfo('torch', '2.9.1+rocm7.2.1')
    const plan = planPipReconciliation(multiArch(fullTuple), tmpDir)
    expect(plan.removals.sort()).toEqual([
      'rocm',
      'rocm_bootstrap',
      'rocm_sdk_core',
      'rocm_sdk_devel',
      'torch',
      'triton-rocm'
    ])
    expect(plan.expectAbsent.sort()).toEqual(['pytorch-triton-rocm', 'triton-rocm'])
  })

  it('entering multi-arch also sweeps the older pytorch-triton-rocm name', () => {
    distInfo('pytorch_triton_rocm', '3.5.0')
    const plan = planPipReconciliation(multiArch(fullTuple), tmpDir)
    expect(plan.removals).toEqual(['pytorch-triton-rocm'])
    expect(plan.expectAbsent.sort()).toEqual(['pytorch-triton-rocm', 'triton-rocm'])
  })

  it('a same-version cross-index switch removes the installed core tuple so pip must reinstall from the target index', () => {
    // pip/uv treat an installed wheel of the requested version as satisfied
    // regardless of source index; without the removal the pytorch.org wheel
    // would survive an identical-tuple switch to the AMD index (and vice
    // versa).
    distInfo('torch', '2.12.0+rocm7.14.0')
    distInfo('torchvision', '0.27.0+rocm7.14.0')
    distInfo('torchaudio', '2.11.0+rocm7.14.0')
    const into = planPipReconciliation(multiArch(fullTuple), tmpDir)
    expect(into.removals.sort()).toEqual(['torch', 'torchaudio', 'torchvision'])

    distInfo('amd_torch_device_gfx1100', '2.12.0+rocm7.14.0')
    const outOf = planPipReconciliation(pytorchIndex(fullTuple), tmpDir)
    expect(outOf.removals).toEqual(expect.arrayContaining(['torch', 'torchvision', 'torchaudio']))
    // The target reinstalls the core tuple, so it is NOT asserted absent.
    expect(outOf.expectAbsent).not.toEqual(expect.arrayContaining(['torch']))
    expect(outOf.expectAbsent).toEqual(['amd_torch_device_gfx1100'])
  })

  it('multi-arch minor-to-minor sweeps device overlays so obsolete ones cannot survive', () => {
    distInfo('rocm', '7.14.0')
    distInfo('rocm_sdk_core', '7.14.0')
    distInfo('rocm_sdk_device_gfx1100', '7.14.0')
    distInfo('amd_torch_device_gfx1100', '2.11.0+rocm7.14.0')
    distInfo('amd_torch_device_gfx1250', '2.11.0+rocm7.14.0')
    distInfo('amd_torchvision_device_gfx1100', '0.26.0+rocm7.14.0')
    const plan = planPipReconciliation(multiArch(fullTuple), tmpDir)
    expect(plan.removals.sort()).toEqual([
      'amd_torch_device_gfx1100',
      'amd_torch_device_gfx1250',
      'amd_torchvision_device_gfx1100',
      'rocm',
      'rocm_sdk_core',
      'rocm_sdk_device_gfx1100'
    ])
    expect(plan.expectAbsent.sort()).toEqual(['pytorch-triton-rocm', 'triton-rocm'])
  })

  it('leaving multi-arch sweeps the whole ecosystem plus AMD triton and asserts the ecosystem stays gone', () => {
    distInfo('rocm', '7.14.0')
    distInfo('rocm_bootstrap', '0.1.0')
    distInfo('rocm_sdk_core', '7.14.0')
    distInfo('rocm_sdk_device_gfx1100', '7.14.0')
    distInfo('amd_torch_device_gfx1100', '2.11.0+rocm7.14.0')
    distInfo('amd_torchvision_device_gfx1100', '0.26.0+rocm7.14.0')
    distInfo('triton', '3.7.1+git0263a6a6.rocm7.14.0')
    const plan = planPipReconciliation(
      pytorchIndex({
        torch: '2.10.0+rocm7.1',
        torchvision: '0.25.0+rocm7.1',
        torchaudio: '2.10.0+rocm7.1'
      }),
      tmpDir
    )
    const ecosystem = [
      'amd_torch_device_gfx1100',
      'amd_torchvision_device_gfx1100',
      'rocm',
      'rocm_bootstrap',
      'rocm_sdk_core',
      'rocm_sdk_device_gfx1100'
    ]
    expect(plan.removals.sort()).toEqual([...ecosystem, 'triton'].sort())
    // triton is removed but NOT asserted absent: the target's own dependency
    // tree may legitimately reinstall a triton build.
    expect(plan.expectAbsent.sort()).toEqual(ecosystem)
  })

  it('a non-multi-arch venv on a non-multi-arch target gets no ecosystem sweep', () => {
    // Universal SDK packages without device overlays (e.g. an observed-tuple
    // restore of the universal stack) must be left to the target dependency
    // tree, which references them.
    distInfo('rocm', '7.2.1')
    distInfo('rocm_sdk_core', '7.2.1')
    distInfo('triton_rocm', '3.6.0')
    const plan = planPipReconciliation(
      {
        packages: {
          torch: '2.9.1+rocm7.2.1',
          torchvision: '0.24.1+rocm7.2.1',
          torchaudio: '2.9.1+rocm7.2.1'
        },
        source: null
      },
      tmpDir
    )
    expect(plan.removals).toEqual([])
    expect(plan.expectAbsent).toEqual([])
  })

  it('still reconciles undeclared family packages and declares omitted optionals absent', () => {
    distInfo('torchvision', '0.26.0+cu126')
    const plan = planPipReconciliation(
      { packages: { torch: '2.11.0+cu126' }, source: null },
      tmpDir
    )
    expect(plan.removals).toEqual(['torchvision'])
    expect(plan.expectAbsent.sort()).toEqual(['torchaudio', 'torchvision'])
  })

  it('handles an unknown site dir', () => {
    const plan = planPipReconciliation(multiArch(fullTuple), null)
    expect(plan.removals).toEqual([])
    expect(plan.expectAbsent).toEqual([])
  })
})

describe('amdOverlayCoherenceError', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'torchstack-overlay-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function distInfo(name: string, version: string): void {
    fs.mkdirSync(path.join(tmpDir, `${name}-${version}.dist-info`), { recursive: true })
  }

  const packages: TorchStackPackages = {
    torch: '2.12.0+rocm7.14.0',
    torchvision: '0.27.0+rocm7.14.0',
    torchaudio: '2.11.0+rocm7.14.0'
  }

  it('passes when every overlay tracks the core tuple', () => {
    distInfo('amd_torch_device_gfx1100', '2.12.0+rocm7.14.0')
    distInfo('amd_torchvision_device_gfx1100', '0.27.0+rocm7.14.0')
    distInfo('rocm_sdk_device_gfx1100', '7.14.0') // not an amd-* overlay; unversioned vs tuple
    expect(amdOverlayCoherenceError(tmpDir, packages)).toBeNull()
  })

  it('flags a torch overlay left at another minor', () => {
    distInfo('amd_torch_device_gfx1100', '2.12.0+rocm7.14.0')
    distInfo('amd_torch_device_gfx110x', '2.11.0+rocm7.14.0')
    expect(amdOverlayCoherenceError(tmpDir, packages)).toContain('amd_torch_device_gfx110x')
  })

  it('flags a torchvision overlay against the torchvision version, not torch', () => {
    distInfo('amd_torchvision_device_gfx1100', '0.26.0+rocm7.14.0')
    expect(amdOverlayCoherenceError(tmpDir, packages)).toContain('amd_torchvision_device_gfx1100')
  })

  it('flags an overlay missing the ROCm local tag - AMD overlays always carry the full core version', () => {
    distInfo('amd_torch_device_gfx1100', '2.12.0')
    expect(amdOverlayCoherenceError(tmpDir, packages)).toContain('amd_torch_device_gfx1100')
  })

  it('flags an overlay for a package the target does not declare', () => {
    distInfo('amd_torchvision_device_gfx1100', '0.27.0+rocm7.14.0')
    expect(amdOverlayCoherenceError(tmpDir, { torch: '2.12.0+rocm7.14.0' })).toContain(
      'declares no torchvision'
    )
  })

  it('ignores unrelated dists and unreadable dirs', () => {
    distInfo('torch', '2.12.0+rocm7.14.0')
    expect(amdOverlayCoherenceError(tmpDir, packages)).toBeNull()
    expect(amdOverlayCoherenceError(path.join(tmpDir, 'missing'), packages)).toBeNull()
  })
})

describe('preparePipStack / pipInstallSpecs', () => {
  const amdEntry: TorchStackEntry = {
    stackId: 'amd-index:rocm7.14.0:2.10.0',
    variant: 'win-amd',
    pythonVersion: '',
    packages: {
      torch: '2.10.0+rocm7.14.0',
      torchvision: '0.25.0+rocm7.14.0',
      torchaudio: '2.10.0+rocm7.14.0'
    },
    source: { kind: 'amd-multi-arch-index', indexTag: 'rocm7.14.0' },
    date: '2026-07-15',
    comfyuiVersion: ''
  }

  it('carries the AMD source and derives the hardcoded AMD index from it', () => {
    const prepared = preparePipStack(amdEntry.packages, amdEntry)
    expect(prepared.source).toEqual({ kind: 'amd-multi-arch-index', indexTag: 'rocm7.14.0' })
    expect(prepared.indexUrl).toBe(AMD_MULTI_ARCH_INDEX_URL)
    // The rocm tag still asserts AMD accelerator evidence at verify time.
    expect(prepared.accelVariant).toBe('amd')
  })

  it('derives the tag index for an entry-less (observed tuple) restore', () => {
    const prepared = preparePipStack({ torch: '2.10.0+cu130' }, null)
    expect(prepared.source).toBeNull()
    expect(prepared.indexUrl).toBe('https://download.pytorch.org/whl/cu130')
  })

  it('adds [device-all] to torch and torchvision only for AMD multi-arch', () => {
    expect(pipInstallSpecs(preparePipStack(amdEntry.packages, amdEntry))).toEqual([
      'torch[device-all]==2.10.0+rocm7.14.0',
      'torchvision[device-all]==0.25.0+rocm7.14.0',
      'torchaudio==2.10.0+rocm7.14.0'
    ])
  })

  it('leaves ordinary sources on bare pins', () => {
    expect(
      pipInstallSpecs(preparePipStack({ torch: '2.11.0+cu130', torchvision: '0.26.0+cu130' }, null))
    ).toEqual(['torch==2.11.0+cu130', 'torchvision==0.26.0+cu130'])
  })

  it('passes AMD as the EXTRA index over a default-PyPI --index-url, in exactly that order', () => {
    // uv gives --extra-index-url priority over --index-url (first-index
    // strategy): were AMD the --index-url, uv would resolve the torch
    // project against PyPI (the extra) and fail the +rocm pins.
    expect(pipIndexArgs(preparePipStack(amdEntry.packages, amdEntry))).toEqual([
      '--index-url',
      'https://pypi.org/simple',
      '--extra-index-url',
      AMD_MULTI_ARCH_INDEX_URL
    ])
  })

  it('passes the derived index alone for ordinary sources, and nothing for PyPI tuples', () => {
    expect(pipIndexArgs(preparePipStack({ torch: '2.11.0+cu130' }, null))).toEqual([
      '--index-url',
      'https://download.pytorch.org/whl/cu130'
    ])
    expect(pipIndexArgs(preparePipStack({ torch: '2.11.0' }, null))).toEqual([])
  })
})

describe('preflightDiskSpace (pip estimates)', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'torchstack-disk-test-'))
    fs.mkdirSync(path.join(tmpDir, 'ComfyUI', '.venv'), { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // The machine's real free space decides pass/fail; the estimate under
  // test is visible either way (result or DiskSpaceError both carry it).
  async function requiredBytesFor(
    opts?: Parameters<typeof preflightDiskSpace>[3]
  ): Promise<number> {
    const installation = { id: 'disk-test', installPath: tmpDir } as unknown as InstallationRecord
    try {
      return (await preflightDiskSpace(installation, null, undefined, opts)).requiredBytes
    } catch (err) {
      if (err instanceof DiskSpaceError) return err.requiredBytes
      throw err
    }
  }

  it('charges the larger AMD multi-arch staging estimate only for that source', async () => {
    const generic = await requiredBytesFor()
    const pytorchIndex = await requiredBytesFor({
      pipSource: { kind: 'pytorch-index', backend: 'cuda', indexTag: 'cu130' }
    })
    const amd = await requiredBytesFor({
      pipSource: { kind: 'amd-multi-arch-index', indexTag: 'rocm7.14.0' }
    })
    expect(pytorchIndex).toBe(generic)
    // 24 GiB AMD estimate vs the 8 GiB generic pip fallback.
    expect(amd - generic).toBeGreaterThanOrEqual(16 * 1024 ** 3)
  })
})

describe('applyBundleGraft (real fs)', () => {
  let tmpDir: string
  let srcSite: string
  let dstSite: string

  function fileIn(root: string, ...segments: string[]): void {
    const p = path.join(root, ...segments)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, 'x')
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundlegraft-test-'))
    srcSite = path.join(tmpDir, 'src')
    dstSite = path.join(tmpDir, 'dst')
    fs.mkdirSync(srcSite, { recursive: true })
    fs.mkdirSync(dstSite, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('switches an AMD multi-arch venv back to the universal bundle: SDK payloads grafted, multi-arch leftovers swept', async () => {
    // Universal ROCm 7.2.1 bundle: torch family + rocm dist metadata, pure
    // shims, and the `_`-prefixed SDK payload packages find_libraries needs.
    for (const name of [
      'torch',
      'torch-2.9.1+rocm7.2.1.dist-info',
      'torchvision',
      'torchvision-0.24.1+rocm7.2.1.dist-info',
      'torchaudio',
      'torchaudio-2.9.1+rocm7.2.1.dist-info',
      'rocm_sdk',
      'rocm-7.2.1.dist-info',
      'rocm_sdk_core',
      '_rocm_sdk_core',
      'rocm_sdk_core-7.2.1.dist-info',
      'rocm_sdk_devel',
      '_rocm_sdk_devel',
      'rocm_sdk_devel-7.2.1.dist-info',
      'rocm_sdk_libraries',
      '_rocm_sdk_libraries_custom',
      'rocm_sdk_libraries_custom-7.2.1.dist-info'
    ])
      fileIn(srcSite, name, 'FILE')
    fileIn(srcSite, '_rocm_sdk_libraries_custom', 'bin', 'hipblas.dll')

    // Venv on the multi-arch 7.14 stack, exactly as the forward switch
    // leaves it - including AMD's device-overlay .kpack payload inside
    // torch/ and unrelated packages that must survive.
    for (const name of [
      'torch',
      'torch-2.11.0+rocm7.14.0.dist-info',
      'torchvision',
      'torchvision-0.26.0+rocm7.14.0.dist-info',
      'torchaudio',
      'torchaudio-2.11.0+rocm7.14.0.dist-info',
      'rocm_sdk',
      'rocm-7.14.0.dist-info',
      'rocm_bootstrap',
      'rocm_bootstrap-0.1.0.dist-info',
      'rocm_sdk_core',
      '_rocm_sdk_core',
      'rocm_sdk_core-7.14.0.dist-info',
      'rocm_sdk_libraries',
      '_rocm_sdk_libraries',
      'rocm_sdk_libraries-7.14.0.dist-info',
      'rocm_sdk_device',
      '_rocm_sdk_device_gfx1100',
      'rocm_sdk_device_gfx1100-7.14.0.dist-info',
      'amd_torch_device_gfx1100-2.11.0+rocm7.14.0.dist-info',
      'amd_torchvision_device_gfx1100-0.26.0+rocm7.14.0.dist-info'
    ])
      fileIn(dstSite, name, 'FILE')
    fileIn(dstSite, 'torch', '.kpack', 'torch_gfx1100.kpack')
    fileIn(dstSite, 'torchvision', '.kpack', 'torchvision_gfx1100.kpack')
    fileIn(dstSite, 'torchsde', 'FILE')
    fileIn(dstSite, 'torchsde-0.2.6.dist-info', 'FILE')
    fileIn(dstSite, 'numpy', 'FILE')

    const entry: TorchStackEntry = {
      stackId: 'comfy-bundle:win-amd:old-env',
      variant: 'win-amd',
      pythonVersion: '3.12.9',
      packages: {
        torch: '2.9.1+rocm7.2.1',
        torchvision: '0.24.1+rocm7.2.1',
        torchaudio: '2.9.1+rocm7.2.1'
      },
      source: { kind: 'comfy-bundle', variant: 'win-amd', bundleTag: 'old-env' },
      date: '2026-01-01',
      comfyuiVersion: '0.0.0'
    }
    const removed = await applyBundleGraft(
      { kind: 'bundle', srcSite, stagingDir: tmpDir, entry },
      dstSite
    )

    // Universal SDK payload is complete - this is what the E2E switch-back
    // verification failed on (hipblas.dll unreachable via _rocm_sdk_*).
    expect(
      fs.existsSync(path.join(dstSite, '_rocm_sdk_libraries_custom', 'bin', 'hipblas.dll'))
    ).toBe(true)
    expect(fs.existsSync(path.join(dstSite, '_rocm_sdk_core'))).toBe(true)
    expect(fs.existsSync(path.join(dstSite, '_rocm_sdk_devel'))).toBe(true)
    expect(fs.existsSync(path.join(dstSite, 'rocm_sdk_core-7.2.1.dist-info'))).toBe(true)
    expect(fs.existsSync(path.join(dstSite, 'torch-2.9.1+rocm7.2.1.dist-info'))).toBe(true)

    // No trace of the multi-arch stack: dists, payloads, device overlays.
    for (const name of [
      'torch-2.11.0+rocm7.14.0.dist-info',
      'rocm-7.14.0.dist-info',
      'rocm_bootstrap',
      'rocm_bootstrap-0.1.0.dist-info',
      'rocm_sdk_core-7.14.0.dist-info',
      '_rocm_sdk_libraries',
      'rocm_sdk_libraries-7.14.0.dist-info',
      'rocm_sdk_device',
      '_rocm_sdk_device_gfx1100',
      'rocm_sdk_device_gfx1100-7.14.0.dist-info',
      'amd_torch_device_gfx1100-2.11.0+rocm7.14.0.dist-info',
      'amd_torchvision_device_gfx1100-0.26.0+rocm7.14.0.dist-info'
    ])
      expect(fs.existsSync(path.join(dstSite, name)), name).toBe(false)
    // The device overlays' .kpack payload went with the torch dir swap.
    expect(fs.existsSync(path.join(dstSite, 'torch', '.kpack'))).toBe(false)
    expect(fs.existsSync(path.join(dstSite, 'torchvision', '.kpack'))).toBe(false)

    // Unrelated packages survive.
    expect(fs.existsSync(path.join(dstSite, 'torchsde'))).toBe(true)
    expect(fs.existsSync(path.join(dstSite, 'numpy'))).toBe(true)

    // Swept dists are reported so verification asserts they stayed gone.
    expect(removed.sort()).toEqual([
      'amd_torch_device_gfx1100',
      'amd_torchvision_device_gfx1100',
      'rocm_bootstrap',
      'rocm_sdk_device_gfx1100'
    ])
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
      lastVerifiedTorchStack: { stackId: 'comfy-bundle:win-cpu:old-env' }
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
      comfyuiVersion: '0.0.0'
    }
    return { kind: 'bundle', srcSite, stagingDir, entry }
  }

  it('rolls the venv back intact and leaves stack metadata untouched when verification fails', async () => {
    // The graft succeeds (dist-info matches the tuple) but the venv has no
    // python interpreter, so verifyStack fails AFTER mutation - exercising
    // the full rollback path.
    const update = vi.fn(async () => {})
    const result = await applyTorchStackTransaction(makeInstallation(), makePrepared(), {
      sendProgress: () => {},
      update
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
      observedTorchStack: null
    })

    // The staging dir is always cleaned up.
    expect(fs.existsSync(stagingDir)).toBe(false)
  })

  it('does not touch the venv when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const update = vi.fn(async () => {})
    const result = await applyTorchStackTransaction(makeInstallation(), makePrepared(), {
      sendProgress: () => {},
      update,
      signal: controller.signal
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
      sendProgress: () => {},
      update
    })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('did not finish')
    // The live venv and the recovery-owned backup are both untouched.
    expect(fs.existsSync(path.join(venvSite, 'torch-2.1.0.dist-info'))).toBe(true)
    expect(fs.existsSync(venvDir + '.torch-backup')).toBe(true)
    expect(update).not.toHaveBeenCalled()
  })
})
