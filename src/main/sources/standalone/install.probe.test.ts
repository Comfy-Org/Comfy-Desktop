import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '' },
  ipcMain: { handle: vi.fn() },
}))

import { probeInstallation } from './install'

/** Build a standalone layout (standalone-env/ + manifest.json + ComfyUI/main.py). */
function makeStandalone(root: string): void {
  fs.mkdirSync(path.join(root, 'standalone-env'), { recursive: true })
  fs.mkdirSync(path.join(root, 'ComfyUI'), { recursive: true })
  fs.writeFileSync(path.join(root, 'ComfyUI', 'main.py'), '')
  fs.writeFileSync(
    path.join(root, 'manifest.json'),
    JSON.stringify({ comfyui_ref: 'v0.1.0', version: 'win-nvidia-1', id: 'win-nvidia', python_version: '3.12' }),
  )
}

describe('standalone probeInstallation', () => {
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'standalone-probe-'))
  })

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('detects a standalone install at the root and records the root', async () => {
    const root = path.join(tmp, 'install')
    makeStandalone(root)

    const result = await probeInstallation(root)
    expect(result).not.toBeNull()
    expect(result!.installPath).toBe(root)
    expect(result!.version).toBe('v0.1.0')
    expect(result!.variant).toBe('win-nvidia')
  })

  it('detects a standalone install when pointed at the nested ComfyUI folder', async () => {
    const root = path.join(tmp, 'install')
    makeStandalone(root)

    const result = await probeInstallation(path.join(root, 'ComfyUI'))
    expect(result).not.toBeNull()
    // installPath must be the root, not the nested ComfyUI folder.
    expect(result!.installPath).toBe(root)
    expect(result!.version).toBe('v0.1.0')
  })

  it('returns null for an unrelated directory', async () => {
    const plain = path.join(tmp, 'plain')
    fs.mkdirSync(plain, { recursive: true })
    expect(await probeInstallation(plain)).toBeNull()
  })

  it('returns null for a bare ComfyUI folder with no standalone parent', async () => {
    const comfy = path.join(tmp, 'ComfyUI')
    fs.mkdirSync(comfy, { recursive: true })
    fs.writeFileSync(path.join(comfy, 'main.py'), '')
    expect(await probeInstallation(comfy)).toBeNull()
  })

  it('does not resolve up from a non-ComfyUI sibling inside a standalone', async () => {
    const root = path.join(tmp, 'install')
    makeStandalone(root)
    // Pointing at standalone-env/ (a sibling of ComfyUI) must not track the root.
    expect(await probeInstallation(path.join(root, 'standalone-env'))).toBeNull()
  })
})
