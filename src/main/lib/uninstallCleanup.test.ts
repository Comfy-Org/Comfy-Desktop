import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type CleanupModule = typeof import('./uninstallCleanup')
type CleanupFs = import('./uninstallCleanup').CleanupFs
type DeletionGuard = import('./uninstallCleanup').DeletionGuard
type CleanupEntry = import('./uninstallCleanup').CleanupEntry
type EntryKind = import('./uninstallCleanup').EntryKind

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
  vi.restoreAllMocks()
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
const instancesBox = { deleteInstances: true, deleteModels: false }

const linkType = process.platform === 'win32' ? 'junction' : 'dir'

function diskOps(c: CleanupModule, order: string[], failing: string | null = null): CleanupFs {
  function tracked(op: (p: string) => void): (p: string) => void {
    return (p) => {
      order.push(p)
      op(p)
    }
  }
  const ops = c.nodeCleanupFs
  return {
    ...ops,
    list: (dir) => {
      if (dir === failing) {
        fs.rmSync(path.join(dir, '.comfyui-desktop-2'), { force: true })
        throw Object.assign(new Error('busy'), { code: 'EBUSY' })
      }
      return ops.list(dir)
    },
    removeFile: tracked((p) => ops.removeFile(p)),
    removeLink: tracked((p) => ops.removeLink(p)),
    removeEmptyDir: tracked((p) => ops.removeEmptyDir(p))
  }
}

function bareGuard(allowedRoots: string[], linksAllowedAtOrAbove: string[] = []): DeletionGuard {
  return { protectedPaths: [], keptPaths: [], allowedRoots, linksAllowedAtOrAbove }
}

function testEntry(p: string, seen: EntryKind = 'dir'): CleanupEntry {
  return { path: p, bucket: 'A', reason: 'test', seen }
}

function writeInstallRecords(records: Record<string, unknown>[]): void {
  const text = JSON.stringify(records)
  write(path.join(userData, 'installations.json'), text)
  write(path.join(userData, 'installations.json.bak'), text)
}

function denied(): NodeJS.ErrnoException {
  return Object.assign(new Error('denied'), { code: 'EACCES' })
}

function failReadsOf(file: string): void {
  const realRead = fs.readFileSync.bind(fs) as typeof fs.readFileSync
  const read = (p: fs.PathOrFileDescriptor, opts?: unknown): string => {
    if (p === file) throw denied()
    return realRead(p, opts as BufferEncoding)
  }
  vi.spyOn(fs, 'readFileSync').mockImplementation(read as typeof fs.readFileSync)
}

function failLstatOf(target: string): void {
  const realLstat = fs.lstatSync.bind(fs) as typeof fs.lstatSync
  const lstat = (p: fs.PathLike, opts?: fs.StatSyncOptions): ReturnType<typeof realLstat> => {
    if (p === target) throw denied()
    return realLstat(p, opts)
  }
  vi.spyOn(fs, 'lstatSync').mockImplementation(lstat as typeof fs.lstatSync)
}

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

  function writeRecords(records: Record<string, unknown>[]): void {
    write(path.join(userData, 'installations.json'), JSON.stringify(records))
  }

  function adoptedSetup(): { dir: string; legacy: string } {
    const legacy = path.join(home, 'LegacyComfyUI')
    write(path.join(legacy, '.comfyui-desktop-2'), 'inst-1\n')
    write(path.join(legacy, '.venv', 'pyvenv.cfg'))
    write(path.join(legacy, 'user', 'default', 'workflow.json'))
    const dir = installAt('adopted')
    write(path.join(dir, '.comfyui-desktop-2'), 'inst-1')
    writeRecords([{ id: 'inst-1', installPath: dir, adoptedBaseDir: legacy }])
    return { dir, legacy }
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

  it('keeps an install inside the app data folder when the box is not checked', async () => {
    const dir = path.join(userData, 'ComfyUI-Installs', 'inside')
    write(path.join(dir, '.comfyui-desktop-2'), 'inst-1')
    write(path.join(dir, 'ComfyUI', 'main.py'))
    writeRecords([{ id: 'inst-1', installPath: dir }])
    write(path.join(userData, 'logs', 'main.log'))

    const c = await loadAs('win32')
    expect(c.runUninstallCleanup([c.UNINSTALL_CLEANUP_FLAG])).toBe(0)
    expect(fs.existsSync(path.join(dir, 'ComfyUI', 'main.py'))).toBe(true)
    expect(fs.existsSync(path.join(userData, 'logs'))).toBe(false)
  })

  it('keeps installs inside the app data folder that are not being removed', async () => {
    const tracked = path.join(userData, 'tracked')
    write(path.join(tracked, '.comfyui-desktop-2'), 'tracked')
    const mismatched = path.join(userData, 'mismatched')
    write(path.join(mismatched, '.comfyui-desktop-2'), 'inst-other')
    writeRecords([
      { id: 'inst-2', installPath: tracked },
      { id: 'inst-4', installPath: mismatched }
    ])
    write(path.join(userData, 'logs', 'main.log'))

    const c = await loadAs('win32')
    expect(c.runUninstallCleanup(allFlags(c))).toBe(0)
    expect(fs.existsSync(tracked)).toBe(true)
    expect(fs.existsSync(mismatched)).toBe(true)
    expect(fs.existsSync(path.join(userData, 'logs'))).toBe(false)
  })

  it('keeps the records of installs that are not removed and drops the removed ones', async () => {
    const matching = installAt('matching')
    write(path.join(matching, '.comfyui-desktop-2'), 'inst-1')
    const tracked = installAt('tracked')
    write(path.join(tracked, '.comfyui-desktop-2'), 'tracked')
    writeInstallRecords([
      { id: 'inst-1', installPath: matching },
      { id: 'inst-2', installPath: tracked }
    ])

    const c = await loadAs('win32')
    expect(c.runUninstallCleanup(allFlags(c))).toBe(0)
    expect(fs.existsSync(matching)).toBe(false)
    expect(fs.existsSync(path.join(tracked, 'ComfyUI', 'main.py'))).toBe(true)
    expect(fs.existsSync(path.join(userData, 'installations.json.bak'))).toBe(true)
    const text = fs.readFileSync(path.join(userData, 'installations.json'), 'utf-8')
    const records = JSON.parse(text) as Record<string, unknown>[]
    expect(records.map((r) => r.id)).toEqual(['inst-2'])
  })

  it('keeps an install whose folder is a link and its record', async () => {
    const external = path.join(caseRoot, 'external-install')
    write(path.join(external, '.comfyui-desktop-2'), 'inst-1')
    write(path.join(external, 'ComfyUI', 'main.py'))
    const linked = path.join(localRoot(), 'ComfyUI-Installs', 'linked')
    fs.mkdirSync(path.dirname(linked), { recursive: true })
    fs.symlinkSync(external, linked, linkType)
    writeRecords([{ id: 'inst-1', installPath: linked }])

    const c = await loadAs('win32')
    expect(c.runUninstallCleanup([c.UNINSTALL_CLEANUP_FLAG, c.DELETE_INSTANCES_FLAG])).toBe(0)
    expect(fs.lstatSync(linked).isSymbolicLink()).toBe(true)
    expect(fs.existsSync(path.join(external, 'ComfyUI', 'main.py'))).toBe(true)
    const text = fs.readFileSync(path.join(userData, 'installations.json'), 'utf-8')
    const records = JSON.parse(text) as Record<string, unknown>[]
    expect(records.map((r) => r.id)).toEqual(['inst-1'])
  })

  it('refuses a custom install under a linked parent folder', async () => {
    const realParent = path.join(caseRoot, 'real-parent')
    const linkedParent = path.join(caseRoot, 'linked-parent')
    const main = path.join(realParent, 'install', 'ComfyUI', 'main.py')
    write(path.join(realParent, 'install', '.comfyui-desktop-2'), 'inst-1')
    write(main, 'keep')
    fs.symlinkSync(realParent, linkedParent, linkType)
    const install = path.join(linkedParent, 'install')
    writeRecords([{ id: 'inst-1', installPath: install }])

    const c = await loadAs('win32')
    const results = c.runCleanup(c.collectUninstallCleanupInputs(instancesBox))
    const result = results.find((r) => r.entry.path === install)
    expect(result?.outcome).toBe('refused')
    expect(result?.detail).toBe(`inside a linked folder: ${linkedParent}`)
    expect(fs.readFileSync(main, 'utf-8')).toBe('keep')
  })

  it('keeps a per-install models folder inside the shared models folder', async () => {
    const dir = installAt('own-models')
    write(path.join(dir, '.comfyui-desktop-2'), 'inst-1')
    const extra = path.join(localRoot(), 'ComfyUI-Shared', 'models', 'inst-1-loras')
    write(path.join(extra, 'a.safetensors'))
    writeRecords([{ id: 'inst-1', installPath: dir, modelDirs: [extra] }])

    const c = await loadAs('win32')
    expect(c.runUninstallCleanup(allFlags(c))).toBe(0)
    expect(fs.existsSync(dir)).toBe(false)
    expect(fs.existsSync(path.join(extra, 'a.safetensors'))).toBe(true)
  })

  it('keeps per-install input and output folders outside the install', async () => {
    const dir = installAt('own-io')
    write(path.join(dir, '.comfyui-desktop-2'), 'inst-1')
    write(path.join(dir, 'ComfyUI', 'input', 'inside.png'))
    const input = path.join(userData, 'inst-1-input')
    const output = path.join(userData, 'inst-1-output')
    write(path.join(input, 'a.png'))
    write(path.join(output, 'b.png'))
    writeRecords([{ id: 'inst-1', installPath: dir, inputDir: input, outputDir: output }])
    write(path.join(userData, 'logs', 'main.log'))

    const c = await loadAs('win32')
    expect(c.runUninstallCleanup(allFlags(c))).toBe(0)
    expect(fs.existsSync(dir)).toBe(false)
    expect(fs.existsSync(path.join(input, 'a.png'))).toBe(true)
    expect(fs.existsSync(path.join(output, 'b.png'))).toBe(true)
    expect(fs.existsSync(path.join(userData, 'logs'))).toBe(false)
  })

  it('retires the adoption marker and keeps the legacy files', async () => {
    const { dir, legacy } = adoptedSetup()

    const c = await loadAs('win32')
    expect(c.runUninstallCleanup([c.UNINSTALL_CLEANUP_FLAG, c.DELETE_INSTANCES_FLAG])).toBe(0)
    expect(fs.existsSync(dir)).toBe(false)
    expect(fs.existsSync(path.join(legacy, '.comfyui-desktop-2'))).toBe(false)
    expect(fs.existsSync(path.join(legacy, '.venv', 'pyvenv.cfg'))).toBe(true)
    expect(fs.existsSync(path.join(legacy, 'user', 'default', 'workflow.json'))).toBe(true)
  })

  it('keeps the adoption marker when the adopted install is not removed', async () => {
    const { dir, legacy } = adoptedSetup()

    const c = await loadAs('win32')
    const inputs = c.collectUninstallCleanupInputs(instancesBox)
    c.runCleanup(inputs, c.DEFAULT_CLEANUP_POLICY, diskOps(c, [], dir))
    expect(fs.readFileSync(path.join(legacy, '.comfyui-desktop-2'), 'utf-8')).toBe('inst-1\n')
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

  it('refuses an install that holds the shared input, output and kept models folders', async () => {
    const shared = path.join(localRoot(), 'ComfyUI-Shared')
    write(path.join(shared, '.comfyui-desktop-2'), 'inst-1')
    write(path.join(shared, 'ComfyUI', 'main.py'))
    write(path.join(shared, 'models', 'a.safetensors'))
    write(path.join(shared, 'input', 'a.png'))
    write(path.join(shared, 'output', 'b.png'))
    writeRecords([{ id: 'inst-1', installPath: shared }])

    const c = await loadAs('win32')
    const results = c.runCleanup(c.collectUninstallCleanupInputs(instancesBox))
    expect(results.find((r) => r.entry.path === shared)?.outcome).toBe('refused')
    expect(fs.existsSync(path.join(shared, 'models', 'a.safetensors'))).toBe(true)
    expect(fs.existsSync(path.join(shared, 'input', 'a.png'))).toBe(true)
    expect(fs.existsSync(path.join(shared, 'output', 'b.png'))).toBe(true)
  })

  it('keeps every folder named in the settings or an install record', async () => {
    const dir = installAt('named')
    write(path.join(dir, '.comfyui-desktop-2'), 'inst-1')
    const named = ['Installs', 'Saved', 'venv', 'nested'].map((name) => path.join(userData, name))
    for (const folder of named) write(path.join(folder, 'keep.txt'))
    const [installDir, saved, venv, nested] = named
    const settings = { installDir, lastSaveDialogDir: saved }
    write(path.join(userData, 'settings.json'), JSON.stringify(settings))
    writeRecords([{ id: 'inst-1', installPath: dir, venvPath: venv, extra: { paths: [nested] } }])
    write(path.join(userData, 'logs', 'main.log'))

    const c = await loadAs('win32')
    expect(c.runUninstallCleanup(allFlags(c))).toBe(0)
    expect(fs.existsSync(dir)).toBe(false)
    for (const folder of named) expect(fs.existsSync(path.join(folder, 'keep.txt'))).toBe(true)
    expect(fs.existsSync(path.join(userData, 'logs'))).toBe(false)
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

describe('order and failures', () => {
  function installWithModels(): { install: string; models: string } {
    const install = path.join(localRoot(), 'ComfyUI-Installs', 'a')
    write(path.join(install, '.comfyui-desktop-2'), 'inst-1')
    write(path.join(install, 'ComfyUI', 'main.py'))
    writeInstallRecords([{ id: 'inst-1', installPath: install }])
    const models = path.join(localRoot(), 'ComfyUI-Shared', 'models')
    write(path.join(models, 'a.safetensors'))
    write(path.join(userData, 'logs', 'main.log'))
    return { install, models }
  }

  it('removes installs and models before app data', async () => {
    const { install, models } = installWithModels()

    const c = await loadAs('win32')
    const order: string[] = []
    const inputs = c.collectUninstallCleanupInputs(bothBoxes)
    c.runCleanup(inputs, c.DEFAULT_CLEANUP_POLICY, diskOps(c, order))

    expect(order).toContain(install)
    expect(order).toContain(models)
    expect(order.indexOf(userData)).toBeGreaterThan(order.indexOf(install))
    expect(order.indexOf(userData)).toBeGreaterThan(order.indexOf(models))
  })

  it('keeps the install list and the marker when an install cannot be removed', async () => {
    const { install } = installWithModels()

    const c = await loadAs('win32')
    const inputs = c.collectUninstallCleanupInputs(bothBoxes)
    const results = c.runCleanup(inputs, c.DEFAULT_CLEANUP_POLICY, diskOps(c, [], install))

    expect(results.find((r) => r.entry.path === install)?.outcome).toBe('failed')
    expect(fs.readFileSync(path.join(install, '.comfyui-desktop-2'), 'utf-8')).toBe('inst-1')
    expect(fs.existsSync(path.join(userData, 'installations.json'))).toBe(true)
    expect(fs.existsSync(path.join(userData, 'installations.json.bak'))).toBe(true)
    expect(fs.existsSync(path.join(userData, 'logs'))).toBe(false)
    expect(c.keptInstallIds(results)).toEqual(['inst-1'])
    expect(c.formatCleanupLog(bothBoxes, results, new Date())).toContain(
      'kept in the install list because their folders were not removed: inst-1'
    )
  })

  it('marks a failed install as partially deleted and leaves a refused one as it was', async () => {
    const { install } = installWithModels()
    const basePath = path.join(home, 'Documents', 'ComfyUI')
    write(path.join(basePath, '.comfyui-desktop-2'), 'inst-2')
    write(path.join(appData, 'ComfyUI', 'config.json'), JSON.stringify({ basePath }))
    writeInstallRecords([
      { id: 'inst-1', installPath: install, sourceId: 'standalone', status: 'installed' },
      { id: 'inst-2', installPath: basePath, sourceId: 'standalone', status: 'installed' }
    ])

    const c = await loadAs('win32')
    const inputs = c.collectUninstallCleanupInputs(bothBoxes)
    const results = c.runCleanup(inputs, c.DEFAULT_CLEANUP_POLICY, diskOps(c, [], install))

    expect(results.find((r) => r.entry.path === install)?.outcome).toBe('failed')
    expect(results.find((r) => r.entry.path === basePath)?.outcome).toBe('refused')
    const text = fs.readFileSync(path.join(userData, 'installations.json'), 'utf-8')
    const records = JSON.parse(text) as Record<string, unknown>[]
    expect(records.map((r) => [r.id, r.status])).toEqual([
      ['inst-1', 'partial-delete'],
      ['inst-2', 'installed']
    ])
    expect(records[0]?.sourceId).toBe('standalone')
  })

  function idsAndStatus(name: string): unknown[][] {
    const text = fs.readFileSync(path.join(userData, name), 'utf-8')
    const records = JSON.parse(text) as Record<string, unknown>[]
    return records.map((r) => [r.id, r.status])
  }

  it('keeps output folders named only by a removed install across two cleanups', async () => {
    const removed = path.join(localRoot(), 'ComfyUI-Installs', 'a')
    const failing = path.join(localRoot(), 'ComfyUI-Installs', 'b')
    write(path.join(removed, '.comfyui-desktop-2'), 'inst-1')
    write(path.join(failing, '.comfyui-desktop-2'), 'inst-2')
    const oldOutput = path.join(userData, 'OldOutput')
    const newOutput = path.join(userData, 'NewOutput')
    write(path.join(oldOutput, 'old.png'), 'keep')
    write(path.join(newOutput, 'new.png'), 'keep')
    const second = { id: 'inst-2', installPath: failing }
    const current = [{ id: 'inst-1', installPath: removed, outputDir: newOutput }, second]
    const earlier = [{ id: 'inst-1', installPath: removed, outputDir: oldOutput }, second]
    write(path.join(userData, 'installations.json'), JSON.stringify(current))
    write(path.join(userData, 'installations.json.bak'), JSON.stringify(earlier))
    write(path.join(userData, 'logs', 'main.log'))

    const c = await loadAs('win32')
    for (let run = 0; run < 2; run++) {
      const inputs = c.collectUninstallCleanupInputs(instancesBox)
      c.runCleanup(inputs, c.DEFAULT_CLEANUP_POLICY, diskOps(c, [], failing))
    }

    expect(fs.existsSync(removed)).toBe(false)
    expect(fs.readFileSync(path.join(oldOutput, 'old.png'), 'utf-8')).toBe('keep')
    expect(fs.readFileSync(path.join(newOutput, 'new.png'), 'utf-8')).toBe('keep')
    expect(fs.existsSync(path.join(userData, 'logs'))).toBe(false)
    for (const name of ['installations.json', 'installations.json.bak']) {
      expect(idsAndStatus(name)).toEqual([['inst-2', 'partial-delete']])
    }
    const keptText = fs.readFileSync(path.join(userData, 'uninstall-kept-paths.json'), 'utf-8')
    expect(JSON.parse(keptText)).toEqual(
      expect.arrayContaining([
        { path: oldOutput, roles: ['output'] },
        { path: newOutput, roles: ['output'] }
      ])
    )
  })

  it('rewrites both copies of the install list when only the backup can be read', async () => {
    const removed = path.join(localRoot(), 'ComfyUI-Installs', 'a')
    write(path.join(removed, '.comfyui-desktop-2'), 'inst-1')
    const unmarked = path.join(localRoot(), 'ComfyUI-Installs', 'b')
    write(path.join(unmarked, 'ComfyUI', 'main.py'))
    const records = [
      { id: 'inst-1', installPath: removed },
      { id: 'inst-2', installPath: unmarked }
    ]
    write(path.join(userData, 'installations.json'), '[{"id": "inst-1",')
    write(path.join(userData, 'installations.json.bak'), JSON.stringify(records))

    const c = await loadAs('win32')
    expect(c.runUninstallCleanup([c.UNINSTALL_CLEANUP_FLAG, c.DELETE_INSTANCES_FLAG])).toBe(0)

    expect(fs.existsSync(removed)).toBe(false)
    expect(fs.existsSync(path.join(unmarked, 'ComfyUI', 'main.py'))).toBe(true)
    for (const name of ['installations.json', 'installations.json.bak']) {
      expect(idsAndStatus(name)).toEqual([['inst-2', undefined]])
    }
  })

  it('refuses an install whose marker changes after collection and keeps its record', async () => {
    const { install } = installWithModels()

    const c = await loadAs('win32')
    const inputs = c.collectUninstallCleanupInputs(instancesBox)
    write(path.join(install, '.comfyui-desktop-2'), 'inst-other')
    const results = c.runCleanup(inputs)

    const result = results.find((r) => r.entry.path === install)
    expect(result?.outcome).toBe('refused')
    expect(result?.detail).toBe('its Desktop marker no longer reads inst-1')
    expect(fs.existsSync(path.join(install, 'ComfyUI', 'main.py'))).toBe(true)
    expect(idsAndStatus('installations.json')).toEqual([['inst-1', undefined]])
  })

  it('reports a failure when no copy of the install list is left to rewrite', async () => {
    const { install } = installWithModels()

    const c = await loadAs('win32')
    const inputs = c.collectUninstallCleanupInputs(instancesBox)
    const list = path.join(userData, 'installations.json')
    const results = c.runCleanup(inputs, c.DEFAULT_CLEANUP_POLICY, {
      ...c.nodeCleanupFs,
      removeFile: (p) => {
        c.nodeCleanupFs.removeFile(p)
        fs.rmSync(list, { force: true })
        fs.rmSync(`${list}.bak`, { force: true })
      }
    })

    expect(fs.existsSync(install)).toBe(false)
    const result = results.find((r) => r.entry.reason === 'install list update')
    expect(result?.outcome).toBe('failed')
    expect(result?.detail).toBe('neither copy of the install list could be read')
  })

  it('changes neither list copy when the primary cannot be read during cleanup', async () => {
    const { install } = installWithModels()

    const c = await loadAs('win32')
    const inputs = c.collectUninstallCleanupInputs(instancesBox)
    failReadsOf(path.join(userData, 'installations.json'))
    const results = c.runCleanup(inputs)
    vi.restoreAllMocks()

    expect(fs.existsSync(install)).toBe(false)
    const result = results.find((r) => r.entry.reason === 'install list update')
    expect(result?.outcome).toBe('failed')
    expect(result?.detail).toBe('installations.json could not be read, so neither copy was changed')
    for (const name of ['installations.json', 'installations.json.bak']) {
      expect(idsAndStatus(name)).toEqual([['inst-1', undefined]])
    }
  })

  it('keeps an install and its records when its type cannot be checked', async () => {
    const { install } = installWithModels()
    failLstatOf(install)

    const c = await loadAs('win32')
    expect(c.runUninstallCleanup([c.UNINSTALL_CLEANUP_FLAG, c.DELETE_INSTANCES_FLAG])).toBe(1)
    vi.restoreAllMocks()

    expect(fs.readFileSync(path.join(install, '.comfyui-desktop-2'), 'utf-8')).toBe('inst-1')
    expect(fs.existsSync(path.join(install, 'ComfyUI', 'main.py'))).toBe(true)
    for (const name of ['installations.json', 'installations.json.bak']) {
      expect(idsAndStatus(name)).toEqual([['inst-1', undefined]])
    }
    const log = fs.readFileSync(path.join(temp, c.UNINSTALL_CLEANUP_LOG_FILE), 'utf-8')
    expect(log).toContain('could not be checked when cleanup started: EACCES')
  })
})

describe('links inside app data', () => {
  it('leaves a link alone when a kept models folder lies behind it', async () => {
    const external = path.join(caseRoot, 'external')
    const linked = path.join(userData, 'linked')
    write(path.join(external, 'models', 'model.safetensors'))
    write(path.join(external, 'photos', 'family.png'), 'keep')
    fs.symlinkSync(external, linked, linkType)
    const settings = { modelsDirs: [path.join(linked, 'models')] }
    write(path.join(userData, 'settings.json'), JSON.stringify(settings))
    write(path.join(userData, 'logs', 'main.log'))

    const c = await loadAs('win32')
    expect(c.runUninstallCleanup([c.UNINSTALL_CLEANUP_FLAG])).toBe(0)
    expect(fs.readFileSync(path.join(external, 'photos', 'family.png'), 'utf-8')).toBe('keep')
    expect(fs.existsSync(path.join(linked, 'models', 'model.safetensors'))).toBe(true)
    expect(fs.existsSync(path.join(userData, 'logs'))).toBe(false)
  })

  it('removes a link without touching the folder it points to', async () => {
    const external = path.join(caseRoot, 'external')
    const linked = path.join(userData, 'linked')
    write(path.join(external, 'photos', 'family.png'), 'keep')
    fs.symlinkSync(external, linked, linkType)
    write(path.join(userData, 'settings.json'), '{}')

    const c = await loadAs('win32')
    expect(c.runUninstallCleanup([c.UNINSTALL_CLEANUP_FLAG])).toBe(0)
    expect(fs.existsSync(linked)).toBe(false)
    expect(fs.readFileSync(path.join(external, 'photos', 'family.png'), 'utf-8')).toBe('keep')
  })

  it('leaves a linked older-name folder alone when kept models lie behind it', async () => {
    const external = path.join(caseRoot, 'external')
    const linked = path.join(appData, 'ComfyUI Launcher')
    write(path.join(external, 'models', 'model.safetensors'))
    write(path.join(external, 'photos', 'family.png'), 'keep')
    fs.symlinkSync(external, linked, linkType)
    const settings = { modelsDirs: [path.join(linked, 'models')] }
    write(path.join(userData, 'settings.json'), JSON.stringify(settings))
    write(path.join(userData, 'logs', 'main.log'))

    const c = await loadAs('win32')
    expect(c.runUninstallCleanup([c.UNINSTALL_CLEANUP_FLAG])).toBe(0)
    expect(fs.readFileSync(path.join(external, 'photos', 'family.png'), 'utf-8')).toBe('keep')
    expect(fs.existsSync(path.join(linked, 'models', 'model.safetensors'))).toBe(true)
    expect(fs.existsSync(path.join(userData, 'logs'))).toBe(false)
  })

  it('leaves a linked app data folder alone when kept data lies behind it', async () => {
    const external = path.join(caseRoot, 'external')
    write(path.join(external, 'models', 'model.safetensors'))
    write(path.join(external, 'photos', 'family.png'), 'keep')
    fs.rmSync(userData, { recursive: true, force: true })
    fs.symlinkSync(external, userData, linkType)
    const settings = { modelsDirs: [path.join(userData, 'models')] }
    write(path.join(userData, 'settings.json'), JSON.stringify(settings))

    const c = await loadAs('win32')
    expect(c.runUninstallCleanup([c.UNINSTALL_CLEANUP_FLAG])).toBe(0)
    expect(fs.readFileSync(path.join(external, 'photos', 'family.png'), 'utf-8')).toBe('keep')
    expect(fs.existsSync(path.join(external, 'models', 'model.safetensors'))).toBe(true)
    expect(fs.lstatSync(userData).isSymbolicLink()).toBe(true)
  })

  it('removes a linked cache folder as a link and keeps what it points to', async () => {
    const external = path.join(caseRoot, 'external')
    const linked = path.join(localRoot(), 'ComfyUI-Cache')
    write(path.join(external, 'download-cache', 'a.bin'), 'cached')
    write(path.join(external, 'photos', 'family.png'), 'keep')
    fs.mkdirSync(localRoot(), { recursive: true })
    fs.symlinkSync(external, linked, linkType)

    const c = await loadAs('win32')
    expect(c.runUninstallCleanup([c.UNINSTALL_CLEANUP_FLAG])).toBe(0)
    expect(fs.existsSync(linked)).toBe(false)
    const cached = path.join(external, 'download-cache', 'a.bin')
    expect(fs.readFileSync(cached, 'utf-8')).toBe('cached')
    expect(fs.readFileSync(path.join(external, 'photos', 'family.png'), 'utf-8')).toBe('keep')
  })

  function linkedCache(): string {
    const external = path.join(caseRoot, 'external')
    const linked = path.join(localRoot(), 'ComfyUI-Cache')
    write(path.join(external, 'download-cache', 'a.bin'), 'cached')
    fs.mkdirSync(localRoot(), { recursive: true })
    fs.symlinkSync(external, linked, linkType)
    return linked
  }

  function swapForFolder(linked: string): string {
    fs.unlinkSync(linked)
    const photo = path.join(linked, 'family.png')
    write(photo, 'keep')
    return photo
  }

  it('refuses a planned link that became a folder', async () => {
    const linked = linkedCache()

    const c = await loadAs('win32')
    const plan = c.planUninstallCleanup(c.collectUninstallCleanupInputs(noBoxes))
    expect(plan.entries.find((e) => e.path === linked)?.seen).toBe('link')
    const photo = swapForFolder(linked)
    const results = c.executeUninstallCleanup(plan)

    const result = results.find((r) => r.entry.path === linked)
    expect(result?.outcome).toBe('refused')
    expect(result?.detail).toBe('was a link when cleanup started, now a folder')
    expect(fs.readFileSync(photo, 'utf-8')).toBe('keep')
  })

  it('refuses a planned empty folder that became a link', async () => {
    const external = path.join(caseRoot, 'external')
    write(path.join(external, 'a.bin'), 'cached')
    const cacheParent = localRoot()
    fs.mkdirSync(cacheParent, { recursive: true })

    const c = await loadAs('win32')
    const plan = c.planUninstallCleanup(c.collectUninstallCleanupInputs(noBoxes))
    expect(plan.entries.find((e) => e.path === cacheParent)?.seen).toBe('dir')
    fs.rmdirSync(cacheParent)
    fs.symlinkSync(external, cacheParent, linkType)
    const results = c.executeUninstallCleanup(plan)

    const result = results.find((r) => r.entry.path === cacheParent)
    expect(result?.outcome).toBe('refused')
    expect(result?.detail).toBe('was a folder when cleanup started, now a link')
    expect(fs.lstatSync(cacheParent).isSymbolicLink()).toBe(true)
    expect(fs.readFileSync(path.join(external, 'a.bin'), 'utf-8')).toBe('cached')
  })

  it('does not walk into a folder swapped in for a link during the walk', async () => {
    const external = path.join(caseRoot, 'external')
    write(path.join(external, 'a.bin'), 'cached')
    const walked = path.join(userData, 'walked')
    const linked = path.join(walked, 'linked')
    write(path.join(walked, 'scratch.txt'))
    fs.symlinkSync(external, linked, linkType)

    const c = await loadAs('win32')
    const guard = c.planUninstallCleanup(c.collectUninstallCleanupInputs(noBoxes)).guard
    let photo = ''
    const swapping: CleanupFs = {
      ...c.nodeCleanupFs,
      entryInfo: (p) => {
        const info = c.nodeCleanupFs.entryInfo(p)
        if (p === linked && info.kind === 'link' && !photo) photo = swapForFolder(linked)
        return info
      }
    }
    const [result] = c.executeUninstallCleanup({ entries: [testEntry(walked)], guard }, swapping)

    expect(result?.outcome).toBe('failed')
    expect(fs.readFileSync(photo, 'utf-8')).toBe('keep')
    expect(fs.existsSync(path.join(walked, 'scratch.txt'))).toBe(false)
    expect(fs.readFileSync(path.join(external, 'a.bin'), 'utf-8')).toBe('cached')
  })

  it('removes a planned folder that became a link as a link only', async () => {
    const external = path.join(caseRoot, 'external')
    write(path.join(external, 'family.png'), 'keep')
    const logDir = path.join(userData, 'logs')
    write(path.join(logDir, 'main.log'))

    const c = await loadAs('win32')
    const plan = c.planUninstallCleanup(c.collectUninstallCleanupInputs(noBoxes))
    fs.rmSync(logDir, { recursive: true, force: true })
    fs.symlinkSync(external, logDir, linkType)
    c.executeUninstallCleanup(plan)

    expect(fs.lstatSync(logDir, { throwIfNoEntry: false })).toBeUndefined()
    expect(fs.readFileSync(path.join(external, 'family.png'), 'utf-8')).toBe('keep')
  })

  it('keeps app data that a configured folder reaches through a link', async () => {
    const saved = path.join(userData, 'saved-images')
    write(path.join(saved, 'family.png'), 'keep')
    const outputLink = path.join(home, 'Pictures', 'Comfy')
    fs.mkdirSync(path.dirname(outputLink), { recursive: true })
    fs.symlinkSync(saved, outputLink, linkType)
    write(path.join(userData, 'settings.json'), JSON.stringify({ outputDir: outputLink }))
    write(path.join(userData, 'logs', 'main.log'))

    const c = await loadAs('win32')
    const results = c.runCleanup(c.collectUninstallCleanupInputs(noBoxes))
    expect(results.find((r) => r.entry.path === userData)?.outcome).toBe('emptied')
    expect(fs.readFileSync(path.join(saved, 'family.png'), 'utf-8')).toBe('keep')
    expect(fs.existsSync(path.join(userData, 'logs'))).toBe(false)
  })

  it('empties a folder around a kept folder inside it', async () => {
    const saved = path.join(userData, 'Saved')
    const output = path.join(saved, 'output')
    write(path.join(output, 'family.png'), 'keep')
    write(path.join(saved, 'scratch.txt'))
    write(path.join(userData, 'settings.json'), JSON.stringify({ outputDir: output }))
    write(path.join(userData, 'logs', 'main.log'))

    const c = await loadAs('win32')
    const results = c.runCleanup(c.collectUninstallCleanupInputs(noBoxes))
    const result = results.find((r) => r.entry.path === userData)
    expect(result?.outcome).toBe('emptied')
    expect(result?.detail).toContain(output)
    expect(fs.readFileSync(path.join(output, 'family.png'), 'utf-8')).toBe('keep')
    expect(fs.existsSync(path.join(saved, 'scratch.txt'))).toBe(false)
    expect(fs.existsSync(path.join(userData, 'logs'))).toBe(false)
    expect(fs.existsSync(path.join(userData, 'settings.json'))).toBe(true)
  })

  it('stops at another drive mounted inside a folder', async () => {
    const c = await loadAs('win32')
    const mounted = path.join(userData, 'mounted')
    const onDrive = path.join(mounted, 'a.bin')
    const appLog = path.join(userData, 'app.log')
    const listings = new Map([[userData, ['mounted', 'app.log']], [mounted, ['a.bin']]])
    const removed: string[] = []
    const results = c.executeUninstallCleanup(
      { entries: [testEntry(userData)], guard: bareGuard([userData]) },
      {
        entryInfo: (p) => ({
          kind: listings.has(p) ? 'dir' : 'file',
          device: p === onDrive ? 2 : 1
        }),
        realPath: (p) => p,
        list: (dir) => listings.get(dir) ?? [],
        readText: () => null,
        removeFile: (p) => {
          removed.push(p)
        },
        removeLink: () => undefined,
        removeEmptyDir: (p) => {
          removed.push(p)
        },
        writeFile: () => undefined
      }
    )
    expect(results[0]?.outcome).toBe('failed')
    expect(results[0]?.detail).toBe(`another drive is mounted at ${onDrive}`)
    expect(removed).toEqual([appLog])
  })

  it('allows links at or above the home folder and refuses other links', async () => {
    const c = await loadAs('darwin')
    const system = path.join(caseRoot, 'system')
    fs.mkdirSync(path.join(caseRoot, 'private'), { recursive: true })
    fs.symlinkSync(path.join(caseRoot, 'private'), system, linkType)
    const userHome = path.join(system, 'home')
    const appFolder = path.join(userHome, 'app')
    write(path.join(appFolder, 'cache', 'a.bin'))
    const external = path.join(caseRoot, 'external')
    write(path.join(external, 'b.bin'), 'keep')
    const below = path.join(userHome, 'linked')
    const beside = path.join(caseRoot, 'tmp-link')
    fs.symlinkSync(external, below, linkType)
    fs.symlinkSync(external, beside, linkType)

    const cache = path.join(appFolder, 'cache')
    const files = [path.join(below, 'b.bin'), path.join(beside, 'b.bin')]
    const results = c.executeUninstallCleanup({
      entries: [testEntry(cache), ...files.map((file) => testEntry(file, 'file'))],
      guard: bareGuard([appFolder, below, beside], [userHome])
    })

    expect(results.map((r) => r.outcome)).toEqual(['removed', 'refused', 'refused'])
    expect(results[1]?.detail).toBe(`inside a linked folder: ${below}`)
    expect(results[2]?.detail).toBe(`inside a linked folder: ${beside}`)
    expect(fs.existsSync(cache)).toBe(false)
    expect(fs.readFileSync(path.join(external, 'b.bin'), 'utf-8')).toBe('keep')
  })
})

describe('earlier settings and app names', () => {
  it('keeps an output folder named only in the settings backup', async () => {
    const earlier = path.join(userData, 'MyOutput')
    write(path.join(earlier, 'family.png'), 'keep')
    write(path.join(userData, 'settings.json'), '{}')
    write(path.join(userData, 'settings.json.bak'), JSON.stringify({ outputDir: earlier }))
    write(path.join(userData, 'logs', 'main.log'))

    const c = await loadAs('win32')
    expect(c.runUninstallCleanup([c.UNINSTALL_CLEANUP_FLAG])).toBe(0)
    expect(fs.readFileSync(path.join(earlier, 'family.png'), 'utf-8')).toBe('keep')
    expect(fs.existsSync(path.join(userData, 'logs'))).toBe(false)
  })

  it('keeps an install named only in the install list backup', async () => {
    const earlier = path.join(userData, 'OldInstall')
    write(path.join(earlier, 'ComfyUI', 'main.py'))
    write(path.join(userData, 'installations.json'), '[]')
    const backup = JSON.stringify([{ id: 'inst-9', installPath: earlier }])
    write(path.join(userData, 'installations.json.bak'), backup)
    write(path.join(userData, 'logs', 'main.log'))

    const c = await loadAs('win32')
    expect(c.runUninstallCleanup(allFlags(c))).toBe(0)
    expect(fs.existsSync(path.join(earlier, 'ComfyUI', 'main.py'))).toBe(true)
    expect(fs.existsSync(path.join(userData, 'logs'))).toBe(false)
  })

  it('keeps an install named only in the install list backup across two cleanups', async () => {
    const earlier = path.join(userData, 'OldInstall')
    write(path.join(earlier, 'ComfyUI', 'main.py'))
    write(path.join(userData, 'installations.json'), '[]')
    const backup = JSON.stringify([{ id: 'inst-9', installPath: earlier }])
    write(path.join(userData, 'installations.json.bak'), backup)

    const c = await loadAs('win32')
    expect(c.runUninstallCleanup(allFlags(c))).toBe(0)
    expect(c.runUninstallCleanup(allFlags(c))).toBe(0)
    expect(fs.existsSync(path.join(earlier, 'ComfyUI', 'main.py'))).toBe(true)
    expect(fs.readFileSync(path.join(userData, 'installations.json.bak'), 'utf-8')).toBe(backup)
  })

  it('keeps the list backup that names a kept install when the list is rewritten', async () => {
    const install = path.join(localRoot(), 'ComfyUI-Installs', 'a')
    write(path.join(install, '.comfyui-desktop-2'), 'inst-1')
    const earlier = path.join(userData, 'OldInstall')
    write(path.join(earlier, 'ComfyUI', 'main.py'))
    const current = JSON.stringify([{ id: 'inst-1', installPath: install }])
    write(path.join(userData, 'installations.json'), current)
    const backup = JSON.stringify([{ id: 'inst-9', installPath: earlier }])
    write(path.join(userData, 'installations.json.bak'), backup)

    const c = await loadAs('win32')
    expect(c.runUninstallCleanup(allFlags(c))).toBe(0)
    expect(fs.existsSync(install)).toBe(false)
    expect(fs.readFileSync(path.join(userData, 'installations.json.bak'), 'utf-8')).toBe(backup)
    expect(c.runUninstallCleanup(allFlags(c))).toBe(0)
    expect(fs.existsSync(path.join(earlier, 'ComfyUI', 'main.py'))).toBe(true)
  })

  it('keeps models named by the settings in an older-name app data folder', async () => {
    const older = path.join(appData, 'ComfyUI Launcher')
    const models = path.join(older, 'models')
    write(path.join(models, 'model.safetensors'))
    write(path.join(older, 'settings.json'), JSON.stringify({ modelsDirs: [models] }))
    write(path.join(older, 'logs', 'old.log'))

    const c = await loadAs('win32')
    expect(c.runUninstallCleanup([c.UNINSTALL_CLEANUP_FLAG])).toBe(0)
    expect(fs.existsSync(path.join(models, 'model.safetensors'))).toBe(true)
    expect(fs.existsSync(path.join(older, 'logs'))).toBe(false)
  })

  it('keeps older-name models and the settings naming them across two cleanups', async () => {
    const older = path.join(appData, 'ComfyUI Launcher')
    const models = path.join(older, 'models')
    write(path.join(models, 'model.safetensors'))
    write(path.join(older, 'settings.json'), JSON.stringify({ modelsDirs: [models] }))
    write(path.join(older, 'logs', 'old.log'))

    const c = await loadAs('win32')
    expect(c.runUninstallCleanup([c.UNINSTALL_CLEANUP_FLAG])).toBe(0)
    expect(fs.existsSync(path.join(older, 'settings.json'))).toBe(true)
    expect(c.runUninstallCleanup([c.UNINSTALL_CLEANUP_FLAG])).toBe(0)
    expect(fs.existsSync(path.join(models, 'model.safetensors'))).toBe(true)
    expect(fs.existsSync(path.join(older, 'logs'))).toBe(false)
  })

  it('keeps an older-name app data folder whose settings cannot be read', async () => {
    const older = path.join(appData, 'ComfyUI Launcher')
    write(path.join(older, 'models', 'model.safetensors'))
    write(path.join(older, 'settings.json'), '{"modelsDirs": [')

    const c = await loadAs('win32')
    expect(c.runUninstallCleanup([c.UNINSTALL_CLEANUP_FLAG])).toBe(0)
    expect(fs.existsSync(path.join(older, 'models', 'model.safetensors'))).toBe(true)
  })
})

describe('folders with more than one role', () => {
  it.each([
    ['download cache', ['ComfyUI-Cache', 'download-cache'], noBoxes],
    ['models folder', ['ComfyUI-Shared', 'models'], bothBoxes]
  ])('keeps an output folder set to the default %s', async (_name, parts, options) => {
    const folder = path.join(localRoot(), ...parts)
    write(path.join(folder, 'family.png'), 'keep')
    write(path.join(userData, 'settings.json'), JSON.stringify({ outputDir: folder }))

    const c = await loadAs('win32')
    const results = c.runCleanup(c.collectUninstallCleanupInputs(options))
    expect(results.find((r) => r.entry.path === folder)?.outcome).toBe('refused')
    expect(fs.readFileSync(path.join(folder, 'family.png'), 'utf-8')).toBe('keep')
  })
})

describe('configured download cache', () => {
  interface CacheSetup {
    cache: string
    portable: string
    standalone: string
    mine: string
  }

  function cacheSetup(cache = path.join(home, 'MyCache')): CacheSetup {
    const portable = path.join(cache, 'v0.3.40_ComfyUI_windows_portable_nvidia.7z')
    const standalone = path.join(cache, 'v1.2.0_cu128')
    const mine = path.join(cache, 'my-files')
    write(path.join(portable, 'a.bin'))
    write(path.join(standalone, 'b.bin'))
    write(path.join(mine, 'c.txt'))
    write(path.join(userData, 'settings.json'), JSON.stringify({ cacheDir: cache }))
    writeInstallRecords([
      {
        id: 'inst-1',
        installPath: path.join(home, 'portable'),
        version: 'v0.3.40',
        asset: 'ComfyUI_windows_portable_nvidia.7z'
      },
      {
        id: 'inst-2',
        installPath: path.join(home, 'standalone'),
        releaseTag: 'v1.2.0',
        variant: 'cu128'
      }
    ])
    return { cache, portable, standalone, mine }
  }

  it('removes only the entries Desktop downloaded there', async () => {
    const { cache, portable, standalone, mine } = cacheSetup()

    const c = await loadAs('win32')
    expect(c.runUninstallCleanup([c.UNINSTALL_CLEANUP_FLAG])).toBe(0)
    expect(fs.existsSync(portable)).toBe(false)
    expect(fs.existsSync(standalone)).toBe(false)
    expect(fs.existsSync(path.join(mine, 'c.txt'))).toBe(true)
    expect(fs.existsSync(cache)).toBe(true)
  })

  it('keeps a configured cache folder inside the app data folder', async () => {
    const { cache, portable, standalone, mine } = cacheSetup(path.join(userData, 'MyCache'))
    write(path.join(userData, 'logs', 'main.log'))

    const c = await loadAs('win32')
    expect(c.runUninstallCleanup([c.UNINSTALL_CLEANUP_FLAG])).toBe(0)
    expect(fs.existsSync(portable)).toBe(false)
    expect(fs.existsSync(standalone)).toBe(false)
    expect(fs.existsSync(path.join(mine, 'c.txt'))).toBe(true)
    expect(fs.existsSync(cache)).toBe(true)
    expect(fs.existsSync(path.join(userData, 'logs'))).toBe(false)
  })

  it('refuses the configured folder itself', async () => {
    const { cache } = cacheSetup()

    const c = await loadAs('win32')
    const inputs = c.collectUninstallCleanupInputs(bothBoxes)
    const plan = c.planUninstallCleanup(inputs)
    expect(plannedPaths(plan)).not.toContain(cache)
    expect(c.deletionRefusal(cache, plan.guard)).not.toBeNull()
  })
})

describe('unreadable settings and install list', () => {
  const brokenList = '[{"id": "inst-1",'

  function installInsideAppData(): string {
    const dir = path.join(userData, 'ComfyUI-Installs', 'inside')
    write(path.join(dir, '.comfyui-desktop-2'), 'inst-1')
    write(path.join(dir, 'ComfyUI', 'main.py'))
    write(path.join(userData, 'logs', 'main.log'))
    return dir
  }

  function cleanupLog(c: CleanupModule): string {
    return fs.readFileSync(path.join(temp, c.UNINSTALL_CLEANUP_LOG_FILE), 'utf-8')
  }

  it('reads the backup when the install list cannot be parsed', async () => {
    const dir = installInsideAppData()
    write(path.join(userData, 'installations.json'), brokenList)
    const backup = JSON.stringify([{ id: 'inst-1', installPath: dir }])
    write(path.join(userData, 'installations.json.bak'), backup)

    const c = await loadAs('win32')
    expect(c.runUninstallCleanup([c.UNINSTALL_CLEANUP_FLAG])).toBe(0)
    expect(fs.existsSync(path.join(dir, 'ComfyUI', 'main.py'))).toBe(true)
    expect(fs.existsSync(path.join(userData, 'logs'))).toBe(false)
  })

  it('keeps installs, models and app data when no install list can be read', async () => {
    const inside = installInsideAppData()
    const outside = path.join(localRoot(), 'ComfyUI-Installs', 'outside')
    write(path.join(outside, '.comfyui-desktop-2'), 'inst-2')
    const models = path.join(localRoot(), 'ComfyUI-Shared', 'models')
    write(path.join(models, 'a.safetensors'))
    write(path.join(userData, 'installations.json'), brokenList)
    write(path.join(userData, 'installations.json.bak'), '')

    const c = await loadAs('win32')
    expect(c.runUninstallCleanup(allFlags(c))).toBe(0)
    expect(fs.existsSync(path.join(inside, 'ComfyUI', 'main.py'))).toBe(true)
    expect(fs.existsSync(path.join(outside, '.comfyui-desktop-2'))).toBe(true)
    expect(fs.existsSync(path.join(models, 'a.safetensors'))).toBe(true)
    const list = fs.readFileSync(path.join(userData, 'installations.json'), 'utf-8')
    expect(list).toBe(brokenList)
    expect(fs.existsSync(path.join(userData, 'installations.json.bak'))).toBe(true)
    expect(cleanupLog(c)).toContain('installations.json and its backup could not be read')
  })

  it('keeps models and app data when the settings cannot be read', async () => {
    const added = path.join(userData, 'MyModels')
    write(path.join(added, 'b.safetensors'))
    const models = path.join(localRoot(), 'ComfyUI-Shared', 'models')
    write(path.join(models, 'a.safetensors'))
    write(path.join(userData, 'settings.json'), '{"modelsDirs": [')
    write(path.join(userData, 'logs', 'main.log'))

    const c = await loadAs('win32')
    expect(c.runUninstallCleanup(allFlags(c))).toBe(0)
    expect(fs.existsSync(path.join(added, 'b.safetensors'))).toBe(true)
    expect(fs.existsSync(path.join(models, 'a.safetensors'))).toBe(true)
    expect(fs.existsSync(path.join(userData, 'settings.json'))).toBe(true)
    expect(cleanupLog(c)).toContain('settings.json and its backup could not be read')
  })

  it('removes only app log, update and temp files when the settings cannot be read', async () => {
    const cache = path.join(localRoot(), 'ComfyUI-Cache', 'download-cache')
    const photo = path.join(cache, 'outputs', 'family.png')
    write(photo, 'keep')
    const partial = path.join(localRoot(), 'ComfyUI-Shared', '.desktop2-downloads', 'a.part')
    write(partial)
    write(path.join(userData, 'settings.json'), '{"outputDir": "')
    const logDir = path.join(userData, 'logs')
    const rotated = path.join(logDir, 'app.log_2026-01-02T03-04-05-678Z.log')
    const appLogs = [path.join(logDir, 'app.log'), rotated]
    for (const file of appLogs) write(file)
    const otherLog = path.join(logDir, 'notes.txt')
    write(otherLog, 'keep')
    const updates = path.join(localAppData, 'comfyui-desktop-2-updater')
    const download = path.join(updates, 'pending', 'setup.exe')
    write(download)
    const otherUpdate = path.join(updates, 'pending', 'notes.txt')
    write(otherUpdate, 'keep')

    const c = await loadAs('win32')
    const plan = c.planUninstallCleanup(c.collectUninstallCleanupInputs(bothBoxes))
    expect(plannedPaths(plan)).not.toContain(cache)
    expect(plannedPaths(plan)).not.toContain(logDir)
    expect(plannedPaths(plan)).not.toContain(updates)
    expect(c.runUninstallCleanup(allFlags(c))).toBe(0)
    expect(fs.readFileSync(photo, 'utf-8')).toBe('keep')
    expect(fs.existsSync(partial)).toBe(true)
    for (const file of [...appLogs, download]) expect(fs.existsSync(file)).toBe(false)
    expect(fs.readFileSync(otherLog, 'utf-8')).toBe('keep')
    expect(fs.readFileSync(otherUpdate, 'utf-8')).toBe('keep')
    expect(cleanupLog(c)).toContain(
      'settings.json and its backup could not be read: removed only app log files'
    )
  })

  it('keeps output under the logs folder when neither settings copy can be read', async () => {
    const photo = path.join(userData, 'logs', 'outputs', 'family.png')
    write(photo, 'keep')
    const appLog = path.join(userData, 'logs', 'app.log')
    write(appLog)
    write(path.join(userData, 'settings.json'), '{"outputDir": "')
    write(path.join(userData, 'settings.json.bak'), '{"outputDir": "')

    const c = await loadAs('win32')
    expect(c.runUninstallCleanup(allFlags(c))).toBe(0)
    expect(fs.readFileSync(photo, 'utf-8')).toBe('keep')
    expect(fs.existsSync(appLog)).toBe(false)
    expect(cleanupLog(c)).toContain('settings.json and its backup could not be read')
  })

  it('keeps installs and both list copies when the primary list cannot be read', async () => {
    const removed = path.join(localRoot(), 'ComfyUI-Installs', 'a')
    write(path.join(removed, '.comfyui-desktop-2'), 'inst-1')
    write(path.join(removed, 'ComfyUI', 'main.py'))
    const unmarked = path.join(localRoot(), 'ComfyUI-Installs', 'b')
    write(path.join(unmarked, 'ComfyUI', 'main.py'))
    const newest = path.join(localRoot(), 'ComfyUI-Installs', 'c')
    write(path.join(newest, '.comfyui-desktop-2'), 'inst-3')
    const older = [
      { id: 'inst-1', installPath: removed },
      { id: 'inst-2', installPath: unmarked }
    ]
    const list = path.join(userData, 'installations.json')
    const primaryText = JSON.stringify([...older, { id: 'inst-3', installPath: newest }])
    const backupText = JSON.stringify(older)
    write(list, primaryText)
    write(`${list}.bak`, backupText)
    failReadsOf(list)

    const c = await loadAs('win32')
    expect(c.runUninstallCleanup([c.UNINSTALL_CLEANUP_FLAG, c.DELETE_INSTANCES_FLAG])).toBe(1)
    vi.restoreAllMocks()

    expect(fs.existsSync(path.join(removed, 'ComfyUI', 'main.py'))).toBe(true)
    expect(fs.readFileSync(list, 'utf-8')).toBe(primaryText)
    expect(fs.readFileSync(`${list}.bak`, 'utf-8')).toBe(backupText)
    expect(cleanupLog(c)).toContain('installations.json could not be read')
  })

  it('treats a missing install list as an empty one', async () => {
    write(path.join(userData, 'logs', 'main.log'))

    const c = await loadAs('win32')
    expect(c.collectUninstallCleanupInputs(noBoxes).unreadableFiles).toEqual([])
    expect(c.runUninstallCleanup([c.UNINSTALL_CLEANUP_FLAG])).toBe(0)
    expect(fs.existsSync(path.join(userData, 'logs'))).toBe(false)
  })
})

describe('models', () => {
  it('removes default models that an earlier cleanup kept for a removed install', async () => {
    const install = path.join(localRoot(), 'ComfyUI-Installs', 'a')
    write(path.join(install, '.comfyui-desktop-2'), 'inst-1')
    const models = path.join(localRoot(), 'ComfyUI-Shared', 'models')
    write(path.join(models, 'a.safetensors'))
    writeInstallRecords([{ id: 'inst-1', installPath: install, modelDirs: [models] }])

    const c = await loadAs('win32')
    expect(c.runUninstallCleanup([c.UNINSTALL_CLEANUP_FLAG, c.DELETE_INSTANCES_FLAG])).toBe(0)
    expect(fs.existsSync(path.join(models, 'a.safetensors'))).toBe(true)
    const keptText = fs.readFileSync(path.join(userData, 'uninstall-kept-paths.json'), 'utf-8')
    expect(JSON.parse(keptText)).toEqual([{ path: models, roles: ['models'] }])

    expect(c.runUninstallCleanup([c.UNINSTALL_CLEANUP_FLAG, c.DELETE_MODELS_FLAG])).toBe(0)
    expect(fs.existsSync(models)).toBe(false)
  })

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

  it('empties the app data folder around kept pointer files', async () => {
    write(path.join(userData, 'settings.json'), '{}')
    write(path.join(userData, 'installations.json'), '[]')
    write(path.join(userData, 'logs', 'main.log'))

    const c = await loadAs('win32')
    const outcome = (keepPointerFiles: boolean): string | undefined => {
      const policy = { keepPointerFiles, deleteSharedInputOutput: false }
      const results = c.runCleanup(c.collectUninstallCleanupInputs(noBoxes), policy)
      return results.find((r) => r.entry.path === userData)?.outcome
    }

    expect(outcome(true)).toBe('emptied')
    expect(fs.existsSync(path.join(userData, 'settings.json'))).toBe(true)
    expect(fs.existsSync(path.join(userData, 'installations.json'))).toBe(true)
    expect(fs.existsSync(path.join(userData, 'logs'))).toBe(false)
    expect(outcome(false)).toBe('removed')
    expect(fs.existsSync(userData)).toBe(false)
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
      entries: [testEntry(home)],
      guard: plan.guard
    })
    expect(results[0]?.outcome).toBe('refused')
    expect(fs.existsSync(path.join(home, 'keep.txt'))).toBe(true)
  })

  it('keeps going after a failed delete and reports it', async () => {
    const c = await loadAs('win32')
    const first = path.join(userData, 'first')
    const second = path.join(userData, 'second')
    const removed: string[] = []
    const entries = [testEntry(first, 'file'), testEntry(second, 'file')]
    const results = c.executeUninstallCleanup(
      { entries, guard: bareGuard([userData]) },
      {
        entryInfo: () => ({ kind: 'file', device: 1 }),
        realPath: (p) => p,
        list: () => [],
        readText: () => null,
        removeFile: (p) => {
          if (p === first) throw Object.assign(new Error('busy'), { code: 'EBUSY' })
          removed.push(p)
        },
        removeLink: () => undefined,
        removeEmptyDir: () => undefined,
        writeFile: () => undefined
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

  it('refuses a logs link swapped for a folder while installs are removed', async () => {
    useMacLayout()
    const external = path.join(caseRoot, 'external-logs')
    write(path.join(external, 'main.log'), 'log')
    fs.mkdirSync(path.dirname(logs), { recursive: true })
    fs.symlinkSync(external, logs, linkType)
    const install = path.join(home, 'ComfyUI-Installs', 'a')
    write(path.join(install, '.comfyui-desktop-2'), 'inst-1')
    write(path.join(install, 'ComfyUI', 'main.py'))
    const records = [{ id: 'inst-1', installPath: install }]
    write(path.join(userData, 'installations.json'), JSON.stringify(records))

    const c = await loadAs('darwin')
    const inputs = c.collectUninstallCleanupInputs(instancesBox, 'darwin')
    const photo = path.join(logs, 'family.png')
    let swapped = false
    const swapping: CleanupFs = {
      ...c.nodeCleanupFs,
      removeFile: (p) => {
        if (!swapped) {
          swapped = true
          fs.unlinkSync(logs)
          write(photo, 'keep')
        }
        c.nodeCleanupFs.removeFile(p)
      }
    }
    const results = c.runCleanup(inputs, c.DEFAULT_CLEANUP_POLICY, swapping)

    expect(results.find((r) => r.entry.path === install)?.outcome).toBe('removed')
    const result = results.find((r) => r.entry.path === logs)
    expect(result?.outcome).toBe('refused')
    expect(result?.detail).toBe('was a link when cleanup started, now a folder')
    expect(fs.readFileSync(photo, 'utf-8')).toBe('keep')
    expect(fs.readFileSync(path.join(external, 'main.log'), 'utf-8')).toBe('log')
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

  it('refuses an app folder under an XDG folder reached through a link', async () => {
    useLinuxLayout()
    const realConfig = path.join(caseRoot, 'real-config')
    const linkedConfig = path.join(caseRoot, 'linked-config')
    const windowState = path.join(realConfig, 'comfyui-desktop-2', 'window-state.json')
    write(windowState, 'keep')
    fs.symlinkSync(realConfig, linkedConfig, linkType)
    process.env.XDG_CONFIG_HOME = linkedConfig

    const c = await loadAs('linux')
    const results = c.runCleanup(c.collectUninstallCleanupInputs(bothBoxes, 'linux'))
    const configDir = path.join(linkedConfig, 'comfyui-desktop-2')
    const result = results.find((r) => r.entry.path === configDir)
    expect(result?.outcome).toBe('refused')
    expect(result?.detail).toBe(`inside a linked folder: ${linkedConfig}`)
    expect(fs.readFileSync(windowState, 'utf-8')).toBe('keep')
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

  it('turns off install-on-quit, relaunches with the flags, then quits', async () => {
    process.env.APPIMAGE = '/home/user/Comfy-Desktop.AppImage'
    const c = await loadAs('linux')
    const { app } = await import('electron')
    const quit = vi.fn()
    const suppressInstallOnQuit = vi.fn()

    c.relaunchIntoUninstallCleanup(instancesBox, { suppressInstallOnQuit, quit })

    const relaunch = vi.mocked(app.relaunch)
    expect(relaunch).toHaveBeenCalledTimes(1)
    const options = relaunch.mock.calls[0]?.[0]
    expect(options?.execPath).toBe('/home/user/Comfy-Desktop.AppImage')
    expect(options?.args?.slice(-2)).toEqual([c.UNINSTALL_CLEANUP_FLAG, c.DELETE_INSTANCES_FLAG])
    expect(quit).toHaveBeenCalledTimes(1)
    expect(relaunch.mock.invocationCallOrder[0]).toBeLessThan(quit.mock.invocationCallOrder[0]!)
    expect(suppressInstallOnQuit).toHaveBeenCalledTimes(1)
    expect(suppressInstallOnQuit.mock.invocationCallOrder[0]).toBeLessThan(
      relaunch.mock.invocationCallOrder[0]!
    )
  })
})
