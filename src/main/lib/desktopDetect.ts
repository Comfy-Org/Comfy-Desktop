import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { homedir } from 'os'

import { scanCustomNodes } from './nodes'
import { parsePipFreeze, uvEnv } from './pip'
import type { Snapshot } from './snapshots'
import * as i18n from './i18n'

export function assertReadable(dirPath: string): void {
  try {
    fs.accessSync(dirPath, fs.constants.R_OK)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EACCES' || code === 'EPERM') {
      throw new Error(i18n.t('errors.folderPermissionDenied', { path: dirPath }), { cause: err })
    }
    throw err
  }
}

export const ADOPT_MARKER_FILE = '.comfyui-desktop-2'

export interface DesktopInstallInfo {
  configDir: string
  basePath: string
  executablePath: string | null
  hasVenv: boolean
}

function getDesktopConfigDir(): string | null {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA
    if (!appData) return null
    return path.join(appData, 'ComfyUI')
  }
  if (process.platform === 'darwin') {
    return path.join(homedir(), 'Library', 'Application Support', 'ComfyUI')
  }
  return null
}

export function findDesktopExecutable(): string | null {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA
    if (!localAppData) return null
    const candidate = path.join(localAppData, 'Programs', 'ComfyUI', 'ComfyUI.exe')
    if (fs.existsSync(candidate)) return candidate
    return null
  }
  if (process.platform === 'darwin') {
    const candidate = '/Applications/ComfyUI.app'
    if (fs.existsSync(candidate)) return candidate
    return null
  }
  return null
}

export function detectDesktopInstall(): DesktopInstallInfo | null {
  const configDir = getDesktopConfigDir()
  if (!configDir) return null

  const configPath = path.join(configDir, 'config.json')
  let basePath: string
  try {
    const raw = fs.readFileSync(configPath, 'utf-8')
    const config = JSON.parse(raw) as Record<string, unknown>
    if (typeof config.basePath !== 'string' || !config.basePath) return null
    basePath = path.resolve(configDir, config.basePath)
  } catch {
    return null
  }

  if (!fs.existsSync(basePath)) {
    assertReadable(path.dirname(basePath))
    return null
  }
  assertReadable(basePath)

  if (fs.existsSync(path.join(basePath, ADOPT_MARKER_FILE))) return null

  const hasModels = fs.existsSync(path.join(basePath, 'models'))
  const hasUser = fs.existsSync(path.join(basePath, 'user'))
  if (!hasModels || !hasUser) return null

  return {
    configDir,
    basePath,
    executablePath: findDesktopExecutable(),
    hasVenv: fs.existsSync(path.join(basePath, '.venv'))
  }
}

function getDesktopPythonPath(basePath: string): string | null {
  if (process.platform === 'win32') {
    const candidate = path.join(basePath, '.venv', 'Scripts', 'python.exe')
    if (fs.existsSync(candidate)) return candidate
  } else if (process.platform === 'darwin') {
    const candidate = path.join(basePath, '.venv', 'bin', 'python3')
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

export async function pipFreezeDirect(pythonPath: string): Promise<Record<string, string>> {
  const output = await new Promise<string>((resolve, reject) => {
    execFile(
      pythonPath,
      ['-m', 'pip', 'freeze', '--local'],
      { windowsHide: true, timeout: 60_000, maxBuffer: 10 * 1024 * 1024, env: uvEnv() },
      (err, stdout, stderr) => {
        if (err) {
          const detail = stderr ? stderr.slice(0, 500) : err.message
          return reject(new Error(`pip freeze failed: ${detail}`))
        }
        resolve(stdout)
      }
    )
  })

  return parsePipFreeze(output)
}

export async function captureDesktopSnapshot(info: DesktopInstallInfo): Promise<Snapshot> {
  const customNodes = await scanCustomNodes(info.basePath)

  let pipPackages: Record<string, string> = {}
  const venvPython = getDesktopPythonPath(info.basePath)
  if (venvPython) {
    try {
      pipPackages = await pipFreezeDirect(venvPython)
    } catch {}
  }

  return {
    version: 1,
    createdAt: new Date().toISOString(),
    trigger: 'manual',
    label: 'Legacy Desktop migration',
    comfyui: {
      ref: 'Legacy Desktop',
      commit: null,
      releaseTag: '',
      variant: ''
    },
    customNodes,
    pipPackages,
    skipPipSync: true
  }
}
