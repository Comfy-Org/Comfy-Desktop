import { execFile } from 'node:child_process'
import { copyFile, cp, mkdir } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const STUB_MAIN_PY = path.resolve(__dirname, 'fakeComfy', 'main.py')

function hostPython(): string {
  return process.env['E2E_PYTHON'] ?? (process.platform === 'win32' ? 'python' : 'python3')
}

async function createVenv(installPath: string): Promise<void> {
  const venvDir = path.join(installPath, 'venv')
  const python = hostPython()
  try {
    await execFileAsync(python, ['-m', 'venv', '--without-pip', venvDir], { windowsHide: true })
  } catch (err) {
    throw new Error(
      `The fake ComfyUI install runs on a real Python 3, and "${python}" could not build its venv. Install Python 3 or set E2E_PYTHON to an interpreter.`,
      { cause: err }
    )
  }
  if (process.platform === 'win32') {
    await cp(path.join(venvDir, 'Scripts'), path.join(venvDir, 'base'), { recursive: true })
  }
}

export async function reserveFreePort(): Promise<number> {
  const { createServer } = await import('node:net')
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      if (addr === null || typeof addr === 'string') {
        srv.close(() => reject(new Error('could not determine a free port')))
        return
      }
      const { port } = addr
      srv.close(() => resolve(port))
    })
  })
}

export interface FakeComfyInstall {
  installPath: string
  port: number
}

export async function writeFakeComfyInstall(opts: {
  installPath: string
  port: number
}): Promise<FakeComfyInstall> {
  const { installPath, port } = opts
  await mkdir(path.join(installPath, 'ComfyUI'), { recursive: true })
  await copyFile(STUB_MAIN_PY, path.join(installPath, 'ComfyUI', 'main.py'))
  await createVenv(installPath)
  return { installPath, port }
}

export interface FakeComfyProcess {
  pid: number
  argv: string[]
}

export function readFakeComfyProcess(port: number): Promise<FakeComfyProcess | null> {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/e2e/stub-process', timeout: 1_000 },
      (res) => {
        let body = ''
        res.setEncoding('utf-8')
        res.on('data', (chunk: string) => (body += chunk))
        res.on('end', () => {
          try {
            resolve(res.statusCode === 200 ? (JSON.parse(body) as FakeComfyProcess) : null)
          } catch {
            resolve(null)
          }
        })
      }
    )
    req.on('error', () => resolve(null))
    req.on('timeout', () => {
      req.destroy()
      resolve(null)
    })
  })
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export function opsFlagsGrantSeed(opts: {
  arg: string
  minCoreVersion?: string
  commitRanges?: [string, string | null][]
  description?: string
  notice?: 'silent'
}): Record<string, unknown> {
  return {
    desktop_core_beta_features: {
      value: 'treatment',
      payload: {
        flags: [
          {
            arg: opts.arg,
            ...(opts.commitRanges === undefined
              ? { min_core_version: opts.minCoreVersion }
              : { commit_ranges: opts.commitRanges }),
            ...(opts.description === undefined ? {} : { description: opts.description }),
            ...(opts.notice === undefined ? {} : { notice: opts.notice })
          }
        ]
      }
    }
  }
}
