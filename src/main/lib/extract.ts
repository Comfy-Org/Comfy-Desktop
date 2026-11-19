import type { ChildProcess } from 'child_process'
import { spawn, execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import { path7za } from '7zip-bin'

export interface ExtractProgress {
  percent: number
  elapsedSecs: number
  etaSecs: number
}

interface ExtractOptions {
  signal?: AbortSignal
}

function killTree(child: ChildProcess | null): void {
  if (!child || child.killed) return
  if (process.platform === 'win32') {
    execFile('taskkill', ['/T', '/F', '/PID', String(child.pid)], { windowsHide: true }, () => {})
  } else {
    child.kill()
  }
}

function get7zBin(): string {
  let binPath: string = path7za
  binPath = binPath.replace('app.asar', 'app.asar.unpacked')
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(binPath, 0o755)
    } catch {}
  }
  return binPath
}

export function extract(
  archivePath: string,
  destDir: string,
  onProgress?: ((p: ExtractProgress) => void) | null,
  options: ExtractOptions = {}
): Promise<void> {
  const { signal } = options
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(new Error('Extraction cancelled'))
      return
    }

    fs.mkdirSync(destDir, { recursive: true })

    const bin = get7zBin()
    const args = ['x', archivePath, `-o${destDir}`, '-y', '-bsp1']

    const child = spawn(bin, args)
    let stderr = ''
    let cancelled = false
    const startTime = Date.now()

    const onAbort = (): void => {
      cancelled = true
      killTree(child)
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
    const cleanup = (): void => {
      if (signal) signal.removeEventListener('abort', onAbort)
    }

    child.stdout.on('data', (data: Buffer) => {
      const lines = data.toString().split(/\r?\n/)
      for (const line of lines) {
        const match = line.match(/(\d+)%/)
        if (match && onProgress) {
          const percent = parseInt(match[1]!, 10)
          const elapsedSecs = (Date.now() - startTime) / 1000
          const etaSecs = percent > 0 ? (elapsedSecs / percent) * (100 - percent) : -1
          onProgress({ percent, elapsedSecs, etaSecs })
        }
      }
    })

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    child.on('error', (err: Error) => {
      cleanup()
      if (cancelled) {
        reject(new Error('Extraction cancelled'))
        return
      }
      reject(new Error(`Extraction failed: ${err.message}`))
    })

    child.on('close', (code: number | null) => {
      cleanup()
      if (cancelled) {
        reject(new Error('Extraction cancelled'))
        return
      }
      if (code !== 0) {
        const errorLines = stderr.split(/\r?\n/).filter((l) => l.startsWith('ERROR:'))
        const allUnsupported =
          errorLines.length > 0 && errorLines.every((l) => l.includes('Unsupported Method'))
        if (!allUnsupported) {
          reject(new Error(`Extraction failed: ${stderr || `exit code ${code}`}`))
          return
        }
      }
      if (onProgress) {
        const elapsedSecs = (Date.now() - startTime) / 1000
        onProgress({ percent: 100, elapsedSecs, etaSecs: 0 })
      }
      resolve()
    })
  })
}

function extractTarNative(
  archivePath: string,
  destDir: string,
  options: ExtractOptions = {}
): Promise<void> {
  const { signal } = options
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(new Error('Extraction cancelled'))
      return
    }

    const child = spawn('tar', ['xf', archivePath, '-C', destDir])
    let stderr = ''
    let cancelled = false

    const onAbort = (): void => {
      cancelled = true
      killTree(child)
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
    const cleanup = (): void => {
      if (signal) signal.removeEventListener('abort', onAbort)
    }

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })
    child.on('error', (err: Error) => {
      cleanup()
      if (cancelled) {
        reject(new Error('Extraction cancelled'))
        return
      }
      reject(new Error(`tar extraction failed: ${err.message}`))
    })
    child.on('close', (code: number | null) => {
      cleanup()
      if (cancelled) {
        reject(new Error('Extraction cancelled'))
        return
      }
      if (code !== 0) reject(new Error(`tar extraction failed: ${stderr || `exit code ${code}`}`))
      else resolve()
    })
  })
}

export async function extractNested(
  archivePath: string,
  destDir: string,
  onProgress?: ((p: ExtractProgress) => void) | null,
  options: ExtractOptions = {}
): Promise<void> {
  await extract(archivePath, destDir, onProgress, options)

  try {
    const entries = fs.readdirSync(destDir).filter((e) => !e.startsWith('.'))
    if (entries.length === 1 && entries[0]!.endsWith('.tar')) {
      const innerTar = path.join(destDir, entries[0]!)
      if (process.platform !== 'win32') {
        await extractTarNative(innerTar, destDir, options)
      } else {
        await extract(innerTar, destDir, undefined, options)
      }
      fs.unlinkSync(innerTar)
    }
  } catch {}
}
