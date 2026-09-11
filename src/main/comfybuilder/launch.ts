/**
 * Launch - build the command that runs an installed archive.
 *
 * The archive ships a ready, relocatable `venv/`, so launch drives that venv's
 * python directly against `ComfyUI/main.py` (no rebuild, no `.venv`). Returns a
 * plain {@link LaunchSpec} the UI can spawn however it likes; returns null until
 * a successful install has produced the interpreter + entrypoint.
 */
import fs from 'fs'
import path from 'path'

import { extractPort, parseArgs } from '../lib/util'
import type { LaunchSpec } from './types'

const DEFAULT_LAUNCH_ARGS = '--enable-manager'

/**
 * The archive's bundled interpreter.
 *
 * Windows archives stage the interpreter one level below the venv root, at
 * `venv/base/python.exe`. That placement is what keeps the venv relocatable: CPython
 * resolves a venv's `sys.prefix` as `dirname(dirname(executable))`, so an interpreter
 * sitting AT the venv root resolves to the venv's parent and every entry point uv writes
 * bakes an absolute build path (Comfy-Org/cloud#6138). POSIX already had this shape via
 * `venv/bin/`.
 *
 * Falls back to the old root path so archives cut before that change still launch.
 */
export function venvPython(installPath: string): string {
  if (process.platform !== 'win32') return path.join(installPath, 'venv', 'bin', 'python3')
  const staged = path.join(installPath, 'venv', 'base', 'python.exe')
  return fs.existsSync(staged) ? staged : path.join(installPath, 'venv', 'python.exe')
}

export interface LaunchOptions {
  /** Extra ComfyUI args, e.g. `--cpu --port 8188`. Defaults to `--enable-manager`. */
  launchArgs?: string
}

/**
 * Build the launch command for an installed archive, or null when the venv
 * python or `ComfyUI/main.py` is missing (i.e. not installed yet).
 */
export function buildLaunchSpec(installPath: string, opts: LaunchOptions = {}): LaunchSpec | null {
  const python = venvPython(installPath)
  if (!fs.existsSync(python)) return null
  const mainPy = path.join(installPath, 'ComfyUI', 'main.py')
  if (!fs.existsSync(mainPy)) return null

  const raw = (opts.launchArgs ?? DEFAULT_LAUNCH_ARGS).trim()
  const parsed = raw.length > 0 ? parseArgs(raw) : []
  return {
    cmd: python,
    args: ['-s', path.join('ComfyUI', 'main.py'), ...parsed],
    cwd: installPath,
    port: extractPort(parsed)
  }
}
