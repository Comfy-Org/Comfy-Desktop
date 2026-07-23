/**
 * ComfyBuilder env consumption (the "env-reshape").
 *
 * Unlike a standalone install (a `standalone-env/` master env copied into
 * `ComfyUI/.venv` by `postInstall`), a comfy-builder archive ships ONE ready,
 * relocatable `venv/` at the install root (python + torch + all deps already
 * installed). So there is nothing to build: `postInstall` is a no-op and launch
 * drives the archive's `venv/` python directly.
 */
import fs from 'fs'
import path from 'path'

import { DEFAULT_LAUNCH_ARGS } from '../standalone/envPaths'
import type { InstallationRecord } from '../../installations'
import type { LaunchCommand, PostInstallTools } from '../../types/sources'
import { extractPort, parseArgs } from '../../lib/util'

/** The archive's bundled interpreter. */
export function builderPythonPath(installPath: string): string {
  return process.platform === 'win32'
    ? path.join(installPath, 'venv', 'python.exe')
    : path.join(installPath, 'venv', 'bin', 'python3')
}

/** No-op: the archive ships a complete, ready `venv/`, so there is no env to build.
 *  `extractNested` uses native tar, which preserves the venv's exec bits. */
export async function postInstall(_installation: InstallationRecord, _tools: PostInstallTools): Promise<void> {}

/** Launch ComfyUI with the archive's own venv python (no `.venv` rebuild). */
export function getLaunchCommand(installation: InstallationRecord): LaunchCommand | null {
  const pythonPath = builderPythonPath(installation.installPath)
  if (!fs.existsSync(pythonPath)) return null
  const mainPy = path.join(installation.installPath, 'ComfyUI', 'main.py')
  if (!fs.existsSync(mainPy)) return null

  const userArgs = ((installation.launchArgs as string | undefined) ?? DEFAULT_LAUNCH_ARGS).trim()
  const parsed = userArgs.length > 0 ? parseArgs(userArgs) : []
  return {
    cmd: pythonPath,
    args: ['-s', path.join('ComfyUI', 'main.py'), ...parsed],
    cwd: installation.installPath,
    port: extractPort(parsed),
  }
}
