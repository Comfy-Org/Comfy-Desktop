import { execFile } from 'child_process'
import fs from 'fs'

import type { LaunchCommand } from '../types/sources'

const RESOLVE_DESKTOP2_FRONTEND_ROOT_SCRIPT = `
from importlib import resources

print(resources.files("comfyui_frontend_package").joinpath("static-desktop2"))
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
 * Resolve the Desktop2 frontend root from the selected Python env. Returns
 * `null` when the install's `comfyui_frontend_package` doesn't ship the
 * `static-desktop2` assets, so callers can launch without pinning
 * `--front-end-root` rather than treating it as fatal.
 */
export async function resolveDesktop2FrontendRoot(
  pythonPath: string,
  cwd: string
): Promise<string | null> {
  const frontendRoot = (
    await runPython(pythonPath, ['-s', '-c', RESOLVE_DESKTOP2_FRONTEND_ROOT_SCRIPT], cwd)
  ).trim()
  if (!frontendRoot || !fs.existsSync(frontendRoot)) {
    return null
  }
  return frontendRoot
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
