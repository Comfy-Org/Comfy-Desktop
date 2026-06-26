import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '' },
  ipcMain: { handle: vi.fn() },
}))

import { portable } from './portable'

/** Build a portable layout (python_embeded/ + ComfyUI/). */
function makePortable(root: string): void {
  fs.mkdirSync(path.join(root, 'python_embeded'), { recursive: true })
  fs.mkdirSync(path.join(root, 'ComfyUI'), { recursive: true })
  fs.writeFileSync(path.join(root, 'ComfyUI', 'main.py'), '')
}

describe('portable probeInstallation', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-probe-'))
  })

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('detects a portable install at the root and records the root', async () => {
    const root = path.join(tmp, 'ComfyUI_windows_portable')
    makePortable(root)

    const result = await portable.probeInstallation!(root)
    expect(result).not.toBeNull()
    expect(result!.installPath).toBe(root)
  })

  it('detects a portable install when pointed at the parent folder', async () => {
    const root = path.join(tmp, 'ComfyUI_windows_portable')
    makePortable(root)

    const result = await portable.probeInstallation!(tmp)
    expect(result).not.toBeNull()
    // Resolves down to the real root, not the parent the user picked.
    expect(result!.installPath).toBe(root)
  })

  it('detects a portable install when pointed at the nested ComfyUI folder', async () => {
    const root = path.join(tmp, 'ComfyUI_windows_portable')
    makePortable(root)

    const result = await portable.probeInstallation!(path.join(root, 'ComfyUI'))
    expect(result).not.toBeNull()
    // Resolves up to the real root, not the nested ComfyUI folder.
    expect(result!.installPath).toBe(root)
  })

  it('returns null for an unrelated directory', async () => {
    const plain = path.join(tmp, 'plain')
    fs.mkdirSync(plain, { recursive: true })
    expect(await portable.probeInstallation!(plain)).toBeNull()
  })

  it('does not resolve up from a non-ComfyUI sibling inside a portable root', async () => {
    const root = path.join(tmp, 'ComfyUI_windows_portable')
    makePortable(root)
    fs.mkdirSync(path.join(root, 'update'), { recursive: true })
    // Pointing at a sibling of ComfyUI must not track the portable root.
    expect(await portable.probeInstallation!(path.join(root, 'update'))).toBeNull()
  })

  it('resolves the nested portable root, not the parent, for a nested portable layout', async () => {
    // outer/downloads/<portable>/ — picking outer/downloads must resolve the
    // nested portable via the down-scan, never jump up to a parent.
    const downloads = path.join(tmp, 'downloads')
    const nested = path.join(downloads, 'ComfyUI_windows_portable')
    makePortable(nested)

    const result = await portable.probeInstallation!(downloads)
    expect(result).not.toBeNull()
    expect(result!.installPath).toBe(nested)
  })
})

