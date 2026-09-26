import fs from 'fs'
import path from 'path'
import { execFile, spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import { killProcTree } from './process'
import { stripAnsi } from './stderrTail'
import { scrubAll } from '../../shared/piiScrub'

/** Regex matching PyTorch-family packages that must never be overwritten by pip. */
export const PYTORCH_RE = /^(torch|torchvision|torchaudio|torchsde)(\s*[<>=!~;[#]|$)/i

/** A parseable distribution name. Shared with the snapshot import guard: these
 *  names reach argv for `uv pip uninstall`, so anything option-shaped or
 *  otherwise malformed must be dropped rather than passed through. */
export const VALID_PIP_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** Environment variables that force colour on. Matched case-insensitively:
 *  Windows environment names are case-insensitive, so an inherited
 *  `Force_Color` reaches the child exactly as `FORCE_COLOR` would. */
const COLOUR_FORCING_VARS = new Set(['FORCE_COLOR', 'CLICOLOR_FORCE'])

/**
 * Environment for a `uv` subprocess, with colour forced off.
 *
 * `uv` honours `FORCE_COLOR` / `CLICOLOR_FORCE` even when its stdout is a pipe,
 * so whatever env the app was launched with can wrap every package name in SGR
 * codes — `\x1b[1maiohttp\x1b[0m==3.9.5` instead of `aiohttp==3.9.5`. Parsed
 * output must never carry them: in #1514 those names were fed back to
 * `uv pip uninstall`, which rejected them all and tipped the restore into a
 * revert that deleted the user's environment.
 */
export function uvEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(base)) {
    if (COLOUR_FORCING_VARS.has(key.toUpperCase())) continue
    env[key] = value
  }
  env.NO_COLOR = '1'
  return env
}

/** Cap on captured pip output (characters) so a verbose install can't grow an unbounded string in memory. */
const MAX_CAPTURED_OUTPUT_CHARS = 256 * 1024

export interface UvPipResult {
  code: number
  /** Combined stdout+stderr in arrival order, capped to the last ~256K characters. */
  output: string
}

/** Handed the spawned uv so a caller can act on the process itself. Optional and
 *  purely additive: callers that do not pass one are unaffected, and nothing here
 *  depends on it. A caller that keeps the handle owns whatever it does with it. */
export type OnUvSpawn = (proc: ChildProcess) => void

/** Run a uv pip command, streaming output and capturing a bounded tail. Returns the exit code and captured output. */
export function runUvPipDetailed(
  uvPath: string,
  args: string[],
  cwd: string,
  sendOutput: (text: string) => void,
  signal?: AbortSignal,
  onSpawn?: OnUvSpawn
): Promise<UvPipResult> {
  if (signal?.aborted) return Promise.resolve({ code: 1, output: '' })
  return new Promise<UvPipResult>((resolve) => {
    const proc = spawn(uvPath, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
      env: uvEnv()
    })
    if (onSpawn) {
      try {
        onSpawn(proc)
      } catch {
        // A caller's own bookkeeping must not take down the install.
      }
    }

    let captured = ''
    const record = (text: string): void => {
      captured += text
      if (captured.length > MAX_CAPTURED_OUTPUT_CHARS)
        captured = captured.slice(-MAX_CAPTURED_OUTPUT_CHARS)
      sendOutput(text)
    }

    const onAbort = (): void => {
      killProcTree(proc)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()

    proc.stdout.on('data', (chunk: Buffer) => record(chunk.toString('utf-8')))
    proc.stderr.on('data', (chunk: Buffer) => record(chunk.toString('utf-8')))
    proc.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort)
      record(`Error: ${err.message}\n`)
      resolve({ code: 1, output: captured })
    })
    proc.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort)
      resolve({ code: code ?? 1, output: captured })
    })
  })
}

/** Run a uv pip command and stream output. Returns the exit code. */
export function runUvPip(
  uvPath: string,
  args: string[],
  cwd: string,
  sendOutput: (text: string) => void,
  signal?: AbortSignal
): Promise<number> {
  return runUvPipDetailed(uvPath, args, cwd, sendOutput, signal).then((r) => r.code)
}

export interface PipMirrorConfig {
  pypiMirror?: string
  useChineseMirrors?: boolean
}

/** Install a requirements file via `uv pip install -r`, filtering out PyTorch packages first. Returns the exit code and captured output. */
export async function installFilteredRequirementsDetailed(
  reqPath: string,
  uvPath: string,
  pythonPath: string,
  installPath: string,
  tempName: string,
  sendOutput: (text: string) => void,
  signal?: AbortSignal,
  mirrors?: PipMirrorConfig,
  extraArgs?: string[],
  onSpawn?: OnUvSpawn
): Promise<UvPipResult> {
  const content = await fs.promises.readFile(reqPath, 'utf-8')
  const filtered = content
    .split('\n')
    .filter((l) => !PYTORCH_RE.test(l.trim()))
    .join('\n')
  const filteredPath = path.join(installPath, tempName)
  await fs.promises.writeFile(filteredPath, filtered, 'utf-8')

  try {
    const indexArgs = getPipIndexArgs(mirrors?.pypiMirror, mirrors?.useChineseMirrors)
    return await runUvPipDetailed(
      uvPath,
      [
        'pip',
        'install',
        '-r',
        filteredPath,
        '--python',
        pythonPath,
        ...indexArgs,
        ...(extraArgs ?? [])
      ],
      installPath,
      sendOutput,
      signal,
      onSpawn
    )
  } finally {
    try {
      await fs.promises.unlink(filteredPath)
    } catch {}
  }
}

/** Install a requirements file via `uv pip install -r`, filtering out PyTorch packages first. Returns the exit code. */
export async function installFilteredRequirements(
  reqPath: string,
  uvPath: string,
  pythonPath: string,
  installPath: string,
  tempName: string,
  sendOutput: (text: string) => void,
  signal?: AbortSignal,
  mirrors?: PipMirrorConfig,
  extraArgs?: string[]
): Promise<number> {
  const result = await installFilteredRequirementsDetailed(
    reqPath,
    uvPath,
    pythonPath,
    installPath,
    tempName,
    sendOutput,
    signal,
    mirrors,
    extraArgs
  )
  return result.code
}

/** The canonical PyPI index — always used as the primary `--index-url`. */
export const PYPI_INDEX_URL = 'https://pypi.org/simple/'

/** Additional PyPI mirror URLs for regions with restricted access (e.g. China). */
export const PYPI_MIRROR_URLS: string[] = [
  'https://mirrors.aliyun.com/pypi/simple/',
  'https://mirrors.cloud.tencent.com/pypi/simple/'
]

/** Trim whitespace and ensure a trailing slash for consistent URL comparison. */
function normalizeIndexUrl(url: string): string {
  const trimmed = url.trim()
  return trimmed.endsWith('/') ? trimmed : trimmed + '/'
}

export function getPipIndexArgs(pypiMirror?: string, useChineseMirrors?: boolean): string[] {
  const mirror = pypiMirror?.trim() || undefined

  // Primary --index-url priority: user mirror, then first Chinese mirror, then pypi.org.
  // The Chinese mirror goes first (not pypi.org as a fallback extra) to avoid uv's first-match
  // strategy stalling on the unreachable pypi.org before falling back.
  let primary: string
  if (mirror) {
    primary = mirror
  } else if (useChineseMirrors && PYPI_MIRROR_URLS.length > 0) {
    primary = PYPI_MIRROR_URLS[0]!
  } else {
    primary = PYPI_INDEX_URL
  }

  const args: string[] = ['--index-url', primary]
  const seen = new Set<string>([normalizeIndexUrl(primary)])
  const extras: string[] = []

  const pypiNorm = normalizeIndexUrl(PYPI_INDEX_URL)
  if (!seen.has(pypiNorm)) {
    extras.push(PYPI_INDEX_URL)
    seen.add(pypiNorm)
  }

  if (useChineseMirrors) {
    for (const url of PYPI_MIRROR_URLS) {
      const norm = normalizeIndexUrl(url)
      if (!seen.has(norm)) {
        extras.push(url)
        seen.add(norm)
      }
    }
  }

  for (const url of extras) {
    args.push('--extra-index-url', url)
  }
  return args
}

/**
 * Parse `uv pip freeze` output into `{ name: version }`.
 *
 * ANSI escapes are stripped before parsing, not after: a colourised stream
 * yields `\x1b[1maiohttp\x1b[0m==3.9.5`, and a name carrying those bytes is
 * both unmatchable against a snapshot and unusable as a `uv pip` argument
 * (#1514). Callers pass the raw stdout; nothing downstream sees an escape.
 */
export function parsePipFreeze(output: string): Record<string, string> {
  // Null prototype: consumers test membership with `in`, so an inherited
  // `constructor` / `toString` would read as an installed distribution.
  const packages: Record<string, string> = Object.create(null)
  for (const line of stripAnsi(output).split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    // Editable installs: "-e git+https://...@commit#egg=name"
    if (trimmed.startsWith('-e ')) {
      const eggMatch = trimmed.match(/#egg=(.+)/)
      if (eggMatch) {
        const name = eggMatch[1]!.trim()
        if (VALID_PIP_NAME.test(name)) packages[name] = trimmed
      }
      continue
    }
    // PEP 508 direct references: "package @ git+https://..." or "package @ file:///..."
    const atMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\s*@\s*(.+)$/)
    if (atMatch) {
      const name = atMatch[1]!.trim()
      if (VALID_PIP_NAME.test(name)) packages[name] = atMatch[2]!.trim()
      continue
    }
    // Standard: "package==version"
    const eqIdx = trimmed.indexOf('==')
    if (eqIdx > 0) {
      // Trim: a styled span can enclose trailing whitespace, and `aiohttp `
      // is as unusable as an escape-carrying name.
      const name = trimmed.slice(0, eqIdx).trim()
      if (VALID_PIP_NAME.test(name)) packages[name] = trimmed.slice(eqIdx + 2)
    }
  }
  return packages
}

export async function pipFreeze(
  uvPath: string,
  pythonPath: string
): Promise<Record<string, string>> {
  const output = await new Promise<string>((resolve, reject) => {
    execFile(
      uvPath,
      ['pip', 'freeze', '--python', pythonPath],
      { windowsHide: true, timeout: 60_000, maxBuffer: 10 * 1024 * 1024, env: uvEnv() },
      (err, stdout, stderr) => {
        if (err) {
          // Surfaced in restore failure dialogs and logs: scrub absolute
          // paths (and so the OS username) and strip any escapes.
          const raw = stderr ? stripAnsi(stderr).slice(0, 500) : err.message
          return reject(new Error(`uv pip freeze failed: ${scrubAll(raw)}`))
        }
        resolve(stdout)
      }
    )
  })

  return parsePipFreeze(output)
}
