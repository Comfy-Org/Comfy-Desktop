import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type CleanupModule = typeof import('./uninstallCleanup')

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'comfyui-desktop-2-uninstall-'))
const ENV_KEYS = [
  'LOCALAPPDATA',
  'SystemDrive',
  'APPIMAGE',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME'
] as const
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))

let caseRoot = ''
let home = ''
let appData = ''
let localAppData = ''
let userData = ''
let temp = ''
let exePath = ''
let logs = ''

function knownPaths(): Record<string, string> {
  return {
    home,
    appData,
    userData,
    temp,
    exe: exePath,
    logs,
    documents: path.join(home, 'Documents'),
    desktop: path.join(home, 'Desktop'),
    downloads: path.join(home, 'Downloads')
  }
}

function write(file: string, content = ''): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content, 'utf-8')
}

function makeDirs(): void {
  const userFolders = ['Documents', 'Desktop', 'Downloads'].map((name) => path.join(home, name))
  for (const dir of [userData, temp, ...userFolders]) fs.mkdirSync(dir, { recursive: true })
}

function useMacLayout(): void {
  appData = path.join(home, 'Library', 'Application Support')
  userData = path.join(appData, 'Comfy Desktop')
  logs = path.join(home, 'Library', 'Logs', 'Comfy Desktop')
  temp = path.join(caseRoot, 'tmp')
  exePath = '/Applications/Comfy Desktop.app/Contents/MacOS/Comfy Desktop'
  makeDirs()
}

function useLinuxLayout(): void {
  appData = path.join(home, '.config')
  userData = path.join(appData, 'Comfy Desktop')
  logs = path.join(userData, 'logs')
  temp = path.join(caseRoot, 'tmp')
  exePath = '/opt/Comfy Desktop/comfyui-desktop-2'
  makeDirs()
}

beforeEach(() => {
  caseRoot = fs.mkdtempSync(path.join(tmpRoot, 'case-'))
  home = path.join(caseRoot, 'home')
  appData = path.join(home, 'AppData', 'Roaming')
  localAppData = path.join(home, 'AppData', 'Local')
  userData = path.join(appData, 'Comfy Desktop')
  temp = path.join(localAppData, 'Temp')
  logs = ''
  exePath = 'C:\\Programs\\Comfy Desktop\\Comfy Desktop.exe'
  makeDirs()
  for (const key of ENV_KEYS) delete process.env[key]
  process.env.LOCALAPPDATA = localAppData
  process.env.SystemDrive = 'C:'

  vi.resetModules()
  vi.doMock('electron', () => ({
    app: {
      isPackaged: false,
      relaunch: vi.fn(),
      getPath: (name: string) => {
        const value = knownPaths()[name]
        if (!value) throw new Error(`unknown path ${name}`)
        return value
      }
    }
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.doUnmock('electron')
  for (const key of ENV_KEYS) {
    const value = originalEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

async function loadAs(platform: NodeJS.Platform): Promise<CleanupModule> {
  vi.stubGlobal('process', { ...process, platform })
  return await import('./uninstallCleanup')
}

function localRoot(): string {
  return path.join(localAppData, 'Comfy-Desktop')
}

function plannedPaths(plan: { entries: { path: string }[] }): string[] {
  return plan.entries.map((e) => e.path)
}

function allFlags(c: CleanupModule): string[] {
  return [c.UNINSTALL_CLEANUP_FLAG, c.DELETE_INSTANCES_FLAG, c.DELETE_MODELS_FLAG]
}

const noBoxes = { deleteInstances: false, deleteModels: false }
const bothBoxes = { deleteInstances: true, deleteModels: true }

describe('plan per data-root mode', () => {
  it('uses LOCALAPPDATA\\Comfy-Desktop in the default mode', async () => {
    const c = await loadAs('win32')
    const inputs = c.collectUninstallCleanupInputs(bothBoxes)
    const root = localRoot()

    expect(inputs.folders.dataRoot).toBe(root)
    expect(inputs.folders.installDir).toBe(path.join(root, 'ComfyUI-Installs'))
    expect(inputs.folders.models).toBe(path.join(root, 'ComfyUI-Shared', 'models'))
    expect(inputs.folders.downloadCache).toBe(path.join(root, 'ComfyUI-Cache', 'download-cache'))

    const plan = c.planUninstallCleanup(inputs)
    const paths = plannedPaths(plan)
    expect(paths).toContain(path.join(root, 'ComfyUI-Cache', 'download-cache'))
    expect(paths).toContain(path.join(root, 'ComfyUI-Shared', 'benchmarks'))
    expect(paths).toContain(path.join(root, 'ComfyUI-Shared', 'models'))
    expect(paths).toContain(path.join(localAppData, 'comfyui-desktop-2-updater'))
    expect(plan.entries.find((e) => e.path === root)?.onlyIfEmpty).toBe(true)
    const installs = plan.entries.find((e) => e.path === path.join(root, 'ComfyUI-Installs'))
    expect(installs?.onlyIfEmpty).toBe(true)
  })

  it('keeps the home folder itself in legacy-home mode', async () => {
    write(path.join(userData, 'data-location.json'), JSON.stringify({ mode: 'legacy-home' }))
    const c = await loadAs('win32')
    const inputs = c.collectUninstallCleanupInputs(bothBoxes)

    expect(inputs.folders.dataRoot).toBe(home)
    expect(inputs.folders.installDir).toBe(path.join(home, 'ComfyUI-Installs'))
    expect(inputs.folders.downloadCache).toBe(path.join(userData, 'download-cache'))

    const plan = c.planUninstallCleanup(inputs)
    const paths = plannedPaths(plan)
    expect(paths).toContain(path.join(home, 'ComfyUI-Shared', 'models'))
    expect(paths).toContain(path.join(userData, 'download-cache'))
    expect(paths).not.toContain(home)
    expect(c.deletionRefusal(home, plan.guard)).not.toBeNull()
  })

  it('uses <drive>\\Comfy-Desktop when the app is on another drive', async () => {
    exePath = 'D:\\Programs\\Comfy Desktop\\Comfy Desktop.exe'
    const c = await loadAs('win32')
    const inputs = c.collectUninstallCleanupInputs(bothBoxes)
    const root = path.join('D:\\', 'Comfy-Desktop')

    expect(inputs.folders.dataRoot).toBe(root)
    expect(inputs.folders.installDir).toBe(path.join(root, 'ComfyUI-Installs'))

    const plan = c.planUninstallCleanup(inputs)
    const paths = plannedPaths(plan)
    expect(paths).toContain(path.join(root, 'ComfyUI-Cache', 'download-cache'))
    expect(paths).toContain(path.join(root, 'ComfyUI-Shared', 'models'))
    expect(plan.entries.find((e) => e.path === root)?.onlyIfEmpty).toBe(true)
    expect(paths).toContain(path.join(localRoot(), 'ComfyUI-Shared', 'benchmarks'))
  })

  it('removes app files and leaves unrelated folders alone', async () => {
    write(path.join(userData, 'logs', 'main.log'), 'log')
    write(path.join(userData, 'settings.json'), JSON.stringify({ apiKey: 'secret-token-value' }))
    write(path.join(appData, 'ComfyUI', 'config.json'), '{}')
    write(path.join(appData, 'ComfyUI Launcher', 'settings.json'), '{}')
    write(path.join(localAppData, 'comfyui-desktop-2-updater', 'setup.exe'))
    write(path.join(localRoot(), 'ComfyUI-Cache', 'download-cache', 'a.bin'))
    write(path.join(temp, 'comfy-focus-1234.vbs'))
    write(path.join(temp, 'comfyui-desktop-2-snapshots', 'a.json'))
    write(path.join(temp, 'cnr-some-node-1.0.0-1700000000000.zip'))
    write(path.join(temp, 'unrelated.txt'))

    const c = await loadAs('win32')
    expect(c.runUninstallCleanup([c.UNINSTALL_CLEANUP_FLAG])).toBe(0)

    expect(fs.existsSync(path.join(userData, 'logs'))).toBe(false)
    expect(fs.existsSync(path.join(userData, 'settings.json'))).toBe(true)
    expect(fs.existsSync(path.join(appData, 'ComfyUI', 'config.json'))).toBe(true)
    expect(fs.existsSync(path.join(appData, 'ComfyUI Launcher'))).toBe(false)
    expect(fs.existsSync(path.join(localAppData, 'comfyui-desktop-2-updater'))).toBe(false)
    expect(fs.existsSync(path.join(localRoot(), 'ComfyUI-Cache'))).toBe(false)
    expect(fs.existsSync(path.join(temp, 'comfy-focus-1234.vbs'))).toBe(false)
    expect(fs.existsSync(path.join(temp, 'comfyui-desktop-2-snapshots'))).toBe(false)
    expect(fs.existsSync(path.join(temp, 'cnr-some-node-1.0.0-1700000000000.zip'))).toBe(false)
    expect(fs.existsSync(path.join(temp, 'unrelated.txt'))).toBe(true)

    const log = fs.readFileSync(path.join(temp, c.UNINSTALL_CLEANUP_LOG_FILE), 'utf-8')
    expect(log).toContain('removed=')
    expect(log).not.toContain('secret-token-value')
  })
})

describe('instances', () => {
  function installAt(name: string): string {
    const dir = path.join(localRoot(), 'ComfyUI-Installs', name)
    write(path.join(dir, 'ComfyUI', 'main.py'))
    return dir
  }

  function writeRecords(records: { id: string; installPath: string }[]): void {
    write(path.join(userData, 'installations.json'), JSON.stringify(records))
  }

  it('removes only installs whose marker matches the record id', async () => {
    const matching = installAt('matching')
    write(path.join(matching, '.comfyui-desktop-2'), 'inst-1\n')
    const tracked = installAt('tracked')
    write(path.join(tracked, '.comfyui-desktop-2'), 'tracked')
    const missing = installAt('missing')
    const mismatched = installAt('mismatched')
    write(path.join(mismatched, '.comfyui-desktop-2'), 'inst-other')
    writeRecords([
      { id: 'inst-1', installPath: matching },
      { id: 'inst-2', installPath: tracked },
      { id: 'inst-3', installPath: missing },
      { id: 'inst-4', installPath: mismatched }
    ])

    const c = await loadAs('win32')
    expect(c.runUninstallCleanup([c.UNINSTALL_CLEANUP_FLAG, c.DELETE_INSTANCES_FLAG])).toBe(0)

    expect(fs.existsSync(matching)).toBe(false)
    expect(fs.existsSync(tracked)).toBe(true)
    expect(fs.existsSync(missing)).toBe(true)
    expect(fs.existsSync(mismatched)).toBe(true)
    expect(fs.existsSync(path.join(localRoot(), 'ComfyUI-Installs'))).toBe(true)
  })

  it('never plans an install whose id is the tracked marker', async () => {
    const dir = installAt('tracked-id')
    write(path.join(dir, '.comfyui-desktop-2'), 'tracked')
    writeRecords([{ id: 'tracked', installPath: dir }])

    const c = await loadAs('win32')
    const plan = c.planUninstallCleanup(c.collectUninstallCleanupInputs(bothBoxes))
    expect(plannedPaths(plan)).not.toContain(dir)
  })

  it('removes the installs folder once it is empty', async () => {
    const only = installAt('only')
    write(path.join(only, '.comfyui-desktop-2'), 'inst-1')
    writeRecords([{ id: 'inst-1', installPath: only }])

    const c = await loadAs('win32')
    expect(c.runUninstallCleanup([c.UNINSTALL_CLEANUP_FLAG, c.DELETE_INSTANCES_FLAG])).toBe(0)
    expect(fs.existsSync(path.join(localRoot(), 'ComfyUI-Installs'))).toBe(false)
  })

  it('keeps installs when the box is not checked', async () => {
    const dir = installAt('kept')
    write(path.join(dir, '.comfyui-desktop-2'), 'inst-1')
    writeRecords([{ id: 'inst-1', installPath: dir }])

    const c = await loadAs('win32')
    expect(c.runUninstallCleanup([c.UNINSTALL_CLEANUP_FLAG])).toBe(0)
    expect(fs.existsSync(dir)).toBe(true)
    expect(fs.existsSync(path.join(userData, 'installations.json'))).toBe(true)
  })

  it('refuses the Desktop One base path even with a matching marker', async () => {
    const basePath = path.join(home, 'Documents', 'ComfyUI')
    write(path.join(basePath, '.comfyui-desktop-2'), 'inst-1')
    write(path.join(appData, 'ComfyUI', 'config.json'), JSON.stringify({ basePath }))
    writeRecords([{ id: 'inst-1', installPath: basePath }])

    const c = await loadAs('win32')
    expect(c.runUninstallCleanup([c.UNINSTALL_CLEANUP_FLAG, c.DELETE_INSTANCES_FLAG])).toBe(0)
    expect(fs.existsSync(basePath)).toBe(true)
  })

  it('keeps shared input and output folders', async () => {
    const shared = path.join(localRoot(), 'ComfyUI-Shared')
    write(path.join(shared, 'input', 'a.png'))
    write(path.join(shared, 'output', 'b.png'))

    const c = await loadAs('win32')
    expect(c.DELETE_SHARED_INPUT_OUTPUT_WITH_INSTANCES).toBe(false)
    expect(c.runUninstallCleanup(allFlags(c))).toBe(0)
    expect(fs.existsSync(path.join(shared, 'input', 'a.png'))).toBe(true)
    expect(fs.existsSync(path.join(shared, 'output', 'b.png'))).toBe(true)
  })
})

describe('models', () => {
  it('removes only the default models folder', async () => {
    const shared = path.join(localRoot(), 'ComfyUI-Shared')
    const defaultModels = path.join(shared, 'models')
    const added = path.join(home, 'MyModels')
    write(path.join(defaultModels, 'checkpoints', 'a.safetensors'))
    write(path.join(added, 'checkpoints', 'b.safetensors'))
    const settings = { modelsDirs: [defaultModels, added] }
    write(path.join(userData, 'settings.json'), JSON.stringify(settings))

    const c = await loadAs('win32')
    expect(c.runUninstallCleanup([c.UNINSTALL_CLEANUP_FLAG, c.DELETE_MODELS_FLAG])).toBe(0)

    expect(fs.existsSync(defaultModels)).toBe(false)
    expect(fs.existsSync(path.join(added, 'checkpoints', 'b.safetensors'))).toBe(true)
    expect(fs.existsSync(shared)).toBe(false)
  })

  it('refuses an added models folder that sits inside the default root', async () => {
    const added = path.join(localRoot(), 'ComfyUI-Shared', 'models', 'extra')
    write(path.join(added, 'c.safetensors'))
    write(path.join(userData, 'settings.json'), JSON.stringify({ modelsDirs: [added] }))

    const c = await loadAs('win32')
    expect(c.runUninstallCleanup([c.UNINSTALL_CLEANUP_FLAG, c.DELETE_MODELS_FLAG])).toBe(0)
    expect(fs.existsSync(path.join(added, 'c.safetensors'))).toBe(true)
  })

  it('keeps the default models folder when the box is not checked', async () => {
    const defaultModels = path.join(localRoot(), 'ComfyUI-Shared', 'models')
    write(path.join(defaultModels, 'checkpoints', 'a.safetensors'))

    const c = await loadAs('win32')
    expect(c.runUninstallCleanup([c.UNINSTALL_CLEANUP_FLAG])).toBe(0)
    expect(fs.existsSync(path.join(defaultModels, 'checkpoints', 'a.safetensors'))).toBe(true)
  })
})

describe('pointer files', () => {
  it('keeps what the next install needs to find kept data', async () => {
    const c = await loadAs('win32')
    expect(c.KEEP_POINTER_FILES_FOR_KEPT_DATA).toBe(true)

    const none = c.pointerFilesToKeep(noBoxes)
    expect(none).toEqual(
      expect.arrayContaining(['installations.json', 'settings.json', 'data-location.json'])
    )

    const modelsKept = c.pointerFilesToKeep({ deleteInstances: true, deleteModels: false })
    expect(modelsKept).toEqual(expect.arrayContaining(['settings.json', 'data-location.json']))
    expect(modelsKept).not.toContain('installations.json')

    const instancesKept = c.pointerFilesToKeep({ deleteInstances: false, deleteModels: true })
    expect(instancesKept).toEqual(
      expect.arrayContaining(['installations.json', 'settings.json', 'data-location.json'])
    )

    expect(c.pointerFilesToKeep(bothBoxes)).toEqual([])
  })

  it('keeps nothing when the setting is off', async () => {
    const c = await loadAs('win32')
    expect(c.pointerFilesToKeep(noBoxes, false)).toEqual([])
    expect(c.pointerFilesToKeep({ deleteInstances: true, deleteModels: false }, false)).toEqual([])
  })

  it('plans the whole app data folder only when nothing is kept', async () => {
    write(path.join(userData, 'settings.json'), '{}')
    write(path.join(userData, 'installations.json'), '[]')
    write(path.join(userData, 'logs', 'main.log'))

    const c = await loadAs('win32')
    const inputs = c.collectUninstallCleanupInputs(noBoxes)

    const kept = plannedPaths(
      c.planUninstallCleanup(inputs, { keepPointerFiles: true, deleteSharedInputOutput: false })
    )
    expect(kept).toContain(path.join(userData, 'logs'))
    expect(kept).not.toContain(path.join(userData, 'settings.json'))
    expect(kept).not.toContain(path.join(userData, 'installations.json'))
    expect(kept).not.toContain(userData)

    const wiped = plannedPaths(
      c.planUninstallCleanup(inputs, { keepPointerFiles: false, deleteSharedInputOutput: false })
    )
    expect(wiped).toContain(userData)
  })

  it('removes the whole app data folder when both boxes are checked', async () => {
    write(path.join(userData, 'settings.json'), '{}')
    write(path.join(userData, 'installations.json'), '[]')

    const c = await loadAs('win32')
    expect(c.runUninstallCleanup(allFlags(c))).toBe(0)
    expect(fs.existsSync(userData)).toBe(false)
  })
})

describe('deletionRefusal', () => {
  const forbidden = [
    'home',
    'appData',
    'localAppData',
    'temp',
    'documents',
    'desktop',
    'downloads'
  ] as const

  it.each(forbidden)('refuses the %s folder', async (name) => {
    const c = await loadAs('win32')
    const inputs = c.collectUninstallCleanupInputs(bothBoxes)
    const plan = c.planUninstallCleanup(inputs)
    const target = inputs.folders[name]
    if (!target) throw new Error(`no ${name} folder`)
    expect(c.deletionRefusal(target, plan.guard)).not.toBeNull()
  })

  it('refuses a drive root, a relative path and a path outside the app folders', async () => {
    const c = await loadAs('win32')
    const plan = c.planUninstallCleanup(c.collectUninstallCleanupInputs(bothBoxes))
    expect(c.deletionRefusal(path.parse(home).root, plan.guard)).not.toBeNull()
    expect(c.deletionRefusal(path.join('relative', 'dir'), plan.guard)).not.toBeNull()
    expect(c.deletionRefusal(path.join(home, 'Projects'), plan.guard)).not.toBeNull()
    expect(c.deletionRefusal(path.join(userData, 'logs'), plan.guard)).toBeNull()
  })

  it('refuses an ancestor of a protected folder', async () => {
    const c = await loadAs('win32')
    const plan = c.planUninstallCleanup(c.collectUninstallCleanupInputs(bothBoxes))
    expect(c.deletionRefusal(path.dirname(home), plan.guard)).not.toBeNull()
  })

  it('records a refusal and leaves the folder in place', async () => {
    write(path.join(home, 'keep.txt'))
    const c = await loadAs('win32')
    const plan = c.planUninstallCleanup(c.collectUninstallCleanupInputs(noBoxes))
    const results = c.executeUninstallCleanup({
      entries: [{ path: home, bucket: 'A', reason: 'test' }],
      guard: plan.guard
    })
    expect(results[0]?.outcome).toBe('refused')
    expect(fs.existsSync(path.join(home, 'keep.txt'))).toBe(true)
  })

  it('keeps going after a failed delete and reports it', async () => {
    const c = await loadAs('win32')
    const guard = { protectedPaths: [], allowedRoots: [userData] }
    const first = path.join(userData, 'first')
    const second = path.join(userData, 'second')
    const removed: string[] = []
    const results = c.executeUninstallCleanup(
      {
        entries: [
          { path: first, bucket: 'A', reason: 'test' },
          { path: second, bucket: 'A', reason: 'test' }
        ],
        guard
      },
      {
        exists: () => true,
        remove: (p) => {
          if (p === first) throw Object.assign(new Error('busy'), { code: 'EBUSY' })
          removed.push(p)
        },
        isEmptyDir: () => true,
        removeEmptyDir: () => undefined
      }
    )
    expect(results.map((r) => r.outcome)).toEqual(['failed', 'removed'])
    expect(results[0]?.detail).toBe('EBUSY')
    expect(removed).toEqual([second])
  })
})

describe('macOS', () => {
  function updaterCache(): string {
    return path.join(home, 'Library', 'Caches', 'comfyui-desktop-2-updater')
  }

  it('plans the app folders under Library and the shared benchmarks', async () => {
    useMacLayout()
    const c = await loadAs('darwin')
    const inputs = c.collectUninstallCleanupInputs(bothBoxes, 'darwin')

    expect(inputs.folders.configDir).toBe(userData)
    expect(inputs.folders.dataDir).toBe(userData)
    expect(inputs.folders.logs).toBe(logs)
    expect(inputs.folders.updaterCache).toBe(updaterCache())
    expect(inputs.folders.installDir).toBe(path.join(home, 'ComfyUI-Installs'))
    expect(inputs.folders.models).toBe(path.join(home, 'ComfyUI-Shared', 'models'))

    const plan = c.planUninstallCleanup(inputs)
    const paths = plannedPaths(plan)
    expect(paths).toContain(userData)
    expect(paths).toContain(logs)
    expect(paths).toContain(updaterCache())
    expect(paths).toContain(path.join(home, 'ComfyUI-Shared', 'benchmarks'))
    expect(paths).toContain(path.join(home, 'ComfyUI-Shared', 'models'))
    expect(paths).not.toContain(home)
    expect(paths).not.toContain(path.join(localAppData, 'comfyui-desktop-2-updater'))
    const installs = plan.entries.find((e) => e.path === path.join(home, 'ComfyUI-Installs'))
    expect(installs?.onlyIfEmpty).toBe(true)
  })

  it('removes app data and keeps settings, installs and models by default', async () => {
    useMacLayout()
    write(path.join(userData, 'settings.json'), JSON.stringify({ apiKey: 'secret-token-value' }))
    write(path.join(userData, 'installations.json'), '[]')
    write(path.join(userData, 'Cache', 'data_0'))
    write(path.join(logs, 'main.log'), 'log')
    write(path.join(updaterCache(), 'pending', 'update.zip'))
    write(path.join(home, 'ComfyUI-Shared', 'benchmarks', 'gpu.json'))
    write(path.join(home, 'ComfyUI-Shared', 'models', 'a.safetensors'))
    write(path.join(appData, 'ComfyUI', 'config.json'), '{}')
    write(path.join(home, 'Library', 'Caches', 'other-app', 'x'))

    const c = await loadAs('darwin')
    expect(c.runUninstallCleanup([c.UNINSTALL_CLEANUP_FLAG], 'darwin')).toBe(0)

    expect(fs.existsSync(path.join(userData, 'settings.json'))).toBe(true)
    expect(fs.existsSync(path.join(userData, 'installations.json'))).toBe(true)
    expect(fs.existsSync(path.join(userData, 'Cache'))).toBe(false)
    expect(fs.existsSync(logs)).toBe(false)
    expect(fs.existsSync(updaterCache())).toBe(false)
    expect(fs.existsSync(path.join(home, 'ComfyUI-Shared', 'benchmarks'))).toBe(false)
    expect(fs.existsSync(path.join(home, 'ComfyUI-Shared', 'models', 'a.safetensors'))).toBe(true)
    expect(fs.existsSync(path.join(appData, 'ComfyUI', 'config.json'))).toBe(true)
    expect(fs.existsSync(path.join(home, 'Library', 'Caches', 'other-app', 'x'))).toBe(true)

    const log = fs.readFileSync(path.join(temp, c.UNINSTALL_CLEANUP_LOG_FILE), 'utf-8')
    expect(log).not.toContain('secret-token-value')
  })

  it('removes the whole app folder when both boxes are checked', async () => {
    useMacLayout()
    write(path.join(userData, 'settings.json'), '{}')
    write(path.join(userData, 'installations.json'), '[]')

    const c = await loadAs('darwin')
    expect(c.runUninstallCleanup(allFlags(c), 'darwin')).toBe(0)
    expect(fs.existsSync(userData)).toBe(false)
    expect(fs.existsSync(appData)).toBe(true)
  })

  it.each([
    [''],
    ['Library'],
    [path.join('Library', 'Application Support')],
    [path.join('Library', 'Caches')],
    [path.join('Library', 'Logs')],
    [path.join('Library', 'Preferences')],
    ['Documents'],
    ['Desktop'],
    ['Downloads']
  ])('refuses ~/%s', async (rel) => {
    useMacLayout()
    const c = await loadAs('darwin')
    const plan = c.planUninstallCleanup(c.collectUninstallCleanupInputs(bothBoxes, 'darwin'))
    expect(c.deletionRefusal(path.join(home, rel), plan.guard)).not.toBeNull()
  })

  it('refuses the file system root and the app bundle', async () => {
    useMacLayout()
    const c = await loadAs('darwin')
    const plan = c.planUninstallCleanup(c.collectUninstallCleanupInputs(bothBoxes, 'darwin'))
    expect(c.deletionRefusal(path.parse(home).root, plan.guard)).not.toBeNull()
    expect(c.deletionRefusal('/Applications/Comfy Desktop.app', plan.guard)).not.toBeNull()
  })
})

describe('Linux', () => {
  function xdg(...parts: string[]): string {
    return path.join(home, ...parts, 'comfyui-desktop-2')
  }

  it('plans the XDG folders, the old config folder and the updater cache', async () => {
    useLinuxLayout()
    const c = await loadAs('linux')
    const inputs = c.collectUninstallCleanupInputs(bothBoxes, 'linux')

    expect(inputs.folders.configDir).toBe(xdg('.config'))
    expect(inputs.folders.dataDir).toBe(xdg('.local', 'share'))
    expect(inputs.folders.stateDir).toBe(xdg('.local', 'state'))
    expect(inputs.folders.cacheDir).toBe(xdg('.cache'))
    expect(inputs.folders.updaterCache).toBe(path.join(home, '.cache', 'comfyui-desktop-2-updater'))

    const paths = plannedPaths(c.planUninstallCleanup(inputs))
    expect(paths).toEqual(
      expect.arrayContaining([
        userData,
        xdg('.config'),
        xdg('.local', 'share'),
        xdg('.local', 'state'),
        xdg('.cache'),
        path.join(home, '.cache', 'comfyui-desktop-2-updater'),
        path.join(home, 'ComfyUI-Shared', 'benchmarks'),
        path.join(home, 'ComfyUI-Shared', 'models')
      ])
    )
    expect(paths).not.toContain(logs)
    expect(paths).not.toContain(home)
  })

  it('keeps the settings and install list in their XDG folders by default', async () => {
    useLinuxLayout()
    const secret = JSON.stringify({ apiKey: 'secret-token-value' })
    write(path.join(xdg('.config'), 'settings.json'), secret)
    write(path.join(xdg('.config'), 'window-state.json'), '{}')
    write(path.join(xdg('.local', 'share'), 'installations.json'), '[]')
    write(path.join(xdg('.local', 'share'), 'snapshots', 'a.json'))
    write(path.join(xdg('.local', 'state'), 'state.json'))
    write(path.join(xdg('.cache'), 'download-cache', 'a.bin'))
    write(path.join(home, '.cache', 'comfyui-desktop-2-updater', 'pending', 'update.AppImage'))
    write(path.join(logs, 'main.log'))
    write(path.join(home, '.config', 'other-app', 'config'))

    const c = await loadAs('linux')
    expect(c.runUninstallCleanup([c.UNINSTALL_CLEANUP_FLAG], 'linux')).toBe(0)

    expect(fs.existsSync(path.join(xdg('.config'), 'settings.json'))).toBe(true)
    expect(fs.existsSync(path.join(xdg('.config'), 'window-state.json'))).toBe(false)
    expect(fs.existsSync(path.join(xdg('.local', 'share'), 'installations.json'))).toBe(true)
    expect(fs.existsSync(path.join(xdg('.local', 'share'), 'snapshots'))).toBe(false)
    expect(fs.existsSync(xdg('.local', 'state'))).toBe(false)
    expect(fs.existsSync(xdg('.cache'))).toBe(false)
    expect(fs.existsSync(path.join(home, '.cache', 'comfyui-desktop-2-updater'))).toBe(false)
    expect(fs.existsSync(userData)).toBe(false)
    expect(fs.existsSync(path.join(home, '.config', 'other-app', 'config'))).toBe(true)

    const log = fs.readFileSync(path.join(temp, c.UNINSTALL_CLEANUP_LOG_FILE), 'utf-8')
    expect(log).not.toContain('secret-token-value')
  })

  it('removes every XDG folder when both boxes are checked', async () => {
    useLinuxLayout()
    write(path.join(xdg('.config'), 'settings.json'), '{}')
    write(path.join(xdg('.local', 'share'), 'installations.json'), '[]')

    const c = await loadAs('linux')
    expect(c.runUninstallCleanup(allFlags(c), 'linux')).toBe(0)
    expect(fs.existsSync(xdg('.config'))).toBe(false)
    expect(fs.existsSync(xdg('.local', 'share'))).toBe(false)
    expect(fs.existsSync(path.join(home, '.config'))).toBe(true)
    expect(fs.existsSync(path.join(home, '.local', 'share'))).toBe(true)
  })

  it('follows XDG_CACHE_HOME and refuses the folder itself', async () => {
    useLinuxLayout()
    const xdgCache = path.join(caseRoot, 'xdg-cache')
    process.env.XDG_CACHE_HOME = xdgCache
    const c = await loadAs('linux')
    const inputs = c.collectUninstallCleanupInputs(bothBoxes, 'linux')

    expect(inputs.folders.cacheDir).toBe(path.join(xdgCache, 'comfyui-desktop-2'))
    expect(inputs.folders.updaterCache).toBe(path.join(xdgCache, 'comfyui-desktop-2-updater'))
    const plan = c.planUninstallCleanup(inputs)
    expect(plannedPaths(plan)).toContain(path.join(xdgCache, 'comfyui-desktop-2'))
    expect(c.deletionRefusal(xdgCache, plan.guard)).not.toBeNull()
  })

  it.each([
    [''],
    ['.config'],
    ['.cache'],
    ['.local'],
    [path.join('.local', 'share')],
    [path.join('.local', 'state')],
    ['Documents'],
    ['Desktop'],
    ['Downloads']
  ])('refuses ~/%s', async (rel) => {
    useLinuxLayout()
    const c = await loadAs('linux')
    const plan = c.planUninstallCleanup(c.collectUninstallCleanupInputs(bothBoxes, 'linux'))
    expect(c.deletionRefusal(path.join(home, rel), plan.guard)).not.toBeNull()
  })

  it('refuses the file system root and the app install folder', async () => {
    useLinuxLayout()
    const c = await loadAs('linux')
    const plan = c.planUninstallCleanup(c.collectUninstallCleanupInputs(bothBoxes, 'linux'))
    expect(c.deletionRefusal(path.parse(home).root, plan.guard)).not.toBeNull()
    expect(c.deletionRefusal(path.dirname(exePath), plan.guard)).not.toBeNull()
  })
})

describe('unsupported platforms', () => {
  it('deletes nothing', async () => {
    write(path.join(userData, 'logs', 'main.log'))
    const c = await loadAs('freebsd')

    expect(c.runUninstallCleanup(allFlags(c), 'freebsd')).toBe(0)
    expect(fs.existsSync(path.join(userData, 'logs', 'main.log'))).toBe(true)
    expect(fs.existsSync(path.join(temp, c.UNINSTALL_CLEANUP_LOG_FILE))).toBe(false)
  })
})

describe('relaunching into the cleanup', () => {
  it('passes only the cleanup flags to a packaged app', async () => {
    const c = await loadAs('darwin')
    const options = c.cleanupRelaunchOptions(
      { deleteInstances: false, deleteModels: true },
      { argv: ['/Applications/Comfy Desktop.app/Contents/MacOS/Comfy Desktop'], isPackaged: true }
    )
    expect(options).toEqual({ args: [c.UNINSTALL_CLEANUP_FLAG, c.DELETE_MODELS_FLAG] })
  })

  it('keeps the dev app path and drops stale cleanup flags', async () => {
    const c = await loadAs('linux')
    const options = c.cleanupRelaunchOptions(bothBoxes, {
      argv: ['/usr/bin/electron', '.', c.UNINSTALL_CLEANUP_FLAG, c.DELETE_MODELS_FLAG],
      isPackaged: false
    })
    expect(options.args).toEqual(['.', ...allFlags(c)])
  })

  it('relaunches the AppImage file rather than its mount point', async () => {
    const c = await loadAs('linux')
    const options = c.cleanupRelaunchOptions(noBoxes, {
      argv: ['/tmp/.mount_Comfy/comfyui-desktop-2'],
      isPackaged: true,
      appImage: '/home/user/Applications/Comfy-Desktop.AppImage'
    })
    expect(options).toEqual({
      execPath: '/home/user/Applications/Comfy-Desktop.AppImage',
      args: [c.UNINSTALL_CLEANUP_FLAG]
    })
  })

  it('asks Electron to relaunch with the flags, then quits', async () => {
    process.env.APPIMAGE = '/home/user/Comfy-Desktop.AppImage'
    const c = await loadAs('linux')
    const { app } = await import('electron')
    const quit = vi.fn()

    c.relaunchIntoUninstallCleanup({ deleteInstances: true, deleteModels: false }, quit)

    const relaunch = vi.mocked(app.relaunch)
    expect(relaunch).toHaveBeenCalledTimes(1)
    const options = relaunch.mock.calls[0]?.[0]
    expect(options?.execPath).toBe('/home/user/Comfy-Desktop.AppImage')
    expect(options?.args?.slice(-2)).toEqual([c.UNINSTALL_CLEANUP_FLAG, c.DELETE_INSTANCES_FLAG])
    expect(quit).toHaveBeenCalledTimes(1)
    expect(relaunch.mock.invocationCallOrder[0]).toBeLessThan(quit.mock.invocationCallOrder[0]!)
  })
})
