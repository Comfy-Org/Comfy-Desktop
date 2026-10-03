import fs from 'fs'
import path from 'path'

/** Runtime session keys the Performance Test view launches under, one per installation. */
export const PERFORMANCE_TEST_SESSION_PREFIX = 'performance-test:'

export type SessionKind = 'performance_test' | 'normal'
export type DbMode = 'memory' | 'file'

export const MEMORY_DATABASE_URL = 'sqlite:///:memory:'

export function performanceTestSessionKey(installationId: string): string {
  return `${PERFORMANCE_TEST_SESSION_PREFIX}${installationId}`
}

export function sessionKindOf(sessionKey: string): SessionKind {
  return sessionKey.startsWith(PERFORMANCE_TEST_SESSION_PREFIX) ? 'performance_test' : 'normal'
}

/**
 * Whether the Core about to be launched builds an in-memory database from
 * `sqlite:///:memory:`. Core v0.17.0 added that (`_is_memory_db`), in the same change as the
 * `<db>.lock` file lock. An older Core runs Alembic on a connection of its own, so the tables
 * vanish with it and every assets query fails; it gets its file database as before.
 * Read from the checkout rather than gated on a version, because source and nightly checkouts
 * carry no trustworthy release label.
 */
export function coreSupportsMemoryDb(comfyuiDir: string): boolean {
  try {
    const db = fs.readFileSync(path.join(comfyuiDir, 'app', 'database', 'db.py'), 'utf8')
    return db.includes('def _is_memory_db(')
  } catch {
    return false
  }
}

/** `args` with every `--database-url` dropped and the in-memory URL appended. Dropped rather
 *  than overridden: Core's argparse takes the last value but Desktop's own readers take the
 *  first, and they must agree. */
export function withMemoryDatabase(args: readonly string[]): string[] {
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
  out.push('--database-url', MEMORY_DATABASE_URL)
  return out
}

/** The database a launch's arguments select. Core's argparse keeps the last `--database-url`. */
export function databaseModeOf(args: readonly string[] | undefined): DbMode {
  const all = args ?? []
  let url: string | undefined
  for (let i = 0; i < all.length; i++) {
    const a = all[i]!
    if (a === '--database-url') url = all[i + 1]
    else if (a.startsWith('--database-url=')) url = a.slice('--database-url='.length)
  }
  return url === MEMORY_DATABASE_URL || url === 'sqlite://' ? 'memory' : 'file'
}
