import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import fs from 'fs'

vi.mock('electron', () => ({
  app: { getPath: () => '' }
}))

vi.mock('./nodes', () => ({
  scanCustomNodes: vi.fn().mockResolvedValue([])
}))

import {
  detectDesktopInstall,
  findDesktopExecutable,
  captureDesktopSnapshot
} from './desktopDetect'
import type { DesktopInstallInfo } from './desktopDetect'

const originalPlatform = process.platform

function stubProcess(platform: NodeJS.Platform, env: NodeJS.ProcessEnv = {}): void {
  Object.defineProperty(process, 'platform', { configurable: true, value: platform })
  delete process.env.APPDATA
  delete process.env.LOCALAPPDATA
  Object.assign(process.env, env)
}

afterEach(() => {
  Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform })
  delete process.env.APPDATA
  delete process.env.LOCALAPPDATA
})

describe('detectDesktopInstall', () => {
  let readFileSyncSpy: MockInstance
  let existsSyncSpy: MockInstance
  let accessSyncSpy: MockInstance

  beforeEach(() => {
    vi.restoreAllMocks()
    readFileSyncSpy = vi.spyOn(fs, 'readFileSync')
    existsSyncSpy = vi.spyOn(fs, 'existsSync')
    accessSyncSpy = vi.spyOn(fs, 'accessSync').mockReturnValue(undefined)
    delete process.env.APPDATA
    delete process.env.LOCALAPPDATA
  })

  it('returns null on unsupported platforms', () => {
    stubProcess('linux')
    expect(detectDesktopInstall()).toBeNull()
  })

  it('returns null when APPDATA is not set on Windows', () => {
    stubProcess('win32')
    expect(detectDesktopInstall()).toBeNull()
  })

  it('returns null when config.json does not exist', () => {
    stubProcess('win32', { APPDATA: '/mock/AppData/Roaming' })
    readFileSyncSpy.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    expect(detectDesktopInstall()).toBeNull()
  })

  it('returns null when config.json has no basePath', () => {
    stubProcess('win32', { APPDATA: '/mock/AppData/Roaming' })
    readFileSyncSpy.mockReturnValue('{"installState":"installed"}')
    expect(detectDesktopInstall()).toBeNull()
  })

  it('returns null when basePath does not exist on disk', () => {
    stubProcess('win32', { APPDATA: '/mock/AppData/Roaming' })
    readFileSyncSpy.mockReturnValue(JSON.stringify({ basePath: '/mock/Documents/ComfyUI' }))
    existsSyncSpy.mockReturnValue(false)
    expect(detectDesktopInstall()).toBeNull()
  })

  it('throws a permission error when basePath is EACCES', () => {
    stubProcess('win32', { APPDATA: '/mock/AppData/Roaming' })
    readFileSyncSpy.mockReturnValue(JSON.stringify({ basePath: '/mock/Documents/ComfyUI' }))
    existsSyncSpy.mockImplementation((p: fs.PathLike) => {
      return p.toString() === '/mock/Documents/ComfyUI'
    })
    const eacces = Object.assign(new Error('EACCES'), { code: 'EACCES' })
    accessSyncSpy.mockImplementation(() => {
      throw eacces
    })
    expect(() => detectDesktopInstall()).toThrow(/folderPermissionDenied|denied access/)
  })

  it('returns info when a valid Desktop install is found', () => {
    const appData = '/mock/AppData/Roaming'
    const localAppData = '/mock/AppData/Local'
    const configDir = path.join(appData, 'ComfyUI')
    const basePath = path.resolve(configDir, '/mock/Documents/ComfyUI')
    stubProcess('win32', { APPDATA: appData, LOCALAPPDATA: localAppData })

    readFileSyncSpy.mockReturnValue(JSON.stringify({ basePath: '/mock/Documents/ComfyUI' }))
    existsSyncSpy.mockImplementation((p: fs.PathLike) => {
      const s = p.toString()
      if (s === basePath) return true
      if (s === path.join(basePath, 'models')) return true
      if (s === path.join(basePath, 'user')) return true
      if (s === path.join(basePath, '.venv')) return true
      return false
    })

    const result = detectDesktopInstall()
    expect(result).not.toBeNull()
    expect(result!.basePath).toBe(basePath)
    expect(result!.hasVenv).toBe(true)
  })

  it('returns null when adoption marker is present at basePath', () => {
    const appData = '/mock/AppData/Roaming'
    const configDir = path.join(appData, 'ComfyUI')
    const basePath = path.resolve(configDir, '/mock/Documents/ComfyUI')
    stubProcess('win32', { APPDATA: appData })

    readFileSyncSpy.mockReturnValue(JSON.stringify({ basePath: '/mock/Documents/ComfyUI' }))
    existsSyncSpy.mockImplementation((p: fs.PathLike) => {
      const s = p.toString()
      if (s === basePath) return true
      if (s === path.join(basePath, '.comfyui-desktop-2')) return true
      // models/user would otherwise match: assert the marker short-circuits.
      if (s === path.join(basePath, 'models')) return true
      if (s === path.join(basePath, 'user')) return true
      return false
    })

    expect(detectDesktopInstall()).toBeNull()
  })

  it('returns info with hasVenv false when .venv is missing', () => {
    const appData = '/mock/AppData/Roaming'
    const configDir = path.join(appData, 'ComfyUI')
    const basePath = path.resolve(configDir, '/mock/Documents/ComfyUI')
    stubProcess('win32', { APPDATA: appData })

    readFileSyncSpy.mockReturnValue(JSON.stringify({ basePath: '/mock/Documents/ComfyUI' }))
    existsSyncSpy.mockImplementation((p: fs.PathLike) => {
      const s = p.toString()
      if (s === basePath) return true
      if (s === path.join(basePath, 'models')) return true
      if (s === path.join(basePath, 'user')) return true
      return false
    })

    const result = detectDesktopInstall()
    expect(result).not.toBeNull()
    expect(result!.hasVenv).toBe(false)
  })
})

describe('findDesktopExecutable', () => {
  let existsSyncSpy: MockInstance

  beforeEach(() => {
    vi.restoreAllMocks()
    existsSyncSpy = vi.spyOn(fs, 'existsSync')
  })

  it('returns null on unsupported platforms', () => {
    stubProcess('linux')
    expect(findDesktopExecutable()).toBeNull()
  })

  it('returns executable path on Windows when it exists', () => {
    const localAppData = '/mock/AppData/Local'
    stubProcess('win32', { LOCALAPPDATA: localAppData })
    const expected = path.join(localAppData, 'Programs', 'ComfyUI', 'ComfyUI.exe')
    existsSyncSpy.mockImplementation((p: fs.PathLike) => p.toString() === expected)
    expect(findDesktopExecutable()).toBe(expected)
  })

  it('returns null on Windows when executable does not exist', () => {
    stubProcess('win32', { LOCALAPPDATA: '/mock/AppData/Local' })
    existsSyncSpy.mockReturnValue(false)
    expect(findDesktopExecutable()).toBeNull()
  })
})

describe('captureDesktopSnapshot', () => {
  let mockScan: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.restoreAllMocks()
    const nodes = await import('./nodes')
    mockScan = vi.mocked(nodes.scanCustomNodes)
    mockScan.mockResolvedValue([])
  })

  it('returns a valid snapshot with empty nodes when no custom nodes exist', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)
    const info: DesktopInstallInfo = {
      configDir: '/config/ComfyUI',
      basePath: '/data/ComfyUI',
      executablePath: null,
      hasVenv: false
    }

    const snapshot = await captureDesktopSnapshot(info)

    expect(snapshot.version).toBe(1)
    expect(snapshot.trigger).toBe('manual')
    expect(snapshot.label).toBe('Legacy Desktop migration')
    expect(snapshot.comfyui.ref).toBe('Legacy Desktop')
    expect(snapshot.customNodes).toEqual([])
    expect(snapshot.pipPackages).toEqual({})
  })

  it('scans custom nodes from basePath', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)
    const fakeNodes = [
      { id: 'test-node', type: 'cnr' as const, dirName: 'test-node', enabled: true, version: '1.0' }
    ]
    mockScan.mockResolvedValue(fakeNodes)

    const info: DesktopInstallInfo = {
      configDir: '/config/ComfyUI',
      basePath: '/data/ComfyUI',
      executablePath: null,
      hasVenv: false
    }

    const snapshot = await captureDesktopSnapshot(info)

    expect(mockScan).toHaveBeenCalledWith('/data/ComfyUI')
    expect(snapshot.customNodes).toEqual(fakeNodes)
  })

  it('skips pip freeze when no venv exists', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)
    const info: DesktopInstallInfo = {
      configDir: '/config/ComfyUI',
      basePath: '/data/ComfyUI',
      executablePath: null,
      hasVenv: false
    }

    const snapshot = await captureDesktopSnapshot(info)

    expect(snapshot.pipPackages).toEqual({})
  })
})
