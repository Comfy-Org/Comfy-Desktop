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
  /** See the transitions below. */
  phase: 'open' | 'held' | 'released'
}

/**
 * The one quit or update-install sequence. Every path goes through these transitions:
 *
 *   from      | transition                                     | to
 *   ----------|------------------------------------------------|-----------------------------
 *   none      | begin: an update install (its stop and wait),  | open (the deadline starts)
 *             | or a committed quit                            |
 *   open      | hold: a committed before-quit                  | held
 *   held      | a further before-quit                          | held (prevented too)
 *   held      | wait + drain done: release, quit again         | released
 *   released  | the re-issued before-quit (emitted inside      | passes; then end: none
 *             | `app.quit()`, so before release returns)       |
 *   open      | abandon: an install that did not go ahead      | none
 *   held      | abandon                                        | held (the quit owns it now)
 *
 * Ending after the release means a quit that was cancelled later (a window's close consult)
 * and is issued again gets a hold and a wait of its own. A wait that runs out evicts the work
 * it gave up on, so a later sequence does not wait for that work again.
 */
let active: QuitSequence | null = null

const now = (): number => performance.now()

/** How often a wait looks for an OS session end, which ends it early. */
const SESSION_END_POLL_MS = 250

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

/** begin: none → open. A no-op while a sequence is running. */
export function beginQuitSequence(): QuitSequence {
  active ??= {
    deadline: now() + QUIT_WAIT_MS,
    waitedMs: 0,
    timedOut: false,
    stops: 0,
    waiting: null,
    phase: 'open'
  }
  return active
}

/** abandon: open → none, for an install that did not go ahead (the next quit starts afresh).
 *  A held quit took the sequence over and keeps it. */
export function abandonQuitSequence(): void {
  if (active?.phase === 'open') active = null
}

async function runWait(seq: QuitSequence): Promise<void> {
  const startedAt = now()
  const stops = new Set<Promise<void>>()
  let raced: Promise<void>[] = []
  // Re-read after each round: a stop's exit handler, or an aborted launch's kill, registers
  // while the wait is already running.
  while (pending.size > 0 && !isSessionEnding()) {
    const remaining = seq.deadline - now()
    if (remaining <= 0) {
      // What this wait gave up on is evicted, so no later sequence waits for (or counts) it
      // again. Work registered since its last round stays.
      for (const entry of raced) pending.delete(entry)
      seq.timedOut = true
      break
    }
    raced = [...pending.keys()]
    for (const [entry, kind] of pending) if (kind === 'stop') stops.add(entry)
    let timer: ReturnType<typeof setTimeout> | undefined
    // Raced, never cancelled: a hung probe or a stuck tree is given up on, not waited out.
    await Promise.race([
      Promise.all(raced),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, Math.min(remaining, SESSION_END_POLL_MS))
      })
    ])
    clearTimeout(timer)
  }
  seq.stops += stops.size
  seq.waitedMs += now() - startedAt
}

/** Wait, within the sequence's deadline, for the exit work in flight. Begins the sequence if
 *  none is running. Concurrent callers share one wait. */
export function waitForExitWork(): Promise<void> {
  const seq = beginQuitSequence()
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
  /** `app.quit()`: emits the re-issued before-quit before it returns. */
  quit: () => void
}

/**
 * hold, from before-quit once the quit is committed: wait for the exit work, drain telemetry,
 * then release (quit again) and end. While the OS is ending the session nothing is waited for:
 * it kills apps that linger, and the drain matters more.
 */
export function holdQuit(event: { preventDefault: () => void }, deps: QuitHoldDeps): void {
  const seq = beginQuitSequence()
  if (seq.phase === 'released') return
  event.preventDefault()
  if (seq.phase === 'held') return
  seq.phase = 'held'
  // A session end, before or during the wait, ends it at once (see `runWait`).
  void waitForExitWork()
    .then(() =>
      deps.drain(
        // The session end skipped the wait or cut it short.
        isSessionEnding()
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
      try {
        deps.quit()
      } finally {
        if (active === seq) active = null
      }
    })
}

/** Test-only: drop all state between tests. */
export function _resetQuitWaitForTest(): void {
  pending.clear()
  active = null
}
