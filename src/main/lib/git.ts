import { AsyncLocalStorage } from 'async_hooks'
import { execFile, spawn, type ExecFileException } from 'child_process'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { killProcTree } from './process'
import { getBundledScriptPath } from './bundledScript'
import { removeQuarantine, codesignBinaries } from '../sources/standalone/macRepair'
import * as telemetry from './telemetry'
import { buildErrorFields } from '../../shared/errorEvent'

type Pygit2State =
  | { status: 'unconfigured' }
  | { status: 'healthy'; python: string; script: string; failures: number }
  | { status: 'disabled'; reason: string }

let _pygit2: Pygit2State = { status: 'unconfigured' }

const PYGIT2_MAX_FAILURES = 3

const PYGIT2_LONG_TIMEOUT_MS = 20 * 60 * 1000

const LOCAL_GIT_TIMEOUT_MS = 5_000

const PYGIT2_PROBE_TIMEOUT_MS = 5_000

const _pygit2RepairedDirs = new Set<string>()

export function configurePygit2(pythonPath: string, scriptPath: string): void {
  _pygit2 = { status: 'healthy', python: pythonPath, script: scriptPath, failures: 0 }
}

export function isPygit2Configured(): boolean {
  return _pygit2.status === 'healthy'
}

export function getPygit2Config(): { python: string | null; script: string | null } {
  if (_pygit2.status === 'healthy') {
    return { python: _pygit2.python, script: _pygit2.script }
  }
  return { python: null, script: null }
}

export function getPygit2Status(): Pygit2State {
  return _pygit2
}

export function resetPygit2State(): void {
  _pygit2 = { status: 'unconfigured' }
  _pygit2RepairedDirs.clear()
}

function disablePygit2(reason: string): void {
  if (_pygit2.status === 'disabled') return
  console.warn('[git] disabling pygit2 fallback:', reason)
  const failures = _pygit2.status === 'healthy' ? _pygit2.failures : 0
  telemetry.emit('comfy.desktop.pygit2.circuit_broken', {
    reason_bucket: telemetry.bucketError(reason),
    failures
  })
  _pygit2 = { status: 'disabled', reason }
}

const _breakerExempt = new AsyncLocalStorage<true>()

export function withoutPygit2Breaker<T>(work: () => Promise<T>): Promise<T> {
  return _breakerExempt.run(true, work)
}

function recordPygit2Failure(reason: string): void {
  if (_breakerExempt.getStore()) return
  if (_pygit2.status !== 'healthy') return
  const failures = _pygit2.failures + 1
  _pygit2 = { ..._pygit2, failures }
  if (failures >= PYGIT2_MAX_FAILURES) {
    disablePygit2(`disabled after ${failures} consecutive launch failures: ${reason}`)
  }
}

function recordPygit2Success(): void {
  if (_breakerExempt.getStore()) return
  if (_pygit2.status !== 'healthy' || _pygit2.failures === 0) return
  _pygit2 = { ..._pygit2, failures: 0 }
}

function isLaunchFailure(error: ExecFileException | null): boolean {
  if (!error) return false
  if (error.killed) return true
  if (error.signal) return true
  const code = error.code
  if (typeof code === 'string') return true
  return false
}

function getStandalonePythonPath(installPath: string): string {
  return process.platform === 'win32'
    ? path.join(installPath, 'standalone-env', 'python.exe')
    : path.join(installPath, 'standalone-env', 'bin', 'python3')
}

export function probePygit2(
  pythonPath: string,
  scriptPath: string,
  timeoutMs: number = PYGIT2_PROBE_TIMEOUT_MS
): Promise<{ ok: true } | { ok: false; reason: string }> {
  return new Promise((resolve) => {
    execFile(
      pythonPath,
      ['-s', '-u', scriptPath, 'healthcheck'],
      {
        encoding: 'utf-8',
        windowsHide: true,
        timeout: timeoutMs
      },
      (error, stdout, stderr) => {
        if (!error && (stdout ?? '').includes('ok pygit2')) {
          resolve({ ok: true })
          return
        }
        const reason =
          `${error?.message ?? ''}\n${(stderr ?? '').trim()}`.trim() || 'pygit2 healthcheck failed'
        resolve({ ok: false, reason })
      }
    )
  })
}

async function repairEnvForPygit2(envDir: string): Promise<void> {
  if (process.platform !== 'darwin') return
  if (_pygit2RepairedDirs.has(envDir)) return
  _pygit2RepairedDirs.add(envDir)
  if (!fs.existsSync(envDir)) return
  let result: 'ok' | 'failed' = 'ok'
  const log = (msg: string): void => {
    console.log('[git] pygit2 repair:', msg.trim())
  }
  try {
    log(`removing quarantine on ${envDir}`)
    await removeQuarantine(envDir, log)
    log(`adhoc codesigning ${envDir}`)
    await codesignBinaries(envDir, log)
  } catch (err) {
    result = 'failed'
    console.warn('[git] pygit2 repair failed:', err)
  }
  telemetry.emit('comfy.desktop.pygit2.repair_attempted', { result })
}

export async function tryConfigurePygit2Fallback(installPath: string): Promise<boolean> {
  if (_pygit2.status === 'disabled') return false
  const pythonPath = getStandalonePythonPath(installPath)
  if (!fs.existsSync(pythonPath)) return false
  const scriptPath = getBundledScriptPath('git_operations.py')
  if (!fs.existsSync(scriptPath)) return false

  let probe = await probePygit2(pythonPath, scriptPath)
  if (!probe.ok && process.platform === 'darwin') {
    console.warn(`[git] pygit2 probe failed; attempting macOS repair: ${probe.reason}`)
    await repairEnvForPygit2(path.join(installPath, 'standalone-env'))
    probe = await probePygit2(pythonPath, scriptPath)
  }

  if (!probe.ok) {
    console.warn(`[git] pygit2 fallback rejected for ${installPath}: ${probe.reason}`)
    telemetry.emit('comfy.desktop.pygit2.probe_failed', {
      source: 'standalone',
      ...buildErrorFields(probe.reason)
    })
    return false
  }

  configurePygit2(pythonPath, scriptPath)
  console.log('[git] pygit2 fallback configured via', pythonPath)
  return true
}

export async function tryConfigureBootstrapPygit2(): Promise<boolean> {
  if (_pygit2.status === 'disabled') return false
  const osName =
    process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux'
  const platformDir = `${osName}-${process.arch}`
  const bootstrapDir = app.isPackaged
    ? path.join(process.resourcesPath, 'bootstrap-python')
    : path.join(__dirname, '..', '..', 'bootstrap-python', platformDir)
  const pythonPath =
    process.platform === 'win32'
      ? path.join(bootstrapDir, 'python.exe')
      : path.join(bootstrapDir, 'bin', 'python3')
  if (!fs.existsSync(pythonPath)) return false
  const scriptPath = getBundledScriptPath('git_operations.py')
  if (!fs.existsSync(scriptPath)) return false

  let probe = await probePygit2(pythonPath, scriptPath)
  if (!probe.ok && process.platform === 'darwin') {
    console.warn(`[git] bootstrap pygit2 probe failed; attempting macOS repair: ${probe.reason}`)
    await repairEnvForPygit2(bootstrapDir)
    probe = await probePygit2(pythonPath, scriptPath)
  }

  if (!probe.ok) {
    console.warn(`[git] bootstrap pygit2 rejected at ${pythonPath}: ${probe.reason}`)
    telemetry.emit('comfy.desktop.pygit2.probe_failed', {
      source: 'bootstrap',
      ...buildErrorFields(probe.reason)
    })
    return false
  }

  configurePygit2(pythonPath, scriptPath)
  console.log('[git] bootstrap pygit2 configured via', pythonPath)
  return true
}

function runPygit2(
  args: string[],
  timeout: number = LOCAL_GIT_TIMEOUT_MS
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    if (_pygit2.status !== 'healthy') {
      resolve({ exitCode: 1, stdout: '', stderr: 'pygit2 fallback is not available' })
      return
    }
    const { python, script } = _pygit2
    execFile(
      python,
      ['-s', '-u', script, ...args],
      {
        encoding: 'utf-8',
        windowsHide: true,
        timeout
      },
      (error, stdout, stderr) => {
        const stderrStr = (stderr ?? '').toString()
        if (isLaunchFailure(error)) {
          recordPygit2Failure(error?.message ?? stderrStr ?? 'launch failure')
        } else {
          recordPygit2Success()
        }
        resolve({
          exitCode: error
            ? typeof (error as ExecFileException).code === 'number'
              ? ((error as ExecFileException).code as number)
              : 1
            : 0,
          stdout: (stdout ?? '').toString(),
          stderr: stderrStr
        })
      }
    )
  })
}

function makeRunPygit2(
  sendOutput: (text: string) => void,
  signal?: AbortSignal,
  timeoutMs: number = PYGIT2_LONG_TIMEOUT_MS
): (args: string[]) => Promise<ProcessResult> {
  return (args: string[]): Promise<ProcessResult> => {
    if (signal?.aborted) return Promise.resolve({ exitCode: 1, stderr: '', stdout: '' })
    if (_pygit2.status !== 'healthy') {
      return Promise.resolve({
        exitCode: 1,
        stderr: 'pygit2 fallback is not available',
        stdout: ''
      })
    }
    const { python, script } = _pygit2
    return new Promise((resolve) => {
      const stdoutChunks: string[] = []
      const stderrChunks: string[] = []
      const proc = spawn(python, ['-s', '-u', script, ...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        detached: process.platform !== 'win32'
      })
      let settled = false
      let timedOut = false
      const finish = (result: ProcessResult): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        resolve(result)
      }
      const timer = setTimeout(() => {
        timedOut = true
        const msg = `\nTimed out running pygit2 helper after ${Math.round(timeoutMs / 1000)}s\n`
        sendOutput(msg)
        stderrChunks.push(msg)
        killProcTree(proc)
        recordPygit2Failure('timeout in long-running pygit2 spawn')
        finish({ exitCode: 1, stderr: stderrChunks.join(''), stdout: stdoutChunks.join('') })
      }, timeoutMs)
      const onAbort = (): void => {
        killProcTree(proc)
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) onAbort()
      proc.stdout.on('data', (data: Buffer) => {
        const text = data.toString()
        stdoutChunks.push(text)
        sendOutput(text)
      })
      proc.stderr.on('data', (data: Buffer) => {
        const text = data.toString()
        stderrChunks.push(text)
        sendOutput(text)
      })
      proc.on('error', (err) => {
        recordPygit2Failure(err.message)
        sendOutput(err.message)
        finish({
          exitCode: 1,
          stderr: stderrChunks.join('') + err.message,
          stdout: stdoutChunks.join('')
        })
      })
      proc.on('close', (code) => {
        if (timedOut) return
        if (code === 0) recordPygit2Success()
        finish({
          exitCode: code ?? 1,
          stderr: stderrChunks.join(''),
          stdout: stdoutChunks.join('')
        })
      })
    })
  }
}

export interface ProcessResult {
  exitCode: number
  stderr: string
  stdout: string
}

function spawnStreamed(
  cmd: string,
  args: string[],
  sendOutput: (text: string) => void,
  options?: { cwd?: string; signal?: AbortSignal }
): Promise<ProcessResult> {
  const { cwd, signal } = options ?? {}
  if (signal?.aborted) return Promise.resolve({ exitCode: 1, stderr: '', stdout: '' })
  return new Promise((resolve) => {
    const stdoutChunks: string[] = []
    const stderrChunks: string[] = []
    const proc = spawn(cmd, args, {
      ...(cwd ? { cwd } : {}),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32'
    })
    const onAbort = (): void => {
      killProcTree(proc)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
    proc.stdout.on('data', (data: Buffer) => {
      const text = data.toString()
      stdoutChunks.push(text)
      sendOutput(text)
    })
    proc.stderr.on('data', (data: Buffer) => {
      const text = data.toString()
      stderrChunks.push(text)
      sendOutput(text)
    })
    proc.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort)
      sendOutput(err.message)
      resolve({
        exitCode: 1,
        stderr: stderrChunks.join('') + err.message,
        stdout: stdoutChunks.join('')
      })
    })
    proc.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort)
      resolve({ exitCode: code ?? 1, stderr: stderrChunks.join(''), stdout: stdoutChunks.join('') })
    })
  })
}

export function gitDirPresence(repoPath: string): 'absent' | 'present' | 'indeterminate' {
  try {
    fs.lstatSync(path.join(repoPath, '.git'))
    return 'present'
  } catch (err) {
    return (err as NodeJS.ErrnoException)?.code === 'ENOENT' ? 'absent' : 'indeterminate'
  }
}

export function resolveGitDir(repoPath: string): string | null {
  const dotGit = path.join(repoPath, '.git')
  try {
    const st = fs.statSync(dotGit)
    if (st.isDirectory()) return dotGit
    if (st.isFile()) {
      const content = fs.readFileSync(dotGit, 'utf-8')
      const m = content.match(/^gitdir:\s*(.+)\s*$/m)
      if (m) return path.resolve(repoPath, m[1]!.trim())
    }
  } catch {}
  return null
}

export function readGitHead(repoPath: string): string | null {
  const gitDir = resolveGitDir(repoPath)
  if (!gitDir) return null
  const headPath = path.join(gitDir, 'HEAD')
  try {
    const content = fs.readFileSync(headPath, 'utf-8').trim()
    if (!content.startsWith('ref: ')) return content || null
    const refPath = path.resolve(gitDir, content.slice(5))
    if (!refPath.startsWith(gitDir + path.sep) && refPath !== gitDir) return null
    try {
      return fs.readFileSync(refPath, 'utf-8').trim() || null
    } catch {
      const packedRefsPath = path.join(gitDir, 'packed-refs')
      try {
        const packed = fs.readFileSync(packedRefsPath, 'utf-8')
        const ref = content.slice(5)
        for (const line of packed.split('\n')) {
          if (line.startsWith('#') || !line.trim()) continue
          const [sha, name] = line.trim().split(/\s+/)
          if (name === ref) return sha || null
        }
      } catch {}
      return null
    }
  } catch {
    return null
  }
}

export function readGitRemoteUrl(repoPath: string): string | null {
  const gitDir = resolveGitDir(repoPath)
  if (!gitDir) return null
  const configPath = path.join(gitDir, 'config')
  try {
    const content = fs.readFileSync(configPath, 'utf-8')
    const match = content.match(/\[remote "origin"\][^[]*?url\s*=\s*(.+)/m)
    if (!match) return null
    return redactUrl(match[1]!.trim())
  } catch {
    return null
  }
}

function redactUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.username || parsed.password) {
      parsed.username = ''
      parsed.password = ''
    }
    return parsed.toString()
  } catch {
    return url.replace(/\/\/[^/@]+@/, '//')
  }
}

export function countCommitsAhead(
  repoPath: string,
  tag: string,
  commit: string = 'HEAD'
): Promise<number | undefined> {
  if (isPygit2Configured()) {
    return runPygit2(['rev-list-count', repoPath, tag, commit]).then(({ exitCode, stdout }) => {
      if (exitCode !== 0) return undefined
      const n = parseInt(stdout.trim(), 10)
      return Number.isFinite(n) ? n : undefined
    })
  }
  return new Promise((resolve) => {
    execFile(
      'git',
      ['rev-list', '--count', `${tag}..${commit}`],
      {
        cwd: repoPath,
        encoding: 'utf-8',
        windowsHide: true,
        timeout: LOCAL_GIT_TIMEOUT_MS
      },
      (error, stdout) => {
        if (error) {
          resolve(undefined)
          return
        }
        const n = parseInt(stdout.trim(), 10)
        resolve(Number.isFinite(n) ? n : undefined)
      }
    )
  })
}

export function findNearestTag(
  repoPath: string,
  commit: string = 'HEAD'
): Promise<string | undefined> {
  if (isPygit2Configured()) {
    return runPygit2(['describe-tags', repoPath, commit]).then(({ exitCode, stdout }) => {
      if (exitCode !== 0) return undefined
      const tag = stdout.trim()
      return tag || undefined
    })
  }
  return new Promise((resolve) => {
    execFile(
      'git',
      ['describe', '--tags', '--abbrev=0', commit],
      {
        cwd: repoPath,
        encoding: 'utf-8',
        windowsHide: true,
        timeout: LOCAL_GIT_TIMEOUT_MS
      },
      (error, stdout) => {
        if (error) {
          resolve(undefined)
          return
        }
        const tag = stdout.trim()
        resolve(tag || undefined)
      }
    )
  })
}

export function lsRemoteLatestTag(url: string): Promise<string | undefined> {
  if (isPygit2Configured()) {
    return runPygit2(['ls-remote-tags', url], 15000).then(({ exitCode, stdout }) => {
      if (exitCode !== 0) return undefined
      const tag = stdout.trim().split('\n')[0]?.trim()
      return tag || undefined
    })
  }
  return new Promise((resolve) => {
    execFile(
      'git',
      ['ls-remote', '--tags', url],
      {
        encoding: 'utf-8',
        windowsHide: true,
        timeout: 15000
      },
      (error, stdout) => {
        if (error) {
          resolve(undefined)
          return
        }
        let best: { tag: string; version: number[] } | undefined
        for (const line of stdout.trim().split('\n')) {
          const ref = line.split(/\s+/)[1]
          if (!ref || !ref.startsWith('refs/tags/') || ref.endsWith('^{}')) continue
          const name = ref.slice('refs/tags/'.length)
          const m = name.match(/^v?(\d+(?:\.\d+)*)$/)
          if (!m) continue
          const v = m[1]!.split('.').map(Number)
          if (!best || compareVersionArrays(v, best.version) > 0) {
            best = { tag: name, version: v }
          }
        }
        resolve(best?.tag)
      }
    )
  })
}

export function lsRemoteStableTags(url: string): Promise<string[]> {
  const filterAndSort = (raw: string[]): string[] => {
    const versions: Array<{ tag: string; parts: number[] }> = []
    for (const tag of raw) {
      const m = tag.match(/^v(\d+)\.(\d+)\.(\d+)$/)
      if (!m) continue
      versions.push({ tag, parts: [Number(m[1]), Number(m[2]), Number(m[3])] })
    }
    versions.sort((a, b) => compareVersionArrays(b.parts, a.parts))
    return versions.map((v) => v.tag)
  }

  if (isPygit2Configured()) {
    return runPygit2(['ls-remote-tags', url], 15000).then(({ exitCode, stdout }) => {
      if (exitCode !== 0) return []
      const tags = stdout
        .trim()
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
      return filterAndSort(tags)
    })
  }
  return new Promise((resolve) => {
    execFile(
      'git',
      ['ls-remote', '--tags', url],
      {
        encoding: 'utf-8',
        windowsHide: true,
        timeout: 15000
      },
      (error, stdout) => {
        if (error) {
          resolve([])
          return
        }
        const tags: string[] = []
        for (const line of stdout.trim().split('\n')) {
          const ref = line.split(/\s+/)[1]
          if (!ref || !ref.startsWith('refs/tags/') || ref.endsWith('^{}')) continue
          tags.push(ref.slice('refs/tags/'.length))
        }
        resolve(filterAndSort(tags))
      }
    )
  })
}

export function lsRemoteRef(url: string, ref: string): Promise<string | null> {
  if (isPygit2Configured()) {
    return runPygit2(['ls-remote-ref', url, ref], 15000).then(({ exitCode, stdout }) => {
      if (exitCode !== 0) return null
      const sha = stdout.trim()
      return sha || null
    })
  }
  return new Promise((resolve) => {
    execFile(
      'git',
      ['ls-remote', '--refs', url, ref],
      {
        encoding: 'utf-8',
        windowsHide: true,
        timeout: 15000
      },
      (error, stdout) => {
        if (error) {
          resolve(null)
          return
        }
        const sha = stdout.trim().split(/\s+/)[0]
        resolve(sha || null)
      }
    )
  })
}

function compareVersionArrays(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

export function findLatestVersionTag(repoPath: string): Promise<string | undefined> {
  if (isPygit2Configured()) {
    return runPygit2(['tag-list', repoPath]).then(({ exitCode, stdout }) => {
      if (exitCode !== 0) return undefined
      const tag = stdout.trim().split('\n')[0]?.trim()
      return tag || undefined
    })
  }
  return new Promise((resolve) => {
    execFile(
      'git',
      ['tag', '-l', 'v*', '--sort=-v:refname'],
      {
        cwd: repoPath,
        encoding: 'utf-8',
        windowsHide: true,
        timeout: LOCAL_GIT_TIMEOUT_MS
      },
      (error, stdout) => {
        if (error) {
          resolve(undefined)
          return
        }
        const tag = stdout.trim().split('\n')[0]?.trim()
        resolve(tag || undefined)
      }
    )
  })
}

export function countUniqueCommits(
  repoPath: string,
  ref1: string,
  ref2: string
): Promise<number | undefined> {
  if (isPygit2Configured()) {
    return runPygit2(['cherry-pick-count', repoPath, ref1, ref2]).then(({ exitCode, stdout }) => {
      if (exitCode !== 0) return undefined
      const n = parseInt(stdout.trim(), 10)
      return Number.isFinite(n) ? n : undefined
    })
  }
  return new Promise((resolve) => {
    execFile(
      'git',
      ['rev-list', '--count', '--cherry-pick', '--left-only', `${ref1}...${ref2}`],
      {
        cwd: repoPath,
        encoding: 'utf-8',
        windowsHide: true,
        timeout: LOCAL_GIT_TIMEOUT_MS
      },
      (error, stdout) => {
        if (error) {
          resolve(undefined)
          return
        }
        const n = parseInt(stdout.trim(), 10)
        resolve(Number.isFinite(n) ? n : undefined)
      }
    )
  })
}

export function isAncestorOf(
  repoPath: string,
  ancestor: string,
  descendant: string
): Promise<boolean> {
  if (isPygit2Configured()) {
    return runPygit2(['is-ancestor', repoPath, ancestor, descendant]).then(({ exitCode }) => {
      return exitCode === 0
    })
  }
  return new Promise((resolve) => {
    execFile(
      'git',
      ['merge-base', '--is-ancestor', ancestor, descendant],
      {
        cwd: repoPath,
        windowsHide: true,
        timeout: LOCAL_GIT_TIMEOUT_MS
      },
      (error) => {
        resolve(!error)
      }
    )
  })
}

export function findMergeBase(
  repoPath: string,
  ref1: string,
  ref2: string
): Promise<string | undefined> {
  if (isPygit2Configured()) {
    return runPygit2(['merge-base', repoPath, ref1, ref2]).then(({ exitCode, stdout }) => {
      if (exitCode !== 0) return undefined
      const sha = stdout.trim()
      return sha || undefined
    })
  }
  return new Promise((resolve) => {
    execFile(
      'git',
      ['merge-base', ref1, ref2],
      {
        cwd: repoPath,
        encoding: 'utf-8',
        windowsHide: true,
        timeout: LOCAL_GIT_TIMEOUT_MS
      },
      (error, stdout) => {
        if (error) {
          resolve(undefined)
          return
        }
        const sha = stdout.trim()
        resolve(sha || undefined)
      }
    )
  })
}

export function revParseRef(repoPath: string, ref: string): Promise<string | undefined> {
  if (isPygit2Configured()) {
    return runPygit2(['rev-parse', repoPath, ref]).then(({ exitCode, stdout }) => {
      if (exitCode !== 0) return undefined
      const sha = stdout.trim()
      return sha || undefined
    })
  }
  return new Promise((resolve) => {
    execFile(
      'git',
      ['rev-parse', ref],
      {
        cwd: repoPath,
        encoding: 'utf-8',
        windowsHide: true,
        timeout: LOCAL_GIT_TIMEOUT_MS
      },
      (error, stdout) => {
        if (error) {
          resolve(undefined)
          return
        }
        const sha = stdout.trim()
        resolve(sha || undefined)
      }
    )
  })
}

export function hasTrackedChanges(repoPath: string): Promise<boolean | null> {
  if (isPygit2Configured()) {
    return runPygit2(['tracked-changes', repoPath]).then(({ exitCode, stdout }) =>
      exitCode === 0 ? stdout.trim() !== '' : null
    )
  }
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-c', 'safe.directory=*', 'status', '--porcelain', '--untracked-files=no'],
      { cwd: repoPath, encoding: 'utf-8', windowsHide: true, timeout: LOCAL_GIT_TIMEOUT_MS },
      (error, stdout) => resolve(error ? null : stdout.trim() !== '')
    )
  })
}

const MERGE_BASE_NONE = 5

export function findMergeBaseOrNone(
  repoPath: string,
  ref1: string,
  ref2: string
): Promise<string | null | undefined> {
  if (isPygit2Configured()) {
    return runPygit2(['merge-base', repoPath, ref1, ref2]).then(({ exitCode, stdout }) => {
      if (exitCode === MERGE_BASE_NONE) return null
      return exitCode === 0 ? stdout.trim() || undefined : undefined
    })
  }
  return new Promise((resolve) => {
    execFile(
      'git',
      ['merge-base', ref1, ref2],
      { cwd: repoPath, encoding: 'utf-8', windowsHide: true, timeout: LOCAL_GIT_TIMEOUT_MS },
      (error, stdout) => {
        if (error) {
          resolve(error.code === 1 && !error.killed && error.signal == null ? null : undefined)
          return
        }
        resolve(stdout.trim() || undefined)
      }
    )
  })
}

const HAS_COMMIT_ABSENT = 3

export function commitPresence(
  repoPath: string,
  sha: string
): Promise<'present' | 'absent' | 'unknown'> {
  if (isPygit2Configured()) {
    return runPygit2(['has-commit', repoPath, sha]).then(({ exitCode }) =>
      exitCode === 0 ? 'present' : exitCode === HAS_COMMIT_ABSENT ? 'absent' : 'unknown'
    )
  }
  return new Promise((resolve) => {
    execFile(
      'git',
      ['rev-parse', '--verify', '--quiet', '--end-of-options', `${sha}^{commit}`],
      { cwd: repoPath, windowsHide: true, timeout: LOCAL_GIT_TIMEOUT_MS },
      (error) => {
        if (!error) return resolve('present')
        const miss = error.code === 1 && !error.killed && error.signal == null
        resolve(miss ? 'absent' : 'unknown')
      }
    )
  })
}

export function fetchTags(repoPath: string): Promise<boolean> {
  if (isPygit2Configured()) {
    return runPygit2(['fetch-tags', repoPath], 15000).then(({ exitCode }) => {
      return exitCode === 0
    })
  }
  return new Promise((resolve) => {
    execFile(
      'git',
      ['fetch', '--unshallow', 'origin', '--tags'],
      {
        cwd: repoPath,
        windowsHide: true,
        timeout: 15000
      },
      (error) => {
        if (!error) {
          resolve(true)
          return
        }
        execFile(
          'git',
          ['fetch', 'origin', '--tags'],
          {
            cwd: repoPath,
            windowsHide: true,
            timeout: 15000
          },
          (error2) => {
            resolve(!error2)
          }
        )
      }
    )
  })
}

export function fetchCommitSha(repoPath: string, sha: string): Promise<boolean> {
  if (isPygit2Configured()) {
    return runPygit2(['fetch-commit', repoPath, sha], 15000).then(({ exitCode }) => {
      return exitCode === 0
    })
  }
  return new Promise((resolve) => {
    execFile(
      'git',
      ['fetch', 'origin', sha],
      {
        cwd: repoPath,
        windowsHide: true,
        timeout: 15000
      },
      (error) => {
        resolve(!error)
      }
    )
  })
}

export function hasGitDir(nodePath: string): boolean {
  return resolveGitDir(nodePath) !== null
}

let _systemGitProbe: Promise<boolean> | null = null

function probeSystemGit(): Promise<boolean> {
  if (_systemGitProbe !== null) return _systemGitProbe
  _systemGitProbe = new Promise<boolean>((resolve) => {
    execFile('git', ['--version'], { windowsHide: true, timeout: 5000 }, (error) => {
      resolve(!error)
    })
  })
  return _systemGitProbe
}

export function isGitAvailable(): Promise<boolean> {
  if (isPygit2Configured()) return Promise.resolve(true)
  return probeSystemGit()
}

export function resetGitAvailableCache(): void {
  _systemGitProbe = null
}

export function isSystemGitAvailable(): Promise<boolean> {
  return probeSystemGit()
}

export function isForcePygit2(): boolean {
  return process.env.COMFY_FORCE_PYGIT2 === '1'
}

export function isPygit2AuthFailure(result: ProcessResult): boolean {
  if (result.exitCode === 0) return false
  const s = `${result.stdout}\n${result.stderr}`.toLowerCase()
  return (
    s.includes('no callback set') ||
    s.includes('authentication required') ||
    s.includes('unsupported url protocol') ||
    s.includes('remote authentication required') ||
    s.includes('callback returned unsupported credentials type') ||
    s.includes('user rejected certificate') ||
    s.includes('certificate') ||
    s.includes('ssl') ||
    s.includes('tls') ||
    (s.includes('ssh') && s.includes('credential'))
  )
}

async function withSystemGitFallback(
  op: string,
  pygit2Op: () => Promise<ProcessResult>,
  systemGitOp: () => Promise<ProcessResult>,
  sendOutput: (text: string) => void
): Promise<ProcessResult> {
  const result = await pygit2Op()
  if (!isPygit2AuthFailure(result) || isForcePygit2()) return result
  if (!(await isSystemGitAvailable())) return result
  telemetry.emit('comfy.desktop.git.system_fallback', {
    op,
    error_bucket: telemetry.bucketError(result.stderr)
  })
  sendOutput(
    '\npygit2 could not authenticate or validate the remote certificate (your git config may ' +
      'rewrite GitHub HTTPS to SSH, or your system trust store may reject the certificate); ' +
      'retrying with system git...\n'
  )
  return systemGitOp()
}

export function gitClone(
  url: string,
  dest: string,
  sendOutput: (text: string) => void,
  signal?: AbortSignal
): Promise<ProcessResult> {
  if (signal?.aborted) return Promise.resolve({ exitCode: 1, stderr: '', stdout: '' })
  const systemGitClone = async (): Promise<ProcessResult> => {
    await fs.promises.rm(dest, { recursive: true, force: true }).catch(() => {})
    return spawnStreamed('git', ['clone', url, dest], sendOutput, { signal })
  }
  if (isPygit2Configured()) {
    const runPygit2Spawn = makeRunPygit2(sendOutput, signal)
    return withSystemGitFallback(
      'clone',
      () => runPygit2Spawn(['clone', url, dest]),
      systemGitClone,
      sendOutput
    )
  }
  return spawnStreamed('git', ['clone', url, dest], sendOutput, { signal })
}

function makeRunGit(
  repoPath: string,
  sendOutput: (text: string) => void,
  signal?: AbortSignal
): (args: string[]) => Promise<ProcessResult> {
  return (args: string[]): Promise<ProcessResult> =>
    spawnStreamed('git', args, sendOutput, { cwd: repoPath, signal })
}

export function gitCheckoutCommit(
  repoPath: string,
  commit: string,
  sendOutput: (text: string) => void,
  signal?: AbortSignal
): Promise<ProcessResult> {
  if (signal?.aborted) return Promise.resolve({ exitCode: 1, stderr: '', stdout: '' })
  const systemGitCheckout = (): Promise<ProcessResult> => {
    const runGit = makeRunGit(repoPath, sendOutput, signal)
    return runGit(['checkout', commit]).then((directResult) => {
      if (directResult.exitCode === 0) return directResult
      return runGit(['fetch', '--unshallow', 'origin'])
        .then((result) => {
          if (result.exitCode !== 0) return runGit(['fetch', 'origin'])
          return result
        })
        .then((fetchResult) => {
          if (fetchResult.exitCode !== 0) return fetchResult
          return runGit(['checkout', commit])
        })
    })
  }
  if (isPygit2Configured()) {
    const runPygit2Spawn = makeRunPygit2(sendOutput, signal)
    return withSystemGitFallback(
      'checkout',
      () => runPygit2Spawn(['checkout', repoPath, commit]),
      systemGitCheckout,
      sendOutput
    )
  }
  return systemGitCheckout()
}

export async function rollbackComfySource(
  comfyuiDir: string,
  targetHead: string,
  sendOutput?: (text: string) => void
): Promise<boolean> {
  if (readGitHead(comfyuiDir) === targetHead) return true
  sendOutput?.(`\nRolling back ComfyUI source to ${targetHead.slice(0, 7)}...\n`)
  const result = await gitCheckoutCommit(
    comfyuiDir,
    targetHead,
    sendOutput ?? (() => {}),
    undefined
  )
  const head = readGitHead(comfyuiDir)
  const ok = result.exitCode === 0 && !!head && head.startsWith(targetHead.slice(0, 7))
  sendOutput?.(
    ok
      ? `Rolled back ComfyUI source to ${targetHead.slice(0, 7)}.\n`
      : `WARNING: Failed to roll back ComfyUI source to ${targetHead.slice(0, 7)}.\n`
  )
  return ok
}

export function gitFetchAndCheckout(
  repoPath: string,
  commit: string,
  sendOutput: (text: string) => void,
  signal?: AbortSignal
): Promise<ProcessResult> {
  if (signal?.aborted) return Promise.resolve({ exitCode: 1, stderr: '', stdout: '' })
  const systemGitFetchAndCheckout = (): Promise<ProcessResult> => {
    const runGit = makeRunGit(repoPath, sendOutput, signal)

    const refspec = '+refs/heads/master:refs/remotes/origin/master'
    return runGit(['fetch', '--unshallow', '--tags', 'origin', refspec])
      .then((result) => {
        if (result.exitCode !== 0) return runGit(['fetch', '--tags', 'origin', refspec])
        return result
      })
      .then((result) => {
        if (result.exitCode !== 0) return result
        return runGit(['checkout', '--detach', 'HEAD'])
          .then(() => {
            return runGit(['branch', '-f', 'master', 'refs/remotes/origin/master'])
          })
          .then((branchResult) => {
            if (branchResult.exitCode !== 0) return branchResult
            return runGit(['checkout', commit])
          })
      })
  }
  if (isPygit2Configured()) {
    const runPygit2Spawn = makeRunPygit2(sendOutput, signal)
    return withSystemGitFallback(
      'fetch-and-checkout',
      () => runPygit2Spawn(['fetch-and-checkout', repoPath, commit]),
      systemGitFetchAndCheckout,
      sendOutput
    )
  }
  return systemGitFetchAndCheckout()
}
