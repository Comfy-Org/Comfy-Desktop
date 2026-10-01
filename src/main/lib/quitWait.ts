import { exitBookkeepingInFlight } from './comfyProcessRecord'
import {
  comfyStopsInFlight,
  exitReportsInFlight,
  KILL_WAIT_MS,
  stopSweepsInFlight
} from './process'

/**
 * Quitting waits, briefly, for the ComfyUI processes it is stopping.
 *
 * A quit stops every ComfyUI it runs, but the kill is asynchronous: without a wait, Desktop can
 * exit while the tree is still going down (Windows termination is asynchronous; a process
 * finishing GPU teardown holds the database lock for seconds), so a relaunch or an update meets a
 * ComfyUI that still holds the port and the lock. It also exits before the exit bookkeeping has
 * run, leaving a record the next launch has to reason about.
 *
 * One deadline is shared by every waiter of a quit (the telemetry drain, `will-quit`, an update),
 * so the whole quit waits at most `QUIT_WAIT_MS`, never longer: a stuck kill never blocks quit.
 */

/** The kill's own wait is `KILL_WAIT_MS`, and the margin lets the exit reports that follow it run.
 *  This is a cap on the quit, not a promise that every stop fits: a Windows stop can spend extra
 *  time in its process-table snapshot first, and one that outlasts the cap is given up on and
 *  reported (`quit_wait_timed_out`, and `stop_timed_out` on the exit, if it comes). */
export const QUIT_WAIT_MS = KILL_WAIT_MS + 1_000

export interface QuitWaitResult {
  /** Since the first waiter of this quit started. */
  waitedMs: number
  /** The deadline ran out with stops or their bookkeeping still in flight. */
  timedOut: boolean
  /** How many ComfyUI stops the quit waited on. */
  stopsInFlight: number
}

export interface QuitWaitDeps {
  stops: () => Promise<unknown>[]
  bookkeeping: () => Promise<unknown>[]
  now: () => number
}

const defaultDeps: QuitWaitDeps = {
  stops: comfyStopsInFlight,
  bookkeeping: () => [
    ...exitBookkeepingInFlight(),
    ...exitReportsInFlight(),
    // Waited for, but not counted as stops: the kills they make are.
    ...stopSweepsInFlight()
  ],
  now: () => performance.now()
}

interface QuitWaitState {
  startedAt: number
  deadline: number
  seen: Set<Promise<unknown>>
  timedOut: boolean
}
let state: QuitWaitState | null = null
/** Stops a timed-out wait gave up on: no later wait waits for them again (a quit already spent its
 *  budget on them), but anything started since gets a deadline of its own. */
const givenUp = new WeakSet<Promise<unknown>>()

/** The quit this wait belonged to did not happen (a failed update install): the next quit gets
 *  a deadline of its own. */
export function abandonQuitWait(): void {
  state = null
}

/** Whether anything a quit would wait for is in flight right now. */
export function comfyStopsPending(deps: QuitWaitDeps = defaultDeps): boolean {
  return pendingWork(deps).all.length > 0
}

/** What is in flight and not already given up on: the stops, and everything (with bookkeeping). */
function pendingWork(deps: QuitWaitDeps): { stops: Promise<unknown>[]; all: Promise<unknown>[] } {
  const stops = deps.stops().filter((p) => !givenUp.has(p))
  return { stops, all: [...stops, ...deps.bookkeeping().filter((p) => !givenUp.has(p))] }
}

/** Wait for the ComfyUI stops (and the exit bookkeeping they trigger) in flight, until none is
 *  left or the quit's shared deadline passes. */
export async function waitForComfyStops(deps: QuitWaitDeps = defaultDeps): Promise<QuitWaitResult> {
  // Quit listeners run in one synchronous pass, and the one that starts the stops (cancelAll in
  // before-quit) may come after this one: look once they have all run.
  await Promise.resolve()
  // The deadline starts when there is first something to wait for, not when a waiter first
  // looks: a quit's other before-quit work (a dialog, a telemetry drain) must not spend it.
  if (!state && !comfyStopsPending(deps)) return { waitedMs: 0, timedOut: false, stopsInFlight: 0 }
  if (!state) {
    const now = deps.now()
    state = { startedAt: now, deadline: now + QUIT_WAIT_MS, seen: new Set(), timedOut: false }
  }
  const s = state
  for (;;) {
    const { stops, all: work } = pendingWork(deps)
    for (const stop of stops) s.seen.add(stop)
    if (work.length === 0) {
      // All done: a later quit (this one may yet be cancelled) gets a deadline of its own.
      if (state === s) state = null
      break
    }
    const left = s.deadline - deps.now()
    if (left <= 0) {
      s.timedOut = true
      for (const p of work) givenUp.add(p)
      if (state === s) state = null
      break
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const expired = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, left)
      timer.unref()
    })
    // Settling does not end the wait: a settled stop can queue bookkeeping, so look again.
    await Promise.race([Promise.allSettled(work), expired]).finally(() => clearTimeout(timer))
  }
  return {
    waitedMs: Math.round(deps.now() - s.startedAt),
    timedOut: s.timedOut,
    stopsInFlight: s.seen.size
  }
}

/** The part of Electron's `app` the quit gate needs. */
export interface QuitGateApp {
  on(event: 'will-quit', listener: (event: { preventDefault: () => void }) => void): unknown
  quit(): void
}

/**
 * `will-quit` (after every window has closed) is where the quit is held for async teardown:
 * `preventDefault`, then `app.quit()` again once done. Two things are waited for in one hold:
 * managed model downloads parking their staged bytes, and ComfyUI stops. Once only: the second
 * `will-quit` goes through.
 */
export function installQuitGate(
  app: QuitGateApp,
  downloads: { active: () => boolean; suspend: () => Promise<unknown> },
  stops: { pending: () => boolean; wait: () => Promise<unknown> } = {
    pending: () => comfyStopsPending(),
    wait: () => waitForComfyStops()
  }
): void {
  let held = false
  app.on('will-quit', (event) => {
    if (held) return
    const suspending = downloads.active()
    const stopping = stops.pending()
    if (!suspending && !stopping) return
    held = true
    event.preventDefault()
    void Promise.allSettled([
      suspending ? downloads.suspend() : null,
      stopping ? stops.wait() : null
    ]).finally(() => app.quit())
  })
}
