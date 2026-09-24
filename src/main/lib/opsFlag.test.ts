// The plumbing every ops flag shares: one in-flight fetch, an accessor that awaits it rather
// than racing it to the default, and a fallback that survives both a rejection and a payload
// `parse` doesn't recognise. Per-flag key/fail-direction/parsing is covered by that flag's own
// spec (see `cloudFreeRuns.test.ts`).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import * as safeFile from './safe-file'

const getOpsFlagResult = vi.fn()
vi.mock('./telemetry', () => ({
  getOpsFlagResult: (...args: unknown[]) => getOpsFlagResult(...args)
}))

/** The `onLateResult` callback `init` handed to the fetch, or `undefined` when it passed none.
 *  Firing it by hand is how a post-deadline arrival is staged: `getOpsFlagResult` owns which
 *  outcomes reach it (truthy only — see `telemetry.test.ts`), this file owns what the wrapper
 *  does once one does. */
function lateCallback(): ((result: unknown) => void) | undefined {
  const call = getOpsFlagResult.mock.calls.at(-1)
  return call?.[3] as ((result: unknown) => void) | undefined
}

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
  vi.restoreAllMocks()
  fs.rmSync(testConfigDir, { recursive: true, force: true })
})

describe('makeOpsFlag', () => {
  it('resolves a recognised value', async () => {
    const flag = makeTestFlag()
    getOpsFlagResult.mockResolvedValue(flagResult('disabled'))
    await flag.init({ distinctId: 'anon' })
    expect(await flag.get()).toBe('disabled')
  })

  it.each([['garbage'], [true]])('keeps the fallback for %s', async (value) => {
    // `parse` returning undefined is how an unrecognised payload is told apart from a
    // legitimate value — it must not overwrite the fail direction. Both values here are real
    // `FeatureFlagValue`s the parser declines, so this reaches the value branch as production
    // would; a fixture carrying `value: undefined` would not be a valid result at all.
    const flag = makeTestFlag()
    getOpsFlagResult.mockResolvedValue(flagResult(value))
    await flag.init({ distinctId: 'anon' })
    expect(await flag.get()).toBe('normal')
  })

  it('keeps the fallback when the fetch rejects', async () => {
    // Defensive: `getOpsFlagResult` classifies its own failures as `unreachable` and does not
    // reject (telemetry.ts). This pins the wrapper's own catch so a future caller that does
    // reject cannot drop the flag to an unparsed state.
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
    // The trailing `undefined` is the late-result callback, which only a persisted flag gets —
    // see `makeOpsFlag late results`. Asserted rather than elided so a callback handed to a
    // non-persisting flag fails here.
    expect(getOpsFlagResult).toHaveBeenCalledWith('test-flag', 'anon', 50, undefined)
  })

  it('defaults the timeout when the caller omits one', async () => {
    const flag = makeTestFlag()
    getOpsFlagResult.mockResolvedValue(flagResult('normal'))
    await flag.init({ distinctId: 'anon' })
    expect(getOpsFlagResult).toHaveBeenCalledWith(
      'test-flag',
      'anon',
      expect.any(Number),
      undefined
    )
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

  it('refuses the persisted write when the primary exists but is unreadable', async () => {
    // Given a primary that EXISTS but cannot be read, with a readable backup standing in for it.
    // `readFileSafe` serves the backup
    // tagged `primaryUnreadable`, so the file's REAL content is unknown — a read-modify-write
    // would replace an intact primary with state reconstructed from the backup.
    seedGrantedFiles()
    vi.spyOn(safeFile, 'readFileSafe').mockReturnValue({
      kind: 'data',
      data: grantEntry(true),
      primaryUnreadable: true
    })

    const flag = makeGrantFlag()
    getOpsFlagResult.mockResolvedValue(flagResult(false, null))
    await expect(flag.init({ distinctId: 'anon' })).resolves.toBeUndefined()

    // Then the launch still uses what it just fetched — refusing to persist is not refusing
    // to apply.
    expect(await flag.get()).toBe('revoked')

    // And neither file was rewritten: the refusal happens before the backup write too, so it
    // cannot leave the pair half-updated.
    expect(JSON.parse(fs.readFileSync(flagsFilePath(), 'utf-8'))).toEqual(parsedGrant(true))
    expect(JSON.parse(fs.readFileSync(bakFilePath(), 'utf-8'))).toEqual(parsedGrant(true))
  })

  it('refuses the persisted write when the primary is unreadable and no backup stands in', async () => {
    // Given an unreadable primary with NO backup, `readFileSafe` reports `unreadable` rather
    // than serving data. Still a refusal: an unrecoverable file is not an empty one, and
    // writing would replace real entries with a single reconstructed key.
    fs.writeFileSync(flagsFilePath(), grantEntry(true), 'utf-8')
    vi.spyOn(safeFile, 'readFileSafe').mockReturnValue({ kind: 'unreadable' })

    const flag = makeGrantFlag()
    getOpsFlagResult.mockResolvedValue(flagResult(false, null))
    await expect(flag.init({ distinctId: 'anon' })).resolves.toBeUndefined()

    expect(await flag.get()).toBe('revoked')
    expect(JSON.parse(fs.readFileSync(flagsFilePath(), 'utf-8'))).toEqual(parsedGrant(true))
    expect(fs.existsSync(bakFilePath())).toBe(false)
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

// A cold `/flags` POST measured ~2572 ms on Windows and is always cold at boot, so the 2000 ms
// deadline loses every launch: the fetch is abandoned mid-flight, the launch reads `unreachable`,
// and a cached grant survives every restart. The deadline still governs THIS launch's decision —
// what changes is that an explicit value arriving after it is persisted for the NEXT one, so a
// revocation converges in one extra launch instead of never.
//
// Only `kind: 'value'` may be written late. A late miss or rejection classifies as `unreachable`,
// which must never be persisted by any route — otherwise deleting a flag would revoke it, which
// is exactly the contract `persist` documents against.
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
    const contents = JSON.stringify({ 'grant-flag': { value: granted, payload: null } })
    fs.writeFileSync(flagsFilePath(), contents, 'utf-8')
    fs.writeFileSync(flagsFilePath() + '.bak', contents, 'utf-8')
  }

  function storedGrant(): unknown {
    return JSON.parse(fs.readFileSync(flagsFilePath(), 'utf-8'))
  }

  /** A launch that loses the race: the deadline resolves `unreachable` while the fetch is still
   *  in flight. Returns the flag so the caller can fire its late result. */
  async function launchLosingTheRace() {
    const flag = makeGrantFlag()
    getOpsFlagResult.mockResolvedValue(unreachable())
    await flag.init({ distinctId: 'anon' })
    return flag
  }

  it('persists a late explicit false so the next unreachable launch reads the revocation', async () => {
    // Given a grant persisted by an earlier online launch
    seedGrant(true)
    const flag = await launchLosingTheRace()
    expect(await flag.get()).toBe('granted')

    // When the disable lands after the deadline, too late for this launch to act on
    lateCallback()?.(flagResult(false, null))

    // Then this launch keeps the grant — the deadline still owns the current decision
    expect(await flag.get()).toBe('granted')
    // And the cache now holds the revocation
    expect(storedGrant()).toEqual({ 'grant-flag': { value: false, payload: null } })

    // And the next launch, also unreachable, reads it back
    const next = makeGrantFlag()
    getOpsFlagResult.mockResolvedValue(unreachable())
    await next.init({ distinctId: 'anon' })
    expect(await next.get()).toBe('revoked')
  })

  it('persists a late explicit true, so a grant can also arrive one launch behind', async () => {
    // Given a revocation on disk — the opposite starting cache, so this cannot pass by inertia
    seedGrant(false)
    const flag = await launchLosingTheRace()
    expect(await flag.get()).toBe('revoked')

    lateCallback()?.(flagResult(true, null))

    expect(storedGrant()).toEqual({ 'grant-flag': { value: true, payload: null } })
  })

  it('does not disturb the current launch when the late value contradicts it', async () => {
    // The deadline owns this launch's decision: a treatment that flipped mid-session would be a
    // worse failure than one that converges on restart, so `cached` is deliberately left alone.
    seedGrant(true)
    const flag = await launchLosingTheRace()

    lateCallback()?.(flagResult(false, null))

    expect(await flag.get()).toBe('granted')
  })

  // A late miss and a late rejection both classify as `unreachable`, so `getOpsFlagResult`
  // withholds the callback and nothing reaches this wrapper. That it withholds them is the
  // load-bearing half and is pinned in `telemetry.test.ts` ("withholds a late result that
  // carries no result for the key" / "withholds a late rejection"). This is the other half:
  // a launch that never receives a late value has no OTHER route to the file, so withholding
  // really is a no-op. Named for what it asserts — the wrapper cannot distinguish WHY no late
  // value arrived, so a test here claiming to cover a specific late outcome would be a fiction.
  it('writes nothing when a launch is never handed a late value', async () => {
    // Given a grant on disk, and a launch whose fetch was abandoned at the deadline
    const stored = JSON.stringify({ 'grant-flag': { value: true, payload: null } }, null, 2)
    fs.writeFileSync(flagsFilePath(), stored, 'utf-8')
    const flag = await launchLosingTheRace()

    // When the callback is registered but never invoked, as a withheld outcome leaves it
    expect(lateCallback()).toBeTypeOf('function')
    await Promise.resolve()

    // Then the grant stands, byte for byte. Deletion is not revocation, late or otherwise.
    // Indented JSON on purpose: canonical output could not tell "untouched" from "rewritten
    // identically", and rewriting is the bug under test.
    expect(fs.readFileSync(flagsFilePath(), 'utf-8')).toBe(stored)
    expect(await flag.get()).toBe('granted')
  })

  it('writes exactly once when the fetch wins the race', async () => {
    // Given a fetch that beats the deadline, so there is no abandoned promise to report late
    const writes = vi.spyOn(safeFile, 'writeFileSafe')
    const flag = makeGrantFlag()
    getOpsFlagResult.mockResolvedValue(flagResult(true, null))
    await flag.init({ distinctId: 'anon' })

    // Then the in-band write is the only one. A late callback firing here too would double it.
    expect(writes.mock.calls.filter(([file]) => file === flagsFilePath())).toHaveLength(1)
    expect(await flag.get()).toBe('granted')
  })

  it('ignores a late result belonging to a superseded init', async () => {
    // Given a launch that lost the race, whose fetch is still in flight
    seedGrant(true)
    const flag = await launchLosingTheRace()
    const strandedCallback = lateCallback()

    // When the flag is reset — a new test, or a fresh init — before that fetch settles
    flag._resetForTest()

    // Then its late result is discarded rather than written under the state that replaced it
    strandedCallback?.(flagResult(false, null))
    expect(storedGrant()).toEqual({ 'grant-flag': { value: true, payload: null } })
  })

  it('swallows and logs a failed late write', async () => {
    // Given `writeFileSafe`'s staging path blocked by a directory, so the write throws EISDIR
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
    fs.mkdirSync(flagsFilePath() + '.bak.tmp')

    // When the late result lands, the throw must not escape — nothing awaits this callback, so
    // an uncaught error becomes an unhandled rejection rather than a caught test failure.
    expect(() => lateCallback()?.(flagResult(false, null))).not.toThrow()
    expect(logs.mock.calls.some(([msg]) => msg === '[grant] late persist error:')).toBe(true)
  })

  it('hands a non-persisting flag no late callback at all', async () => {
    // `cloudFreeRuns` must stay write-free structurally, not by a guard inside a callback: no
    // write path is handed to its abandoned fetch in the first place. `getOpsFlagResult` still
    // observes that fetch to report how it settled, which is not a write.
    const flag = makeTestFlag()
    getOpsFlagResult.mockResolvedValue(unreachable())
    await flag.init({ distinctId: 'anon' })

    expect(lateCallback()).toBeUndefined()
    expect(fs.existsSync(flagsFilePath())).toBe(false)
  })
})
