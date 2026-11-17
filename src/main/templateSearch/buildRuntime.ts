import fs from 'fs'
import path from 'path'
import type { InstallationRecord } from '../installations'
import { getActivePythonPath, getActiveVenvDir } from '../lib/pythonEnv'
import { findSitePackages } from '../sources/standalone/envPaths'
import type { TerminalEnv } from '../types/sources'

export interface BuildRuntime {
  python: string
  sitePackages: string | null
}

const PYTHON_EXE = /^python(3(\.\d+)?)?(\.exe)?$/i

function venvPython(venvDir: string): string | null {
  const candidates =
    process.platform === 'win32'
      ? [path.join(venvDir, 'Scripts', 'python.exe')]
      : [path.join(venvDir, 'bin', 'python3'), path.join(venvDir, 'bin', 'python')]
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null
}

function embeddedSitePackages(python: string): string {
  return process.platform === 'win32'
    ? path.join(path.dirname(python), 'Lib', 'site-packages')
    : (findSitePackages(path.dirname(path.dirname(python))) ?? '')
}

export function buildRuntime(
  installation: InstallationRecord,
  env: TerminalEnv | null
): BuildRuntime | null {
  if (env?.venvDir) {
    const python = venvPython(env.venvDir)
    return python ? { python, sitePackages: findSitePackages(env.venvDir) } : null
  }
  const pipExe = env?.pip?.exe
  if (pipExe && PYTHON_EXE.test(path.basename(pipExe)) && fs.existsSync(pipExe)) {
    return { python: pipExe, sitePackages: embeddedSitePackages(pipExe) || null }
  }
  const python = getActivePythonPath(installation)
  return python ? { python, sitePackages: findSitePackages(getActiveVenvDir(installation)) } : null
}
