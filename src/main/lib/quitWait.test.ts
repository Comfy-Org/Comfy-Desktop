import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./paths', () => ({ stateDir: () => '/nonexistent-state' }))

import {
  abandonQuitWait,
  installQuitGate,
  QUIT_WAIT_MS,
  waitForComfyStops,
  type QuitWaitDeps
} from './quitWait'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('waitForComfyStops', () => {
  let stops: Promise<unknown>[]
  let bookkeeping: Promise<unknown>[]
  const deps = (): QuitWaitDeps => ({
    stops: () => stops,
    bookkeeping: () => bookkeeping,
    now: () => performance.now()
  })

  beforeEach(() => {
    stops = []
    bookkeeping = []
    abandonQuitWait()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns at once when nothing is being stopped', async () => {
    expect(await waitForComfyStops(deps())).toMatchObject({ timedOut: false, stopsInFlight: 0 })
  })

  it('sees a stop started by a quit listener that runs after it in the same pass', async () => {
    const stop = deferred()
    const waiting = waitForComfyStops(deps())
    stops = [stop.promise] // cancelAll, in a later before-quit listener
    let done = false
    void waiting.then(() => (done = true))
    await new Promise((r) => setTimeout(r, 10))
    expect(done).toBe(false)
    stops = []
    stop.resolve()
    expect(await waiting).toMatchObject({ timedOut: false, stopsInFlight: 1 })
  })

  it('keeps waiting for the bookkeeping a finished stop queues', async () => {
    const stop = deferred()
    const scan = deferred()
    stops = [stop.promise]
    const order: string[] = []
    const waiting = waitForComfyStops(deps()).then(() => order.push('quit'))
    stop.resolve()
    stops = []
    bookkeeping = [scan.promise]
    await new Promise((r) => setTimeout(r, 10))
    order.push('scan')
    bookkeeping = []
    scan.resolve()
    await waiting
    expect(order).toEqual(['scan', 'quit'])
  })

  it('never blocks the quit: a stuck stop times out at the shared deadline', async () => {
    vi.useFakeTimers()
    let clock = 0
    stops = [new Promise(() => {})]
    const d: QuitWaitDeps = { ...deps(), now: () => clock }
    const first = waitForComfyStops(d)
    await vi.advanceTimersByTimeAsync(0)
    clock = QUIT_WAIT_MS / 2
    // A later waiter of the same quit shares the deadline rather than starting its own.
    const second = waitForComfyStops(d)
    await vi.advanceTimersByTimeAsync(0)
    clock = QUIT_WAIT_MS
    await vi.advanceTimersByTimeAsync(QUIT_WAIT_MS)
    expect(await first).toMatchObject({ timedOut: true, waitedMs: QUIT_WAIT_MS })
    expect(await second).toMatchObject({ timedOut: true, waitedMs: QUIT_WAIT_MS })
  })

  it('bounds stuck bookkeeping (a hung survivor sweep) by the same deadline', async () => {
    vi.useFakeTimers()
    let clock = 0
    bookkeeping = [new Promise(() => {})]
    const d: QuitWaitDeps = { ...deps(), now: () => clock }
    const waiting = waitForComfyStops(d)
    await vi.advanceTimersByTimeAsync(0)
    clock = QUIT_WAIT_MS
    await vi.advanceTimersByTimeAsync(QUIT_WAIT_MS)
    expect(await waiting).toMatchObject({ timedOut: true, waitedMs: QUIT_WAIT_MS })
  })

  it("reports the update's completed wait to the quit that follows it", async () => {
    // The update waits before the installer; the installer's quit then finds nothing left.
    let clock = 0
    const d: QuitWaitDeps = { ...deps(), now: () => clock }
    const stop = deferred()
    stops = [stop.promise]
    const update = waitForComfyStops(d)
    await new Promise((r) => setTimeout(r, 0))
    clock = 2500
    stops = []
    stop.resolve()
    await update
    expect(await waitForComfyStops(d)).toMatchObject({ waitedMs: 2500, stopsInFlight: 1 })
  })

  it('does not start the deadline while there is nothing to wait for', async () => {
    // A quit that is cancelled (or still behind a dialog) must not spend the next one's budget.
    let clock = 0
    const d: QuitWaitDeps = { ...deps(), now: () => clock }
    expect(await waitForComfyStops(d)).toMatchObject({ waitedMs: 0, stopsInFlight: 0 })
    clock = QUIT_WAIT_MS * 5
    const stop = deferred()
    stops = [stop.promise]
    let done = false
    const waiting = waitForComfyStops(d).then((r) => {
      done = true
      return r
    })
    await new Promise((r) => setTimeout(r, 10))
    expect(done).toBe(false)
    stops = []
    stop.resolve()
    expect(await waiting).toMatchObject({ timedOut: false, stopsInFlight: 1 })
  })

  it('gives the next quit a deadline of its own once a wait has drained', async () => {
    let clock = 0
    const d: QuitWaitDeps = { ...deps(), now: () => clock }
    const first = deferred()
    stops = [first.promise]
    const waiting = waitForComfyStops(d)
    await new Promise((r) => setTimeout(r, 0))
    stops = []
    first.resolve()
    await waiting
    clock = QUIT_WAIT_MS * 3
    const second = deferred()
    stops = [second.promise]
    const again = waitForComfyStops(d)
    await new Promise((r) => setTimeout(r, 10))
    stops = []
    second.resolve()
    expect(await again).toMatchObject({ timedOut: false, waitedMs: 0, stopsInFlight: 1 })
  })

  it('after a timeout, waits afresh for new stops but not again for the stuck one', async () => {
    vi.useFakeTimers()
    let clock = 0
    const stuck = new Promise(() => {})
    stops = [stuck]
    const d: QuitWaitDeps = { ...deps(), now: () => clock }
    const first = waitForComfyStops(d)
    await vi.advanceTimersByTimeAsync(0)
    clock = QUIT_WAIT_MS
    await vi.advanceTimersByTimeAsync(QUIT_WAIT_MS)
    expect(await first).toMatchObject({ timedOut: true })
    // The stuck one alone: nothing to wait for; it reports the wait that already happened.
    expect(await waitForComfyStops(d)).toMatchObject({ timedOut: true, waitedMs: QUIT_WAIT_MS })
    // A new stop (the update's second round) gets a deadline of its own.
    const fresh = deferred()
    stops = [stuck, fresh.promise]
    let done = false
    const second = waitForComfyStops(d).then((r) => {
      done = true
      return r
    })
    await vi.advanceTimersByTimeAsync(10)
    expect(done).toBe(false)
    stops = [stuck]
    fresh.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(await second).toMatchObject({ timedOut: false, stopsInFlight: 1 })
  })

  it('gives a quit after an abandoned one a deadline of its own', async () => {
    let clock = 0
    const d: QuitWaitDeps = { ...deps(), now: () => clock }
    await waitForComfyStops(d)
    clock = QUIT_WAIT_MS * 3
    abandonQuitWait()
    const stop = deferred()
    stops = [stop.promise]
    const waiting = waitForComfyStops(d)
    await new Promise((r) => setTimeout(r, 10))
    stops = []
    stop.resolve()
    expect(await waiting).toMatchObject({ timedOut: false, waitedMs: 0 })
  })
})

describe('installQuitGate', () => {
  class FakeApp extends EventEmitter {
    quits = 0
    quit(): void {
      this.quits++
    }
    willQuit(): boolean {
      let prevented = false
      this.emit('will-quit', { preventDefault: () => (prevented = true) })
      return prevented
    }
  }

  function gate(opts: { downloads?: boolean; stops?: boolean }) {
    const app = new FakeApp()
    const suspend = deferred()
    const wait = deferred()
    const calls = { suspend: 0, wait: 0 }
    installQuitGate(
      app,
      {
        active: () => !!opts.downloads,
        suspend: () => {
          calls.suspend++
          return suspend.promise
        }
      },
      {
        pending: () => !!opts.stops,
        wait: () => {
          calls.wait++
          return wait.promise
        }
      }
    )
    return { app, suspend, wait, calls }
  }

  it('lets the quit through when there is nothing to wait for', () => {
    const { app } = gate({})
    expect(app.willQuit()).toBe(false)
  })

  it('holds the quit for ComfyUI stops, then quits again', async () => {
    const { app, wait, calls } = gate({ stops: true })
    expect(app.willQuit()).toBe(true)
    expect(calls).toEqual({ suspend: 0, wait: 1 })
    await new Promise((r) => setTimeout(r, 0))
    expect(app.quits).toBe(0)
    wait.resolve()
    await vi.waitFor(() => expect(app.quits).toBe(1))
    // The re-issued quit goes through.
    expect(app.willQuit()).toBe(false)
  })

  it('holds once for downloads and stops together, until both are done', async () => {
    const { app, suspend, wait, calls } = gate({ downloads: true, stops: true })
    expect(app.willQuit()).toBe(true)
    expect(calls).toEqual({ suspend: 1, wait: 1 })
    suspend.resolve()
    await new Promise((r) => setTimeout(r, 0))
    expect(app.quits).toBe(0)
    wait.resolve()
    await vi.waitFor(() => expect(app.quits).toBe(1))
  })

  it('still suspends downloads when no ComfyUI is being stopped', async () => {
    const { app, suspend, calls } = gate({ downloads: true })
    expect(app.willQuit()).toBe(true)
    expect(calls).toEqual({ suspend: 1, wait: 0 })
    suspend.resolve()
    await vi.waitFor(() => expect(app.quits).toBe(1))
  })
})

describe('a stop sweep (quit-time survivors)', () => {
  it('is waited for, but only the kills it makes count as stops', async () => {
    const { trackStopSweep } = await import('./process')
    abandonQuitWait()
    const sweep = deferred()
    void trackStopSweep(sweep.promise)
    let done = false
    const waiting = waitForComfyStops().then((r) => {
      done = true
      return r
    })
    await new Promise((r) => setTimeout(r, 10))
    expect(done).toBe(false)
    sweep.resolve()
    expect(await waiting).toMatchObject({ timedOut: false, stopsInFlight: 0 })
  })
})
