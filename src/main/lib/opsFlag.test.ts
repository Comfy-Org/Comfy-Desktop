import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import * as safeFile from './safe-file'

const getOpsFlagResult = vi.fn()
vi.mock('./telemetry', () => ({
  getOpsFlagResult: (...args: unknown[]) => getOpsFlagResult(...args)
}))

function lateCallback(): ((result: unknown) => void) | undefined {
  const call = getOpsFlagResult.mock.calls.at(-1)
  return call?.[3] as ((result: unknown) => void) | undefined
}

let testConfigDir = ''
vi.mock('./paths', () => ({
  configDir: () => testConfigDir
}))

import { makeOpsFlag } from './opsFlag'

function flagResult(value: unknown, payload?: unknown): unknown {
  return { kind: 'value', value, payload }
}

function unreachable(): unknown {
  return { kind: 'unreachable' }
}

function makeTestFlag() {
  return makeOpsFlag<'normal' | 'degraded' | 'disabled'>({
    key: 'test-flag',
    fallback: 'normal',
    parse: (value) =>
      value === 'degraded' || value === 'disabled' || value === 'normal' ? value : undefined
  })
}

function makePersistedFlag() {
  return makeOpsFlag<'normal' | 'degraded' | 'disabled'>({
    key: 'test-flag',
    fallback: 'normal',
    parse: (value) =>
      value === 'degraded' || value === 'disabled' || value === 'normal' ? value : undefined,
    persist: true
  })
}

const NOW = Date.UTC(2026, 9, 5)
const DAY_MS = 24 * 60 * 60 * 1000

const settle = () => new Promise((resolve) => setImmediate(resolve))

beforeEach(() => {
  getOpsFlagResult.mockReset()
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-flag-'))
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(testConfigDir, { recursive: true, force: true })
})

describe('makeOpsFlag', () => {
  it('resolves a recognised value', async () => {
    const flag = makeTestFlag()
    getOpsFlagResult.mockResolvedValue(flagResult('disabled'))
    await flag.init({ distinctId: 'anon' })
    await settle()
    expect(await flag.get()).toBe('disabled')
  })

  it.each([['garbage'], [true]])('keeps the fallback for %s', async (value) => {
    const flag = makeTestFlag()
    getOpsFlagResult.mockResolvedValue(flagResult(value))
    await flag.init({ distinctId: 'anon' })
    await settle()
    expect(await flag.get()).toBe('normal')
  })

  it('keeps the fallback when the fetch rejects', async () => {
    const flag = makeTestFlag()
    getOpsFlagResult.mockRejectedValue(new Error('network'))
    await flag.init({ distinctId: 'anon' })
    await settle()
    expect(await flag.get()).toBe('normal')
  })

  it('awaits the in-flight boot fetch rather than returning the fallback', async () => {
    const flag = makeTestFlag()
    let release: (v: unknown) => void = () => {}
    getOpsFlagResult.mockReturnValue(
      new Promise((r) => {
        release = r
      })
    )
    void flag.init({ distinctId: 'anon' })
    const pending = flag.get()
    release(flagResult('disabled'))
    expect(await pending).toBe('disabled')
  })

  it('is idempotent within a process — one fetch regardless of callers', async () => {
    const flag = makeTestFlag()
    getOpsFlagResult.mockResolvedValue(flagResult('degraded'))
    await Promise.all([flag.init({ distinctId: 'anon' }), flag.init({ distinctId: 'anon' })])
    expect(getOpsFlagResult).toHaveBeenCalledTimes(1)
  })

  it('passes the key, distinct id, and timeout through to the fetch', async () => {
    const flag = makeTestFlag()
    getOpsFlagResult.mockResolvedValue(flagResult('normal'))
    await flag.init({ distinctId: 'anon', timeoutMs: 50 })
    await settle()
    expect(getOpsFlagResult).toHaveBeenCalledWith('test-flag', 'anon', 50, undefined)
  })

  it('defaults the timeout to 2 s when neither the caller nor the flag sets one', async () => {
    const flag = makeTestFlag()
    getOpsFlagResult.mockResolvedValue(flagResult('normal'))
    await flag.init({ distinctId: 'anon' })
    await settle()
    expect(getOpsFlagResult).toHaveBeenCalledWith('test-flag', 'anon', 2000, undefined)
  })

  it('hands the matched JSON payload to parse alongside the value', async () => {
    const flag = makeOpsFlag<string[]>({
      key: 'payload-flag',
      fallback: [],
      parse: (value, payload) =>
        value === true && payload && typeof payload === 'object'
          ? ((payload as { items?: string[] }).items ?? [])
          : undefined
    })
    getOpsFlagResult.mockResolvedValue(flagResult(true, { items: ['a', 'b'] }))
    await flag.init({ distinctId: 'anon' })
    await settle()
    expect(await flag.get()).toEqual(['a', 'b'])
  })

  it('holds its own cache — two flags do not share state', async () => {
    const a = makeTestFlag()
    const b = makeTestFlag()
    getOpsFlagResult.mockResolvedValue(flagResult('disabled'))
    await a.init({ distinctId: 'anon' })
    await settle()
    expect(await a.get()).toBe('disabled')
    expect(await b.get()).toBe('normal')
  })

  it('_resetForTest clears both the cache and the in-flight fetch', async () => {
    const flag = makeTestFlag()
    getOpsFlagResult.mockResolvedValue(flagResult('disabled'))
    await flag.init({ distinctId: 'anon' })
    await settle()
    flag._resetForTest()
    expect(await flag.get()).toBe('normal')
    getOpsFlagResult.mockResolvedValue(flagResult('degraded'))
    await flag.init({ distinctId: 'anon' })
    await settle()
    expect(await flag.get()).toBe('degraded')
    expect(getOpsFlagResult).toHaveBeenCalledTimes(2)
  })
})

describe('makeOpsFlag persistence', () => {
  const OPS_FLAGS_FILE = 'ops-flags.json'

  function flagsFilePath(): string {
    return path.join(testConfigDir, OPS_FLAGS_FILE)
  }

  function writeFlagsFile(contents: string): void {
    fs.writeFileSync(flagsFilePath(), contents, 'utf-8')
  }

  function readFlagsFile(): string {
    return fs.readFileSync(flagsFilePath(), 'utf-8')
  }

  it('uses the persisted value when the fetch resolves undefined', async () => {
    writeFlagsFile(
      JSON.stringify({ 'test-flag': { value: 'disabled', payload: null, fetchedAt: NOW } })
    )
    const flag = makePersistedFlag()
    getOpsFlagResult.mockResolvedValue(unreachable())
    await flag.init({ distinctId: 'anon' })
    await settle()
    expect(await flag.get()).toBe('disabled')
  })

  it('leaves the persisted file untouched when the fetch resolves undefined', async () => {
    const stored = JSON.stringify(
      { 'test-flag': { value: 'disabled', payload: null, fetchedAt: NOW } },
      null,
      2
    )
    writeFlagsFile(stored)
    const flag = makePersistedFlag()
    getOpsFlagResult.mockResolvedValue(unreachable())
    await flag.init({ distinctId: 'anon' })
    await settle()
    expect(readFlagsFile()).toBe(stored)
  })

  it('uses the persisted value and leaves the file untouched when the fetch rejects', async () => {
    const stored = JSON.stringify({
      'test-flag': { value: 'disabled', payload: null, fetchedAt: NOW }
    })
    writeFlagsFile(stored)
    const flag = makePersistedFlag()
    getOpsFlagResult.mockRejectedValue(new Error('network'))
    await flag.init({ distinctId: 'anon' })
    await settle()
    expect(await flag.get()).toBe('disabled')
    expect(readFlagsFile()).toBe(stored)
  })

  it('overwrites the persisted entry when the fetch resolves a defined result', async () => {
    writeFlagsFile(
      JSON.stringify({ 'test-flag': { value: 'disabled', payload: null, fetchedAt: NOW } })
    )
    const flag = makePersistedFlag()
    getOpsFlagResult.mockResolvedValue(flagResult('degraded', { note: 'fresh' }))
    await flag.init({ distinctId: 'anon' })
    await settle()
    expect(await flag.get()).toBe('degraded')
    expect(JSON.parse(readFlagsFile())).toEqual({
      'test-flag': { value: 'degraded', payload: { note: 'fresh' }, fetchedAt: NOW }
    })
  })

  it('reuses a persisted payload, not just the value', async () => {
    writeFlagsFile(
      JSON.stringify({
        'payload-flag': { value: true, payload: { items: ['a', 'b'] }, fetchedAt: NOW }
      })
    )
    const flag = makeOpsFlag<string[]>({
      key: 'payload-flag',
      fallback: [],
      parse: (value, payload) =>
        value === true && payload && typeof payload === 'object'
          ? ((payload as { items?: string[] }).items ?? [])
          : undefined,
      persist: true
    })
    getOpsFlagResult.mockResolvedValue(unreachable())
    await flag.init({ distinctId: 'anon' })
    await settle()
    expect(await flag.get()).toEqual(['a', 'b'])
  })

  it('preserves unrelated keys already in the file', async () => {
    writeFlagsFile(
      JSON.stringify({
        'other-flag': { value: 'on', payload: null, fetchedAt: NOW },
        'test-flag': 'stale'
      })
    )
    const flag = makePersistedFlag()
    getOpsFlagResult.mockResolvedValue(flagResult('degraded', null))
    await flag.init({ distinctId: 'anon' })
    await settle()
    expect(JSON.parse(readFlagsFile())).toEqual({
      'other-flag': { value: 'on', payload: null, fetchedAt: NOW },
      'test-flag': { value: 'degraded', payload: null, fetchedAt: NOW }
    })
  })

  it('falls back to the static fallback when the persisted file is missing', async () => {
    const flag = makePersistedFlag()
    getOpsFlagResult.mockResolvedValue(unreachable())
    await expect(flag.init({ distinctId: 'anon' })).resolves.toBeUndefined()
    await settle()
    expect(await flag.get()).toBe('normal')
  })

  it('falls back to the static fallback when the persisted file is corrupt', async () => {
    writeFlagsFile('{ not json at all')
    const flag = makePersistedFlag()
    getOpsFlagResult.mockResolvedValue(unreachable())
    await expect(flag.init({ distinctId: 'anon' })).resolves.toBeUndefined()
    await settle()
    expect(await flag.get()).toBe('normal')
  })

  it('falls back to the static fallback when the persisted entry is unrecognised', async () => {
    writeFlagsFile(
      JSON.stringify({ 'test-flag': { value: 'garbage', payload: null, fetchedAt: NOW } })
    )
    const flag = makePersistedFlag()
    getOpsFlagResult.mockResolvedValue(unreachable())
    await flag.init({ distinctId: 'anon' })
    await settle()
    expect(await flag.get()).toBe('normal')
  })

  it('does not write the file for a non-persisted flag', async () => {
    const flag = makeTestFlag()
    getOpsFlagResult.mockResolvedValue(flagResult('degraded'))
    await flag.init({ distinctId: 'anon' })
    await settle()
    expect(await flag.get()).toBe('degraded')
    expect(fs.existsSync(flagsFilePath())).toBe(false)
  })

  it('does not read the file for a non-persisted flag', async () => {
    writeFlagsFile(
      JSON.stringify({ 'test-flag': { value: 'disabled', payload: null, fetchedAt: NOW } })
    )
    const flag = makeTestFlag()
    getOpsFlagResult.mockResolvedValue(unreachable())
    await flag.init({ distinctId: 'anon' })
    await settle()
    expect(await flag.get()).toBe('normal')
  })

  it('ignores a persisted entry for a different key', async () => {
    writeFlagsFile(
      JSON.stringify({ 'other-flag': { value: 'disabled', payload: null, fetchedAt: NOW } })
    )
    const flag = makePersistedFlag()
    getOpsFlagResult.mockResolvedValue(unreachable())
    await flag.init({ distinctId: 'anon' })
    await settle()
    expect(await flag.get()).toBe('normal')
  })

  it('survives a write failure without rejecting init or losing the fetched value', async () => {
    writeFlagsFile(
      JSON.stringify({ 'test-flag': { value: 'disabled', payload: null, fetchedAt: NOW } })
    )
    fs.mkdirSync(flagsFilePath() + '.tmp')
    const flag = makePersistedFlag()
    getOpsFlagResult.mockResolvedValue(flagResult('degraded'))
    await expect(flag.init({ distinctId: 'anon' })).resolves.toBeUndefined()
    await settle()
    expect(await flag.get()).toBe('degraded')
  })
})

describe('makeOpsFlag revocation coherence', () => {
  function flagsFilePath(): string {
    return path.join(testConfigDir, 'ops-flags.json')
  }

  function bakFilePath(): string {
    return flagsFilePath() + '.bak'
  }

  function makeGrantFlag() {
    return makeOpsFlag<'granted' | 'revoked' | 'unknown'>({
      key: 'grant-flag',
      fallback: 'unknown',
      parse: (value) => (value === true ? 'granted' : value === false ? 'revoked' : undefined),
      persist: true
    })
  }

  function grantEntry(granted: boolean): string {
    return JSON.stringify({ 'grant-flag': { value: granted, payload: null, fetchedAt: NOW } })
  }

  function parsedGrant(granted: boolean): unknown {
    return { 'grant-flag': { value: granted, payload: null, fetchedAt: NOW } }
  }

  function seedGrantedFiles(): void {
    fs.writeFileSync(flagsFilePath(), grantEntry(true), 'utf-8')
    fs.writeFileSync(bakFilePath(), grantEntry(true), 'utf-8')
  }

  async function disableGrant(): Promise<void> {
    const flag = makeGrantFlag()
    getOpsFlagResult.mockResolvedValue(flagResult(false, null))
    await flag.init({ distinctId: 'anon' })
    await settle()
  }

  async function launchOffline(): Promise<'granted' | 'revoked' | 'unknown'> {
    const flag = makeGrantFlag()
    getOpsFlagResult.mockResolvedValue(unreachable())
    await flag.init({ distinctId: 'anon' })
    await settle()
    return flag.get()
  }

  it('writes the revocation to the backup as well as the primary', async () => {
    seedGrantedFiles()

    await disableGrant()

    expect(JSON.parse(fs.readFileSync(flagsFilePath(), 'utf-8'))).toEqual(parsedGrant(false))
    expect(JSON.parse(fs.readFileSync(bakFilePath(), 'utf-8'))).toEqual(parsedGrant(false))
  })

  it('does not resurrect a revoked grant when the primary is missing on an offline launch', async () => {
    seedGrantedFiles()
    await disableGrant()

    fs.rmSync(flagsFilePath())

    expect(await launchOffline()).toBe('revoked')
  })

  it('does not resurrect a revoked grant from a backup-only read', async () => {
    seedGrantedFiles()
    await disableGrant()

    fs.rmSync(flagsFilePath())
    fs.mkdirSync(flagsFilePath())

    expect(await launchOffline()).toBe('revoked')
  })

  it('aborts the persist when the backup write fails, leaving the primary untouched', async () => {
    seedGrantedFiles()
    fs.mkdirSync(bakFilePath() + '.tmp')

    const flag = makeGrantFlag()
    getOpsFlagResult.mockResolvedValue(flagResult(false, null))
    await expect(flag.init({ distinctId: 'anon' })).resolves.toBeUndefined()
    await settle()

    expect(await flag.get()).toBe('revoked')
    expect(JSON.parse(fs.readFileSync(flagsFilePath(), 'utf-8'))).toEqual(parsedGrant(true))
  })

  it('refuses the persisted write when the primary exists but is unreadable', async () => {
    seedGrantedFiles()
    vi.spyOn(safeFile, 'readFileSafe').mockReturnValue({
      kind: 'data',
      data: grantEntry(true),
      primaryUnreadable: true
    })

    const flag = makeGrantFlag()
    getOpsFlagResult.mockResolvedValue(flagResult(false, null))
    await expect(flag.init({ distinctId: 'anon' })).resolves.toBeUndefined()
    await settle()

    expect(await flag.get()).toBe('revoked')

    expect(JSON.parse(fs.readFileSync(flagsFilePath(), 'utf-8'))).toEqual(parsedGrant(true))
    expect(JSON.parse(fs.readFileSync(bakFilePath(), 'utf-8'))).toEqual(parsedGrant(true))
  })

  it('refuses the persisted write when the primary is unreadable and no backup stands in', async () => {
    fs.writeFileSync(flagsFilePath(), grantEntry(true), 'utf-8')
    vi.spyOn(safeFile, 'readFileSafe').mockReturnValue({ kind: 'unreadable' })

    const flag = makeGrantFlag()
    getOpsFlagResult.mockResolvedValue(flagResult(false, null))
    await expect(flag.init({ distinctId: 'anon' })).resolves.toBeUndefined()
    await settle()

    expect(await flag.get()).toBe('revoked')
    expect(JSON.parse(fs.readFileSync(flagsFilePath(), 'utf-8'))).toEqual(parsedGrant(true))
    expect(fs.existsSync(bakFilePath())).toBe(false)
  })

  it('keeps the revocation in the backup when the primary write fails', async () => {
    seedGrantedFiles()
    fs.mkdirSync(flagsFilePath() + '.tmp')

    const flag = makeGrantFlag()
    getOpsFlagResult.mockResolvedValue(flagResult(false, null))
    await expect(flag.init({ distinctId: 'anon' })).resolves.toBeUndefined()
    await settle()

    expect(await flag.get()).toBe('revoked')
    expect(JSON.parse(fs.readFileSync(bakFilePath(), 'utf-8'))).toEqual(parsedGrant(false))
    expect(JSON.parse(fs.readFileSync(flagsFilePath(), 'utf-8'))).toEqual(parsedGrant(true))
  })
})

describe('makeOpsFlag late results', () => {
  function flagsFilePath(): string {
    return path.join(testConfigDir, 'ops-flags.json')
  }

  function makeGrantFlag() {
    return makeOpsFlag<'granted' | 'revoked' | 'unknown'>({
      key: 'grant-flag',
      fallback: 'unknown',
      parse: (value) => (value === true ? 'granted' : value === false ? 'revoked' : undefined),
      persist: true
    })
  }

  function seedGrant(granted: boolean): void {
    const contents = JSON.stringify({
      'grant-flag': { value: granted, payload: null, fetchedAt: NOW }
    })
    fs.writeFileSync(flagsFilePath(), contents, 'utf-8')
    fs.writeFileSync(flagsFilePath() + '.bak', contents, 'utf-8')
  }

  function storedGrant(): unknown {
    return JSON.parse(fs.readFileSync(flagsFilePath(), 'utf-8'))
  }

  async function launchLosingTheRace() {
    const flag = makeGrantFlag()
    getOpsFlagResult.mockResolvedValue(unreachable())
    await flag.init({ distinctId: 'anon' })
    await settle()
    return flag
  }

  it('persists a late explicit false so the next unreachable launch reads the revocation', async () => {
    seedGrant(true)
    const flag = await launchLosingTheRace()
    expect(await flag.get()).toBe('granted')

    lateCallback()?.(flagResult(false, null))

    expect(await flag.get()).toBe('revoked')
    expect(storedGrant()).toEqual({ 'grant-flag': { value: false, payload: null, fetchedAt: NOW } })

    const next = makeGrantFlag()
    getOpsFlagResult.mockResolvedValue(unreachable())
    await next.init({ distinctId: 'anon' })
    await settle()
    expect(await next.get()).toBe('revoked')
  })

  it('persists a late explicit true, so a grant can also arrive one launch behind', async () => {
    seedGrant(false)
    const flag = await launchLosingTheRace()
    expect(await flag.get()).toBe('revoked')

    lateCallback()?.(flagResult(true, null))

    expect(storedGrant()).toEqual({ 'grant-flag': { value: true, payload: null, fetchedAt: NOW } })
  })

  it('writes nothing when a launch is never handed a late value', async () => {
    const stored = JSON.stringify(
      { 'grant-flag': { value: true, payload: null, fetchedAt: NOW } },
      null,
      2
    )
    fs.writeFileSync(flagsFilePath(), stored, 'utf-8')
    const flag = await launchLosingTheRace()

    expect(lateCallback()).toBeTypeOf('function')
    await Promise.resolve()

    expect(fs.readFileSync(flagsFilePath(), 'utf-8')).toBe(stored)
    expect(await flag.get()).toBe('granted')
  })

  it('writes exactly once when the fetch wins the race', async () => {
    const writes = vi.spyOn(safeFile, 'writeFileSafe')
    const flag = makeGrantFlag()
    getOpsFlagResult.mockResolvedValue(flagResult(true, null))
    await flag.init({ distinctId: 'anon' })
    await settle()

    expect(writes.mock.calls.filter(([file]) => file === flagsFilePath())).toHaveLength(1)
    expect(await flag.get()).toBe('granted')
  })

  it('ignores a late result belonging to a superseded init', async () => {
    seedGrant(true)
    const flag = await launchLosingTheRace()
    const strandedCallback = lateCallback()

    flag._resetForTest()

    strandedCallback?.(flagResult(false, null))
    expect(storedGrant()).toEqual({ 'grant-flag': { value: true, payload: null, fetchedAt: NOW } })
    expect(await flag.get()).toBe('unknown')
  })

  it('keeps a late value that lands before the deadline handler runs', async () => {
    seedGrant(true)
    let answer: (result: unknown) => void = () => {}
    getOpsFlagResult.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const flag = makeGrantFlag()
    await flag.init({ distinctId: 'anon' })
    lateCallback()?.(flagResult(false, null))
    answer(unreachable())
    await settle()
    expect(await flag.get()).toBe('revoked')
  })

  it('ignores a late value parse does not recognise', async () => {
    seedGrant(true)
    const flag = await launchLosingTheRace()
    lateCallback()?.(flagResult('garbage', null))
    expect(await flag.get()).toBe('granted')
  })

  it('swallows and logs a failed late write', async () => {
    seedGrant(true)
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {})
    const flag = makeOpsFlag<'granted' | 'revoked' | 'unknown'>({
      key: 'grant-flag',
      fallback: 'unknown',
      parse: (value) => (value === true ? 'granted' : value === false ? 'revoked' : undefined),
      logLabel: 'grant',
      persist: true
    })
    getOpsFlagResult.mockResolvedValue(unreachable())
    await flag.init({ distinctId: 'anon' })
    await settle()
    fs.mkdirSync(flagsFilePath() + '.bak.tmp')

    expect(() => lateCallback()?.(flagResult(false, null))).not.toThrow()
    expect(logs.mock.calls.some(([msg]) => msg === '[grant] late persist error:')).toBe(true)
    expect(logs).toHaveBeenCalledWith('[grant] late: fetched=', false)
    expect(await flag.get()).toBe('revoked')
  })

  it('hands a non-persisting flag no late callback at all', async () => {
    const flag = makeTestFlag()
    getOpsFlagResult.mockResolvedValue(unreachable())
    await flag.init({ distinctId: 'anon' })
    await settle()

    expect(lateCallback()).toBeUndefined()
    expect(fs.existsSync(flagsFilePath())).toBe(false)
  })
})

describe('makeOpsFlag stale-while-revalidate', () => {
  function flagsFilePath(): string {
    return path.join(testConfigDir, 'ops-flags.json')
  }

  function seedGrant(entry: Record<string, unknown>): void {
    fs.writeFileSync(flagsFilePath(), JSON.stringify({ 'grant-flag': entry }), 'utf-8')
  }

  function storedGrant(): unknown {
    return JSON.parse(fs.readFileSync(flagsFilePath(), 'utf-8'))
  }

  function makeGrantFlag() {
    return makeOpsFlag<'granted' | 'revoked' | undefined>({
      key: 'grant-flag',
      fallback: undefined,
      parse: (value) => (value === true ? 'granted' : value === false ? 'revoked' : undefined),
      timeoutMs: 5000,
      persist: true
    })
  }

  function pendingFetch(): { answer: (result: unknown) => void } {
    let answer: (result: unknown) => void = () => {}
    getOpsFlagResult.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve
      })
    )
    return { answer: (result) => answer(result) }
  }

  it('answers from a saved treatment without waiting for the fetch', async () => {
    seedGrant({ value: true, payload: null, fetchedAt: NOW })
    pendingFetch()
    const flag = makeGrantFlag()
    await flag.init({ distinctId: 'anon' })
    expect(await flag.get()).toBe('granted')
    expect(getOpsFlagResult).toHaveBeenCalledWith('grant-flag', 'anon', 5000, expect.any(Function))
  })

  it.each([
    ['written before entries were stamped', { value: true, payload: null }],
    ['fetched a month ago', { value: true, payload: null, fetchedAt: NOW - 30 * DAY_MS }]
  ])('answers from a treatment %s', async (_, entry) => {
    seedGrant(entry)
    pendingFetch()
    const flag = makeGrantFlag()
    await flag.init({ distinctId: 'anon' })
    expect(await flag.get()).toBe('granted')
  })

  it('applies a refreshed value for later reads and persists it, stamped', async () => {
    seedGrant({ value: true, payload: null, fetchedAt: NOW - DAY_MS })
    const fetch = pendingFetch()
    const flag = makeGrantFlag()
    await flag.init({ distinctId: 'anon' })
    const atLaunch = await flag.get()

    fetch.answer(flagResult(false, null))
    await settle()

    expect(atLaunch).toBe('granted')
    expect(await flag.get()).toBe('revoked')
    expect(storedGrant()).toEqual({ 'grant-flag': { value: false, payload: null, fetchedAt: NOW } })
  })

  it('keeps the saved treatment and writes nothing when the refresh is unreachable', async () => {
    const stored = JSON.stringify({ 'grant-flag': { value: true, payload: null } }, null, 2)
    fs.writeFileSync(flagsFilePath(), stored, 'utf-8')
    const fetch = pendingFetch()
    const flag = makeGrantFlag()
    await flag.init({ distinctId: 'anon' })

    fetch.answer(unreachable())
    await settle()

    expect(await flag.get()).toBe('granted')
    expect(fs.readFileSync(flagsFilePath(), 'utf-8')).toBe(stored)
  })

  it('ignores a refresh that settles after the flag was reset', async () => {
    seedGrant({ value: true, payload: null, fetchedAt: NOW })
    const fetch = pendingFetch()
    const flag = makeGrantFlag()
    await flag.init({ distinctId: 'anon' })
    flag._resetForTest()

    fetch.answer(flagResult(false, null))
    await settle()

    expect(await flag.get()).toBeUndefined()
    expect(storedGrant()).toEqual({ 'grant-flag': { value: true, payload: null, fetchedAt: NOW } })
  })

  it('waits on the flag deadline when nothing is saved', async () => {
    const fetch = pendingFetch()
    const flag = makeGrantFlag()
    void flag.init({ distinctId: 'anon' })
    let read: unknown = 'pending'
    void flag.get().then((value) => (read = value))
    await settle()
    expect(read).toBe('pending')
    expect(getOpsFlagResult).toHaveBeenCalledWith('grant-flag', 'anon', 5000, expect.any(Function))

    fetch.answer(flagResult(true, null))
    await settle()
    expect(read).toBe('granted')
  })

  it('waits on the deadline when the saved entry is not one parse recognises', async () => {
    seedGrant({ value: 'garbage', payload: null, fetchedAt: NOW })
    const fetch = pendingFetch()
    const flag = makeGrantFlag()
    void flag.init({ distinctId: 'anon' })
    let read: unknown = 'pending'
    void flag.get().then((value) => (read = value))
    await settle()
    expect(read).toBe('pending')
    expect(getOpsFlagResult).toHaveBeenCalledWith('grant-flag', 'anon', 5000, expect.any(Function))

    fetch.answer(flagResult(true, null))
    await settle()
    expect(read).toBe('granted')
  })

  it.each([
    ['nothing saved', undefined],
    ['a saved treatment', { value: true, payload: null, fetchedAt: NOW }]
  ])('passes an explicit init timeout through unchanged with %s', async (_, entry) => {
    if (entry) seedGrant(entry)
    getOpsFlagResult.mockResolvedValue(unreachable())
    await makeGrantFlag().init({ distinctId: 'anon', timeoutMs: 50 })
    await settle()
    expect(getOpsFlagResult).toHaveBeenCalledWith('grant-flag', 'anon', 50, expect.any(Function))
  })

  it.each([
    ['answers unreachable', () => getOpsFlagResult.mockResolvedValue(unreachable())],
    ['rejects', () => getOpsFlagResult.mockRejectedValue(new Error('network'))]
  ])('holds a saved treatment that parses to null when the fetch %s', async (_, stage) => {
    seedGrant({ value: false, payload: null, fetchedAt: NOW })
    const flag = makeOpsFlag<'granted' | null | undefined>({
      key: 'grant-flag',
      fallback: undefined,
      parse: (value) => (value === true ? 'granted' : value === false ? null : undefined),
      persist: true
    })
    stage()
    await flag.init({ distinctId: 'anon' })
    await settle()
    expect(await flag.get()).toBeNull()
  })

  it('answers from a saved treatment that parses to null before the fetch settles', async () => {
    seedGrant({ value: false, payload: null, fetchedAt: NOW })
    pendingFetch()
    const flag = makeOpsFlag<'granted' | null | undefined>({
      key: 'grant-flag',
      fallback: undefined,
      parse: (value) => (value === true ? 'granted' : value === false ? null : undefined),
      persist: true
    })
    await flag.init({ distinctId: 'anon' })
    expect(await flag.get()).toBeNull()
  })
})

describe('makeOpsFlag refresh', () => {
  const stored = () =>
    JSON.parse(fs.readFileSync(path.join(testConfigDir, 'ops-flags.json'), 'utf-8'))['test-flag']

  it('does nothing before init', async () => {
    const flag = makePersistedFlag()
    await flag.refresh()
    expect(getOpsFlagResult).not.toHaveBeenCalled()
  })

  it('re-fetches under the boot id and applies and persists the new answer', async () => {
    const flag = makePersistedFlag()
    getOpsFlagResult.mockResolvedValueOnce(flagResult('normal'))
    await flag.init({ distinctId: 'boot-id', timeoutMs: 1234 })
    getOpsFlagResult.mockResolvedValueOnce(flagResult('disabled'))

    await flag.refresh()

    expect(getOpsFlagResult.mock.calls[1]?.slice(0, 3)).toEqual(['test-flag', 'boot-id', 1234])
    expect(await flag.get()).toBe('disabled')
    expect(stored()).toMatchObject({ value: 'disabled' })
  })

  it('keeps the current answer, and the file, when the refresh is unreachable', async () => {
    const flag = makePersistedFlag()
    getOpsFlagResult.mockResolvedValueOnce(flagResult('degraded'))
    await flag.init({ distinctId: 'id' })
    const before = stored()
    getOpsFlagResult.mockResolvedValueOnce(unreachable())

    await flag.refresh()

    expect(await flag.get()).toBe('degraded')
    expect(stored()).toEqual(before)
  })

  it('keeps the answer even for a flag whose parse fails closed on no value', async () => {
    const flag = makeOpsFlag<string[]>({
      key: 'test-flag',
      fallback: [],
      parse: (value, payload) => (value === true && Array.isArray(payload) ? payload : []),
      persist: true
    })
    getOpsFlagResult.mockResolvedValueOnce(flagResult(true, ['--enable-x']))
    await flag.init({ distinctId: 'id' })
    getOpsFlagResult.mockResolvedValueOnce(unreachable())

    await flag.refresh()

    expect(await flag.get(), 'an offline refresh must not parse "no answer" into a cut').toEqual([
      '--enable-x'
    ])
  })

  it('drops an older answer even when the refresh that superseded it is unreachable', async () => {
    const flag = makePersistedFlag()
    getOpsFlagResult.mockResolvedValueOnce(flagResult('normal'))
    await flag.init({ distinctId: 'id' })
    let staffAnswer!: (v: unknown) => void
    getOpsFlagResult.mockReturnValueOnce(new Promise((resolve) => (staffAnswer = resolve)))
    void flag.refresh()
    const staffLate = lateCallback()!
    getOpsFlagResult.mockResolvedValueOnce(unreachable())
    await flag.refresh()

    staffAnswer(flagResult('disabled'))
    staffLate(flagResult('disabled'))
    await settle()

    const why = 'a staff answer arriving after a failed sign-out refresh is stale'
    expect(await flag.get(), why).toBe('normal')
    expect(stored(), why).toMatchObject({ value: 'normal' })
  })

  it("applies and persists the refresh's own late answer", async () => {
    const flag = makePersistedFlag()
    getOpsFlagResult.mockResolvedValueOnce(flagResult('normal'))
    await flag.init({ distinctId: 'id' })
    getOpsFlagResult.mockResolvedValueOnce(unreachable())
    await flag.refresh()

    lateCallback()!(flagResult('disabled'))

    expect(await flag.get()).toBe('disabled')
    expect(stored()).toMatchObject({ value: 'disabled' })
  })

  it('makes get() wait for an in-flight refresh rather than answer the boot value', async () => {
    const flag = makePersistedFlag()
    getOpsFlagResult.mockResolvedValueOnce(flagResult('normal'))
    await flag.init({ distinctId: 'id' })
    let answer!: (v: unknown) => void
    getOpsFlagResult.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))

    void flag.refresh()
    const read = flag.get()
    await settle()
    answer(flagResult('disabled'))

    expect(await read).toBe('disabled')
  })

  it('makes a waiting get() follow a refresh that supersedes the one it awaited', async () => {
    const flag = makePersistedFlag()
    getOpsFlagResult.mockResolvedValueOnce(flagResult('normal'))
    await flag.init({ distinctId: 'id' })
    let answerFirst!: (v: unknown) => void
    let answerSecond!: (v: unknown) => void
    getOpsFlagResult.mockReturnValueOnce(new Promise((resolve) => (answerFirst = resolve)))
    getOpsFlagResult.mockReturnValueOnce(new Promise((resolve) => (answerSecond = resolve)))

    void flag.refresh()
    const read = flag.get()
    await settle()
    void flag.refresh()
    answerFirst(flagResult('degraded'))
    await settle()
    answerSecond(flagResult('disabled'))

    expect(await read, 'the first answer was superseded, not the boot one restored').toBe(
      'disabled'
    )
  })

  it('does not let a slower boot answer land over the refresh', async () => {
    const flag = makePersistedFlag()
    let bootAnswer!: (v: unknown) => void
    getOpsFlagResult.mockReturnValueOnce(new Promise((resolve) => (bootAnswer = resolve)))
    void flag.init({ distinctId: 'id' })
    const bootLate = lateCallback()!
    getOpsFlagResult.mockResolvedValueOnce(flagResult('disabled'))
    await flag.refresh()

    bootAnswer(flagResult('normal'))
    bootLate(flagResult('normal'))
    await settle()

    const why = 'the boot fetch went out without the refreshed property, so its answer is stale'
    expect(await flag.get(), why).toBe('disabled')
    expect(stored(), why).toMatchObject({ value: 'disabled' })
  })
})
