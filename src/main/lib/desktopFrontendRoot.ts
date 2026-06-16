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

export async function resolveDesktop2FrontendRoot(
  pythonPath: string,
  cwd: string
): Promise<string> {
  const frontendRoot = (
    await runPython(pythonPath, ['-s', '-c', RESOLVE_DESKTOP2_FRONTEND_ROOT_SCRIPT], cwd)
  ).trim()
  if (!fs.existsSync(frontendRoot)) {
    throw new Error(`Desktop2 frontend assets not found: ${frontendRoot}`)
  }
  return frontendRoot
}

export function setDesktop2FrontendRootArg(args: string[], frontendRoot: string): string[] {
  const nextArgs: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--front-end-root') {
      i++
    } else if (!arg.startsWith('--front-end-root=')) {
      nextArgs.push(arg)
    }
  }
  return [...nextArgs, '--front-end-root', frontendRoot]
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
