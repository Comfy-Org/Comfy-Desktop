import type * as NodePty from 'node-pty'
import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import type { WebContents } from 'electron'
import * as installations from '../installations'
import type { InstallationRecord } from '../installations'
import type { TerminalEnv } from '../types/sources'
import { getActiveVenvDir, getActiveUvPath } from './pythonEnv'

let ptyModulePromise: Promise<typeof NodePty> | undefined
async function loadPty(): Promise<typeof NodePty> {
  ptyModulePromise ??= import('node-pty')
  const mod = await ptyModulePromise
  return (mod as { default?: typeof NodePty }).default ?? mod
}

const requireFromHere = createRequire(__filename)

function ensureSpawnHelperExecutable(): void {
  if (process.platform === 'win32') return
  try {
    const pkgDir = path.dirname(requireFromHere.resolve('node-pty/package.json'))
    const platformDir = `${process.platform}-${process.arch}`
    const prebuiltHelper = path
      .join(pkgDir, 'prebuilds', platformDir, 'spawn-helper')
      .replace('app.asar', 'app.asar.unpacked')
    if (fs.existsSync(prebuiltHelper)) {
      fs.chmodSync(prebuiltHelper, 0o755)
    }
    const builtHelper = path
      .join(pkgDir, 'build', 'Release', 'spawn-helper')
      .replace('app.asar', 'app.asar.unpacked')
    if (fs.existsSync(builtHelper)) {
      fs.chmodSync(builtHelper, 0o755)
    }
  } catch {}
}

ensureSpawnHelperExecutable()

const MAX_BUFFER_CHUNKS = 1000
const DEFAULT_SIZE = { cols: 80, rows: 30 }

export interface TerminalRestore {
  buffer: string[]
  size: { cols: number; rows: number }
  exited: boolean
}

function getDefaultShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC?.toLowerCase().includes('cmd')
      ? 'powershell.exe'
      : process.env.COMSPEC || 'powershell.exe'
  }
  return process.env.SHELL || '/bin/bash'
}

type TerminalEnvResolver = (installation: InstallationRecord) => TerminalEnv | null
let envResolver: TerminalEnvResolver = () => null

export function setTerminalEnvResolver(resolver: TerminalEnvResolver): void {
  envResolver = resolver
}

function defaultTerminalEnv(inst: InstallationRecord): TerminalEnv {
  const venvDir = getActiveVenvDir(inst)
  return {
    cwd: path.join(inst.installPath, 'ComfyUI'),
    venvDir,
    promptName: path.basename(venvDir),
    pip: { exe: getActiveUvPath(inst), args: ['pip'] }
  }
}

function initCommands(env: TerminalEnv): string[] {
  const hasActivation = !!env.venvDir || !!env.pathPrepends?.length
  const promptName = env.promptName ?? (env.venvDir ? path.basename(env.venvDir) : '')

  if (process.platform === 'win32') {
    const cmds: string[] = []
    const pathPrepends = [
      ...(env.pathPrepends ?? []),
      ...(env.venvDir ? [path.join(env.venvDir, 'Scripts')] : [])
    ]
    if (env.venvDir) {
      cmds.push(`$env:VIRTUAL_ENV = "${env.venvDir}"`, `$env:VIRTUAL_ENV_PROMPT = "${promptName}"`)
    } else if (pathPrepends.length) {
      cmds.push(`$env:VIRTUAL_ENV_PROMPT = "${promptName}"`)
    }
    if (pathPrepends.length) {
      cmds.push(`$env:PATH = "${pathPrepends.join(';')};$env:PATH"`)
    }
    if (hasActivation) {
      cmds.push(
        'if (Test-Path Env:PYTHONHOME) { Remove-Item Env:PYTHONHOME }',
        'function global:prompt { Write-Host -NoNewline -ForegroundColor Green "($env:VIRTUAL_ENV_PROMPT) "; "PS $($executionContext.SessionState.Path.CurrentLocation)$(\'>\' * ($nestedPromptLevel + 1)) " }'
      )
    }
    if (env.pip) {
      cmds.push(`function pip { & "${env.pip.exe}" ${env.pip.args.join(' ')} $args }`)
    }
    cmds.push('Clear-Host')
    return cmds
  }

  const cmds: string[] = []
  if (env.venvDir) {
    cmds.push(`source "${env.venvDir}/bin/activate"`)
  } else if (env.pathPrepends?.length) {
    cmds.push(`export VIRTUAL_ENV_PROMPT="${promptName}"`)
  }
  if (env.pathPrepends?.length) {
    cmds.push(`export PATH="${env.pathPrepends.join(':')}:$PATH"`)
  }
  if (env.pip) {
    cmds.push(`alias pip='"${env.pip.exe}" ${env.pip.args.join(' ')}'`)
  }
  cmds.push('clear')
  return cmds
}

class InstallTerminal {
  readonly installationId: string
  #pty: NodePty.IPty | undefined
  #spawnInFlight: Promise<void> | undefined
  #exited = true
  readonly sessionBuffer: string[] = []
  readonly size = { ...DEFAULT_SIZE }
  readonly subscribers = new Set<WebContents>()

  constructor(installationId: string) {
    this.installationId = installationId
  }

  get exited(): boolean {
    return this.#exited || this.#pty === undefined
  }

  async ensureAlive(): Promise<void> {
    if (this.#pty && !this.#exited) return
    this.#spawnInFlight ??= this.#spawn().finally(() => {
      this.#spawnInFlight = undefined
    })
    await this.#spawnInFlight
  }

  async restart(): Promise<void> {
    this.#killPty()
    await this.#spawn()
  }

  write(data: string): void {
    if (this.#exited || !this.#pty) return
    this.#pty.write(data)
  }

  resize(cols: number, rows: number): void {
    if (!Number.isFinite(cols) || !Number.isFinite(rows)) return
    this.size.cols = Math.max(1, Math.floor(cols))
    this.size.rows = Math.max(1, Math.floor(rows))
    if (this.#exited || !this.#pty) return
    try {
      this.#pty.resize(this.size.cols, this.size.rows)
    } catch {}
  }

  restore(): TerminalRestore {
    return {
      buffer: [...this.sessionBuffer],
      size: { ...this.size },
      exited: this.exited
    }
  }

  subscribe(wc: WebContents): void {
    if (this.subscribers.has(wc)) return
    this.subscribers.add(wc)
    wc.once('destroyed', () => this.subscribers.delete(wc))
  }

  unsubscribe(wc: WebContents): void {
    this.subscribers.delete(wc)
  }

  dispose(): void {
    this.#killPty()
    this.subscribers.clear()
    this.sessionBuffer.length = 0
  }

  async #spawn(): Promise<void> {
    const inst = await installations.get(this.installationId)
    if (!inst || !inst.installPath) {
      throw new Error(`Installation not found: ${this.installationId}`)
    }
    this.sessionBuffer.length = 0
    const env = envResolver(inst) ?? defaultTerminalEnv(inst)
    const cwd = env.cwd && fs.existsSync(env.cwd) ? env.cwd : inst.installPath
    const pty = await loadPty()
    const instance = pty.spawn(getDefaultShell(), [], {
      name: 'xterm-256color',
      cols: this.size.cols,
      rows: this.size.rows,
      cwd,
      env: process.env as Record<string, string>
    })

    this.#pty = instance
    this.#exited = false

    instance.onData((data) => {
      if (this.#pty !== instance) return
      this.sessionBuffer.push(data)
      if (this.sessionBuffer.length > MAX_BUFFER_CHUNKS) this.sessionBuffer.shift()
      this.#broadcast('terminal-output', { installationId: this.installationId, data })
    })

    instance.onExit(() => {
      if (this.#pty !== instance) return
      this.#exited = true
      this.#pty = undefined
      this.#broadcast('terminal-exited', { installationId: this.installationId })
    })

    for (const cmd of initCommands(env)) {
      instance.write(`${cmd}\r`)
    }
  }

  #killPty(): void {
    const instance = this.#pty
    this.#pty = undefined
    this.#exited = true
    if (!instance) return
    try {
      instance.kill()
    } catch {}
  }

  #broadcast(channel: string, payload: unknown): void {
    for (const wc of this.subscribers) {
      if (wc.isDestroyed()) {
        this.subscribers.delete(wc)
        continue
      }
      wc.send(channel, payload)
    }
  }
}

const terminals = new Map<string, InstallTerminal>()

function getOrCreate(installationId: string): InstallTerminal {
  let term = terminals.get(installationId)
  if (!term) {
    term = new InstallTerminal(installationId)
    terminals.set(installationId, term)
  }
  return term
}

export async function subscribeTerminal(
  installationId: string,
  wc: WebContents
): Promise<TerminalRestore> {
  const term = getOrCreate(installationId)
  await term.ensureAlive()
  term.subscribe(wc)
  return term.restore()
}

export function unsubscribeTerminal(installationId: string, wc: WebContents): void {
  terminals.get(installationId)?.unsubscribe(wc)
}

export function writeTerminal(installationId: string, data: string): void {
  terminals.get(installationId)?.write(data)
}

export function resizeTerminal(installationId: string, cols: number, rows: number): void {
  terminals.get(installationId)?.resize(cols, rows)
}

export async function restartTerminal(installationId: string): Promise<TerminalRestore> {
  const term = getOrCreate(installationId)
  await term.restart()
  return term.restore()
}

export function getTerminalRestore(installationId: string): TerminalRestore | null {
  return terminals.get(installationId)?.restore() ?? null
}

export function disposeTerminal(installationId: string): void {
  const term = terminals.get(installationId)
  if (!term) return
  term.dispose()
  terminals.delete(installationId)
}

export function disposeAllTerminals(): void {
  for (const id of [...terminals.keys()]) disposeTerminal(id)
}

export function _resetTerminalsForTest(): void {
  for (const term of terminals.values()) term.dispose()
  terminals.clear()
}
