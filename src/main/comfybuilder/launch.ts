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

import { extractPort, parseArgs, parseArgSpans } from '../lib/util'
import type { LaunchSpec, ModelPolicy } from './types'

const DEFAULT_LAUNCH_ARGS = '--enable-manager'

/** Every flag that turns ComfyUI-Manager on. */
const MANAGER_ENABLING_ARGS = new Set(['--enable-manager', '--enable-manager-legacy-ui'])

function isManagerEnablingArg(arg: string): boolean {
  return MANAGER_ENABLING_ARGS.has(arg)
}

/**
 * Whether a build's author left ComfyUI-Manager on.
 *
 * The build wizard has no manager field of its own: "Custom nodes manager: No"
 * is written as a custom-node allowlist (only the packs the build ships), and
 * "Yes" as an empty blocklist. The builder reads it the same way when deciding
 * whether the archive carries the `comfyui_manager` package, so an allowlist
 * build has no manager to enable. A missing policy means the author never
 * answered (e.g. a build made from a Desktop snapshot), which the builder
 * treats as Yes.
 */
export function managerAllowedByPolicy(policy: ModelPolicy | null | undefined): boolean {
  return policy?.mode !== 'allowlist'
}

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

function withoutManagerEnablingArgs(launchArgs: string): string {
  let result = launchArgs
  const spans = parseArgSpans(launchArgs)
  for (let i = spans.length - 1; i >= 0; i--) {
    const span = spans[i]!
    if (!isManagerEnablingArg(span.value)) continue

    let start = span.start
    let end = span.end
    while (end < result.length && /\s/.test(result[end]!)) end++
    if (end === span.end) {
      while (start > 0 && /\s/.test(result[start - 1]!)) start--
    }
    result = result.slice(0, start) + result.slice(end)
  }
  return result.trim()
}

/**
 * The launch args to store on an install once its release's manager answer is
 * known, so the Startup Arguments field shows what actually launches.
 *
 * A No build loses every manager-enabling flag. A build that was No and is now
 * Yes (the author changed the answer in a newer release) gets `--enable-manager`
 * back, unless the user already has one. Otherwise the args are left alone: a
 * Yes build whose user removed the flag on purpose keeps it removed.
 */
export function launchArgsForManagerAnswer(
  launchArgs: string,
  managerAllowed: boolean,
  previouslyAllowed: boolean | undefined
): string {
  if (!managerAllowed) return withoutManagerEnablingArgs(launchArgs)
  const hasFlag = parseArgs(launchArgs).some(isManagerEnablingArg)
  if (previouslyAllowed === false && !hasFlag) return `${DEFAULT_LAUNCH_ARGS} ${launchArgs}`.trim()
  return launchArgs
}

export interface LaunchOptions {
  /** Extra ComfyUI args, e.g. `--cpu --port 8188`. Defaults to `--enable-manager`. */
  launchArgs?: string
  /**
   * False when the build's author turned ComfyUI-Manager off. Every
   * manager-enabling flag is then dropped, including one the user typed into
   * the launch args, because the archive ships no manager package to enable.
   * Defaults to true.
   */
  managerAllowed?: boolean
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
  const all = raw.length > 0 ? parseArgs(raw) : []
  const parsed =
    opts.managerAllowed === false ? all.filter((arg) => !isManagerEnablingArg(arg)) : all
  return {
    cmd: python,
    args: ['-s', path.join('ComfyUI', 'main.py'), ...parsed],
    cwd: installPath,
    port: extractPort(parsed)
  }
}
