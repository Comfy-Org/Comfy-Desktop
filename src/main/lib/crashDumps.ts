import fs from 'fs'
import path from 'path'
import { app } from 'electron'

const MAX_CRASH_DUMPS = 3

export function getCrashDumpsDir(): string {
  return app.getPath('crashDumps')
}

function collectDumps(dir: string): { file: string; mtimeMs: number }[] {
  const out: { file: string; mtimeMs: number }[] = []
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...collectDumps(full))
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.dmp')) {
      try {
        out.push({ file: full, mtimeMs: fs.statSync(full).mtimeMs })
      } catch {}
    }
  }
  return out
}

export function pruneCrashDumps(opts?: { dir?: string; maxFiles?: number }): number {
  const dir = opts?.dir ?? getCrashDumpsDir()
  const maxFiles = opts?.maxFiles ?? MAX_CRASH_DUMPS
  if (maxFiles < 0) return 0

  const dumps = collectDumps(dir)
  if (dumps.length <= maxFiles) return 0

  dumps.sort((a, b) => b.mtimeMs - a.mtimeMs)
  let deleted = 0
  for (const { file } of dumps.slice(maxFiles)) {
    try {
      fs.unlinkSync(file)
      deleted++
    } catch {}
  }
  return deleted
}
