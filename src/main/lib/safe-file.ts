/**
 * Safe file I/O helpers.
 *
 * writeFileSafe / writeFileSafeAsync: write to .tmp, optionally back up to .bak,
 * then rename .tmp over the target — a crash can never leave the file truncated.
 *
 * readFileSafe / readFileSafeAsync: read the primary file, falling back to .bak
 * (and restoring it) if the primary is missing or corrupt. Reads are tri-state
 * (data / absent / unreadable) so callers can tell "no file" apart from "file
 * exists but is locked" and fail closed before overwriting it.
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

/** Best-effort fsync of a directory so a completed rename itself survives
 *  power loss. Windows cannot fsync a directory handle (the open or fsync
 *  fails with EPERM/EISDIR), so this silently degrades there - NTFS journals
 *  metadata, which covers the rename. */
function fsyncDirBestEffort(dirPath: string): void {
  try {
    const fd = fs.openSync(dirPath, 'r')
    try {
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
  } catch {}
}

/** Async twin of `fsyncDirBestEffort`, so the async write path never blocks
 *  the event loop on a slow (busy or network-backed) volume. */
async function fsyncDirBestEffortAsync(dirPath: string): Promise<void> {
  try {
    const handle = await fs.promises.open(dirPath, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  } catch {}
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
 *  - `data`: file read fine and was non-empty. `primaryUnreadable` is set when
 *    the content came from `.bak` because the primary EXISTS but could not be
 *    read - the primary is typically newer, so read-modify-write callers must
 *    fail closed instead of saving the stale backup state over it.
 *  - `absent`: file does not exist or is empty - the "genuinely gone" cases.
 *  - `unreadable`: file EXISTS but could not be read (lock outlasted the retry
 *    budget, or a non-transient error). Callers must NOT treat this as absent:
 *    the file's real content is unknown. */
export type SafeReadOutcome =
  | { kind: 'data'; data: string; primaryUnreadable?: true }
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

export interface SafeWriteOptions {
  /** Copy the current file to `filePath.bak` before replacing it. */
  backup?: boolean
  /** fsync the temp file before the rename (plus a best-effort fsync of the
   *  parent directory after it) so the finished write survives power loss.
   *  Reserved for small files whose loss reopens a failure loop (the startup
   *  attempt marker, issue #1367); ordinary settings-style writes skip the
   *  cost. */
  durable?: boolean
}

/** Write the temp file, with `durable` fsyncing it so the bytes are on stable
 *  storage before the rename publishes them. */
function writeTmpSync(tmpPath: string, data: string, durable: boolean): void {
  if (!durable) {
    fs.writeFileSync(tmpPath, data, 'utf-8')
    return
  }
  const fd = fs.openSync(tmpPath, 'w')
  try {
    fs.writeFileSync(fd, data, 'utf-8')
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
}

/** Atomically write `data` to `filePath` (see `SafeWriteOptions` for the
 *  `.bak` backup and durability knobs). Transient rename locks are retried
 *  (see TRANSIENT_FS_CODES); a still-failing write throws with the tmp
 *  cleaned up. */
export function writeFileSafe(
  filePath: string,
  data: string,
  options: SafeWriteOptions = {}
): void {
  const tmpPath = filePath + '.tmp'
  const bakPath = filePath + '.bak'
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  writeTmpSync(tmpPath, data, options.durable === true)
  if (options.backup) {
    try {
      fs.copyFileSync(filePath, bakPath)
    } catch {}
  }
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmpPath, filePath)
      if (options.durable) fsyncDirBestEffort(path.dirname(filePath))
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
 *  unreadable. Returns `unreadable` when a file EXISTS but could not be read
 *  and no readable fallback stood in - the real content is unknown, so callers
 *  must fail closed instead of treating it as absent (a later save would
 *  overwrite the intact file with reconstructed defaults).
 *
 *  `.bak` is only restored OVER the primary when the primary is genuinely
 *  absent (ENOENT) or empty. A transiently locked primary (antivirus, indexer)
 *  still exists and is typically NEWER than `.bak`, so restoring would roll
 *  back the most recent writes (issue #1367: that rollback erases the
 *  startup-update loop-breaker marker). Locked reads are retried, then served
 *  from `.bak` WITHOUT restoring, tagged `primaryUnreadable` so callers about
 *  to write back must fail closed (see `SafeReadOutcome`). */
export function readFileSafe(filePath: string): SafeReadOutcome {
  const primary = readFileWithRetrySync(filePath)
  if (primary.kind === 'data') return primary

  const bakPath = filePath + '.bak'
  const { outcome, restoreBak } = resolveBakFallback(primary, readFileWithRetrySync(bakPath))
  if (restoreBak) {
    try {
      fs.copyFileSync(bakPath, filePath)
    } catch {}
  }
  return outcome
}

/** Fallback policy shared by readFileSafe / readFileSafeAsync once the primary
 *  read has missed: which content to serve, whether `.bak` may be restored
 *  over the primary (only when the primary is genuinely absent), and tagging
 *  `.bak` data served for an unreadable primary (see `SafeReadOutcome`). */
function resolveBakFallback(
  primary: { kind: 'absent' } | { kind: 'unreadable' },
  bak: SafeReadOutcome
): { outcome: SafeReadOutcome; restoreBak: boolean } {
  if (bak.kind === 'data') {
    _bakFallbacks++
    return {
      outcome: primary.kind === 'unreadable' ? { ...bak, primaryUnreadable: true } : bak,
      restoreBak: primary.kind === 'absent'
    }
  }
  return {
    outcome:
      primary.kind === 'unreadable' || bak.kind === 'unreadable'
        ? { kind: 'unreadable' }
        : { kind: 'absent' },
    restoreBak: false
  }
}

/** Async twin of `writeTmpSync`. */
async function writeTmpAsync(tmpPath: string, data: string, durable: boolean): Promise<void> {
  if (!durable) {
    await fs.promises.writeFile(tmpPath, data, 'utf-8')
    return
  }
  const handle = await fs.promises.open(tmpPath, 'w')
  try {
    await handle.writeFile(data, 'utf-8')
    await handle.sync()
  } finally {
    await handle.close()
  }
}

export async function writeFileSafeAsync(
  filePath: string,
  data: string,
  options: SafeWriteOptions = {}
): Promise<void> {
  const tmpPath = filePath + '.tmp'
  const bakPath = filePath + '.bak'
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  await writeTmpAsync(tmpPath, data, options.durable === true)
  if (options.backup) {
    try {
      await fs.promises.copyFile(filePath, bakPath)
    } catch {}
  }
  // On Windows, antivirus or indexer may briefly lock the file after a write,
  // causing EPERM on rename. Retry a few times with a short delay.
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.promises.rename(tmpPath, filePath)
      if (options.durable) await fsyncDirBestEffortAsync(path.dirname(filePath))
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

/** Async twin of `readFileSafe` - same `.bak` and tri-state semantics: retry
 *  transient locks, restore `.bak` over the primary only when the primary is
 *  genuinely absent, and report `unreadable` rather than absent when a file
 *  exists but cannot be read. */
export async function readFileSafeAsync(filePath: string): Promise<SafeReadOutcome> {
  const primary = await readFileWithRetryAsync(filePath)
  if (primary.kind === 'data') return primary

  const bakPath = filePath + '.bak'
  const { outcome, restoreBak } = resolveBakFallback(primary, await readFileWithRetryAsync(bakPath))
  if (restoreBak) {
    try {
      await fs.promises.copyFile(bakPath, filePath)
    } catch {}
  }
  return outcome
}
