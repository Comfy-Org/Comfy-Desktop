// @vitest-environment node
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ProcessIdentity from './processIdentity'
import type * as ProcessModule from './process'
import type * as ComfyProcessRecord from './comfyProcessRecord'

/** The record path on Windows: the start time is read with Get-Process (faked here), never CIM. */
const fake = vi.hoisted(() => ({
  /** pid -> start token Get-Process reads now. */
  starts: new Map<number, string>(),
  kills: [] as number[],
  killOk: true,
  /** What the stop did, in order: the safety check, then the proof (start-time read). */
  steps: [] as string[],
  dead: new Set<number>(),
  safe: true,
  /** Runs after each start-time read (to change what the next one answers). */
  afterProof: null as null | (() => void),
  records: [] as Array<{
    installationId: string
    childPid: number
    desktopPid: number
    installPath: string
  }>
}))
vi.mock('./process', async (importOriginal) => ({
  ...(await importOriginal<typeof ProcessModule>()),
  killPid: async (pid: number) => {
    fake.kills.push(pid)
    return fake.killOk
  },
  isSafeToSignal: async () => {
    fake.steps.push('safety')
    return fake.safe
  }
}))
vi.mock('./comfyProcessRecord', async (importOriginal) => ({
  ...(await importOriginal<typeof ComfyProcessRecord>()),
  listRecords: () => fake.records
}))
vi.mock('./processIdentity', async (importOriginal) => ({
  ...(await importOriginal<typeof ProcessIdentity>()),
  holderStartToken: async (pid: number) => {
    fake.steps.push('proof')
    const token = fake.starts.get(pid) ?? null
    fake.afterProof?.()
    return token
  },
  isPidAlive: (pid: number) => !fake.dead.has(pid)
}))

import { asDbLockOffer, findDbLockOffer, stopDbLockOffer } from './comfyDbLock'
import type { DbLockOffer } from '../../types/ipc'

const realPlatform = process.platform
const INSTALL = 'C:\\c\\one'
const STARTED = '134358000923463901'
let dir: string
let db: string
const write = (record: Record<string, unknown>): void =>
  fs.writeFileSync(`${db}.lock.json`, JSON.stringify(record))
const record = (main = `${INSTALL}\\ComfyUI\\main.py`): Record<string, unknown> => ({
  version: 1,
  pid: 9084,
  started: STARTED,
  db,
  main,
  argv: [main, '--enable-assets'],
  port: 8188,
  listen: '127.0.0.1'
})
const find = (): ReturnType<typeof findDbLockOffer> =>
  findDbLockOffer({ installationId: 'inst-1', installPath: INSTALL, dbPath: db })

beforeAll(() => {
  Object.defineProperty(process, 'platform', { value: 'win32' })
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-holder-win32-'))
  db = path.join(dir, 'comfyui.db')
})
afterAll(() => {
  Object.defineProperty(process, 'platform', { value: realPlatform })
  fs.rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => {
  fs.rmSync(`${db}.lock.json`, { force: true })
  fake.starts = new Map([[9084, STARTED]])
  fake.kills = []
  fake.killOk = true
  fake.steps = []
  fake.safe = true
  fake.afterProof = null
  fake.dead = new Set()
  fake.records = []
})

describe('findDbLockOffer on Windows', () => {
  it("offers this install's ComfyUI named by its record (Windows paths, any case)", async () => {
    write(record('c:\\C\\ONE\\ComfyUI\\main.py'))
    expect(await find()).toEqual({
      pid: 9084,
      startTime: STARTED,
      process: 'ComfyUI',
      sameInstall: true
    })
  })

  it('names one of another install, or a sibling sharing the prefix, by its main.py', async () => {
    write(record('C:\\c\\one-two\\ComfyUI\\main.py'))
    expect(await find()).toMatchObject({
      process: 'C:\\c\\one-two\\ComfyUI\\main.py',
      sameInstall: false
    })
  })

  it('offers nothing without a live record: none, a crash leftover, a reused pid', async () => {
    expect(await find()).toBeNull()
    write(record())
    fake.starts = new Map()
    expect(await find()).toBeNull()
    fake.starts = new Map([[9084, '134358999999999999']])
    expect(await find()).toBeNull()
    write({ ...record(), started: undefined })
    expect(await find()).toBeNull()
    // A record that is live but does not say which main.py it runs.
    fake.starts = new Map([[9084, STARTED]])
    write({ ...record(), main: undefined })
    expect(await find()).toBeNull()
  })

  it('offers nothing for a ComfyUI this Desktop is running, but does for an orphan', async () => {
    write(record())
    fake.records = [
      { installationId: 'inst-1', childPid: 7000, desktopPid: process.pid, installPath: INSTALL }
    ]
    expect(await find()).toBeNull()
    // A crashed Desktop's record, and one whose child is gone, hide nothing.
    fake.records = [
      { installationId: 'inst-1', childPid: 7000, desktopPid: 999_999, installPath: INSTALL },
      { installationId: 'inst-1', childPid: 7001, desktopPid: process.pid, installPath: INSTALL }
    ]
    fake.dead.add(7001)
    expect(await find()).toMatchObject({ pid: 9084 })
  })
})

describe('findDbLockOffer: a record is about its own database', () => {
  it('ignores a live record about another database (copied along with an install)', async () => {
    write({ ...record(), db: 'C:\\c\\source\\ComfyUI\\user\\comfyui.db' })
    expect(await find()).toBeNull()
    write({ ...record(), db: undefined })
    expect(await find()).toBeNull()
  })

  it("is not hidden by this Desktop's session of another install; is by a venv-launched one of this install", async () => {
    write(record())
    fake.records = [
      {
        installationId: 'inst-2',
        childPid: 7000,
        desktopPid: process.pid,
        installPath: 'C:\\c\\other'
      }
    ]
    expect(await find()).toMatchObject({ pid: 9084 })
    // This install's session: its child is the venv launcher (7001), the record names the
    // interpreter that launcher runs (9084). Still Desktop's own: no offer.
    fake.records = [
      { installationId: 'inst-1', childPid: 7001, desktopPid: process.pid, installPath: INSTALL }
    ]
    expect(await find()).toBeNull()
  })

  it('offers nothing for a ComfyUI this Desktop runs as this install, wherever its record says it is', async () => {
    // The install was moved or is reached another way: only its id ties the session to it.
    write(record('D:\\moved\\ComfyUI\\main.py'))
    fake.records = [
      {
        installationId: 'inst-1',
        childPid: 7001,
        desktopPid: process.pid,
        installPath: 'D:\\other'
      }
    ]
    expect(await find()).toBeNull()
  })

  it('offers nothing for a ComfyUI this Desktop runs as another install sharing the database', async () => {
    write(record('C:\\c\\two\\ComfyUI\\main.py'))
    fake.records = [
      {
        installationId: 'inst-2',
        childPid: 7000,
        desktopPid: process.pid,
        installPath: 'C:\\c\\two'
      }
    ]
    expect(await find()).toBeNull()
  })
})

describe('stopDbLockOffer on Windows', () => {
  // Built per test: `db` exists only once beforeAll has run.
  let offer: DbLockOffer
  beforeEach(() => {
    offer = {
      pid: 9084,
      startTime: STARTED,
      process: 'ComfyUI',
      sameInstall: true
    }
  })

  it('stops the confirmed ComfyUI once its record still names it, pid and start time', async () => {
    write(record())
    expect(await stopDbLockOffer(offer, db)).toBe(true)
    expect(fake.kills).toEqual([9084])
    // Nothing slow (the first safety probe) sits between the final proof and the signal.
    expect(fake.steps).toEqual(['proof', 'safety', 'proof'])
  })

  it('stops nothing while it runs but its record now names another process, or none', async () => {
    write({ ...record(), pid: 4242 })
    fake.starts.set(4242, STARTED)
    expect(await stopDbLockOffer(offer, db)).toBe(false)
    fs.rmSync(`${db}.lock.json`)
    expect(await stopDbLockOffer(offer, db)).toBe(false)
    expect(fake.kills).toEqual([])
  })

  it('kills nothing when the pid is reused between the first look and the final proof', async () => {
    const NEW = '134358999999999999'
    // The newcomer at the same pid wrote its own, live record.
    write({ ...record(), started: NEW })
    fake.afterProof = () => fake.starts.set(9084, NEW)
    expect(await stopDbLockOffer(offer, db)).toBe(false)
    expect(fake.kills).toEqual([])
  })

  it('has nothing to stop once the confirmed ComfyUI exited, even if its pid was reused', async () => {
    write(record())
    fake.starts.set(9084, '134358999999999999')
    expect(await stopDbLockOffer(offer, db)).toBe(true)
    // The pid's new owner wrote its own, live record: still not the process the user confirmed.
    write({ ...record(), started: '134358999999999999' })
    expect(await stopDbLockOffer(offer, db)).toBe(true)
    fake.starts.delete(9084)
    fake.dead.add(9084)
    expect(await stopDbLockOffer(offer, db)).toBe(true)
    expect(fake.kills).toEqual([])
  })

  it('does not take a start time it could not read, for a pid still alive, as an exit', async () => {
    write(record())
    // Get-Process failed or timed out: the record can't be re-proven either, so nothing stops.
    fake.starts.delete(9084)
    expect(await stopDbLockOffer(offer, db)).toBe(false)
    expect(fake.kills).toEqual([])
  })

  it("stops nothing the safety check refuses (Desktop's own pid, the System process)", async () => {
    write(record())
    fake.safe = false
    expect(await stopDbLockOffer(offer, db)).toBe(false)
    expect(fake.kills).toEqual([])
  })

  it('stops nothing for a record that is not an object', async () => {
    fs.writeFileSync(`${db}.lock.json`, 'null')
    expect(await stopDbLockOffer(offer, db)).toBe(false)
    expect(fake.kills).toEqual([])
  })

  it('stops nothing after a cancel, and says a kill that failed did', async () => {
    write(record())
    const cancelled = new AbortController()
    cancelled.abort()
    expect(await stopDbLockOffer(offer, db, cancelled.signal)).toBe(false)
    expect(fake.kills).toEqual([])
    fake.killOk = false
    expect(await stopDbLockOffer(offer, db)).toBe(false)
  })
})

describe('asDbLockOffer', () => {
  it('accepts only an offer with a pid and a start time', () => {
    const offer = {
      pid: 9084,
      startTime: STARTED,
      process: 'ComfyUI',
      sameInstall: true
    }
    expect(asDbLockOffer(offer)).toBe(offer)
    const bad = [null, undefined, 'x', { ...offer, pid: '9084' }, { ...offer, startTime: 1 }]
    for (const value of bad) {
      expect(asDbLockOffer(value)).toBeNull()
    }
  })
})
