import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Stub the electron surface ../shared touches so the test needs no runtime.
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
    getVersion: () => '0.0.0-test',
    getLocale: () => 'en',
  },
  ipcMain: { handle: vi.fn(), on: vi.fn(), off: vi.fn() },
  dialog: {},
  shell: {},
  WebContentsView: class {},
  BrowserWindow: { getAllWindows: () => [] },
  nativeTheme: { on: vi.fn(), shouldUseDarkColors: false },
}))

import {
  installDirState,
  installDirStateAsync,
  isEffectivelyEmptyInstallDir,
  isInstallDirUnavailable,
} from './shared'

let tmpRoot = ''

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'comfy-dirstate-'))
})

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe('installDirState', () => {
  it("reports 'missing' for a path that does not exist (renamed / unplugged drive)", () => {
    expect(installDirState(path.join(tmpRoot, 'does-not-exist'))).toBe('missing')
  })

  it("reports 'missing' for an empty path string", () => {
    expect(installDirState('')).toBe('missing')
  })

  it("reports 'empty' for a dir holding only ignorable bookkeeping files", () => {
    const dir = path.join(tmpRoot, 'leftover')
    fs.mkdirSync(dir)
    fs.writeFileSync(path.join(dir, '.DS_Store'), '')
    fs.writeFileSync(path.join(dir, 'Thumbs.db'), '')
    expect(installDirState(dir)).toBe('empty')
  })

  it("reports 'empty' for a truly empty dir", () => {
    const dir = path.join(tmpRoot, 'truly-empty')
    fs.mkdirSync(dir)
    expect(installDirState(dir)).toBe('empty')
  })

  it("reports 'populated' for a dir with real content", () => {
    const dir = path.join(tmpRoot, 'real')
    fs.mkdirSync(dir)
    fs.writeFileSync(path.join(dir, 'main.py'), 'print(1)')
    expect(installDirState(dir)).toBe('populated')
  })
})

describe('isEffectivelyEmptyInstallDir', () => {
  // Behavior relied on by the delete/cancel cleanup path: a gone dir is still
  // "effectively empty" (nothing to delete), as is a leftover empty dir.
  it('is true for missing and empty dirs', () => {
    expect(isEffectivelyEmptyInstallDir(path.join(tmpRoot, 'nope'))).toBe(true)
    const dir = path.join(tmpRoot, 'empty')
    fs.mkdirSync(dir)
    expect(isEffectivelyEmptyInstallDir(dir)).toBe(true)
  })

  it('is false for a populated dir', () => {
    const dir = path.join(tmpRoot, 'full')
    fs.mkdirSync(dir)
    fs.writeFileSync(path.join(dir, 'a.txt'), 'x')
    expect(isEffectivelyEmptyInstallDir(dir)).toBe(false)
  })
})

describe('isInstallDirUnavailable', () => {
  it('buckets missing and inaccessible as unavailable, others as available', () => {
    expect(isInstallDirUnavailable('missing')).toBe(true)
    expect(isInstallDirUnavailable('inaccessible')).toBe(true)
    expect(isInstallDirUnavailable('empty')).toBe(false)
    expect(isInstallDirUnavailable('populated')).toBe(false)
    expect(isInstallDirUnavailable(undefined)).toBe(false)
  })
})

describe('installDirStateAsync', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('matches the sync classification for present dirs', async () => {
    const dir = path.join(tmpRoot, 'async')
    fs.mkdirSync(dir)
    fs.writeFileSync(path.join(dir, 'main.py'), 'x')
    await expect(installDirStateAsync(dir)).resolves.toBe('populated')
    await expect(installDirStateAsync(path.join(tmpRoot, 'gone'))).resolves.toBe('missing')
  })

  it("classifies a non-ENOENT readdir error (e.g. EACCES) as 'inaccessible'", async () => {
    const err = Object.assign(new Error('denied'), { code: 'EACCES' })
    vi.spyOn(fs.promises, 'readdir').mockRejectedValueOnce(err as never)
    await expect(installDirStateAsync('/whatever')).resolves.toBe('inaccessible')
  })

  it("reports 'inaccessible' when the probe never settles (dead network drive)", async () => {
    vi.useFakeTimers()
    // A readdir that hangs forever — simulates an offline UNC/network path.
    vi.spyOn(fs.promises, 'readdir').mockReturnValue(new Promise(() => {}) as never)
    const p = installDirStateAsync('//dead/share')
    await vi.runOnlyPendingTimersAsync()
    await expect(p).resolves.toBe('inaccessible')
  })
})
