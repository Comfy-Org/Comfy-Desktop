import { app } from 'electron'
import path from 'path'
import fs from 'fs'

const isLinux = process.platform === 'linux'

const APP_NAME = 'comfyui-desktop-2'

export function configDir(): string {
  if (isLinux) {
    const base = process.env.XDG_CONFIG_HOME || path.join(app.getPath('home'), '.config')
    return path.join(base, APP_NAME)
  }
  return app.getPath('userData')
}

export function cacheDir(): string {
  if (isLinux) {
    const base = process.env.XDG_CACHE_HOME || path.join(app.getPath('home'), '.cache')
    return path.join(base, APP_NAME)
  }
  return app.getPath('userData')
}

export function dataDir(): string {
  if (isLinux) {
    const base = process.env.XDG_DATA_HOME || path.join(app.getPath('home'), '.local', 'share')
    return path.join(base, APP_NAME)
  }
  return app.getPath('userData')
}

export function stateDir(): string {
  if (isLinux) {
    const base = process.env.XDG_STATE_HOME || path.join(app.getPath('home'), '.local', 'state')
    return path.join(base, APP_NAME)
  }
  return app.getPath('userData')
}

function selectedInstallDrive(): string | null {
  if (process.platform !== 'win32') return null
  try {
    const exeDrive = path.win32.parse(app.getPath('exe')).root
    if (!exeDrive) return null
    const systemDrive = process.env.SystemDrive
      ? path.win32.parse(path.win32.join(process.env.SystemDrive, '\\')).root
      : path.win32.parse(app.getPath('home')).root
    if (!systemDrive) return null
    if (exeDrive.toLowerCase() === systemDrive.toLowerCase()) return null
    return exeDrive
  } catch {
    return null
  }
}

type WinSystemDriveMode = 'legacy-home' | 'local-appdata'

const DATA_ROOT_MARKER = 'data-location.json'

let cachedWinMode: WinSystemDriveMode | undefined

function winDataRootMarkerPath(): string {
  return path.join(dataDir(), DATA_ROOT_MARKER)
}

function classifyWinSystemDriveMode(): WinSystemDriveMode {
  try {
    const raw = fs.readFileSync(winDataRootMarkerPath(), 'utf-8')
    const mode = (JSON.parse(raw) as { mode?: unknown }).mode
    if (mode === 'legacy-home' || mode === 'local-appdata') return mode
  } catch {}
  const home = app.getPath('home')
  const hasLegacyFootprint =
    fs.existsSync(path.join(home, 'ComfyUI-Installs')) ||
    fs.existsSync(path.join(home, 'ComfyUI-Shared'))
  return hasLegacyFootprint ? 'legacy-home' : 'local-appdata'
}

function winSystemDriveRoot(): string {
  cachedWinMode ??= classifyWinSystemDriveMode()
  if (cachedWinMode === 'legacy-home') return app.getPath('home')
  const localAppData =
    process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local')
  return path.join(localAppData, 'Comfy-Desktop')
}

export function persistWinDataRootChoice(): void {
  if (process.platform !== 'win32') return
  if (selectedInstallDrive()) return
  const markerPath = winDataRootMarkerPath()
  if (fs.existsSync(markerPath)) return
  try {
    fs.mkdirSync(path.dirname(markerPath), { recursive: true })
    const mode = cachedWinMode ?? classifyWinSystemDriveMode()
    fs.writeFileSync(markerPath, JSON.stringify({ mode }), 'utf-8')
  } catch {}
}

export function defaultDataRoot(): string {
  const drive = selectedInstallDrive()
  if (drive) return path.join(drive, 'Comfy-Desktop')
  if (process.platform === 'win32') return winSystemDriveRoot()
  return app.getPath('home')
}

export function defaultBenchmarksDir(): string {
  const root =
    process.platform === 'win32'
      ? path.join(
          process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local'),
          'Comfy-Desktop'
        )
      : app.getPath('home')
  return path.join(root, 'ComfyUI-Shared', 'benchmarks')
}

export function defaultDownloadCacheDir(): string {
  if (selectedInstallDrive()) {
    return path.join(defaultDataRoot(), 'ComfyUI-Cache', 'download-cache')
  }
  if (process.platform === 'win32') {
    const root = winSystemDriveRoot()
    if (root !== app.getPath('home')) {
      return path.join(root, 'ComfyUI-Cache', 'download-cache')
    }
  }
  return path.join(cacheDir(), 'download-cache')
}

export function builtinDefaultInstallDir(): string {
  return path.join(defaultDataRoot(), 'ComfyUI-Installs')
}

let installDirResolver: (() => string | undefined) | null = null

export function setInstallDirResolver(resolver: () => string | undefined): void {
  installDirResolver = resolver
}

export function defaultInstallDir(): string {
  const configured = installDirResolver?.()
  if (typeof configured === 'string' && configured.trim() !== '') {
    return configured
  }
  return builtinDefaultInstallDir()
}

function migrateIfNeeded(oldPath: string, newPath: string): void {
  try {
    if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
      fs.mkdirSync(path.dirname(newPath), { recursive: true })
      const stat = fs.statSync(oldPath)
      if (stat.isDirectory()) {
        fs.cpSync(oldPath, newPath, { recursive: true })
      } else {
        fs.copyFileSync(oldPath, newPath)
      }
      fs.rmSync(oldPath, { recursive: true, force: true })
    }
  } catch (err: unknown) {
    console.error(`XDG migration failed: ${oldPath} → ${newPath}:`, (err as Error).message)
  }
}

export function migrateXdgPaths(): void {
  if (!isLinux) return
  const oldBase = app.getPath('userData')

  migrateIfNeeded(path.join(oldBase, 'download-cache'), path.join(cacheDir(), 'download-cache'))

  migrateIfNeeded(
    path.join(oldBase, 'installations.json'),
    path.join(dataDir(), 'installations.json')
  )

  migrateIfNeeded(
    path.join(oldBase, 'shared_model_paths.yaml'),
    path.join(dataDir(), 'shared_model_paths.yaml')
  )

  migrateIfNeeded(path.join(oldBase, 'port-locks'), path.join(stateDir(), 'port-locks'))

  migrateCacheDirSetting(oldBase)
}

function migrateCacheDirSetting(oldBase: string): void {
  const settingsPath = path.join(configDir(), 'settings.json')
  try {
    if (!fs.existsSync(settingsPath)) return
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
    const oldDefault = path.join(oldBase, 'download-cache')
    if (settings.cacheDir && path.resolve(settings.cacheDir) === path.resolve(oldDefault)) {
      delete settings.cacheDir
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
    }
  } catch (err: unknown) {
    console.error('Failed to migrate cacheDir setting:', (err as Error).message)
  }
}

export function homeDir(): string {
  return app.getPath('home')
}

export function sanitizeDirName(name: string): string {
  return name.replace(/[<>:"/\\|?*]+/g, '_').trim() || 'ComfyUI'
}

export function allocateUniqueDir(parentDir: string, dirName: string): string {
  let candidate = path.join(parentDir, dirName)
  let suffix = 1
  while (fs.existsSync(candidate)) {
    candidate = path.join(parentDir, `${dirName} (${suffix})`)
    suffix++
  }
  return candidate
}
