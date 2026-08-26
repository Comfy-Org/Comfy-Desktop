// The plumbing every ops flag shares: one in-flight fetch, an accessor that awaits it rather
// than racing it to the default, and a fallback that survives both a rejection and a payload
// `parse` doesn't recognise. Per-flag key/fail-direction/parsing is covered by that flag's own
// spec (see `cloudFreeRuns.test.ts`).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getOpsFlagResult = vi.fn()
vi.mock('./telemetry', () => ({
  getOpsFlagResult: (...args: unknown[]) => getOpsFlagResult(...args)
}))

import { makeOpsFlag } from './opsFlag'

/** The reader hands back `{ value, payload }`; a bare `undefined` is a fetch miss. */
function result(value: unknown, payload?: unknown): unknown {
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
})

describe('makeOpsFlag', () => {
  it('resolves a recognised value', async () => {
    const flag = makeTestFlag()
    getOpsFlagResult.mockResolvedValue(result('disabled'))
    await flag.init({ distinctId: 'anon' })
    expect(await flag.get()).toBe('disabled')
  })

  it.each([['garbage'], [true], [undefined]])('keeps the fallback for %s', async (value) => {
    // `parse` returning undefined is how an unrecognised payload is told apart from a
    // legitimate value — it must not overwrite the fail direction.
    const flag = makeTestFlag()
    getOpsFlagResult.mockResolvedValue(result(value))
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
    release(result('disabled'))
    expect(await pending).toBe('disabled')
  })

  it('is idempotent within a process — one fetch regardless of callers', async () => {
    const flag = makeTestFlag()
    getOpsFlagResult.mockResolvedValue(result('degraded'))
    await Promise.all([flag.init({ distinctId: 'anon' }), flag.init({ distinctId: 'anon' })])
    expect(getOpsFlagResult).toHaveBeenCalledTimes(1)
  })

  it('passes the key, distinct id, and timeout through to the fetch', async () => {
    const flag = makeTestFlag()
    getOpsFlagResult.mockResolvedValue(result('normal'))
    await flag.init({ distinctId: 'anon', timeoutMs: 50 })
    expect(getOpsFlagResult).toHaveBeenCalledWith('test-flag', 'anon', 50)
  })

  it('defaults the timeout when the caller omits one', async () => {
    const flag = makeTestFlag()
    getOpsFlagResult.mockResolvedValue(result('normal'))
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
    getOpsFlagResult.mockResolvedValue(result(true, { items: ['a', 'b'] }))
    await flag.init({ distinctId: 'anon' })
    expect(await flag.get()).toEqual(['a', 'b'])
  })

  it('holds its own cache — two flags do not share state', async () => {
    const a = makeTestFlag()
    const b = makeTestFlag()
    getOpsFlagResult.mockResolvedValue(result('disabled'))
    await a.init({ distinctId: 'anon' })
    expect(await a.get()).toBe('disabled')
    // `b` was never inited, so it has no fetch to await and reports its own fallback.
    expect(await b.get()).toBe('normal')
  })

  it('_resetForTest clears both the cache and the in-flight fetch', async () => {
    const flag = makeTestFlag()
    getOpsFlagResult.mockResolvedValue(result('disabled'))
    await flag.init({ distinctId: 'anon' })
    flag._resetForTest()
    expect(await flag.get()).toBe('normal')
    // A fresh init must actually re-fetch rather than short-circuit on the old promise.
    getOpsFlagResult.mockResolvedValue(result('degraded'))
    await flag.init({ distinctId: 'anon' })
    expect(await flag.get()).toBe('degraded')
    expect(getOpsFlagResult).toHaveBeenCalledTimes(2)
  })
})
