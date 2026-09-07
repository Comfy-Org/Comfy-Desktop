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
  return { kind: 'value', value, payload }
}

function unreachable(): unknown {
  return { kind: 'unreachable' }
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
    // When the boot fetch times out — `getOpsFlagResult` classifies that as `unreachable`
    getOpsFlagResult.mockResolvedValue(unreachable())
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
    getOpsFlagResult.mockResolvedValue(unreachable())
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
    getOpsFlagResult.mockResolvedValue(unreachable())
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
    getOpsFlagResult.mockResolvedValue(unreachable())
    await expect(flag.init({ distinctId: 'anon' })).resolves.toBeUndefined()
    expect(await flag.get()).toBe('normal')
  })

  it('falls back to the static fallback when the persisted file is corrupt', async () => {
    writeFlagsFile('{ not json at all')
    const flag = makePersistedFlag()
    getOpsFlagResult.mockResolvedValue(unreachable())
    await expect(flag.init({ distinctId: 'anon' })).resolves.toBeUndefined()
    expect(await flag.get()).toBe('normal')
  })

  it('falls back to the static fallback when the persisted entry is unrecognised', async () => {
    writeFlagsFile(JSON.stringify({ 'test-flag': { value: 'garbage', payload: null } }))
    const flag = makePersistedFlag()
    getOpsFlagResult.mockResolvedValue(unreachable())
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
    getOpsFlagResult.mockResolvedValue(unreachable())
    await flag.init({ distinctId: 'anon' })
    expect(await flag.get()).toBe('normal')
  })

  it('ignores a persisted entry for a different key', async () => {
    writeFlagsFile(JSON.stringify({ 'other-flag': { value: 'disabled', payload: null } }))
    const flag = makePersistedFlag()
    getOpsFlagResult.mockResolvedValue(unreachable())
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

// Revocation is DISABLE, not deletion: a missing key reads as `unreachable` and HOLDS the
// persisted treatment, so serving an explicit `false` is the only operation that takes a grant
// back. That only works if the revocation reaches the backup too — `readFileSafe` will serve
// `.bak` when the primary is gone or unreadable, so a backup still carrying the old grant
// resurrects it on the next offline launch.
describe('makeOpsFlag revocation coherence', () => {
  function flagsFilePath(): string {
    return path.join(testConfigDir, 'ops-flags.json')
  }

  function bakFilePath(): string {
    return flagsFilePath() + '.bak'
  }

  /** Tri-state on purpose: `revoked` is distinguishable from the `unknown` fail direction, so
   *  reading a revocation back proves the persisted file answered rather than that the flag
   *  merely fell back. */
  function makeGrantFlag() {
    return makeOpsFlag<'granted' | 'revoked' | 'unknown'>({
      key: 'grant-flag',
      fallback: 'unknown',
      parse: (value) => (value === true ? 'granted' : value === false ? 'revoked' : undefined),
      persist: true
    })
  }

  function grantEntry(granted: boolean): string {
    return JSON.stringify({ 'grant-flag': { value: granted, payload: null } })
  }

  function parsedGrant(granted: boolean): unknown {
    return { 'grant-flag': { value: granted, payload: null } }
  }

  function seedGrantedFiles(): void {
    fs.writeFileSync(flagsFilePath(), grantEntry(true), 'utf-8')
    fs.writeFileSync(bakFilePath(), grantEntry(true), 'utf-8')
  }

  async function disableGrant(): Promise<void> {
    const flag = makeGrantFlag()
    getOpsFlagResult.mockResolvedValue(flagResult(false, null))
    await flag.init({ distinctId: 'anon' })
  }

  async function launchOffline(): Promise<'granted' | 'revoked' | 'unknown'> {
    const flag = makeGrantFlag()
    getOpsFlagResult.mockResolvedValue(unreachable())
    await flag.init({ distinctId: 'anon' })
    return flag.get()
  }

  it('writes the revocation to the backup as well as the primary', async () => {
    // Given a grant carried by both files from an earlier online launch
    seedGrantedFiles()

    // When ops disables the flag — an explicit `false`, the supported revocation
    await disableGrant()

    // Then neither file still carries the grant. A `backup: true` write would have copied the
    // pre-rename (still granted) primary over the backup instead.
    expect(JSON.parse(fs.readFileSync(flagsFilePath(), 'utf-8'))).toEqual(parsedGrant(false))
    expect(JSON.parse(fs.readFileSync(bakFilePath(), 'utf-8'))).toEqual(parsedGrant(false))
  })

  it('does not resurrect a revoked grant when the primary is missing on an offline launch', async () => {
    // Given a grant that ops has since revoked
    seedGrantedFiles()
    await disableGrant()

    // When the primary is lost and the next launch cannot reach PostHog
    fs.rmSync(flagsFilePath())

    // Then the backup restores the revocation, not the grant it replaced
    expect(await launchOffline()).toBe('revoked')
  })

  it('does not resurrect a revoked grant from a backup-only read', async () => {
    // Given a grant that ops has since revoked
    seedGrantedFiles()
    await disableGrant()

    // When the primary exists but cannot be read (a directory reads EISDIR, the same
    // `unreadable` outcome as a lock outlasting the retry budget), so only the backup answers
    fs.rmSync(flagsFilePath())
    fs.mkdirSync(flagsFilePath())

    expect(await launchOffline()).toBe('revoked')
  })

  it('aborts the persist when the backup write fails, leaving the primary untouched', async () => {
    // Given the backup's staging path blocked, so the FIRST write of the sequence throws EISDIR
    seedGrantedFiles()
    fs.mkdirSync(bakFilePath() + '.tmp')

    const flag = makeGrantFlag()
    getOpsFlagResult.mockResolvedValue(flagResult(false, null))
    await expect(flag.init({ distinctId: 'anon' })).resolves.toBeUndefined()

    // Then this launch still uses what it fetched, and the primary was never reached — proving
    // the backup is written first, so the two files can never disagree in the resurrecting
    // direction (primary revoked, backup still granted).
    expect(await flag.get()).toBe('revoked')
    expect(JSON.parse(fs.readFileSync(flagsFilePath(), 'utf-8'))).toEqual(parsedGrant(true))
  })

  it('keeps the revocation in the backup when the primary write fails', async () => {
    // Given the primary's staging path blocked, so the SECOND write of the sequence throws
    seedGrantedFiles()
    fs.mkdirSync(flagsFilePath() + '.tmp')

    const flag = makeGrantFlag()
    getOpsFlagResult.mockResolvedValue(flagResult(false, null))
    await expect(flag.init({ distinctId: 'anon' })).resolves.toBeUndefined()

    // Then the backup already holds the revocation, so a later backup-served read cannot
    // resurrect the grant. The stale primary is the accepted residual: two files cannot be
    // written atomically, and the next successful fetch rewrites both.
    expect(await flag.get()).toBe('revoked')
    expect(JSON.parse(fs.readFileSync(bakFilePath(), 'utf-8'))).toEqual(parsedGrant(false))
    expect(JSON.parse(fs.readFileSync(flagsFilePath(), 'utf-8'))).toEqual(parsedGrant(true))
  })
})
