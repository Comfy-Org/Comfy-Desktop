import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { copyTorchFamily, recoverTorchFamilyBackups, removeTorchFamilyPackages } from './torchFamilyFs'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'torchfamilyfs-test-'))
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

/** A package dir always has at least one file (copyDir skips empty dirs). */
function pkg(root: string, name: string, content: string): void {
  fs.mkdirSync(path.join(root, name), { recursive: true })
  fs.writeFileSync(path.join(root, name, 'FILE'), content)
}

function read(root: string, name: string): string {
  return fs.readFileSync(path.join(root, name, 'FILE'), 'utf-8')
}

/** Journal an interrupted (uncommitted) swap, as copyTorchFamily would before
 *  its rename phase. Without this, backups are treated as committed debris. */
function writeMarker(site: string, marker: { backups: string[]; placed: string[] }): void {
  fs.writeFileSync(path.join(site, '.torchrepair-swap.json'), JSON.stringify(marker))
}

describe('copyTorchFamily', () => {
  it('replaces torch-family entries from src and leaves unrelated packages intact', async () => {
    const src = path.join(tmpDir, 'src')
    const dst = path.join(tmpDir, 'dst')
    fs.mkdirSync(src, { recursive: true })
    fs.mkdirSync(dst, { recursive: true })

    // Source bundle: GPU torch stack.
    pkg(src, 'torch', "__version__ = '2.10.0+cu128'")
    pkg(src, 'torch-2.10.0+cu128.dist-info', 'METADATA')
    pkg(src, 'nvidia_cudnn_cu12', 'lib')
    pkg(src, 'triton', 'lib')

    // Destination venv: CPU torch stack, an unrelated package, and a
    // torch-adjacent custom-node dep the bundle does NOT ship.
    pkg(dst, 'torch', "__version__ = '2.12.0'")
    pkg(dst, 'torch-2.12.0.dist-info', 'METADATA')
    pkg(dst, 'numpy', 'keep me')
    pkg(dst, 'torchmetrics', 'custom node dep')
    pkg(dst, 'torchmetrics-1.4.0.dist-info', 'METADATA')

    await copyTorchFamily(src, dst)

    // GPU torch copied in, stale CPU dist-info removed, numpy untouched.
    expect(read(dst, 'torch')).toContain('cu128')
    expect(fs.existsSync(path.join(dst, 'torch-2.10.0+cu128.dist-info'))).toBe(true)
    expect(fs.existsSync(path.join(dst, 'torch-2.12.0.dist-info'))).toBe(false)
    expect(fs.existsSync(path.join(dst, 'nvidia_cudnn_cu12'))).toBe(true)
    expect(fs.existsSync(path.join(dst, 'triton'))).toBe(true)
    expect(read(dst, 'numpy')).toBe('keep me')
    // A torch-adjacent dep the bundle doesn't provide must be preserved.
    expect(read(dst, 'torchmetrics')).toBe('custom node dep')
    expect(fs.existsSync(path.join(dst, 'torchmetrics-1.4.0.dist-info'))).toBe(true)
    // No staging leftovers.
    expect(fs.readdirSync(dst).some((e) => e.startsWith('.torchrepair-'))).toBe(false)
  })

  it('leaves dst untouched when cancelled before staging', async () => {
    const src = path.join(tmpDir, 'src')
    const dst = path.join(tmpDir, 'dst')
    fs.mkdirSync(src, { recursive: true })
    fs.mkdirSync(dst, { recursive: true })
    pkg(src, 'torch', 'new')
    pkg(dst, 'torch', 'old')

    const controller = new AbortController()
    controller.abort()
    await expect(copyTorchFamily(src, dst, controller.signal)).rejects.toThrow('Cancelled')

    expect(read(dst, 'torch')).toBe('old')
    expect(fs.readdirSync(dst).some((e) => e.startsWith('.torchrepair-'))).toBe(false)
  })

  it('rolls the swap back when a staged rename fails, leaving the old family complete', async () => {
    const src = path.join(tmpDir, 'src')
    const dst = path.join(tmpDir, 'dst')
    fs.mkdirSync(src, { recursive: true })
    fs.mkdirSync(dst, { recursive: true })
    pkg(src, 'torch', 'new torch')
    pkg(src, 'torchvision', 'new vision')
    pkg(dst, 'torch', 'old torch')
    pkg(dst, 'torchvision', 'old vision')
    pkg(dst, 'numpy', 'keep me')

    // Fail the second staged->final rename (after torch was already placed),
    // so rollback must both remove the placed copy and restore the backups.
    const realRename = fs.promises.rename.bind(fs.promises)
    let finalRenames = 0
    vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
      const fromStaged = path.basename(String(from)).startsWith('.torchrepair-')
      const toFinal = !path.basename(String(to)).startsWith('.torchrepair-')
      if (fromStaged && toFinal && ++finalRenames === 2) {
        throw new Error('injected rename failure')
      }
      return realRename(from, to)
    })

    await expect(copyTorchFamily(src, dst)).rejects.toThrow('injected rename failure')

    // The old family is back in full; nothing half-new remains under final names.
    expect(read(dst, 'torch')).toBe('old torch')
    expect(read(dst, 'torchvision')).toBe('old vision')
    expect(read(dst, 'numpy')).toBe('keep me')
    expect(fs.readdirSync(dst).some((e) => e.startsWith('.torchrepair-old-'))).toBe(false)
  })

  it('recovers leftover backups from an interrupted prior swap before staging', async () => {
    const src = path.join(tmpDir, 'src')
    const dst = path.join(tmpDir, 'dst')
    fs.mkdirSync(src, { recursive: true })
    fs.mkdirSync(dst, { recursive: true })
    pkg(src, 'torch', 'new torch')
    // A prior run died mid-swap: the good copy sits under the backup name and
    // the original name holds a partially placed replacement.
    pkg(dst, '.torchrepair-old-torch', 'interrupted good copy')
    pkg(dst, 'torch', 'partial junk')
    writeMarker(dst, { backups: ['torch'], placed: ['torch'] })

    await copyTorchFamily(src, dst)

    // Recovery put the good copy back, then the swap replaced it with src's.
    expect(read(dst, 'torch')).toBe('new torch')
    expect(fs.readdirSync(dst).some((e) => e.startsWith('.torchrepair-'))).toBe(false)
  })

  it('does not graft ordinary torch-ecosystem packages the bundle happens to ship', async () => {
    const src = path.join(tmpDir, 'src')
    const dst = path.join(tmpDir, 'dst')
    fs.mkdirSync(src, { recursive: true })
    fs.mkdirSync(dst, { recursive: true })
    pkg(src, 'torch', 'bundle torch')
    // The bundle env ships torchsde (a ComfyUI requirement) — but it is an
    // ordinary pip-managed dep, not part of the stack: grafting it would
    // overwrite the version a snapshot restore just installed.
    pkg(src, 'torchsde', 'bundle torchsde 0.2.6')
    pkg(src, 'torchsde-0.2.6.dist-info', 'METADATA')
    pkg(dst, 'torch', 'old torch')
    pkg(dst, 'torchsde', 'snapshot torchsde 0.2.5')
    pkg(dst, 'torchsde-0.2.5.dist-info', 'METADATA')

    await copyTorchFamily(src, dst)

    expect(read(dst, 'torch')).toBe('bundle torch')
    expect(read(dst, 'torchsde')).toBe('snapshot torchsde 0.2.5')
    expect(fs.existsSync(path.join(dst, 'torchsde-0.2.5.dist-info'))).toBe(true)
    expect(fs.existsSync(path.join(dst, 'torchsde-0.2.6.dist-info'))).toBe(false)
  })

  it('surfaces rollback failures instead of swallowing them, keeping the marker for retry', async () => {
    const src = path.join(tmpDir, 'src')
    const dst = path.join(tmpDir, 'dst')
    fs.mkdirSync(src, { recursive: true })
    fs.mkdirSync(dst, { recursive: true })
    pkg(src, 'torch', 'new torch')
    pkg(src, 'torchvision', 'new vision')
    pkg(dst, 'torch', 'old torch')
    pkg(dst, 'torchvision', 'old vision')

    // Fail the second staged->final rename, then also fail restoring the
    // torch backup during rollback — the live venv is now incomplete and the
    // caller must know.
    const realRename = fs.promises.rename.bind(fs.promises)
    let finalRenames = 0
    vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
      const fromName = path.basename(String(from))
      const toName = path.basename(String(to))
      if (fromName.startsWith('.torchrepair-') && !fromName.startsWith('.torchrepair-old-') &&
          !toName.startsWith('.torchrepair-') && ++finalRenames === 2) {
        throw new Error('injected placement failure')
      }
      if (fromName === '.torchrepair-old-torch' && toName === 'torch') {
        throw new Error('injected restore failure')
      }
      return realRename(from, to)
    })

    await expect(copyTorchFamily(src, dst)).rejects.toThrow(/rollback incomplete.*restore torch/)
    // The marker survives so the next run's recovery retries the rollback.
    expect(fs.existsSync(path.join(dst, '.torchrepair-swap.json'))).toBe(true)
    expect(fs.existsSync(path.join(dst, '.torchrepair-old-torch'))).toBe(true)
  })
})

describe('recoverTorchFamilyBackups', () => {
  it('rolls an uncommitted (marker present) swap back: restores backups, removes introduced entries', async () => {
    const site = path.join(tmpDir, 'site')
    fs.mkdirSync(site, { recursive: true })
    pkg(site, '.torchrepair-old-torch', 'good torch')
    pkg(site, 'torch', 'partial replacement')
    pkg(site, '.torchrepair-old-torchvision', 'good vision')
    // torchvision original absent entirely; the new dist-info and a brand-new
    // nvidia package were already placed under names with no backup.
    pkg(site, 'torch-2.10.0+cu128.dist-info', 'new dist-info')
    pkg(site, 'nvidia_cudnn_cu12', 'introduced')
    pkg(site, 'numpy', 'keep me')
    writeMarker(site, {
      backups: ['torch', 'torchvision'],
      placed: ['torch', 'torchvision', 'torch-2.10.0+cu128.dist-info', 'nvidia_cudnn_cu12']
    })

    await recoverTorchFamilyBackups(site)

    expect(read(site, 'torch')).toBe('good torch')
    expect(read(site, 'torchvision')).toBe('good vision')
    expect(read(site, 'numpy')).toBe('keep me')
    // Entries the interrupted swap introduced under new names are gone.
    expect(fs.existsSync(path.join(site, 'torch-2.10.0+cu128.dist-info'))).toBe(false)
    expect(fs.existsSync(path.join(site, 'nvidia_cudnn_cu12'))).toBe(false)
    expect(fs.readdirSync(site).some((e) => e.startsWith('.torchrepair-'))).toBe(false)
  })

  it('deletes backups from a committed swap (no marker) instead of restoring them', async () => {
    const site = path.join(tmpDir, 'site')
    fs.mkdirSync(site, { recursive: true })
    // The swap committed (marker deleted) but backup cleanup was interrupted:
    // restoring these would silently revert the repair.
    pkg(site, '.torchrepair-old-torch', 'stale old torch')
    pkg(site, 'torch', 'committed new torch')

    await recoverTorchFamilyBackups(site)

    expect(read(site, 'torch')).toBe('committed new torch')
    expect(fs.readdirSync(site).some((e) => e.startsWith('.torchrepair-'))).toBe(false)
  })

  it('recovers a corrupt marker non-destructively: restores backups, never sweeps ambiguous entries', async () => {
    const site = path.join(tmpDir, 'site')
    fs.mkdirSync(site, { recursive: true })
    // Interrupted swap whose journal is unreadable: the backup holds the only
    // good torch, a partial replacement sits at the original name, and the new
    // stack's dist-info was already placed under a brand-new name.
    pkg(site, '.torchrepair-old-torch', 'good torch')
    pkg(site, 'torch', 'partial replacement')
    pkg(site, 'torch-2.10.0+cu128.dist-info', 'new dist-info')
    pkg(site, 'torchsde', 'keep me')
    pkg(site, 'numpy', 'keep me too')
    fs.writeFileSync(path.join(site, '.torchrepair-swap.json'), '{ not json')

    await recoverTorchFamilyBackups(site)

    // The backup is restored over the partial replacement.
    expect(read(site, 'torch')).toBe('good torch')
    // A same-key stranger is ambiguous (placed new entry vs unbacked original)
    // and must NOT be deleted; the next successful swap cleans it up.
    expect(read(site, 'torch-2.10.0+cu128.dist-info')).toBe('new dist-info')
    expect(read(site, 'torchsde')).toBe('keep me')
    expect(read(site, 'numpy')).toBe('keep me too')
    expect(fs.readdirSync(site).some((e) => e.startsWith('.torchrepair-'))).toBe(false)
  })

  it('corrupt marker after a mid-backup crash: unbacked originals are never deleted', async () => {
    const site = path.join(tmpDir, 'site')
    fs.mkdirSync(site, { recursive: true })
    // Crash midway through the BACKUP loop: the torch dir was renamed aside,
    // its dist-info and .libs were not reached yet, nothing was placed - the
    // staged copies are still under temp names.
    pkg(site, '.torchrepair-old-torch', 'good torch')
    pkg(site, 'torch-2.9.0.dist-info', 'good original dist-info')
    pkg(site, 'torch.libs', 'good original sidecar')
    pkg(site, '.torchrepair-torch', 'staged new torch')
    fs.writeFileSync(path.join(site, '.torchrepair-swap.json'), '{ not json')

    await recoverTorchFamilyBackups(site)

    expect(read(site, 'torch')).toBe('good torch')
    // The originals the backup loop never reached survive recovery.
    expect(read(site, 'torch-2.9.0.dist-info')).toBe('good original dist-info')
    expect(read(site, 'torch.libs')).toBe('good original sidecar')
    // The marker is consumed so recovery cannot wedge; only backup-prefixed
    // debris is gone (staged temps are swept by the next swap, not recovery).
    expect(fs.existsSync(path.join(site, '.torchrepair-swap.json'))).toBe(false)
    expect(fs.existsSync(path.join(site, '.torchrepair-old-torch'))).toBe(false)
  })

  it('is a no-op when no backups exist', async () => {
    const site = path.join(tmpDir, 'site')
    fs.mkdirSync(site, { recursive: true })
    pkg(site, 'torch', 'fine')

    await recoverTorchFamilyBackups(site)

    expect(read(site, 'torch')).toBe('fine')
  })
})

describe('removeTorchFamilyPackages', () => {
  it('removes package dir, dist-info, and .libs sidecar; leaves everything else', async () => {
    const site = path.join(tmpDir, 'site')
    fs.mkdirSync(site, { recursive: true })
    pkg(site, 'torchvision', 'lib')
    pkg(site, 'torchvision-0.25.0+cu126.dist-info', 'METADATA')
    pkg(site, 'torchvision.libs', 'sidecar')
    pkg(site, 'torch', 'keep')
    pkg(site, 'torch-2.10.0+cu126.dist-info', 'keep')
    pkg(site, 'torchmetrics', 'keep')

    await removeTorchFamilyPackages(site, ['torchvision'])

    expect(fs.existsSync(path.join(site, 'torchvision'))).toBe(false)
    expect(fs.existsSync(path.join(site, 'torchvision-0.25.0+cu126.dist-info'))).toBe(false)
    expect(fs.existsSync(path.join(site, 'torchvision.libs'))).toBe(false)
    expect(fs.existsSync(path.join(site, 'torch'))).toBe(true)
    expect(fs.existsSync(path.join(site, 'torch-2.10.0+cu126.dist-info'))).toBe(true)
    expect(fs.existsSync(path.join(site, 'torchmetrics'))).toBe(true)
  })

  it('removes distribution-owned extra top-level packages (torchaudio ships torio)', async () => {
    const site = path.join(tmpDir, 'site')
    fs.mkdirSync(site, { recursive: true })
    pkg(site, 'torchaudio', 'lib')
    pkg(site, 'torchaudio-2.9.0+cu126.dist-info', 'METADATA')
    // torio ships inside the torchaudio wheel with no dist-info of its own;
    // leaving it behind would import against the wrong (or no) torchaudio.
    pkg(site, 'torio', 'owned by torchaudio')
    pkg(site, 'torch', 'keep')
    pkg(site, 'torchgen', 'keep - owned by torch, which is not being removed')

    await removeTorchFamilyPackages(site, ['torchaudio'])

    expect(fs.existsSync(path.join(site, 'torchaudio'))).toBe(false)
    expect(fs.existsSync(path.join(site, 'torchaudio-2.9.0+cu126.dist-info'))).toBe(false)
    expect(fs.existsSync(path.join(site, 'torio'))).toBe(false)
    expect(fs.existsSync(path.join(site, 'torch'))).toBe(true)
    expect(fs.existsSync(path.join(site, 'torchgen'))).toBe(true)
  })

  it('removes torch-owned extras (torchgen, functorch) when torch itself is removed', async () => {
    const site = path.join(tmpDir, 'site')
    fs.mkdirSync(site, { recursive: true })
    pkg(site, 'torch', 'lib')
    pkg(site, 'torch-2.10.0.dist-info', 'METADATA')
    pkg(site, 'torchgen', 'owned by torch')
    pkg(site, 'functorch', 'owned by torch')
    pkg(site, 'torchvision', 'keep')

    await removeTorchFamilyPackages(site, ['torch'])

    expect(fs.existsSync(path.join(site, 'torch'))).toBe(false)
    expect(fs.existsSync(path.join(site, 'torchgen'))).toBe(false)
    expect(fs.existsSync(path.join(site, 'functorch'))).toBe(false)
    expect(fs.existsSync(path.join(site, 'torchvision'))).toBe(true)
  })

  it('matches normalized names (dash vs underscore)', async () => {
    const site = path.join(tmpDir, 'site')
    fs.mkdirSync(site, { recursive: true })
    pkg(site, 'pytorch_triton_rocm', 'lib')
    pkg(site, 'pytorch_triton_rocm-3.1.0.dist-info', 'METADATA')

    await removeTorchFamilyPackages(site, ['pytorch-triton-rocm'])

    expect(fs.readdirSync(site)).toEqual([])
  })
})
