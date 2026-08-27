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
import type { GovernanceMarkerState } from './governance'

const DEFAULT_LAUNCH_ARGS = '--enable-manager'

/**
 * Every flag that turns the Manager on in core. `--enable-manager-legacy-ui`
 * is NOT a separate feature: `comfy/cli_args.py` sets `enable_manager = True`
 * whenever it is present.
 *
 * Filtering only the obvious one would let a user re-enable the Manager on an
 * allowlist install by naming the other. Core then refuses to start at all,
 * with the generic "could not apply your organization's policy" - the exact
 * cryptic failure this module exists to replace with a stated refusal.
 */
const MANAGER_ENABLING_ARGS = new Set(['--enable-manager', '--enable-manager-legacy-ui'])

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
  /** The durable governance marker from the installation record. */
  governance?: GovernanceMarkerState
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
  let parsed = raw.length > 0 ? parseArgs(raw) : []

  if (opts.governance?.kind === 'governed') {
    const marker = opts.governance.marker
    if (marker.customNodeMode === 'allowlist') {
      parsed = parsed.filter((arg) => !MANAGER_ENABLING_ARGS.has(arg))
    }
    if (marker.activeForms.includes('model') && !parsed.includes('--enable-asset-hashing')) {
      parsed.push('--enable-asset-hashing')
    }
  }

  return {
    cmd: python,
    args: ['-s', path.join('ComfyUI', 'main.py'), ...parsed],
    cwd: installPath,
    port: extractPort(parsed)
  }
}
