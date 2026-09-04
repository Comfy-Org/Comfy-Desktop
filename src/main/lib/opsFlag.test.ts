// The plumbing every ops flag shares: one in-flight fetch, an accessor that awaits it rather
// than racing it to the default, and a fallback that survives both a rejection and a payload
// `parse` doesn't recognise. Per-flag key/fail-direction/parsing is covered by that flag's own
// spec (see `cloudFreeRuns.test.ts`).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const getOpsFlagResult = vi.fn()
vi.mock('./telemetry', () => ({
  getOpsFlagResult: (...args: unknown[]) => getOpsFlagResult(...args)
}))

// `configDir()` reads XDG_CONFIG_HOME on Linux and electron's userData elsewhere; mocking the
// module directly is how `experiments.test.ts` pins the persisted cache to a temp dir.
let testConfigDir = ''
vi.mock('./paths', () => ({
  configDir: () => testConfigDir
}))

import { makeOpsFlag } from './opsFlag'

function flagResult(value: unknown, payload?: unknown): unknown {
  return value === undefined ? undefined : { value, payload }
}

/** A three-value flag, so "unrecognised payload" is distinguishable from "valid value". */
function makeTestFlag() {
  return makeOpsFlag<'normal' | 'degraded' | 'disabled'>({
    key: 'test-flag',
    fallback: 'normal',
    parse: (value) =>
      value === 'degraded' || value === 'disabled' || value === 'normal' ? value : undefined
  })
}

beforeEach(() => {
  getOpsFlagResult.mockReset()
  // Every test, not just the persistence ones: an empty `configDir()` would resolve
  // `ops-flags.json` relative to cwd and drop a file in the repo root.
  testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-flag-'))
})

afterEach(() => {
  fs.rmSync(testConfigDir, { recursive: true, force: true })
})

describe('makeOpsFlag', () => {
  it('resolves a recognised value', async () => {
    const flag = makeTestFlag()
    getOpsFlagResult.mockResolvedValue(flagResult('disabled'))
    await flag.init({ distinctId: 'anon' })
    expect(await flag.get()).toBe('disabled')
  })

  it.each([['garbage'], [true], [undefined]])('keeps the fallback for %s', async (value) => {
    // `parse` returning undefined is how an unrecognised payload is told apart from a
    // legitimate value — it must not overwrite the fail direction.
    const flag = makeTestFlag()
    getOpsFlagResult.mockResolvedValue(flagResult(value))
    await flag.init({ distinctId: 'anon' })
    expect(await flag.get()).toBe('normal')
  })

  it('keeps the fallback when the fetch rejects', async () => {
    const flag = makeTestFlag()
    getOpsFlagResult.mockRejectedValue(new Error('network'))
    await flag.init({ distinctId: 'anon' })
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
    expect(getOpsFlagResult).toHaveBeenCalledWith('test-flag', 'anon', 50)
  })

  it('defaults the timeout when the caller omits one', async () => {
    const flag = makeTestFlag()
    getOpsFlagResult.mockResolvedValue(flagResult('normal'))
    await flag.init({ distinctId: 'anon' })
    expect(getOpsFlagResult).toHaveBeenCalledWith('test-flag', 'anon', expect.any(Number))
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
    expect(await flag.get()).toEqual(['a', 'b'])
  })

  it('holds its own cache — two flags do not share state', async () => {
    const a = makeTestFlag()
    const b = makeTestFlag()
    getOpsFlagResult.mockResolvedValue(flagResult('disabled'))
    await a.init({ distinctId: 'anon' })
    expect(await a.get()).toBe('disabled')
    // `b` was never inited, so it has no fetch to await and reports its own fallback.
    expect(await b.get()).toBe('normal')
  })

  it('_resetForTest clears both the cache and the in-flight fetch', async () => {
    const flag = makeTestFlag()
    getOpsFlagResult.mockResolvedValue(flagResult('disabled'))
    await flag.init({ distinctId: 'anon' })
    flag._resetForTest()
    expect(await flag.get()).toBe('normal')
    // A fresh init must actually re-fetch rather than short-circuit on the old promise.
    getOpsFlagResult.mockResolvedValue(flagResult('degraded'))
    await flag.init({ distinctId: 'anon' })
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

  function makePersistedFlag() {
    return makeOpsFlag<'normal' | 'degraded' | 'disabled'>({
      key: 'test-flag',
      fallback: 'normal',
      parse: (value) =>
        value === 'degraded' || value === 'disabled' || value === 'normal' ? value : undefined,
      persist: true
    })
  }

  it('uses the persisted value when the fetch resolves undefined', async () => {
    // Given a treatment persisted by an earlier online launch
    writeFlagsFile(JSON.stringify({ 'test-flag': { value: 'disabled', payload: null } }))
    const flag = makePersistedFlag()
    // When the boot fetch times out — `getOpsFlagResult` catches and RESOLVES undefined
    getOpsFlagResult.mockResolvedValue(undefined)
    await flag.init({ distinctId: 'anon' })
    // Then the offline launch keeps the treatment instead of dropping to the fail direction
    expect(await flag.get()).toBe('disabled')
  })

  it('leaves the persisted file untouched when the fetch resolves undefined', async () => {
    // Indented on purpose: a byte comparison against canonical `JSON.stringify` output cannot
    // tell "never written" from "rewritten identically", and rewriting is the bug under test.
    const stored = JSON.stringify({ 'test-flag': { value: 'disabled', payload: null } }, null, 2)
    writeFlagsFile(stored)
    const flag = makePersistedFlag()
    getOpsFlagResult.mockResolvedValue(undefined)
    await flag.init({ distinctId: 'anon' })
    expect(readFlagsFile()).toBe(stored)
  })

  it('uses the persisted value and leaves the file untouched when the fetch rejects', async () => {
    const stored = JSON.stringify({ 'test-flag': { value: 'disabled', payload: null } })
    writeFlagsFile(stored)
    const flag = makePersistedFlag()
    getOpsFlagResult.mockRejectedValue(new Error('network'))
    await flag.init({ distinctId: 'anon' })
    expect(await flag.get()).toBe('disabled')
    expect(readFlagsFile()).toBe(stored)
  })

  it('overwrites the persisted entry when the fetch resolves a defined result', async () => {
    writeFlagsFile(JSON.stringify({ 'test-flag': { value: 'disabled', payload: null } }))
    const flag = makePersistedFlag()
    getOpsFlagResult.mockResolvedValue(flagResult('degraded', { note: 'fresh' }))
    await flag.init({ distinctId: 'anon' })
    expect(await flag.get()).toBe('degraded')
    expect(JSON.parse(readFlagsFile())).toEqual({
      'test-flag': { value: 'degraded', payload: { note: 'fresh' } }
    })
  })

  it('reuses a persisted payload, not just the value', async () => {
    writeFlagsFile(
      JSON.stringify({ 'payload-flag': { value: true, payload: { items: ['a', 'b'] } } })
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
    getOpsFlagResult.mockResolvedValue(undefined)
    await flag.init({ distinctId: 'anon' })
    expect(await flag.get()).toEqual(['a', 'b'])
  })

  it('preserves unrelated keys already in the file', async () => {
    writeFlagsFile(
      JSON.stringify({ 'other-flag': { value: 'on', payload: null }, 'test-flag': 'stale' })
    )
    const flag = makePersistedFlag()
    getOpsFlagResult.mockResolvedValue(flagResult('degraded', null))
    await flag.init({ distinctId: 'anon' })
    expect(JSON.parse(readFlagsFile())).toEqual({
      'other-flag': { value: 'on', payload: null },
      'test-flag': { value: 'degraded', payload: null }
    })
  })

  it('falls back to the static fallback when the persisted file is missing', async () => {
    const flag = makePersistedFlag()
    getOpsFlagResult.mockResolvedValue(undefined)
    await expect(flag.init({ distinctId: 'anon' })).resolves.toBeUndefined()
    expect(await flag.get()).toBe('normal')
  })

  it('falls back to the static fallback when the persisted file is corrupt', async () => {
    writeFlagsFile('{ not json at all')
    const flag = makePersistedFlag()
    getOpsFlagResult.mockResolvedValue(undefined)
    await expect(flag.init({ distinctId: 'anon' })).resolves.toBeUndefined()
    expect(await flag.get()).toBe('normal')
  })

  it('falls back to the static fallback when the persisted entry is unrecognised', async () => {
    writeFlagsFile(JSON.stringify({ 'test-flag': { value: 'garbage', payload: null } }))
    const flag = makePersistedFlag()
    getOpsFlagResult.mockResolvedValue(undefined)
    await flag.init({ distinctId: 'anon' })
    expect(await flag.get()).toBe('normal')
  })

  it('does not write the file for a non-persisted flag', async () => {
    const flag = makeTestFlag()
    getOpsFlagResult.mockResolvedValue(flagResult('degraded'))
    await flag.init({ distinctId: 'anon' })
    expect(await flag.get()).toBe('degraded')
    expect(fs.existsSync(flagsFilePath())).toBe(false)
  })

  it('does not read the file for a non-persisted flag', async () => {
    writeFlagsFile(JSON.stringify({ 'test-flag': { value: 'disabled', payload: null } }))
    const flag = makeTestFlag()
    getOpsFlagResult.mockResolvedValue(undefined)
    await flag.init({ distinctId: 'anon' })
    expect(await flag.get()).toBe('normal')
  })

  it('ignores a persisted entry for a different key', async () => {
    writeFlagsFile(JSON.stringify({ 'other-flag': { value: 'disabled', payload: null } }))
    const flag = makePersistedFlag()
    getOpsFlagResult.mockResolvedValue(undefined)
    await flag.init({ distinctId: 'anon' })
    expect(await flag.get()).toBe('normal')
  })

  it('survives a write failure without rejecting init or losing the fetched value', async () => {
    // `writeFileSafe` stages through `<file>.tmp`; a directory there makes the staging write
    // fail terminally (EISDIR), which is the throw at safe-file.ts:154 the contract must contain.
    // The stale entry is what makes the containment observable: an uncaught write error lands
    // in the miss handler, which would serve `disabled` over the value just fetched.
    writeFlagsFile(JSON.stringify({ 'test-flag': { value: 'disabled', payload: null } }))
    fs.mkdirSync(flagsFilePath() + '.tmp')
    const flag = makePersistedFlag()
    getOpsFlagResult.mockResolvedValue(flagResult('degraded'))
    await expect(flag.init({ distinctId: 'anon' })).resolves.toBeUndefined()
    expect(await flag.get()).toBe('degraded')
  })
})
