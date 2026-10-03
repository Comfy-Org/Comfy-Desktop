import fs from 'fs'
import os from 'os'
import path from 'path'

/** Runtime session keys the Performance Test view launches under, one per installation. */
export const PERFORMANCE_TEST_SESSION_PREFIX = 'performance-test:'

export type SessionKind = 'performance_test' | 'normal'
/** `temp_file`: a Performance Test's own throwaway database; `file`: the install's. */
export type DbMode = 'temp_file' | 'file'

/** Files SQLite and Core keep beside a database: journals, Core's `<db>.lock`, its pre-migration
 *  backup. */
const DB_SIDE_FILES = ['', '-wal', '-shm', '-journal', '.lock', '.bkp']

export function performanceTestSessionKey(installationId: string): string {
  return `${PERFORMANCE_TEST_SESSION_PREFIX}${installationId}`
}

export function sessionKindOf(sessionKey: string): SessionKind {
  return sessionKey.startsWith(PERFORMANCE_TEST_SESSION_PREFIX) ? 'performance_test' : 'normal'
}

/**
 * Whether the Core about to be launched has a database at all, and so a `--database-url` flag.
 * Both arrived together (Core v0.3.41); an older Core has neither and would reject the flag.
 */
export function coreHasDatabase(comfyuiDir: string): boolean {
  return fs.existsSync(path.join(comfyuiDir, 'app', 'database', 'db.py'))
}

/** The throwaway database a Performance Test of this install runs on. One per install: a
 *  second Performance Test of the same install is refused before it gets here. */
export function performanceTestDbPath(installationId: string): string {
  const name = installationId.replace(/[^A-Za-z0-9_-]/g, '_')
  return path.join(os.tmpdir(), 'comfy-desktop-perf-db', `${name}.db`)
}

/** Delete a Performance Test database and its side files. Best effort: a file still held open
 *  is left for the next Performance Test of the install to remove. */
export function removePerformanceTestDb(dbPath: string): void {
  for (const suffix of DB_SIDE_FILES) {
    try {
      fs.rmSync(dbPath + suffix, { force: true })
    } catch {
      // still open (Windows), retried before the next Performance Test of this install
    }
  }
}

/** `args` with every `--database-url` dropped and `url` appended. Dropped rather than
 *  overridden: Core's argparse takes the last value but Desktop's own readers take the first,
 *  and they must agree. */
export function withDatabaseUrl(args: readonly string[], url: string): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === '--database-url') {
      i++
      continue
    }
    if (a.startsWith('--database-url=')) continue
    out.push(a)
  }
  out.push('--database-url', url)
  return out
}
