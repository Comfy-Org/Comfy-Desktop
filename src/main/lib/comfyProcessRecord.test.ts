import { execFileSync, spawn } from 'child_process'
import fs from 'fs'
import http from 'http'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AddressInfo } from 'net'

const dirs = vi.hoisted(() => ({ state: '' }))
vi.mock('./paths', () => ({ stateDir: () => dirs.state }))

import {
  classifyRecord,
  filetimeOf,
  findWindowsSurvivors,
  pendingScanIsCurrent,
  commandLineIsInstall,
  holderIsInstall,
  listRecords,
  markStopRequested,
  probeQueue,
  readRecord,
  removeRecordIf,
  resolvePriorProcess,
  stopLingeringAtQuit,
  takePriorSessionUnclean,
  trackSpawn,
  writeRecord,
  QUEUE_PROBE_BUDGET_MS,
  type ComfyProcessRecord,
  type PriorProcessDeps
} from './comfyProcessRecord'
import { isPidAlive, readStartTimes } from './processIdentity'

const SELF = { pid: process.pid, start: 'self-start' }

function record(overrides: Partial<ComfyProcessRecord> = {}): ComfyProcessRecord {
  return {
    v: 1,
    sessionKey: 'inst-1',
    installationId: 'inst-1',
    installPath: '/installs/one',
    port: 8188,
    bootId: 'boot-1',
    spawnedAt: 1_000,
    desktopPid: 111,
    desktopStartTime: 'desk-start',
    childPid: 222,
    childStartTime: 'child-start',
    ...overrides
  }
}

beforeEach(() => {
  dirs.state = fs.mkdtempSync(path.join(os.tmpdir(), 'comfy-procs-test-'))
})

afterEach(() => {
  fs.rmSync(dirs.state, { recursive: true, force: true })
})

/** A pid that was just used and is now certainly dead (and reaped). */
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
  await new Promise((r) => child.once('exit', r))
  return child.pid!
}

describe('classifyRecord (the proof rule)', () => {
  const probe = (times: Record<number, string> | null) => ({
    startTimes: times ? new Map(Object.entries(times).map(([k, v]) => [Number(k), v])) : null,
    selfPid: SELF.pid,
    selfStartTime: SELF.start
  })

  it.each([
    ['child gone', {}, record(), 'stale'],
    ['pid reused by another process', { 222: 'other' }, record(), 'stale'],
    ['OS query failed', null, record(), 'unproven'],
    ['no child start time recorded', { 222: 'x' }, record({ childStartTime: null }), 'unproven'],
    ['owner running', { 222: 'child-start', 111: 'desk-start' }, record(), 'owner_alive'],
    ['owner gone', { 222: 'child-start' }, record(), 'orphan'],
    ['owner pid reused', { 222: 'child-start', 111: 'someone-else' }, record(), 'orphan'],
    [
      'owner alive, start unknown',
      { 222: 'child-start', 111: 'x' },
      record({ desktopStartTime: null }),
      'owner_alive'
    ],
    [
      'owned by this Desktop',
      { 222: 'child-start' },
      record({ desktopPid: SELF.pid, desktopStartTime: SELF.start }),
      'owner_alive'
    ],
    [
      'a previous Desktop that had our pid',
      { 222: 'child-start' },
      record({ desktopPid: SELF.pid, desktopStartTime: 'older' }),
      'orphan'
    ]
  ] as const)('%s → %s', (_name, times, rec, verdict) => {
    expect(classifyRecord(rec, probe(times as Record<number, string> | null))).toBe(verdict)
  })
})

describe('resolvePriorProcess', () => {
  let clock = 10_000
  let removed: Array<[string, number]> = []
  let alive = new Set<number>()
  let kills: Array<[number, string]> = []

  const deps = (overrides: Partial<PriorProcessDeps> = {}): PriorProcessDeps => ({
    readRecord: () => record(),
    removeRecordIf: (key, pid) => {
      removed.push([key, pid])
    },
    readStartTimes: async (pids) =>
      new Map(
        pids
          .filter((p) => alive.has(p))
          .map((p) => [p, p === 222 ? 'child-start' : 'desk-start'] as [number, string])
      ),
    ownStartTime: async () => SELF.start,
    isPidAlive: (pid) => alive.has(pid),
    probeQueue: async () => ({ running: 0, pending: 0 }),
    // The copies these tests stand in for serve the recorded port.
    portInUse: async () => true,
    portListeners: async () => [...alive],
    processGroupOf: async () => null,
    killPidTree: async (pid, start) => {
      kills.push([pid, start])
      alive.delete(pid)
      return { killed: true, exited: true, waitMs: 30 }
    },
    now: () => clock,
    wallNow: () => clock,
    sleep: async (ms) => {
      clock += ms
    },
    ...overrides
  })

  beforeEach(() => {
    clock = 10_000
    removed = []
    kills = []
    alive = new Set([222])
  })

  it('does nothing without a record', async () => {
    expect(await resolvePriorProcess('inst-1', {}, deps({ readRecord: () => null }))).toBeNull()
  })

  it('drops the record of a child that is already gone, with no OS query', async () => {
    alive.clear()
    const readStartTimes = vi.fn()
    expect(await resolvePriorProcess('inst-1', {}, deps({ readStartTimes }))).toBeNull()
    expect(readStartTimes).not.toHaveBeenCalled()
    expect(removed).toEqual([['inst-1', 222]])
  })

  it('terminates a proven orphan, with the start time it was proven by', async () => {
    const out = await resolvePriorProcess('inst-1', {}, deps())
    expect(kills).toEqual([[222, 'child-start']])
    expect(out).toMatchObject({
      action: 'terminated',
      proof: 'desktop_record',
      exitedInTime: true,
      blocked: null,
      ageMs: 9_000
    })
    expect(removed).toEqual([['inst-1', 222]])
  })

  it('leaves a busy orphan running and blocks the launch', async () => {
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({ probeQueue: async () => ({ running: 1, pending: 0 }) })
    )
    expect(kills).toEqual([])
    expect(out).toMatchObject({ action: 'busy_left', blocked: 'busy', queue: { running: 1 } })
  })

  it('counts queued-but-not-started prompts as busy too', async () => {
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({ probeQueue: async () => ({ running: 0, pending: 3 }) })
    )
    expect(out?.action).toBe('busy_left')
  })

  it('stops a busy orphan once the user has chosen to, without asking the queue', async () => {
    const probeQueue = vi.fn()
    const out = await resolvePriorProcess('inst-1', { stopBusy: true }, deps({ probeQueue }))
    expect(probeQueue).not.toHaveBeenCalled()
    expect(out).toMatchObject({ action: 'terminated', busyOverride: true })
  })

  it('keeps asking a slow orphan until it answers, then acts on the answer', async () => {
    const timeouts: number[] = []
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({
        probeQueue: async (_port, timeoutMs) => {
          timeouts.push(timeoutMs!)
          clock += timeoutMs!
          return timeouts.length < 3 ? null : { running: 1, pending: 0 }
        }
      })
    )
    expect(timeouts).toEqual([1_000, 2_000, 4_000])
    expect(kills).toEqual([])
    expect(out).toMatchObject({ action: 'busy_left', blocked: 'busy', queue: { running: 1 } })
  })

  it('stops a slow orphan that finally answers idle', async () => {
    let calls = 0
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({
        probeQueue: async (_port, timeoutMs) => {
          clock += timeoutMs!
          return ++calls < 2 ? null : { running: 0, pending: 0 }
        }
      })
    )
    expect(out?.action).toBe('terminated')
  })

  it('ends the probe loop even under a clock that never moves, without a pause after the last try', async () => {
    let calls = 0
    let sleeps = 0
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({
        now: () => clock,
        sleep: async () => {
          sleeps++
        },
        probeQueue: async () => {
          calls++
          return null
        }
      })
    )
    expect(calls).toBe(8)
    expect(sleeps).toBe(7)
    expect(out).toMatchObject({ action: 'busy_left', queueUnknown: true })
  })

  it('does not retry an answer that is not a queue: unknown at once, never stopped', async () => {
    const probeQueue = vi.fn(async () => 'not_queue' as const)
    const out = await resolvePriorProcess('inst-1', {}, deps({ probeQueue }))
    expect(probeQueue).toHaveBeenCalledTimes(1)
    expect(kills).toEqual([])
    expect(out).toMatchObject({ action: 'busy_left', queueUnknown: true })
  })

  it('treats a probe that throws as no answer', async () => {
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({
        probeQueue: async (_port, timeoutMs) => {
          clock += timeoutMs!
          throw new Error('socket hang up')
        }
      })
    )
    expect(kills).toEqual([])
    expect(out).toMatchObject({ action: 'busy_left', queueUnknown: true })
  })

  it('gives each attempt only its own timeout, so a hung probe still gets retried', async () => {
    let calls = 0
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({
        now: () => 0,
        probeQueue: (_port, _timeoutMs) => {
          calls++
          return calls === 1 ? new Promise(() => {}) : Promise.resolve({ running: 1, pending: 0 })
        }
      })
    )
    expect(calls).toBe(2)
    expect(out).toMatchObject({ action: 'busy_left', queue: { running: 1 } })
  })

  it('returns on a cancel during a probe that hangs, without waiting it out', async () => {
    const abort = new AbortController()
    const out = await resolvePriorProcess(
      'inst-1',
      { signal: abort.signal },
      deps({
        now: () => 0,
        // Cancelled once the probe is under way; a probe that ignored the cancel would hang
        // until the budget ran out (8 s of attempts), past the test's own timeout.
        probeQueue: () => {
          abort.abort()
          return new Promise(() => {})
        }
      })
    )
    expect(kills).toEqual([])
    expect(out?.action).toBe('left')
  })

  it('never stops anything after a cancel, even on the "stop it" path', async () => {
    const abort = new AbortController()
    abort.abort()
    const out = await resolvePriorProcess(
      'inst-1',
      { stopBusy: true, signal: abort.signal },
      deps()
    )
    expect(kills).toEqual([])
    expect(out).toBeNull()
  })

  it('carries on when reporting progress throws', async () => {
    const out = await resolvePriorProcess(
      'inst-1',
      {
        onProbe: () => {
          throw new Error('Object has been destroyed')
        }
      },
      deps({ probeQueue: async () => ({ running: 1, pending: 0 }) })
    )
    expect(out).toMatchObject({ action: 'busy_left' })
  })

  it('does not wait past the budget on a probe that never settles', async () => {
    let reads = 0
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({
        // The start and the deadline are read at 0; every later read leaves 50 ms of budget.
        now: () => (reads++ < 2 ? 0 : QUEUE_PROBE_BUDGET_MS - 50),
        probeQueue: () => new Promise(() => {})
      })
    )
    expect(out).toMatchObject({ action: 'busy_left', queueUnknown: true })
    expect(kills).toEqual([])
  })

  it('stops probing and never kills once the launch is cancelled', async () => {
    const abort = new AbortController()
    const onProbe = vi.fn()
    const out = await resolvePriorProcess(
      'inst-1',
      { signal: abort.signal, onProbe },
      deps({
        probeQueue: async (_port, timeoutMs) => {
          clock += timeoutMs!
          abort.abort()
          return { running: 0, pending: 0 }
        }
      })
    )
    expect(onProbe).toHaveBeenCalledOnce()
    expect(kills).toEqual([])
    expect(out?.action).toBe('left')
  })

  it('never stops an orphan that does not answer within the budget: the user decides', async () => {
    const started = clock
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({
        probeQueue: async (_port, timeoutMs) => {
          clock += timeoutMs!
          return null
        }
      })
    )
    expect(kills).toEqual([])
    expect(out).toMatchObject({ action: 'busy_left', blocked: 'busy', queueUnknown: true })
    expect(out?.queue).toBeUndefined()
    expect(clock - started).toBe(QUEUE_PROBE_BUDGET_MS)
  })

  it('never touches a child whose Desktop is still running', async () => {
    alive.add(111)
    const out = await resolvePriorProcess('inst-1', {}, deps())
    expect(kills).toEqual([])
    expect(out).toMatchObject({ action: 'left', proof: 'desktop_record', blocked: null })
  })

  it('never touches a child it cannot prove', async () => {
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({ readRecord: () => record({ childStartTime: null }) })
    )
    expect(kills).toEqual([])
    expect(out).toMatchObject({ action: 'left', proof: 'none' })
  })

  it('drops a record whose pid now belongs to another process', async () => {
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({ readStartTimes: async () => new Map([[222, 'a-different-process']]) })
    )
    expect(out).toBeNull()
    expect(kills).toEqual([])
    expect(removed).toEqual([['inst-1', 222]])
  })

  it('waits for a child that was already asked to stop, and does not kill it', async () => {
    let polls = 0
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({
        readRecord: () => record({ stopRequestedAt: 9_000 }),
        sleep: async (ms) => {
          clock += ms
          if (++polls === 5) alive.delete(222)
        }
      })
    )
    expect(kills).toEqual([])
    expect(out).toMatchObject({ action: 'waited', exitedInTime: true, waitMs: 500 })
  })

  it('gives a stopping child its full grace period after slow checks', async () => {
    let polls = 0
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({
        readRecord: () => record({ stopRequestedAt: 9_000 }),
        // A PowerShell-slow start-time query: 12 s, more than the whole grace period.
        readStartTimes: async (pids) => {
          clock += 12_000
          return new Map(
            pids.filter((p) => alive.has(p)).map((p) => [p, p === 222 ? 'child-start' : 'x'])
          )
        },
        sleep: async (ms) => {
          clock += ms
          if (++polls === 50) alive.delete(222)
        }
      })
    )
    expect(kills).toEqual([])
    expect(out).toMatchObject({ action: 'waited', exitedInTime: true })
  })

  it('blocks when a stopping orphan cannot be re-checked after its wait', async () => {
    let queries = 0
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({
        readRecord: () => record({ stopRequestedAt: 9_000 }),
        readStartTimes: async () => (++queries === 1 ? new Map([[222, 'child-start']]) : null)
      })
    )
    expect(kills).toEqual([])
    expect(out).toMatchObject({ action: 'left', blocked: 'unverified' })
  })

  it('terminates a stopping orphan that outlives the wait', async () => {
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({ readRecord: () => record({ stopRequestedAt: 9_000 }) })
    )
    expect(kills).toHaveLength(1)
    expect(out).toMatchObject({ action: 'terminated', waitMs: 10_000 })
  })

  it('leaves a stopping child whose Desktop is still running after the wait', async () => {
    alive.add(111)
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({ readRecord: () => record({ stopRequestedAt: 9_000 }) })
    )
    expect(kills).toEqual([])
    expect(out?.action).toBe('left')
  })

  it('blocks the launch when the orphan outlives its kill, and keeps the record', async () => {
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({ killPidTree: async () => ({ killed: true, exited: false, waitMs: 10_000 }) })
    )
    expect(out).toMatchObject({ action: 'terminated', exitedInTime: false, blocked: 'stuck' })
    expect(removed).toEqual([])
  })

  it('keeps the record and blocks when the orphan cannot be re-verified at the kill', async () => {
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({
        killPidTree: async () => ({
          killed: false,
          reason: 'probe_failed',
          exited: false,
          waitMs: 15_000
        })
      })
    )
    expect(out).toMatchObject({ action: 'left', blocked: 'unverified' })
    expect(removed).toEqual([])
  })

  it("stops this Desktop's own child when nothing manages it any more", async () => {
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({ readRecord: () => record({ desktopPid: SELF.pid, desktopStartTime: SELF.start }) })
    )
    expect(kills).toEqual([[222, 'child-start']])
    expect(out).toMatchObject({ action: 'terminated', blocked: null })
  })

  it("blocks on this Desktop's own stop that outlived both waits", async () => {
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({
        readRecord: () =>
          record({ desktopPid: SELF.pid, desktopStartTime: SELF.start, stopRequestedAt: 9_000 }),
        killPidTree: async () => ({ killed: true, exited: false, waitMs: 5_000 })
      })
    )
    expect(out).toMatchObject({ action: 'terminated', blocked: 'stuck' })
  })

  it('dates the record by the wall clock but waits by the monotonic one', async () => {
    const out = await resolvePriorProcess('inst-1', {}, deps({ wallNow: () => 3_601_000 }))
    expect(out?.ageMs).toBe(3_600_000)
  })

  it('treats a pid that must never be signalled as not ours, and does not block', async () => {
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({
        killPidTree: async () => ({ killed: false, reason: 'unsafe', exited: false, waitMs: 0 })
      })
    )
    expect(out?.blocked).toBeNull()
    expect(removed).toEqual([['inst-1', 222]])
  })

  it('runs an exit scan that could not run then, and stops what it finds', async () => {
    alive.add(300)
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({
        readRecord: () =>
          record({
            pendingScan: {
              known: [{ pid: 101, startTime: '1100' }],
              exitedAt: String(filetimeOf(Date.now()))
            }
          }),
        rescanWindows: async () => [{ pid: 300, startTime: 'restarted-start' }],
        // The restarted copy serves the port.
        portListeners: async () => [300],
        readStartTimes: async (pids) =>
          new Map(
            pids
              .filter((p) => alive.has(p))
              .map((p) => [p, p === 300 ? 'restarted-start' : 'child-start'])
          ),
        settleExitBookkeeping: async () => {}
      })
    )
    expect(kills.map(([pid]) => pid)).toContain(300)
    expect(out).toMatchObject({ lingering: 1 })
  })

  it('keeps the record and refuses the launch while an owed scan still cannot run', async () => {
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({
        readRecord: () =>
          record({
            pendingScan: {
              known: [{ pid: 101, startTime: '1100' }],
              exitedAt: String(filetimeOf(Date.now()))
            }
          }),
        rescanWindows: async () => null,
        settleExitBookkeeping: async () => {}
      })
    )
    expect(out).toMatchObject({ action: 'left', blocked: 'unverified', scanOwed: true })
    expect(kills).toEqual([])
    expect(removed).toEqual([])
  })

  it('gives up an owed scan that cannot run when the port is free and the exit is old', async () => {
    // What the scan looks for serves that port; with it free, blocking every launch for days
    // (naming a child long gone) protects nothing.
    const written: ComfyProcessRecord[] = []
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({
        readRecord: () =>
          record({
            pendingScan: {
              known: [{ pid: 101, startTime: '1100' }],
              exitedAt: String(filetimeOf(Date.now() - 10 * 60_000))
            }
          }),
        rescanWindows: async () => null,
        wallNow: () => Date.now(),
        portInUse: async () => false,
        writeRecord: (r) => {
          written.push(r)
          return true
        },
        settleExitBookkeeping: async () => {}
      })
    )
    expect(out?.blocked ?? null).not.toBe('unverified')
    expect(written.at(-1)?.pendingScan).toBeUndefined()
  })

  it('keeps blocking on an owed scan while a restarted copy may still be starting up', async () => {
    // Booting (custom nodes, prestartup installs) can take minutes with the database open and
    // the port not yet bound: a free port says nothing that soon after the exit.
    const written: ComfyProcessRecord[] = []
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({
        readRecord: () =>
          record({
            pendingScan: {
              known: [{ pid: 101, startTime: '1100' }],
              exitedAt: String(filetimeOf(Date.now() - 30_000))
            }
          }),
        rescanWindows: async () => null,
        wallNow: () => Date.now(),
        portInUse: async () => false,
        writeRecord: (r) => {
          written.push(r)
          return true
        },
        settleExitBookkeeping: async () => {}
      })
    )
    expect(out).toMatchObject({ blocked: 'unverified', scanOwed: true, scanRecent: true })
    expect(written).toEqual([])
  })

  it('does not block when the proof lapsed at the moment of the kill', async () => {
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({
        killPidTree: async () => {
          alive.delete(222)
          return { killed: false, reason: 'mismatch', exited: true, waitMs: 1 }
        }
      })
    )
    expect(out).toMatchObject({ action: 'waited', blocked: null, exitedInTime: true })
  })
})

describe('resolvePriorProcess: survivors of an exited child', () => {
  const survivor = { pid: 555, startTime: 'survivor-start' }
  let alive = new Set<number>()
  let kills: number[] = []
  let removed: number[] = []
  const deps = (overrides: Partial<PriorProcessDeps> = {}): PriorProcessDeps => ({
    readRecord: () =>
      record({ desktopPid: SELF.pid, desktopStartTime: SELF.start, lingering: [survivor] }),
    removeRecordIf: (_k, pid) => {
      removed.push(pid)
    },
    readStartTimes: async (pids) =>
      new Map(pids.filter((p) => alive.has(p)).map((p) => [p, p === 555 ? 'survivor-start' : 'x'])),
    ownStartTime: async () => SELF.start,
    isPidAlive: (pid) => alive.has(pid),
    // Idle unless a test says otherwise: a survivor still serving the port answers it.
    probeQueue: async () => ({ running: 0, pending: 0 }),
    portListeners: async () => [...alive],
    processGroupOf: async () => null,
    killPidTree: async (pid) => {
      kills.push(pid)
      alive.delete(pid)
      return { killed: true, exited: true, waitMs: 5 }
    },
    now: () => 0,
    wallNow: () => 0,
    sleep: async () => {},
    ...overrides
  })

  beforeEach(() => {
    alive = new Set([555])
    kills = []
    removed = []
  })

  it('stops a proven survivor even though the Desktop that spawned the child is running', async () => {
    const out = await resolvePriorProcess('inst-1', {}, deps())
    expect(kills).toEqual([555])
    expect(out).toMatchObject({
      action: 'terminated',
      lingering: 1,
      blocked: null,
      survivorPids: [555]
    })
    expect(removed).toEqual([222])
  })

  it('keeps the record and blocks when one survivor stops and another cannot be verified', async () => {
    alive.add(556)
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({
        readRecord: () =>
          record({
            desktopPid: SELF.pid,
            desktopStartTime: SELF.start,
            lingering: [survivor, { pid: 556, startTime: 'other-start' }]
          }),
        readStartTimes: async () =>
          new Map([
            [555, 'survivor-start'],
            [556, 'other-start']
          ]),
        killPidTree: async (pid) =>
          pid === 555
            ? { killed: true, exited: true, waitMs: 5 }
            : { killed: false, reason: 'probe_failed', exited: false, waitMs: 5 }
      })
    )
    expect(out).toMatchObject({ blocked: 'unverified', lingering: 1, survivorPids: [555, 556] })
    expect(removed).toEqual([])
  })

  it('keeps the record and blocks when the survivors cannot be checked at all', async () => {
    const out = await resolvePriorProcess('inst-1', {}, deps({ readStartTimes: async () => null }))
    expect(kills).toEqual([])
    expect(out).toMatchObject({ blocked: 'unverified' })
    expect(removed).toEqual([])
  })

  it('never stops a survivor that is running prompts without the user choosing', async () => {
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({ probeQueue: async () => ({ running: 1, pending: 3 }) })
    )
    expect(kills).toEqual([])
    expect(out).toMatchObject({
      action: 'busy_left',
      blocked: 'busy',
      queue: { running: 1, pending: 3 }
    })
    expect(removed).toEqual([])
  })

  it('remembers that the user was asked, so a later quit leaves the survivors alone', async () => {
    const written: ComfyProcessRecord[] = []
    await resolvePriorProcess(
      'inst-1',
      {},
      deps({
        probeQueue: async () => ({ running: 1, pending: 0 }),
        writeRecord: (r) => {
          written.push(r)
          return true
        },
        wallNow: () => 4242
      })
    )
    expect(written.at(-1)).toMatchObject({ keptAt: 4242, lingering: [survivor] })
  })

  it('stops a busy survivor once the user has chosen to', async () => {
    const probeQueue = vi.fn(async () => ({ running: 1, pending: 0 }))
    const out = await resolvePriorProcess('inst-1', { stopBusy: true }, deps({ probeQueue }))
    expect(probeQueue).not.toHaveBeenCalled()
    expect(kills).toEqual([555])
    expect(out).toMatchObject({ action: 'terminated', lingering: 1, busyOverride: true })
  })

  it('asks at once, naming the survivors, when nothing serves the port (no probe to wait on)', async () => {
    const probeQueue = vi.fn(async () => ({ running: 0, pending: 0 }))
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({ portListeners: async () => [], probeQueue })
    )
    expect(probeQueue).not.toHaveBeenCalled()
    expect(kills).toEqual([])
    expect(out).toMatchObject({
      action: 'busy_left',
      blocked: 'busy',
      queueUnknown: true,
      survivorPids: [555]
    })
  })

  it('lets a portless survivor that is only tearing down exit, without asking', async () => {
    let polls = 0
    const probeQueue = vi.fn(async () => ({ running: 0, pending: 0 }))
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({
        portListeners: async () => [],
        probeQueue,
        sleep: async () => {
          if (++polls === 3) alive.delete(555)
        }
      })
    )
    expect(kills).toEqual([])
    expect(probeQueue).not.toHaveBeenCalled()
    expect(out).toBeNull()
  })

  it('never stops a survivor that does not answer whether it is busy: the user decides', async () => {
    let t = 0
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({
        now: () => t,
        sleep: async (ms) => {
          t += ms
        },
        probeQueue: async (_port, timeoutMs) => {
          t += timeoutMs!
          return null
        }
      })
    )
    expect(kills).toEqual([])
    expect(out).toMatchObject({ action: 'busy_left', blocked: 'busy', queueUnknown: true })
  })

  it('stops nothing once the launch is cancelled during the survivor check', async () => {
    const abort = new AbortController()
    const out = await resolvePriorProcess(
      'inst-1',
      { signal: abort.signal },
      deps({
        probeQueue: async () => {
          abort.abort()
          return { running: 0, pending: 0 }
        }
      })
    )
    expect(kills).toEqual([])
    expect(out).toBeNull()
  })

  it('reports survivors already stopped when a cancel lands during the stop', async () => {
    const abort = new AbortController()
    const out = await resolvePriorProcess(
      'inst-1',
      { signal: abort.signal },
      deps({
        killPidTree: async (pid) => {
          kills.push(pid)
          alive.delete(pid)
          abort.abort()
          return { killed: true, exited: true, waitMs: 5 }
        }
      })
    )
    expect(kills).toEqual([555])
    expect(out).toMatchObject({ action: 'terminated', lingering: 1, blocked: null })
  })

  it('never stops a survivor pid that now names another process', async () => {
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({ readStartTimes: async () => new Map([[555, 'someone-else']]) })
    )
    expect(kills).toEqual([])
    expect(out).toBeNull()
  })

  it('blocks the launch when a survivor outlives its kill', async () => {
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({ killPidTree: async () => ({ killed: true, exited: false, waitMs: 5_000 }) })
    )
    expect(out).toMatchObject({ blocked: 'stuck', lingering: 1 })
    expect(removed).toEqual([])
  })

  describe('when another process answers on the recorded port', () => {
    // Every installation defaults to the same port: once the child is gone, another ComfyUI (a
    // different installation, say) can hold it, and its answer says nothing about the survivors.
    const STRANGER = 900

    it('never stops the survivors on a stranger\'s "idle": they are put to the user', async () => {
      const probeQueue = vi.fn(async () => ({ running: 0, pending: 0 }))
      const out = await resolvePriorProcess(
        'inst-1',
        {},
        deps({ portListeners: async () => [STRANGER], probeQueue })
      )
      expect(probeQueue).not.toHaveBeenCalled()
      expect(kills).toEqual([])
      expect(out).toMatchObject({ action: 'busy_left', blocked: 'busy', survivorPids: [555] })
    })

    it("names the survivors, not a stranger's prompt, when the stranger is busy", async () => {
      const out = await resolvePriorProcess(
        'inst-1',
        {},
        deps({
          portListeners: async () => [STRANGER],
          probeQueue: async () => ({ running: 1, pending: 0 })
        })
      )
      expect(kills).toEqual([])
      expect(out).toMatchObject({ action: 'busy_left', survivorPids: [555] })
      expect(out).not.toHaveProperty('queue')
    })

    it('treats listeners that cannot be read as "not the survivors"', async () => {
      const probeQueue = vi.fn(async () => ({ running: 0, pending: 0 }))
      const out = await resolvePriorProcess(
        'inst-1',
        {},
        deps({
          portListeners: async () => {
            throw new Error('lsof missing')
          },
          probeQueue
        })
      )
      expect(probeQueue).not.toHaveBeenCalled()
      expect(kills).toEqual([])
      expect(out).toMatchObject({ action: 'busy_left', survivorPids: [555] })
    })

    it("asks /queue when the listener is in the recorded child's process group", async () => {
      const probeQueue = vi.fn(async () => ({ running: 0, pending: 0 }))
      const out = await resolvePriorProcess(
        'inst-1',
        {},
        deps({
          portListeners: async () => [777],
          processGroupOf: async (pid) => (pid === 777 ? 222 : null),
          probeQueue
        })
      )
      expect(probeQueue).toHaveBeenCalled()
      expect(kills).toEqual([555])
      expect(out).toMatchObject({ action: 'terminated', lingering: 1 })
    })

    it('does not trust a listener in some other process group', async () => {
      const out = await resolvePriorProcess(
        'inst-1',
        {},
        deps({
          portListeners: async () => [777],
          processGroupOf: async () => 4242
        })
      )
      expect(kills).toEqual([])
      expect(out).toMatchObject({ action: 'busy_left', survivorPids: [555] })
    })
  })

  it('logs the grace: who it waited for, and how it ended', async () => {
    const lines: string[] = []
    let polls = 0
    await resolvePriorProcess(
      'inst-1',
      { onNote: (line) => lines.push(line) },
      deps({
        portListeners: async () => [],
        sleep: async () => {
          if (++polls === 3) alive.delete(555)
        }
      })
    )
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('pids 555')
    expect(lines[1]).toContain('exited on their own')
  })

  it('reports every pid the stops covered, for the log', async () => {
    const out = await resolvePriorProcess(
      'inst-1',
      { stopBusy: true },
      deps({
        killPidTree: async (pid) => {
          alive.delete(pid)
          return { killed: true, exited: true, waitMs: 5, members: [pid, 560, 561] }
        }
      })
    )
    expect(out).toMatchObject({ action: 'terminated', stoppedPids: [555, 560, 561] })
  })

  it('does not trust /queue when a stranger listens on the port beside a survivor', async () => {
    // A survivor bound to a LAN address and a stranger on loopback share the port number; the
    // busy check (127.0.0.1) would reach the stranger.
    const probeQueue = vi.fn(async () => ({ running: 0, pending: 0 }))
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({ portListeners: async () => [555, 900], probeQueue })
    )
    expect(probeQueue).not.toHaveBeenCalled()
    expect(kills).toEqual([])
    expect(out).toMatchObject({ action: 'busy_left', survivorPids: [555] })
  })

  it('counts a listener a survivor started after the exit scan (Windows ancestry)', async () => {
    const probeQueue = vi.fn(async () => ({ running: 0, pending: 0 }))
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({
        portListeners: async () => [700],
        windowsProcessRows: async () => [
          { pid: 555, ppid: 1, created: '100' },
          { pid: 700, ppid: 555, created: '200' }
        ],
        probeQueue
      })
    )
    expect(probeQueue).toHaveBeenCalled()
    expect(kills).toEqual([555])
    expect(out).toMatchObject({ action: 'terminated' })
  })

  it('does not count a listener under a reused survivor pid created before it', async () => {
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({
        portListeners: async () => [700],
        windowsProcessRows: async () => [
          { pid: 555, ppid: 1, created: '300' },
          { pid: 700, ppid: 555, created: '200' }
        ]
      })
    )
    expect(kills).toEqual([])
    expect(out).toMatchObject({ action: 'busy_left', survivorPids: [555] })
  })

  it('asks a survivor that took the port during the grace, instead of calling it portless', async () => {
    // Still booting when the launch looked; it binds (and turns busy) a moment later.
    let listening = false
    let polls = 0
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({
        portListeners: async () => (listening ? [555] : []),
        probeQueue: async () => ({ running: 1, pending: 0 }),
        sleep: async () => {
          if (++polls === 5) listening = true
        }
      })
    )
    expect(kills).toEqual([])
    expect(out).toMatchObject({ action: 'busy_left', queue: { running: 1, pending: 0 } })
    expect(out).not.toHaveProperty('survivorPids')
  })
})

describe('resolvePriorProcess: the recorded Windows tree outliving its launcher', () => {
  // A Desktop that died ran no exit scan; the interpreter it recorded under the venv launcher
  // (the recorded child, now gone) is still running and still holds the lock.
  const INSTALL = 'C:\\c\\one'
  const interpreter = { pid: 700, startTime: '1700' }
  let alive = new Set<number>()
  let kills: number[] = []
  let table: Array<{ pid: number; ppid: number; created: string; commandLine: string }> | null
  const deps = (overrides: Partial<PriorProcessDeps> = {}): PriorProcessDeps => ({
    readRecord: () =>
      record({ installPath: INSTALL, desktopPid: 111, childPid: 222, tree: [interpreter] }),
    removeRecordIf: () => {},
    readStartTimes: async (pids) =>
      new Map(pids.filter((p) => alive.has(p)).map((p) => [p, p === 700 ? '1700' : 'x'])),
    ownStartTime: async () => SELF.start,
    isPidAlive: (pid) => alive.has(pid),
    probeQueue: async () => ({ running: 0, pending: 0 }),
    portListeners: async () => [...alive],
    processGroupOf: async () => null,
    windowsProcessRows: async () => null,
    windowsProcessTable: async () => table,
    platform: 'win32',
    killPidTree: async (pid) => {
      kills.push(pid)
      alive.delete(pid)
      return { killed: true, exited: true, waitMs: 5 }
    },
    now: () => 0,
    wallNow: () => 0,
    sleep: async () => {},
    ...overrides
  })

  beforeEach(() => {
    alive = new Set([700])
    kills = []
    table = [
      {
        pid: 700,
        ppid: 222,
        created: '1700',
        commandLine: 'C:\\Py\\python.exe -s ComfyUI\\main.py --port 8188'
      }
    ]
  })

  it('stops the recorded interpreter once it is proven, and says the tree proved it', async () => {
    const out = await resolvePriorProcess('inst-1', {}, deps())
    expect(kills).toEqual([700])
    expect(out).toMatchObject({ action: 'terminated', proof: 'desktop_tree', lingering: 1 })
  })

  it('still asks first when it is busy', async () => {
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({ probeQueue: async () => ({ running: 1, pending: 0 }) })
    )
    expect(kills).toEqual([])
    expect(out).toMatchObject({ action: 'busy_left', proof: 'desktop_tree' })
  })

  it.each([
    ['another process now has its pid', { created: '9999' }],
    ['it no longer runs main.py', { commandLine: 'C:\\Py\\python.exe -m pip install x' }],
    ['it runs another installation', { commandLine: 'C:\\Py\\python.exe D:\\other\\main.py' }]
  ])('leaves it alone when %s', async (_why, change) => {
    table = [{ ...table![0]!, ...change }]
    expect(await resolvePriorProcess('inst-1', {}, deps())).toBeNull()
    expect(kills).toEqual([])
  })

  it("does not take a custom node's own `python main.py` under the interpreter for it", async () => {
    // A helper started by a custom node, recorded as a tree member: relative main.py, but its
    // parent is the interpreter, not the recorded launcher.
    table = [{ pid: 700, ppid: 650, created: '1700', commandLine: 'C:\\Py\\python.exe main.py' }]
    expect(await resolvePriorProcess('inst-1', {}, deps())).toBeNull()
    expect(kills).toEqual([])
  })

  it('leaves the tree to the child path while the launcher itself is alive', async () => {
    alive.add(222)
    const probe = vi.fn(async () => table)
    await resolvePriorProcess('inst-1', {}, deps({ windowsProcessTable: probe }))
    expect(probe).not.toHaveBeenCalled()
    expect(kills).not.toContain(700)
  })

  it('ignores a recorded tree off Windows, where nothing can verify it', async () => {
    const probe = vi.fn(async () => null)
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      deps({ platform: 'linux', windowsProcessTable: probe })
    )
    expect(probe).not.toHaveBeenCalled()
    expect(out).toBeNull()
  })

  it('does not launch beside it when the process table cannot be read', async () => {
    table = null
    const out = await resolvePriorProcess('inst-1', {}, deps())
    expect(kills).toEqual([])
    expect(out).toMatchObject({ blocked: 'unverified' })
  })
})

describe('stopLingeringAtQuit', () => {
  const survivor = { pid: 555, startTime: 'survivor-start' }
  let kills: number[] = []
  const deps = (overrides: Partial<PriorProcessDeps> = {}): PriorProcessDeps => ({
    readRecord,
    removeRecordIf: () => {},
    readStartTimes: async (pids) =>
      new Map(pids.filter((p) => p === 555).map((p) => [p, 'survivor-start'])),
    ownStartTime: async () => SELF.start,
    isPidAlive: (pid) => pid === 555,
    probeQueue: async () => ({ running: 0, pending: 0 }),
    killPidTree: async (pid) => {
      kills.push(pid)
      return { killed: true, exited: true, waitMs: 1 }
    },
    now: () => 0,
    wallNow: () => 0,
    sleep: async () => {},
    ...overrides
  })
  beforeEach(() => {
    kills = []
  })

  it("stops the proven survivors of this Desktop's children", async () => {
    writeRecord(
      record({
        desktopPid: SELF.pid,
        desktopStartTime: SELF.start,
        childExitedAt: 1,
        lingering: [survivor]
      })
    )
    expect(await stopLingeringAtQuit(deps())).toBe(1)
    expect(kills).toEqual([555])
  })

  it.each([
    ['the user was asked about them at a launch', { keptAt: 5 }],
    ['another Desktop wrote the record', { desktopPid: 111, desktopStartTime: 'desk-start' }],
    ['a previous Desktop that had our pid wrote it', { desktopStartTime: 'an-earlier-desktop' }]
  ])('leaves them alone when %s', async (_why, overrides) => {
    writeRecord(
      record({
        desktopPid: SELF.pid,
        desktopStartTime: SELF.start,
        childExitedAt: 1,
        lingering: [survivor],
        ...overrides
      })
    )
    expect(await stopLingeringAtQuit(deps())).toBe(0)
    expect(kills).toEqual([])
  })

  it('costs nothing when no record of ours has survivors (no start-time query)', async () => {
    writeRecord(record({ desktopPid: SELF.pid, desktopStartTime: SELF.start }))
    const ownStartTime = vi.fn(async () => SELF.start)
    expect(await stopLingeringAtQuit(deps({ ownStartTime }))).toBe(0)
    expect(ownStartTime).not.toHaveBeenCalled()
  })

  it('never stops a pid that now names another process', async () => {
    writeRecord(
      record({
        desktopPid: SELF.pid,
        desktopStartTime: SELF.start,
        childExitedAt: 1,
        lingering: [{ pid: 555, startTime: 'a-process-that-had-this-pid-before' }]
      })
    )
    expect(await stopLingeringAtQuit(deps())).toBe(0)
    expect(kills).toEqual([])
  })
})

describe.runIf(process.platform !== 'win32')('survivors of a real process group', () => {
  /** A detached leader (like Desktop's ComfyUI) that starts a long-lived child from `childFile`,
   *  then exits when its stdin closes, which the test does only after `trackSpawn` listens. */
  async function leaderWithChild(
    childFile: string
  ): Promise<{ leader: ReturnType<typeof spawn>; survivorPid: number }> {
    fs.writeFileSync(childFile, 'setTimeout(() => {}, 60000)\n')
    const leader = spawn(
      process.execPath,
      [
        '-e',
        `const c = require('child_process').spawn(process.execPath, [${JSON.stringify(childFile)}], { stdio: 'ignore' }); console.log(c.pid); process.stdin.on('end', () => process.exit(0)); process.stdin.resume()`
      ],
      { stdio: ['pipe', 'pipe', 'ignore'], detached: true }
    )
    const survivorPid = await new Promise<number>((r) =>
      leader.stdout!.once('data', (d: Buffer) => r(Number(String(d).trim())))
    )
    return { leader, survivorPid }
  }

  const info = {
    sessionKey: 'inst-1',
    installationId: 'inst-1',
    installPath: '/x',
    port: 1,
    bootId: 'b'
  }

  it('records a ComfyUI that outlives the child, and the next launch stops only it', async () => {
    // Node runs a file of any name, so a script called main.py stands in for a ComfyUI worker.
    const { leader, survivorPid } = await leaderWithChild(path.join(dirs.state, 'main.py'))
    try {
      trackSpawn(leader, info)
      leader.stdin!.end()
      await vi.waitFor(() => expect(readRecord('inst-1')?.lingering?.[0]?.pid).toBe(survivorPid), {
        timeout: 5_000
      })
      expect(isPidAlive(leader.pid!)).toBe(false)

      // This survivor serves no port, so it never answers the busy check; the next launch asks,
      // and this is the user having chosen "Stop it and launch".
      const out = await resolvePriorProcess('inst-1', { stopBusy: true })
      expect(out).toMatchObject({ action: 'terminated', lingering: 1, exitedInTime: true })
      expect(isPidAlive(survivorPid)).toBe(false)
      expect(readRecord('inst-1')).toBeNull()
    } finally {
      try {
        process.kill(survivorPid, 'SIGKILL')
      } catch {}
    }
  })

  it('never records a survivor that is not ComfyUI (a browser, a model server)', async () => {
    const { leader, survivorPid } = await leaderWithChild(path.join(dirs.state, 'server.js'))
    try {
      trackSpawn(leader, info)
      leader.stdin!.end()
      await vi.waitFor(() => expect(readRecord('inst-1')).toBeNull(), { timeout: 5_000 })
      expect(isPidAlive(survivorPid)).toBe(true)
      expect(await resolvePriorProcess('inst-1')).toBeNull()
      expect(isPidAlive(survivorPid)).toBe(true)
    } finally {
      try {
        process.kill(survivorPid, 'SIGKILL')
      } catch {}
    }
  })

  it('drops the record when nothing outlives the child', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 200)'], {
      stdio: 'ignore',
      detached: true
    })
    trackSpawn(child, {
      sessionKey: 'inst-1',
      installationId: 'inst-1',
      installPath: '/x',
      port: 1,
      bootId: 'b'
    })
    await new Promise((r) => child.once('exit', r))
    await vi.waitFor(() => expect(readRecord('inst-1')).toBeNull())
  })
})

function hasLsof(): boolean {
  try {
    execFileSync('lsof', ['-v'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

describe.runIf(process.platform === 'linux' && hasLsof())(
  'survivors and a real stranger on the recorded port',
  () => {
    const started: ReturnType<typeof spawn>[] = []
    afterEach(() => {
      for (const p of started.splice(0)) {
        try {
          process.kill(p.pid!, 'SIGKILL')
        } catch {}
      }
    })

    /** A stand-in ComfyUI (a script called main.py): answers /queue idle or busy on `port`, or
     *  serves nothing (`portless`, a worker holding the lock). */
    /** Listens on a port of the OS's choosing (no free-then-rebind race with other workers)
     *  and reports it. */
    async function fakeComfy(
      mode: 'idle' | 'busy' | 'portless'
    ): Promise<{ pid: number; port: number }> {
      const file = path.join(dirs.state, 'main.py')
      fs.writeFileSync(
        file,
        `const [mode] = process.argv.slice(2)
const running = mode === 'busy' ? [[1, 'x']] : []
if (mode !== 'portless') {
  const server = require('http')
    .createServer((_q, r) => r.end(JSON.stringify({ queue_running: running, queue_pending: [] })))
  server.listen(0, '127.0.0.1', () => console.log(server.address().port))
} else console.log(0)
setInterval(() => {}, 1 << 30)
`
      )
      const p = spawn(process.execPath, [file, mode], { stdio: ['ignore', 'pipe', 'ignore'] })
      started.push(p)
      const port = await new Promise<number>((r) =>
        p.stdout!.once('data', (d: Buffer) => r(Number(String(d).trim())))
      )
      return { pid: p.pid!, port }
    }

    /** A record whose child and Desktop are gone, with `survivor` proven by its start time. */
    async function survivorRecord(survivor: number, port: number): Promise<void> {
      const times = await readStartTimes([survivor])
      writeRecord(
        record({
          port,
          childPid: await deadPid(),
          desktopPid: await deadPid(),
          childExitedAt: Date.now(),
          lingering: [{ pid: survivor, startTime: times!.get(survivor)! }]
        })
      )
    }

    it('asks about a portless survivor even when an idle stranger holds the port', async () => {
      // Another installation took the recorded port once it was free.
      const { pid: stranger, port } = await fakeComfy('idle')
      const { pid: survivor } = await fakeComfy('portless')
      await survivorRecord(survivor, port)
      const out = await resolvePriorProcess('inst-1')
      expect(out).toMatchObject({ action: 'busy_left', survivorPids: [survivor] })
      expect(isPidAlive(survivor)).toBe(true)
      expect(isPidAlive(stranger)).toBe(true)
    }, 20_000)

    it('never stops a busy survivor on another port because a stranger on the recorded one is idle', async () => {
      const { pid: stranger, port } = await fakeComfy('idle')
      const { pid: survivor } = await fakeComfy('busy')
      await survivorRecord(survivor, port)
      const out = await resolvePriorProcess('inst-1')
      expect(out).toMatchObject({ action: 'busy_left', survivorPids: [survivor] })
      expect(isPidAlive(survivor)).toBe(true)
      expect(isPidAlive(stranger)).toBe(true)
    }, 20_000)

    it('still stops an idle survivor that serves the recorded port itself', async () => {
      const { pid: survivor, port } = await fakeComfy('idle')
      await survivorRecord(survivor, port)
      const out = await resolvePriorProcess('inst-1')
      expect(out).toMatchObject({ action: 'terminated', lingering: 1 })
      await vi.waitFor(() => expect(isPidAlive(survivor)).toBe(false))
    }, 20_000)
  }
)

describe('findWindowsSurvivors (a ComfyUI that restarted itself with os.execv)', () => {
  // Launcher L (pid 100) ran interpreter I (101). I execv'd: a new venv launcher N (200, parent
  // I) and its interpreter (201) now run outside the job, and L and I are gone. Creation times
  // are FILETIMEs; the exit is at EXIT.
  const INSTALL = 'C:\\c\\one'
  const EXIT = filetimeOf(Date.UTC(2026, 8, 29, 12, 0, 0))
  const at = (secondsFromExit: number): string =>
    String(EXIT + BigInt(secondsFromExit) * 10_000_000n)
  const known = [
    { pid: 100, startTime: at(-3600) },
    { pid: 101, startTime: at(-3599) }
  ]
  const ctx = { known, installPath: INSTALL, exitedAt: EXIT }
  const row = (pid: number, ppid: number, created: string, commandLine: string) => ({
    pid,
    ppid,
    created,
    commandLine
  })
  const venvMain = `"${INSTALL}\\.venv\\Scripts\\python.exe" "main.py" --port 8188`

  it('finds the restarted copy and its interpreter through the dead interpreter', () => {
    const rows = [
      row(200, 101, at(-1), venvMain),
      row(201, 200, at(0), 'C:\\Py\\python.exe main.py --port 8188')
    ]
    expect(findWindowsSurvivors(rows, ctx)).toEqual([
      { pid: 200, startTime: at(-1) },
      { pid: 201, startTime: at(0) }
    ])
  })

  it('ignores an older process whose recorded parent pid was reused', () => {
    const rows = [row(300, 101, at(-7200), venvMain)]
    expect(findWindowsSurvivors(rows, ctx)).toEqual([])
  })

  it('ignores the child of a NEW process that took a dead tree pid', () => {
    const rows = [
      row(101, 5, at(-10), 'cmd.exe'), // pid 101 reused by something else
      row(300, 101, at(-5), venvMain)
    ]
    expect(findWindowsSurvivors(rows, ctx)).toEqual([])
  })

  it('ignores a process created long before the exit, even with a matching parent', () => {
    const rows = [row(300, 101, at(-1800), venvMain)]
    expect(findWindowsSurvivors(rows, ctx)).toEqual([])
  })

  it('ignores a process created after the exit (it cannot be what the child left)', () => {
    expect(findWindowsSurvivors([row(300, 101, at(1), venvMain)], ctx)).toEqual([])
  })

  it('ignores a ComfyUI of another installation', () => {
    const rows = [row(300, 101, at(-1), '"C:\\c\\two\\.venv\\Scripts\\python.exe" "main.py"')]
    expect(findWindowsSurvivors(rows, ctx)).toEqual([])
  })

  it('ignores what a custom node started that is not ComfyUI', () => {
    const rows = [
      row(400, 101, at(-1), '"C:\\Program Files\\Browser\\browser.exe" http://127.0.0.1:8188'),
      row(401, 101, at(-1), 'ollama.exe serve')
    ]
    expect(findWindowsSurvivors(rows, ctx)).toEqual([])
  })

  it('keeps a known interpreter that is still running, by its creation time only', () => {
    expect(
      findWindowsSurvivors(
        [row(101, 100, at(-3599), 'C:\\Py\\python.exe -s ComfyUI\\main.py')],
        ctx
      )
    ).toEqual([{ pid: 101, startTime: at(-3599) }])
    expect(
      findWindowsSurvivors([row(101, 7, at(-1), 'C:\\Py\\python.exe -s ComfyUI\\main.py')], ctx)
    ).toEqual([])
  })

  it('below a restarted copy, ignores a main.py that is not this installation', () => {
    const rows = [
      row(200, 101, at(-1), venvMain),
      row(201, 200, at(0), 'C:\\Py\\python.exe main.py --port 8188'),
      row(202, 201, at(0), 'C:\\Py\\python.exe C:\\elsewhere\\main.py')
    ]
    expect(findWindowsSurvivors(rows, ctx).map((m) => m.pid)).toEqual([200, 201])
  })

  it('compares the parent creation time numerically', () => {
    const rows = [
      row(101, 100, '0' + at(-3599), 'C:\\Py\\python.exe'),
      row(200, 101, at(-1), venvMain)
    ]
    expect(findWindowsSurvivors(rows, ctx).map((m) => m.pid)).toEqual([200])
  })

  describe('the shape QA saw: a relative main.py under a dead interpreter', () => {
    // Recorded: launcher 11000 and its interpreter 12184 (the tree), exit at 00:36:04Z. The
    // restarted launcher 1192 was created at 00:36:00Z, 4 s before the exit, names the dead
    // interpreter as parent, and runs this install's venv python with a relative main.py.
    const exit = filetimeOf(Date.UTC(2026, 8, 30, 0, 36, 4))
    const t = (h: number, m: number, sec: number): string =>
      String(filetimeOf(Date.UTC(2026, 8, 30, h, m, sec)))
    const qaCtx = {
      known: [
        { pid: 11000, startTime: t(0, 20, 0) },
        { pid: 12184, startTime: t(0, 20, 1) }
      ],
      installPath: 'C:\\Users\\qa\\ComfyUI-Installs\\ComfyUI',
      exitedAt: exit
    }
    const restarted = row(
      1192,
      12184,
      t(0, 36, 0),
      '"C:\\Users\\qa\\ComfyUI-Installs\\ComfyUI\\.venv\\Scripts\\python.exe" "ComfyUI\\main.py" --port 8188 --enable-assets'
    )

    it('is found at exit, with the interpreter pid free', () => {
      expect(findWindowsSurvivors([restarted], qaCtx)).toEqual([
        { pid: 1192, startTime: t(0, 36, 0) }
      ])
    })

    it('is still found by a later scan after the dead interpreter pid was reused', () => {
      const reuser = row(12184, 4, t(0, 40, 0), 'C:\\Windows\\System32\\svchost.exe -k netsvcs')
      expect(findWindowsSurvivors([reuser, restarted], qaCtx).map((m) => m.pid)).toEqual([1192])
    })

    it('is found with an unquoted relative main.py too', () => {
      const unquoted = row(
        1192,
        12184,
        t(0, 36, 0),
        '"C:\\Users\\qa\\ComfyUI-Installs\\ComfyUI\\.venv\\Scripts\\python.exe" ComfyUI/main.py --port 8188'
      )
      expect(findWindowsSurvivors([unquoted], qaCtx).map((m) => m.pid)).toEqual([1192])
    })

    it('is rejected when the pid it names was already held by another process when it started', () => {
      const earlierHolder = row(12184, 4, t(0, 35, 59), 'cmd.exe')
      expect(findWindowsSurvivors([earlierHolder, restarted], qaCtx)).toEqual([])
    })
  })

  it('ignores a known tree member that runs some other main.py (a custom node helper)', () => {
    expect(
      findWindowsSurvivors(
        [row(101, 100, at(-3599), 'C:\\Py\\python.exe C:\\service\\main.py')],
        ctx
      )
    ).toEqual([])
  })

  it('never returns Desktop itself', () => {
    expect(findWindowsSurvivors([row(process.pid, 101, at(-1), venvMain)], ctx)).toEqual([])
  })
})

describe('record store', () => {
  it('round-trips, and keys with a colon survive as filenames', () => {
    const r = record({ sessionKey: 'performance-test:inst-1' })
    writeRecord(r)
    expect(readRecord('performance-test:inst-1')).toEqual(r)
    expect(listRecords()).toEqual([r])
  })

  it('skips a file whose name is not one it wrote', () => {
    writeRecord(record())
    fs.writeFileSync(path.join(dirs.state, 'comfy-procs', '50%.json'), '{}')
    expect(listRecords().map((r) => r.sessionKey)).toEqual(['inst-1'])
  })

  it.each([
    ['a numeric start token', { childStartTime: 12345 }],
    ['an out-of-range port', { port: 70000 }],
    ['a zero port', { port: 0 }],
    ['pid 1 as the child', { childPid: 1 }],
    ['pid 0 as the owner', { desktopPid: 0 }],
    ['pid 1 as a survivor', { lingering: [{ pid: 1, startTime: 'x' }] }],
    ['a null entry in an owed scan', { pendingScan: { known: [null], exitedAt: '1' } }],
    [
      'a numeric start token in an owed scan',
      { pendingScan: { known: [{ pid: 101, startTime: 1100 }], exitedAt: '1' } }
    ]
  ])('rejects a record with %s', (_why, bad) => {
    writeRecord({ ...record(), ...bad } as unknown as ComfyProcessRecord)
    expect(readRecord('inst-1')).toBeNull()
  })

  it('reads a corrupt or foreign file as no record', () => {
    fs.mkdirSync(path.join(dirs.state, 'comfy-procs'), { recursive: true })
    fs.writeFileSync(path.join(dirs.state, 'comfy-procs', 'inst-1.json'), '{"v":1,')
    fs.writeFileSync(path.join(dirs.state, 'comfy-procs', 'inst-2.json'), '{"v":2}')
    expect(readRecord('inst-1')).toBeNull()
    expect(listRecords()).toEqual([])
  })

  it('leaves a record it cannot read right now, and drops one that is corrupt', () => {
    const dir = path.join(dirs.state, 'comfy-procs')
    fs.mkdirSync(path.join(dir, 'inst-1.json'), { recursive: true })
    removeRecordIf('inst-1', 222)
    expect(fs.existsSync(path.join(dir, 'inst-1.json'))).toBe(true)
    fs.rmdirSync(path.join(dir, 'inst-1.json'))
    fs.writeFileSync(path.join(dir, 'inst-1.json'), '{"v":1,')
    removeRecordIf('inst-1', 222)
    expect(fs.existsSync(path.join(dir, 'inst-1.json'))).toBe(false)
  })

  it('only removes the record of the child it names', () => {
    writeRecord(record({ childPid: 333 }))
    removeRecordIf('inst-1', 222)
    expect(readRecord('inst-1')?.childPid).toBe(333)
    removeRecordIf('inst-1', 333)
    expect(readRecord('inst-1')).toBeNull()
  })

  it('stamps a stop request once, and only on a record this Desktop wrote', () => {
    writeRecord(record({ sessionKey: 'foreign', desktopPid: 111 }))
    markStopRequested('foreign')
    expect(readRecord('foreign')?.stopRequestedAt).toBeUndefined()
    fs.unlinkSync(path.join(dirs.state, 'comfy-procs', 'foreign.json'))

    writeRecord(record({ desktopPid: process.pid }))
    markStopRequested('inst-1')
    const first = readRecord('inst-1')?.stopRequestedAt
    expect(first).toBeGreaterThan(0)
    markStopRequested('inst-1')
    expect(readRecord('inst-1')?.stopRequestedAt).toBe(first)
    markStopRequested('no-such-session')
    expect(listRecords()).toHaveLength(1)
  })

  it.runIf(process.platform !== 'win32')(
    'tracks a real spawn: start times filled in, record gone when it exits',
    async () => {
      const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
        stdio: 'ignore'
      })
      const info = {
        sessionKey: 'inst-1',
        installationId: 'inst-1',
        installPath: '/x',
        port: 1,
        bootId: 'b'
      }
      trackSpawn(child, info)
      expect(readRecord('inst-1')).toMatchObject({ childPid: child.pid, desktopPid: process.pid })
      await vi.waitFor(() => expect(readRecord('inst-1')?.childStartTime).toBeTruthy())
      expect(readRecord('inst-1')?.desktopStartTime).toBeTruthy()
      const exited = new Promise((r) => child.once('exit', r))
      child.kill('SIGKILL')
      await exited
      // The exit bookkeeping looks for survivors first (asynchronous `ps` on macOS).
      await vi.waitFor(() => expect(readRecord('inst-1')).toBeNull())
    }
  )
})

describe('takePriorSessionUnclean', () => {
  it('reports a record left by a dead Desktop that never stopped its child, once', async () => {
    const dead = await deadPid()
    writeRecord(record({ desktopPid: dead, childPid: process.pid }))
    expect(takePriorSessionUnclean()).toBe(true)
    expect(takePriorSessionUnclean()).toBe(false)
    expect(readRecord('inst-1')).not.toBeNull()
  })

  it('does not report a stop that was requested, and drops records whose child is gone', async () => {
    const dead = await deadPid()
    writeRecord(record({ desktopPid: dead, childPid: dead, stopRequestedAt: 1 }))
    expect(takePriorSessionUnclean()).toBe(false)
    expect(listRecords()).toEqual([])
  })

  it('reports a crash whose child also died, then forgets it', async () => {
    const dead = await deadPid()
    writeRecord(record({ desktopPid: dead, childPid: dead }))
    expect(takePriorSessionUnclean()).toBe(true)
    expect(listRecords()).toEqual([])
  })

  it('does not count a child that exited on its own and left a survivor', async () => {
    const dead = await deadPid()
    writeRecord(
      record({
        desktopPid: dead,
        childPid: dead,
        childExitedAt: 1,
        lingering: [{ pid: process.pid, startTime: 'x' }]
      })
    )
    expect(takePriorSessionUnclean()).toBe(false)
    expect(readRecord('inst-1')).not.toBeNull()
  })

  it('keeps a record whose recorded tree outlived its Desktop and launcher', async () => {
    const dead = await deadPid()
    writeRecord(
      record({ desktopPid: dead, childPid: dead, tree: [{ pid: process.pid, startTime: 'x' }] })
    )
    takePriorSessionUnclean()
    expect(readRecord('inst-1')).not.toBeNull()
  })

  it('keeps a record that still owes a Windows exit scan across a Desktop restart', async () => {
    const dead = await deadPid()
    writeRecord(
      record({
        desktopPid: dead,
        childPid: dead,
        childExitedAt: 1,
        pendingScan: {
          known: [{ pid: 101, startTime: '1100' }],
          exitedAt: String(filetimeOf(Date.now()))
        }
      })
    )
    takePriorSessionUnclean()
    expect(readRecord('inst-1')?.pendingScan).toBeDefined()

    // The next launch runs the scan, stops what it finds, and no longer owes it.
    const kills: number[] = []
    const out = await resolvePriorProcess(
      'inst-1',
      {},
      {
        readRecord,
        removeRecordIf,
        readStartTimes: async (pids) =>
          new Map(pids.filter((p) => p === 300).map((p) => [p, 'restarted-start'])),
        ownStartTime: async () => 'self',
        isPidAlive: (pid) => pid === 300 && kills.length === 0,
        // The restarted copy serves the recorded port and is idle.
        portListeners: async () => [300],
        probeQueue: async () => ({ running: 0, pending: 0 }),
        killPidTree: async (pid) => {
          kills.push(pid)
          return { killed: true, exited: true, waitMs: 1 }
        },
        rescanWindows: async () => [{ pid: 300, startTime: 'restarted-start' }],
        settleExitBookkeeping: async () => {},
        now: () => 0,
        wallNow: () => Date.now(),
        sleep: async () => {}
      }
    )
    expect(kills).toEqual([300])
    expect(out).toMatchObject({ action: 'terminated', lingering: 1 })
    expect(readRecord('inst-1')).toBeNull()
  })

  it('drops a pending Windows exit scan once it is too old to trust', async () => {
    const dead = await deadPid()
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000
    writeRecord(
      record({
        desktopPid: dead,
        childPid: dead,
        childExitedAt: 1,
        pendingScan: {
          known: [{ pid: 101, startTime: '1100' }],
          exitedAt: String(filetimeOf(eightDaysAgo))
        }
      })
    )
    expect(pendingScanIsCurrent(readRecord('inst-1')!)).toBe(false)
    takePriorSessionUnclean()
    expect(readRecord('inst-1')).toBeNull()
  })

  it('ignores records owned by a running Desktop', () => {
    writeRecord(record({ desktopPid: process.pid, childPid: process.pid }))
    expect(isPidAlive(process.pid)).toBe(true)
    expect(takePriorSessionUnclean()).toBe(false)
  })
})

describe('commandLineIsInstall', () => {
  it.each([
    ['/opt/c/one/.venv/bin/python -s ComfyUI/main.py --port 8188', '/opt/c/one', true],
    ['/opt/c/one-two/.venv/bin/python -s ComfyUI/main.py', '/opt/c/one', false],
    ['/opt/c/one/.venv/bin/python -m pip list', '/opt/c/one', false],
    ['/usr/bin/python -s /opt/c/one/ComfyUI/main.py', '/opt/c/one/', true],
    [
      '/usr/bin/python /elsewhere/main.py /opt/c/one/ComfyUI/user/comfyui.db.lock',
      '/opt/c/one',
      false
    ],
    ['/usr/bin/python -s ComfyUI/main.py --input-directory /opt/c/one/input', '/opt/c/one', false],
    [
      '"C:\\c\\one\\.venv\\Scripts\\python.exe" -s ComfyUI\\main.py --port 8188',
      'C:\\c\\one',
      true
    ],
    ['"C:\\Py\\python.exe" "C:\\c\\one\\ComfyUI\\main.py"', 'C:\\c\\one', true],
    // `ps -o args=` on macOS: nothing is quoted, and install paths can contain spaces.
    [
      '/Users/a/My ComfyUI/.venv/bin/python -s ComfyUI/main.py --port 8188',
      '/Users/a/My ComfyUI',
      true
    ],
    [
      '/usr/bin/python3 -s /Users/a/My ComfyUI (1)/ComfyUI/main.py --listen',
      '/Users/a/My ComfyUI (1)',
      true
    ],
    [
      '/usr/bin/python3 /elsewhere/main.py /Users/a/My ComfyUI/ComfyUI/user/comfyui.db.lock',
      '/Users/a/My ComfyUI',
      false
    ],
    [
      '/usr/bin/python3 -s ComfyUI/main.py --input-directory /Users/a/My ComfyUI/input',
      '/Users/a/My ComfyUI',
      false
    ],
    ['/Users/a/My ComfyUI/.venv/bin/python -m pip list', '/Users/a/My ComfyUI', false],
    // A drive-letter path is absolute: another install's main.py is not this one's relative one.
    ['C:\\c\\one\\.venv\\Scripts\\python.exe C:\\c\\two\\ComfyUI\\main.py', 'C:\\c\\one', false],
    ['C:\\c\\one\\.venv\\Scripts\\python.exe ComfyUI\\main.py', 'C:\\c\\one', true]
  ])('%s in %s → %s', (cmd, installPath, expected) => {
    expect(commandLineIsInstall(cmd, installPath)).toBe(expected)
  })
})

describe('commandLineIsInstall with an exact argv', () => {
  it('matches spaced paths exactly and ignores mentions', () => {
    const root = '/home/a/My ComfyUI'
    expect(commandLineIsInstall([`${root}/.venv/bin/python`, '-s', 'ComfyUI/main.py'], root)).toBe(
      true
    )
    expect(commandLineIsInstall(['/usr/bin/python3', `${root}/ComfyUI/main.py`], root)).toBe(true)
    expect(
      commandLineIsInstall(['/usr/bin/python3', '/x/main.py', `${root}/ComfyUI/user/a.lock`], root)
    ).toBe(false)
  })

  it('resolves a relative interpreter or main.py against the working directory', () => {
    const root = '/home/a/My ComfyUI'
    const venv = ['./ComfyUI/.venv/bin/python3', '-s', 'ComfyUI/main.py']
    expect(commandLineIsInstall(venv, root)).toBe(false)
    expect(commandLineIsInstall(venv, root, root)).toBe(true)
    expect(commandLineIsInstall(['python3', 'main.py'], root, `${root}/ComfyUI`)).toBe(true)
    // Somewhere else, the same relative command line is another ComfyUI.
    expect(commandLineIsInstall(venv, root, '/home/a/Other')).toBe(false)
    // A bare interpreter name comes from PATH, not the working directory.
    expect(commandLineIsInstall(['python3', '-c', 'x'], root, root)).toBe(false)
  })
})

describe.runIf(process.platform === 'linux')('holderIsInstall from a record', () => {
  // A helper whose command line names nothing of the install: only the record says it is ours.
  it.each([
    ['the recorded child, by start time', 'child', true],
    ['a recorded survivor, by start time', 'survivor', true],
    ['a pid a stale record names, now another process', 'stale', false]
  ])('%s', async (_name, kind, expected) => {
    const install = '/installs/recorded'
    const helper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
      stdio: 'ignore'
    })
    try {
      await vi.waitFor(async () => expect(await readStartTimes([helper.pid!])).not.toBeNull())
      const token = (await readStartTimes([helper.pid!]))!.get(helper.pid!)!
      const recorded = kind === 'stale' ? 'a-process-that-had-this-pid-before' : token
      writeRecord(
        record({
          sessionKey: 'performance-test:inst-1',
          installPath: install,
          ...(kind === 'survivor'
            ? { childPid: await deadPid(), lingering: [{ pid: helper.pid!, startTime: recorded }] }
            : { childPid: helper.pid!, childStartTime: recorded })
        })
      )
      expect(await holderIsInstall(helper.pid!, install)).toBe(expected)
    } finally {
      helper.kill('SIGKILL')
    }
  })
})

describe.runIf(process.platform === 'linux')('holderIsInstall (real process, spaced path)', () => {
  it.each([
    ['relative main.py run by the install venv interpreter', 'relative'],
    ['absolute main.py inside the install', 'absolute'],
    ['a relative interpreter, started from the install', 'relative-interpreter']
  ])('%s', async (_name, mode) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'My ComfyUI ('))
    const install = path.join(root, 'Install One')
    fs.mkdirSync(path.join(install, 'ComfyUI'), { recursive: true })
    fs.mkdirSync(path.join(install, '.venv', 'bin'), { recursive: true })
    fs.writeFileSync(path.join(install, 'ComfyUI', 'main.py'), 'setTimeout(() => {}, 60000)\n')
    const interpreter = path.join(install, '.venv', 'bin', 'python')
    fs.symlinkSync(process.execPath, interpreter)
    const child =
      mode === 'relative'
        ? spawn(interpreter, [path.join('ComfyUI', 'main.py')], { cwd: install, stdio: 'ignore' })
        : mode === 'absolute'
          ? spawn(process.execPath, [path.join(install, 'ComfyUI', 'main.py')], { stdio: 'ignore' })
          : // No `-s`: the stand-in interpreter is node, which exits on it at once.
            spawn('./.venv/bin/python', [path.join('ComfyUI', 'main.py')], {
              cwd: install,
              stdio: 'ignore'
            })
    try {
      await vi.waitFor(async () => {
        const argv = await fs.promises.readFile(`/proc/${child.pid}/cmdline`, 'utf-8')
        expect(argv).toContain('main.py')
      })
      expect(await holderIsInstall(child.pid!, install)).toBe(true)
      expect(await holderIsInstall(child.pid!, path.join(root, 'Install Two'))).toBe(false)
    } finally {
      child.kill('SIGKILL')
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('probeQueue', () => {
  let server: http.Server | null = null
  afterEach(async () => {
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()))
    server = null
  })

  async function serve(handler: http.RequestListener): Promise<number> {
    server = http.createServer(handler)
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()))
    return (server.address() as AddressInfo).port
  }

  it('answers null for a port that cannot be probed, without throwing', async () => {
    expect(await probeQueue(0)).toBeNull()
    expect(await probeQueue(70000)).toBeNull()
  })

  it('counts running and pending prompts', async () => {
    const port = await serve((req, res) => {
      expect(req.url).toBe('/queue')
      res.end(JSON.stringify({ queue_running: [[1]], queue_pending: [[2], [3]] }))
    })
    expect(await probeQueue(port)).toEqual({ running: 1, pending: 2 })
  })

  it.each([
    ['not JSON', (_q: http.IncomingMessage, res: http.ServerResponse) => res.end('<html>')],
    ['not a queue', (_q: http.IncomingMessage, res: http.ServerResponse) => res.end('{}')],
    [
      'an error status',
      (_q: http.IncomingMessage, res: http.ServerResponse) => {
        res.statusCode = 500
        res.end('{"queue_running":[],"queue_pending":[]}')
      }
    ]
  ])('answers "not a queue" for %s', async (_name, handler) => {
    expect(await probeQueue(await serve(handler))).toBe('not_queue')
  })

  it('answers null when nothing listens, and when it hangs (its own timer ends the wait)', async () => {
    // The server never responds: only the probe's own timeout can settle this.
    const port = await serve(() => {})
    expect(await probeQueue(port, 200)).toBeNull()
    server!.closeAllConnections()
    await new Promise<void>((r) => server!.close(() => r()))
    server = null
    expect(await probeQueue(port, 200)).toBeNull()
  })
})
