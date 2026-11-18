import { describe, it, expect, vi, afterEach } from 'vitest'
import type { QueueAnswer } from './comfyProcessRecord'
import {
  createIdleUpdateWatcher,
  IDLE_UPDATE_QUIET_MS,
  type IdleSession,
  type IdleUpdateDeps,
  type IdleUpdateWatcher
} from './idleUpdate'

const MINUTE = 60 * 1000

interface Harness {
  watcher: IdleUpdateWatcher
  deps: IdleUpdateDeps
  clock: { now: number }
  sessions: IdleSession[]
  queue: Map<number, QueueAnswer>
  channels: Map<string, string | null>
  app: { waiting: boolean }
}

const watchers: IdleUpdateWatcher[] = []
afterEach(() => {
  for (const w of watchers.splice(0)) w.stop()
})

function harness(): Harness {
  const clock = { now: 0 }
  const sessions: IdleSession[] = []
  const queue = new Map<number, QueueAnswer>()
  const channels = new Map<string, string | null>()
  const app = { waiting: false }
  const deps: IdleUpdateDeps = {
    now: () => clock.now,
    runningSessions: () => sessions,
    probeQueue: async (port) => (queue.has(port) ? queue.get(port)! : { running: 0, pending: 0 }),
    instanceUpdateChannel: async (id) => channels.get(id) ?? null,
    updateInstance: vi.fn(),
    appUpdateWaiting: () => app.waiting,
    installAppUpdate: vi.fn()
  }
  const watcher = createIdleUpdateWatcher(deps, { tickMs: 1_000_000 })
  watchers.push(watcher)
  return { watcher, deps, clock, sessions, queue, channels, app }
}

function withInstance(h: Harness, channel: string | null = 'latest'): void {
  h.sessions.push({ installationId: 'inst-1', port: 8000, startedAt: 0 })
  h.channels.set('inst-1', channel)
}

describe('idle update watcher', () => {
  it('updates an instance whose queue and window have been quiet for the full idle period', async () => {
    const h = harness()
    withInstance(h)
    h.clock.now = IDLE_UPDATE_QUIET_MS
    await h.watcher.tick()
    expect(
      h.deps.updateInstance,
      'expected the idle instance to update on its channel'
    ).toHaveBeenCalledWith('inst-1', 'latest')
  })

  it('waits while the instance has only been quiet for part of the idle period', async () => {
    const h = harness()
    withInstance(h)
    h.clock.now = IDLE_UPDATE_QUIET_MS - MINUTE
    await h.watcher.tick()
    expect(h.deps.updateInstance).not.toHaveBeenCalled()
  })

  it('restarts the idle clock whenever the queue has work in it', async () => {
    const h = harness()
    withInstance(h)
    h.clock.now = 20 * MINUTE
    h.queue.set(8000, { running: 1, pending: 0 })
    await h.watcher.tick()
    h.queue.set(8000, { running: 0, pending: 0 })
    h.clock.now = 20 * MINUTE + IDLE_UPDATE_QUIET_MS - MINUTE
    await h.watcher.tick()
    expect(
      h.deps.updateInstance,
      'a job 29 minutes ago is not 30 idle minutes'
    ).not.toHaveBeenCalled()
    h.clock.now = 20 * MINUTE + IDLE_UPDATE_QUIET_MS
    await h.watcher.tick()
    expect(h.deps.updateInstance).toHaveBeenCalledOnce()
  })

  it('restarts the idle clock on input in that instance', async () => {
    const h = harness()
    withInstance(h)
    h.clock.now = 25 * MINUTE
    h.watcher.noteInput('inst-1')
    h.clock.now = IDLE_UPDATE_QUIET_MS
    await h.watcher.tick()
    expect(
      h.deps.updateInstance,
      'input 5 minutes ago means the user is still there'
    ).not.toHaveBeenCalled()
  })

  it('treats a queue that does not answer as busy', async () => {
    const h = harness()
    withInstance(h)
    h.queue.set(8000, null)
    h.clock.now = IDLE_UPDATE_QUIET_MS
    await h.watcher.tick()
    expect(h.deps.updateInstance).not.toHaveBeenCalled()
  })

  it('leaves an instance alone when it has no update or has not opted in', async () => {
    const h = harness()
    withInstance(h, null)
    h.clock.now = IDLE_UPDATE_QUIET_MS
    await h.watcher.tick()
    expect(h.deps.updateInstance).not.toHaveBeenCalled()
  })

  it('does not update the same instance again on the next tick', async () => {
    const h = harness()
    withInstance(h)
    h.clock.now = IDLE_UPDATE_QUIET_MS
    await h.watcher.tick()
    h.clock.now += MINUTE
    await h.watcher.tick()
    expect(h.deps.updateInstance).toHaveBeenCalledOnce()
  })

  it('installs a waiting Desktop update once every instance and window has been quiet', async () => {
    const h = harness()
    withInstance(h, null)
    h.app.waiting = true
    h.clock.now = IDLE_UPDATE_QUIET_MS
    await h.watcher.tick()
    expect(h.deps.installAppUpdate).toHaveBeenCalledOnce()
    h.clock.now += MINUTE
    await h.watcher.tick()
    expect(
      h.deps.installAppUpdate,
      'expected one install request, not one per tick'
    ).toHaveBeenCalledOnce()
  })

  it('holds a Desktop update while any instance is busy', async () => {
    const h = harness()
    withInstance(h, null)
    h.app.waiting = true
    h.queue.set(8000, { running: 0, pending: 2 })
    h.clock.now = IDLE_UPDATE_QUIET_MS
    await h.watcher.tick()
    expect(h.deps.installAppUpdate).not.toHaveBeenCalled()
  })

  it('holds a Desktop update after input in any window, even with no instance running', async () => {
    const h = harness()
    h.app.waiting = true
    h.clock.now = 10 * MINUTE
    h.watcher.noteInput(null)
    h.clock.now = IDLE_UPDATE_QUIET_MS
    await h.watcher.tick()
    expect(h.deps.installAppUpdate).not.toHaveBeenCalled()
  })

  it('holds a Desktop update in the tick that starts an instance update', async () => {
    const h = harness()
    withInstance(h)
    h.app.waiting = true
    h.clock.now = IDLE_UPDATE_QUIET_MS
    await h.watcher.tick()
    expect(h.deps.updateInstance).toHaveBeenCalledOnce()
    expect(
      h.deps.installAppUpdate,
      'quitting now would kill the instance update'
    ).not.toHaveBeenCalled()
  })
})
