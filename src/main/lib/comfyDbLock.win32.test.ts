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
    return fake.starts.get(pid) ?? null
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
  fake.dead = new Set()
  fake.records = []
})

describe('findDbLockOffer on Windows', () => {
  it("offers this install's ComfyUI named by its record (Windows paths, any case)", async () => {
    write(record('c:\\C\\ONE\\ComfyUI\\main.py'))
    expect(await find()).toEqual({
      pid: 9084,
      startTime: STARTED,
      dbPath: db,
      process: 'ComfyUI',
      sameInstall: true,
      installationId: 'inst-1'
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
      dbPath: db,
      process: 'ComfyUI',
      sameInstall: true,
      installationId: 'inst-1'
    }
  })

  it('stops the confirmed ComfyUI once its record still names it, pid and start time', async () => {
    write(record())
    expect(await stopDbLockOffer(offer)).toBe(true)
    expect(fake.kills).toEqual([9084])
    // Nothing slow (the first safety probe) sits between the proof and the signal.
    expect(fake.steps).toEqual(['safety', 'proof'])
  })

  it('stops nothing when the record now names another process, or none', async () => {
    write({ ...record(), pid: 4242 })
    fake.starts.set(4242, STARTED)
    expect(await stopDbLockOffer(offer)).toBe(false)
    write(record())
    fake.starts.set(9084, '134358999999999999')
    expect(await stopDbLockOffer(offer)).toBe(false)
    // The pid was reused by a new ComfyUI that wrote its own, live record.
    write({ ...record(), started: '134358999999999999' })
    expect(await stopDbLockOffer(offer)).toBe(false)
    fs.rmSync(`${db}.lock.json`)
    expect(await stopDbLockOffer(offer)).toBe(false)
    expect(fake.kills).toEqual([])
  })

  it("stops nothing the safety check refuses (Desktop's own pid, the System process)", async () => {
    write(record())
    fake.safe = false
    expect(await stopDbLockOffer(offer)).toBe(false)
    expect(fake.kills).toEqual([])
  })

  it('stops nothing for a record that is not an object', async () => {
    fs.writeFileSync(`${db}.lock.json`, 'null')
    expect(await stopDbLockOffer(offer)).toBe(false)
    expect(fake.kills).toEqual([])
  })

  it('stops nothing after a cancel, and says a kill that failed did', async () => {
    write(record())
    const cancelled = new AbortController()
    cancelled.abort()
    expect(await stopDbLockOffer(offer, cancelled.signal)).toBe(false)
    expect(fake.kills).toEqual([])
    fake.killOk = false
    expect(await stopDbLockOffer(offer)).toBe(false)
  })
})

describe('asDbLockOffer', () => {
  it('accepts only an offer with a pid, a start time and a database', () => {
    const offer = {
      pid: 9084,
      startTime: STARTED,
      dbPath: 'C:\\x.db',
      process: 'ComfyUI',
      sameInstall: true
    }
    expect(asDbLockOffer(offer)).toBe(offer)
    const bad = [null, undefined, 'x', { ...offer, pid: '9084' }, { ...offer, startTime: 1 }]
    for (const value of [...bad, { ...offer, dbPath: undefined }]) {
      expect(asDbLockOffer(value)).toBeNull()
    }
  })
})
