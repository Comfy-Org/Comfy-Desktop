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

/** Where a governed build's archive carries its signed policy. Must match
 *  ComfyUI's `_POLICY_PATH` in `app/governance.py` (Comfy-Org/ComfyUI#16167 at
 *  cd93b00, line 50); recheck it when that PR merges. */
const GOVERNANCE_POLICY_RELATIVE = path.join('ComfyUI', 'governance', 'policy.signed.json')

/**
 * A governed build's policy, read from the signed policy file its archive
 * carries. ComfyUI enforces that policy itself and exits at startup on a flag
 * it forbids, so launch leaves out the manager-enabling flags under any
 * custom-node policy (allowlist or blocklist) and the launcher's
 * `--extra-model-paths-config` on any governed build.
 */
export interface Governance {
  kind: 'governed'
  /** The signed payload's `customNodeMode`; null when custom nodes are not governed. */
  customNodeMode: 'allowlist' | 'blocklist' | null
}

/**
 * Read the signed policy an installed archive carries, or null for an ordinary
 * build. The signature is not checked here; ComfyUI checks it at startup. A
 * policy file that cannot be read still marks the install governed, and a
 * custom-node mode that cannot be read counts as an allowlist, the stricter
 * answer.
 */
export function readGovernance(installPath: string): Governance | null {
  const file = path.join(installPath, GOVERNANCE_POLICY_RELATIVE)
  if (!fs.existsSync(file)) return null
  let mode: unknown
  try {
    const envelope = JSON.parse(fs.readFileSync(file, 'utf-8')) as { payload: unknown }
    const payload = Buffer.from(String(envelope.payload), 'base64url').toString('utf-8')
    mode = (JSON.parse(payload) as { customNodeMode: unknown }).customNodeMode
  } catch {
    mode = undefined
  }
  return {
    kind: 'governed',
    customNodeMode: mode === 'blocklist' || mode === null ? mode : 'allowlist'
  }
}

/** False when a governed build has a custom-node policy (allowlist or
 *  blocklist), under which ComfyUI refuses to start with the manager enabled:
 *  Manager's prestartup runs scheduled pack installs, a pack's `install.py`
 *  included, before any pack is checked (Comfy-Org/ComfyUI#16167). True for an
 *  ordinary build and for a governed one whose custom nodes are not governed. */
export function managerAllowedByGovernance(governance: Governance | null | undefined): boolean {
  return !governance?.customNodeMode
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
  /** The install's governance, read from its policy file at launch; a
   *  custom-node policy (allowlist or blocklist) drops the manager flags too. */
  governance?: Governance | null
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
  const managerAllowed =
    opts.managerAllowed !== false && managerAllowedByGovernance(opts.governance)
  const parsed = managerAllowed ? all : all.filter((arg) => !isManagerEnablingArg(arg))
  return {
    cmd: python,
    args: ['-s', path.join('ComfyUI', 'main.py'), ...parsed],
    cwd: installPath,
    port: extractPort(parsed)
  }
}
