import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'

import type { LaunchCommand } from '../types/sources'

const DESKTOP2_FRONTEND_ROOT_DIRS = ['static-desktop2', 'static'] as const

const RESOLVE_DESKTOP2_FRONTEND_PACKAGE_ROOT_SCRIPT = `
from importlib import resources

print(resources.files("comfyui_frontend_package"))
`.trim()

export function isLocalComfyPythonLaunch(
  launchCmd: LaunchCommand
): launchCmd is LaunchCommand & { cmd: string; args: string[]; cwd: string } {
  if (launchCmd.skipSharedPaths || !launchCmd.cmd || !launchCmd.args || !launchCmd.cwd) {
    return false
  }
  const sIdx = launchCmd.args.indexOf('-s')
  return sIdx !== -1 && sIdx + 1 < launchCmd.args.length
}

/**
 * Resolve the frontend root from the selected Python env, preferring the
 * Desktop2 assets and falling back to the packaged `static` frontend. Returns
 * `null` when neither exists so callers can launch without pinning
 * `--front-end-root` rather than treating it as fatal.
 */
export async function resolveDesktop2FrontendRoot(
  pythonPath: string,
  cwd: string
): Promise<string | null> {
  const packageRoot = (
    await runPython(pythonPath, ['-s', '-c', RESOLVE_DESKTOP2_FRONTEND_PACKAGE_ROOT_SCRIPT], cwd)
  ).trim()
  if (!packageRoot) {
    return null
  }
  const frontendRoots = DESKTOP2_FRONTEND_ROOT_DIRS.map((dir) => path.join(packageRoot, dir))
  return frontendRoots.find((root) => fs.existsSync(root)) ?? null
}

/** Whether the user already supplied a `--front-end-root` we should respect. */
export function hasFrontEndRootArg(args: string[]): boolean {
  return args.some((arg) => arg === '--front-end-root' || arg.startsWith('--front-end-root='))
}

function runPython(pythonPath: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      pythonPath,
      args,
      { cwd, windowsHide: true, timeout: 15_000 },
      (err, stdout, stderr) => {
        if (err) {
          const detail = stderr ? `\nstderr: ${stderr.trim()}` : ''
          reject(new Error(`Failed to resolve Desktop2 frontend root: ${err.message}${detail}`))
          return
        }
        resolve(stdout)
      }
    )
  })
}
