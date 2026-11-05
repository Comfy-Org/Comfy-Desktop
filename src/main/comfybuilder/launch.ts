import fs from 'fs'
import path from 'path'

import { extractPort, parseArgs, parseArgSpans } from '../lib/util'
import type { LaunchSpec, ModelPolicy } from './types'

const DEFAULT_LAUNCH_ARGS = '--enable-manager'

const MANAGER_ENABLING_ARGS = new Set(['--enable-manager', '--enable-manager-legacy-ui'])

function isManagerEnablingArg(arg: string): boolean {
  return MANAGER_ENABLING_ARGS.has(arg)
}

export function managerAllowedByPolicy(policy: ModelPolicy | null | undefined): boolean {
  return policy?.mode !== 'allowlist'
}

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
  launchArgs?: string
  managerAllowed?: boolean
}

export function buildLaunchSpec(installPath: string, opts: LaunchOptions = {}): LaunchSpec | null {
  const python = venvPython(installPath)
  if (!fs.existsSync(python)) return null
  const mainPy = path.join(installPath, 'ComfyUI', 'main.py')
  if (!fs.existsSync(mainPy)) return null

  const raw = (opts.launchArgs ?? DEFAULT_LAUNCH_ARGS).trim()
  const all = raw.length > 0 ? parseArgs(raw) : []
  const managerAllowed = opts.managerAllowed !== false
  const parsed = managerAllowed ? all : all.filter((arg) => !isManagerEnablingArg(arg))
  return {
    cmd: python,
    args: ['-s', path.join('ComfyUI', 'main.py'), ...parsed],
    cwd: installPath,
    port: extractPort(parsed)
  }
}
