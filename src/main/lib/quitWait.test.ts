import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  QUIT_WAIT_MS,
  _resetQuitWaitForTest,
  beginQuitSequence,
  endQuitSequence,
  holdQuit,
  isQuitHeld,
  trackExitWork,
  waitForExitWork,
  type QuitWaitFields
} from './quitWait'
import { _resetQuitStateForTest, setSessionEnding } from './quit-state'

const deferred = (): { promise: Promise<void>; resolve: () => void } => {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const never = (): Promise<void> => new Promise(() => {})

/** Resolves to whether `p` settled after advancing the fake clock by `ms`. */
async function settledAfter(p: Promise<unknown>, ms: number): Promise<boolean> {
  let settled = false
  void p.then(() => {
    settled = true
  })
  await vi.advanceTimersByTimeAsync(ms)
  return settled
}

function quitHarness(): {
  drain: ReturnType<typeof vi.fn<(fields: QuitWaitFields) => Promise<void>>>
  quit: ReturnType<typeof vi.fn>
  hold: () => { preventDefault: ReturnType<typeof vi.fn> }
} {
  const drain = vi.fn<(fields: QuitWaitFields) => Promise<void>>(async () => {})
  const quit = vi.fn()
  const hold = (): { preventDefault: ReturnType<typeof vi.fn> } => {
    const event = { preventDefault: vi.fn() }
    holdQuit(event, { drain, quit })
    return event
  }
  return { drain, quit, hold }
}

beforeEach(() => {
  vi.useFakeTimers()
  _resetQuitWaitForTest()
  _resetQuitStateForTest()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('waitForExitWork', () => {
  it('returns at once, with no timer, when nothing is in flight', async () => {
    const waiting = waitForExitWork()
    expect(vi.getTimerCount()).toBe(0)
    expect(await settledAfter(waiting, 0)).toBe(true)
  })

  it('waits until the work in flight has settled', async () => {
    const exit = deferred()
    trackExitWork(exit.promise, 'stop')
    const waiting = waitForExitWork()
    expect(await settledAfter(waiting, 3_000)).toBe(false)
    exit.resolve()
    expect(await settledAfter(waiting, 0)).toBe(true)
  })

  it('treats rejected work as settled', async () => {
    trackExitWork(Promise.reject(new Error('probe failed')))
    expect(await settledAfter(waitForExitWork(), 0)).toBe(true)
  })

  it('also waits for work registered while it is waiting', async () => {
    const kill = deferred()
    const handler = deferred()
    trackExitWork(
      kill.promise.then(() => trackExitWork(handler.promise)),
      'stop'
    )
    const waiting = waitForExitWork()
    kill.resolve()
    expect(await settledAfter(waiting, 1_000)).toBe(false)
    handler.resolve()
    expect(await settledAfter(waiting, 0)).toBe(true)
  })

  it('gives up at the deadline on work that never settles', async () => {
    trackExitWork(never(), 'stop')
    const waiting = waitForExitWork()
    expect(await settledAfter(waiting, QUIT_WAIT_MS - 1)).toBe(false)
    expect(await settledAfter(waiting, 1)).toBe(true)
  })

  it('shares one deadline across the waits of a sequence', async () => {
    trackExitWork(never(), 'stop')
    beginQuitSequence()
    await vi.advanceTimersByTimeAsync(QUIT_WAIT_MS - 3_000)
    // A wait starting late in the sequence gets only what is left.
    const late = waitForExitWork()
    expect(await settledAfter(late, 2_999)).toBe(false)
    expect(await settledAfter(late, 1)).toBe(true)
    // And once it has run out, a later wait returns at once.
    expect(await settledAfter(waitForExitWork(), 0)).toBe(true)
  })

  it('gives a fresh deadline once the sequence is ended', async () => {
    trackExitWork(never(), 'stop')
    const first = waitForExitWork()
    await vi.advanceTimersByTimeAsync(QUIT_WAIT_MS)
    await first
    endQuitSequence()
    expect(await settledAfter(waitForExitWork(), QUIT_WAIT_MS - 1)).toBe(false)
  })

  it('lets concurrent callers share one wait', async () => {
    const exit = deferred()
    trackExitWork(exit.promise, 'stop')
    const a = waitForExitWork()
    const b = waitForExitWork()
    expect(a).toBe(b)
    exit.resolve()
    await a
  })
})

describe('holdQuit', () => {
  it('quits without delay when nothing is in flight', async () => {
    const { drain, quit, hold } = quitHarness()
    const event = hold()
    expect(event.preventDefault).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(0)
    expect(drain).toHaveBeenCalledWith({
      quit_wait_ms: 0,
      quit_wait_timed_out: false,
      quit_wait_stops: 0
    })
    expect(quit).toHaveBeenCalledTimes(1)
  })

  it('drains telemetry only after the stopped ComfyUI has exited, then quits once', async () => {
    const { drain, quit, hold } = quitHarness()
    const exit = deferred()
    trackExitWork(exit.promise, 'stop')
    trackExitWork(Promise.resolve(), 'work')
    hold()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(drain).not.toHaveBeenCalled()
    expect(quit).not.toHaveBeenCalled()
    exit.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(drain).toHaveBeenCalledTimes(1)
    expect(drain.mock.calls[0]![0]).toEqual({
      quit_wait_ms: 2_000,
      quit_wait_timed_out: false,
      // Bookkeeping work is not a stop.
      quit_wait_stops: 1
    })
    expect(quit).toHaveBeenCalledTimes(1)
  })

  it('holds every repeated quit while waiting and lets the re-issued one through', async () => {
    const { drain, quit, hold } = quitHarness()
    const exit = deferred()
    trackExitWork(exit.promise, 'stop')
    hold()
    expect(isQuitHeld()).toBe(true)
    // window-all-closed quits again mid-wait.
    expect(hold().preventDefault).toHaveBeenCalled()
    exit.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(isQuitHeld()).toBe(false)
    expect(drain).toHaveBeenCalledTimes(1)
    expect(quit).toHaveBeenCalledTimes(1)
    // The quit it re-issued passes through.
    expect(hold().preventDefault).not.toHaveBeenCalled()
    expect(quit).toHaveBeenCalledTimes(1)
  })

  it('reports a timed-out wait and still quits', async () => {
    const { drain, quit, hold } = quitHarness()
    trackExitWork(never(), 'stop')
    hold()
    await vi.advanceTimersByTimeAsync(QUIT_WAIT_MS)
    expect(drain).toHaveBeenCalledWith({
      quit_wait_ms: QUIT_WAIT_MS,
      quit_wait_timed_out: true,
      quit_wait_stops: 1
    })
    expect(quit).toHaveBeenCalledTimes(1)
  })

  it('reports the update wait that came before it', async () => {
    const exit = deferred()
    trackExitWork(exit.promise, 'stop')
    const updateWait = waitForExitWork()
    await vi.advanceTimersByTimeAsync(4_000)
    exit.resolve()
    await updateWait
    const { drain, hold } = quitHarness()
    hold()
    await vi.advanceTimersByTimeAsync(0)
    expect(drain).toHaveBeenCalledWith({
      quit_wait_ms: 4_000,
      quit_wait_timed_out: false,
      quit_wait_stops: 1
    })
  })

  it('does not wait while the OS is ending the session', async () => {
    const { drain, quit, hold } = quitHarness()
    trackExitWork(never(), 'stop')
    setSessionEnding()
    hold()
    await vi.advanceTimersByTimeAsync(0)
    expect(drain).toHaveBeenCalledWith({ quit_wait_skipped: 'session_ending' })
    expect(quit).toHaveBeenCalledTimes(1)
  })

  it('quits even when the drain fails', async () => {
    const { drain, quit, hold } = quitHarness()
    drain.mockRejectedValueOnce(new Error('network'))
    hold()
    await vi.advanceTimersByTimeAsync(0)
    expect(quit).toHaveBeenCalledTimes(1)
  })
})
