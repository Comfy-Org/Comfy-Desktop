import fs from 'fs'
import path from 'path'
import { execFile, spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import { killProcTree } from './process'
import { stripAnsi } from './stderrTail'
import { scrubAll } from '../../shared/piiScrub'

export const PYTORCH_RE = /^(torch|torchvision|torchaudio|torchsde)(\s*[<>=!~;[#]|$)/i

export const VALID_PIP_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

const COLOUR_FORCING_VARS = new Set(['FORCE_COLOR', 'CLICOLOR_FORCE'])

export function uvEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(base)) {
    if (COLOUR_FORCING_VARS.has(key.toUpperCase())) continue
    env[key] = value
  }
  env.NO_COLOR = '1'
  return env
}

const MAX_CAPTURED_OUTPUT_CHARS = 256 * 1024

export interface UvPipResult {
  code: number
  output: string
}

export type OnUvSpawn = (proc: ChildProcess) => void

export function runUvPipDetailed(
  uvPath: string,
  args: string[],
  cwd: string,
  sendOutput: (text: string) => void,
  signal?: AbortSignal,
  onSpawn?: OnUvSpawn,
  extraEnv?: Record<string, string>
): Promise<UvPipResult> {
  if (signal?.aborted) return Promise.resolve({ code: 1, output: '' })
  return new Promise<UvPipResult>((resolve) => {
    const proc = spawn(uvPath, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
      env: { ...uvEnv(), ...extraEnv }
    })
    if (onSpawn) {
      try {
        onSpawn(proc)
      } catch {}
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
  onSpawn?: OnUvSpawn,
  extraEnv?: Record<string, string>,
  subcommand: 'install' | 'compile' = 'install'
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
        ...(subcommand === 'install' ? ['install', '-r'] : ['compile']),
        filteredPath,
        '--python',
        pythonPath,
        ...indexArgs,
        ...(extraArgs ?? [])
      ],
      installPath,
      sendOutput,
      signal,
      onSpawn,
      extraEnv
    )
  } finally {
    try {
      await fs.promises.unlink(filteredPath)
    } catch {}
  }
}

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

export const PYPI_INDEX_URL = 'https://pypi.org/simple/'

export const PYPI_MIRROR_URLS: string[] = [
  'https://mirrors.aliyun.com/pypi/simple/',
  'https://mirrors.cloud.tencent.com/pypi/simple/'
]

function normalizeIndexUrl(url: string): string {
  const trimmed = url.trim()
  return trimmed.endsWith('/') ? trimmed : trimmed + '/'
}

export function getPipIndexArgs(pypiMirror?: string, useChineseMirrors?: boolean): string[] {
  const mirror = pypiMirror?.trim() || undefined

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

export function parsePipFreeze(output: string): Record<string, string> {
  const packages: Record<string, string> = Object.create(null)
  for (const line of stripAnsi(output).split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    if (trimmed.startsWith('-e ')) {
      const eggMatch = trimmed.match(/#egg=(.+)/)
      if (eggMatch) {
        const name = eggMatch[1]!.trim()
        if (VALID_PIP_NAME.test(name)) packages[name] = trimmed
      }
      continue
    }
    const atMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\s*@\s*(.+)$/)
    if (atMatch) {
      const name = atMatch[1]!.trim()
      if (VALID_PIP_NAME.test(name)) packages[name] = atMatch[2]!.trim()
      continue
    }
    const eqIdx = trimmed.indexOf('==')
    if (eqIdx > 0) {
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
          const raw = stderr ? stripAnsi(stderr).slice(0, 500) : err.message
          return reject(new Error(`uv pip freeze failed: ${scrubAll(raw)}`))
        }
        resolve(stdout)
      }
    )
  })

  return parsePipFreeze(output)
}
