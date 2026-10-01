import { isSessionEnding } from './quit-state'

/**
 * The bounded wait a quit (and an update install) makes for the ComfyUI processes Desktop is
 * stopping. A stop is asynchronous: without the wait, Desktop could exit, or the update's
 * installer start, while the old tree was still going down and holding ComfyUI's port and
 * database lock, and the stop's exit bookkeeping (record cleared, `comfyui.exited`) never ran.
 *
 * Nothing here kills anything. Stops, exit handlers and aborted launches register the work
 * they already do (`trackExitWork`), and the quit awaits that work against ONE deadline per
 * quit sequence: an update spends it before its installer, and the quit that follows reuses
 * what is left.
 */

/** A Windows stop polls the tree for up to 10 s after its snapshot (`KILL_WAIT_MS`), POSIX for
 *  5 s; the extra second lets the exit bookkeeping run after a tree that used its full poll. */
export const QUIT_WAIT_MS = process.platform === 'win32' ? 11_000 : 6_000

type WorkKind = 'stop' | 'work'

/** Exit work in flight. Entries never reject and delete themselves when they settle. */
const pending = new Map<Promise<void>, WorkKind>()

interface QuitSequence {
  deadline: number
  waitedMs: number
  timedOut: boolean
  /** Live ComfyUI processes this sequence's waits saw being stopped. */
  stops: number
  /** The wait in progress, shared by every caller (an update and a quit held behind it). */
  waiting: Promise<void> | null
  /** `held`: before-quit is held for the wait and the telemetry drain. `released`: done; the
   *  re-issued quit (and any later one) passes through. */
  phase: 'open' | 'held' | 'released'
}

/** The current quit or update-install sequence; null until one begins, and again if an update
 *  is abandoned. */
let active: QuitSequence | null = null

const now = (): number => performance.now()

/**
 * Register exit work so a quit waits for it. `'stop'` marks the kill of a live ComfyUI
 * process (counted in telemetry); `'work'` is bookkeeping that follows a stop.
 */
export function trackExitWork(work: Promise<unknown>, kind: WorkKind = 'work'): void {
  const entry = work.then(
    () => undefined,
    () => undefined
  )
  pending.set(entry, kind)
  void entry.then(() => pending.delete(entry))
}

/** Start the sequence (and its deadline) if none is running. */
export function beginQuitSequence(): void {
  active ??= {
    deadline: now() + QUIT_WAIT_MS,
    waitedMs: 0,
    timedOut: false,
    stops: 0,
    waiting: null,
    phase: 'open'
  }
}

/** Abandon the sequence (an update that did not install): the next quit starts afresh. */
export function endQuitSequence(): void {
  active = null
}

async function runWait(seq: QuitSequence): Promise<void> {
  const startedAt = now()
  const stops = new Set<Promise<void>>()
  // Re-read after each round: a stop's exit handler, or an aborted launch's kill, registers
  // while the wait is already running.
  while (pending.size > 0) {
    const remaining = seq.deadline - now()
    if (remaining <= 0) {
      seq.timedOut = true
      break
    }
    for (const [entry, kind] of pending) if (kind === 'stop') stops.add(entry)
    let timer: ReturnType<typeof setTimeout> | undefined
    // Raced, never cancelled: a hung probe or a stuck tree is given up on, not waited out.
    const expired = await Promise.race([
      Promise.all(pending.keys()).then(() => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(true), remaining)
      })
    ])
    clearTimeout(timer)
    if (expired) {
      seq.timedOut = true
      break
    }
  }
  seq.stops += stops.size
  seq.waitedMs += now() - startedAt
}

/** Wait, within the sequence's deadline, for the exit work in flight. Starts the sequence if
 *  none is running. Concurrent callers share one wait. */
export function waitForExitWork(): Promise<void> {
  beginQuitSequence()
  const seq = active!
  seq.waiting ??= runWait(seq).finally(() => {
    seq.waiting = null
  })
  return seq.waiting
}

/** True while a quit is held for its wait: every further before-quit must be held too, or the
 *  process exits before the wait and the drain finish. */
export function isQuitHeld(): boolean {
  return active?.phase === 'held'
}

export type QuitWaitFields =
  | { quit_wait_ms: number; quit_wait_timed_out: boolean; quit_wait_stops: number }
  | { quit_wait_skipped: 'session_ending' }

export interface QuitHoldDeps {
  /** Drain telemetry (bounded by its owner) with the wait's fields on `session.ended`. */
  drain: (fields: QuitWaitFields) => Promise<void>
  quit: () => void
}

/**
 * Called from before-quit once the quit is committed: hold it, wait for the exit work, drain
 * telemetry, then quit again. The re-issued quit passes through. While the OS is ending the
 * session nothing is waited for: it kills apps that linger, and the drain matters more.
 */
export function holdQuit(event: { preventDefault: () => void }, deps: QuitHoldDeps): void {
  beginQuitSequence()
  const seq = active!
  if (seq.phase === 'released') return
  event.preventDefault()
  if (seq.phase === 'held') return
  seq.phase = 'held'
  const skip = isSessionEnding()
  void (skip ? Promise.resolve() : waitForExitWork())
    .then(() =>
      deps.drain(
        skip
          ? { quit_wait_skipped: 'session_ending' }
          : {
              quit_wait_ms: Math.round(seq.waitedMs),
              quit_wait_timed_out: seq.timedOut,
              quit_wait_stops: seq.stops
            }
      )
    )
    .catch(() => {})
    .finally(() => {
      seq.phase = 'released'
      deps.quit()
    })
}

/** Test-only: drop all state between tests. */
export function _resetQuitWaitForTest(): void {
  pending.clear()
  active = null
}
