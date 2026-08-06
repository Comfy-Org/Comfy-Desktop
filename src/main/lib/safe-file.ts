/**
 * Safe file I/O helpers.
 *
 * writeFileSafe / writeFileSafeAsync: write to .tmp, optionally back up to .bak,
 * then rename .tmp over the target — a crash can never leave the file truncated.
 *
 * readFileSafe / readFileSafeAsync: read the primary file, falling back to .bak
 * (and restoring it) if the primary is missing or corrupt.
 */

import fs from 'fs'
import path from 'path'

/** Windows hazard: antivirus / search indexers briefly lock files, making both
 *  rename-over-target and plain reads fail transiently with EPERM/EACCES/EBUSY
 *  even though the file is fine. Both the sync and async paths retry these. */
const TRANSIENT_FS_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
const RENAME_RETRIES = 3
const RENAME_DELAY_MS = 100
const READ_RETRIES = 3
const READ_DELAY_MS = 50

function isTransientFsError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException)?.code
  return code !== undefined && TRANSIENT_FS_CODES.has(code)
}

/** Blocking sleep for the sync paths (no event loop to yield to). */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** Times a read fell back to `.bak` content (primary missing, empty, or locked
 *  past the retry budget - the counter does not distinguish which). Exposed so
 *  telemetry can flag machines whose settings reads are being served from the
 *  backup - the environment behind the Desktop update reinstall loop
 *  (issue #1367). */
let _bakFallbacks = 0

export function getSafeFileDiagnostics(): { bakFallbacks: number } {
  return { bakFallbacks: _bakFallbacks }
}

/** Outcome of a single-file read with transient-lock retries.
 *  - `data`: file read fine and was non-empty.
 *  - `absent`: file does not exist or is empty - the "genuinely gone" cases.
 *  - `unreadable`: file EXISTS but could not be read (lock outlasted the retry
 *    budget, or a non-transient error). Callers must NOT treat this as absent:
 *    the file's real content is unknown. */
export type SafeReadOutcome =
  | { kind: 'data'; data: string }
  | { kind: 'absent' }
  | { kind: 'unreadable' }

/** Read one file, retrying transient Windows locks (see TRANSIENT_FS_CODES).
 *  Distinguishes a missing/empty file from an unreadable one - see
 *  `SafeReadOutcome`. */
export function readFileWithRetrySync(filePath: string): SafeReadOutcome {
  for (let attempt = 0; ; attempt++) {
    try {
      const data = fs.readFileSync(filePath, 'utf-8')
      return data.length > 0 ? { kind: 'data', data } : { kind: 'absent' }
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return { kind: 'absent' }
      if (isTransientFsError(err) && attempt < READ_RETRIES) {
        sleepSync(READ_DELAY_MS * (attempt + 1))
        continue
      }
      return { kind: 'unreadable' }
    }
  }
}

async function readFileWithRetryAsync(filePath: string): Promise<SafeReadOutcome> {
  for (let attempt = 0; ; attempt++) {
    try {
      const data = await fs.promises.readFile(filePath, 'utf-8')
      return data.length > 0 ? { kind: 'data', data } : { kind: 'absent' }
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return { kind: 'absent' }
      if (isTransientFsError(err) && attempt < READ_RETRIES) {
        await new Promise((r) => setTimeout(r, READ_DELAY_MS * (attempt + 1)))
        continue
      }
      return { kind: 'unreadable' }
    }
  }
}

/** Atomically write `data` to `filePath`. With `backup`, copy the current file to
 *  `filePath.bak` before replacing. Transient rename locks are retried (see
 *  TRANSIENT_FS_CODES); a still-failing write throws with the tmp cleaned up. */
export function writeFileSafe(filePath: string, data: string, backup: boolean = false): void {
  const tmpPath = filePath + '.tmp'
  const bakPath = filePath + '.bak'
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(tmpPath, data, 'utf-8')
  if (backup) {
    try {
      fs.copyFileSync(filePath, bakPath)
    } catch {}
  }
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmpPath, filePath)
      return
    } catch (err) {
      if (isTransientFsError(err) && attempt < RENAME_RETRIES) {
        sleepSync(RENAME_DELAY_MS * (attempt + 1))
        continue
      }
      try {
        fs.unlinkSync(tmpPath)
      } catch {}
      throw err
    }
  }
}

/** Read `filePath`, falling back to `filePath.bak` if the primary is missing or
 *  unreadable.
 *
 *  `.bak` is only restored OVER the primary when the primary is genuinely
 *  absent (ENOENT) or empty - the corruption cases the backup exists for. A
 *  transient lock (antivirus, indexer) means the primary still exists and is
 *  typically NEWER than `.bak`; restoring in that case silently rolls back the
 *  most recent writes. That rollback is what kept erasing the startup-update
 *  loop-breaker marker (its write is the last one before the app quits into
 *  the installer, so `.bak` is always one write behind it) and locked machines
 *  into reinstalling the same Desktop update on every boot (issue #1367).
 *  Locked reads are retried, then served from `.bak` WITHOUT restoring. */
export function readFileSafe(filePath: string): string | null {
  const primary = readFileWithRetrySync(filePath)
  if (primary.kind === 'data') return primary.data

  const bak = readFileWithRetrySync(filePath + '.bak')
  if (bak.kind === 'data') {
    _bakFallbacks++
    if (primary.kind === 'absent') {
      try {
        fs.copyFileSync(filePath + '.bak', filePath)
      } catch {}
    }
    return bak.data
  }

  return null
}

export async function writeFileSafeAsync(
  filePath: string,
  data: string,
  backup: boolean = false
): Promise<void> {
  const tmpPath = filePath + '.tmp'
  const bakPath = filePath + '.bak'
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  await fs.promises.writeFile(tmpPath, data, 'utf-8')
  if (backup) {
    try {
      await fs.promises.copyFile(filePath, bakPath)
    } catch {}
  }
  // On Windows, antivirus or indexer may briefly lock the file after a write,
  // causing EPERM on rename. Retry a few times with a short delay.
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.promises.rename(tmpPath, filePath)
      return
    } catch (err) {
      if (isTransientFsError(err) && attempt < RENAME_RETRIES) {
        await new Promise((r) => setTimeout(r, RENAME_DELAY_MS * (attempt + 1)))
        continue
      }
      try {
        await fs.promises.unlink(tmpPath)
      } catch {}
      throw err
    }
  }
}

/** Async twin of `readFileSafe` - same `.bak` semantics: retry transient locks,
 *  restore `.bak` over the primary only when the primary is genuinely absent. */
export async function readFileSafeAsync(filePath: string): Promise<string | null> {
  const primary = await readFileWithRetryAsync(filePath)
  if (primary.kind === 'data') return primary.data

  const bak = await readFileWithRetryAsync(filePath + '.bak')
  if (bak.kind === 'data') {
    _bakFallbacks++
    if (primary.kind === 'absent') {
      try {
        await fs.promises.copyFile(filePath + '.bak', filePath)
      } catch {}
    }
    return bak.data
  }

  return null
}
