/**
 * Retention sweep for Crashpad minidumps in `app.getPath('crashDumps')`.
 *
 * `crashReporter.start({ uploadToServer: false })` keeps dumps purely local,
 * where Crashpad's own pruning is coarse and built around the upload
 * lifecycle — a crash-looping user can accumulate many multi-MB `.dmp` files.
 * This keeps only the newest `maxFiles` dumps (by mtime; Crashpad names files
 * with UUIDs, not timestamps) and deletes the rest. Best-effort: any error is
 * swallowed so a failed sweep never blocks startup.
 */

import fs from 'fs'
import path from 'path'
import { app } from 'electron'

// Keep just the few most recent dumps: the latest crash is what matters for
// diagnosis, a couple of priors help spot a pattern, and at ~1-5 MB each we
// don't want the folder to balloon for a crash-looping user.
const MAX_CRASH_DUMPS = 3

export function getCrashDumpsDir(): string {
  return app.getPath('crashDumps')
}

/** Recursively collect `*.dmp` files under `dir` with their mtimes. */
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
      } catch {
        // File vanished between readdir and stat; skip it.
      }
    }
  }
  return out
}

/**
 * Delete all but the newest `maxFiles` crash dumps. `dir` and `maxFiles` are
 * injectable for tests; defaults are the Electron crashDumps path and
 * `MAX_CRASH_DUMPS`.
 */
export function pruneCrashDumps(opts?: { dir?: string; maxFiles?: number }): number {
  const dir = opts?.dir ?? getCrashDumpsDir()
  const maxFiles = opts?.maxFiles ?? MAX_CRASH_DUMPS
  if (maxFiles < 0) return 0

  const dumps = collectDumps(dir)
  if (dumps.length <= maxFiles) return 0

  // Newest first, then drop everything past the retention cap.
  dumps.sort((a, b) => b.mtimeMs - a.mtimeMs)
  let deleted = 0
  for (const { file } of dumps.slice(maxFiles)) {
    try {
      fs.unlinkSync(file)
      deleted++
    } catch {
      // Locked / already gone; leave it for the next sweep.
    }
  }
  return deleted
}
