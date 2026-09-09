// The plumbing every ops flag shares: one in-flight fetch, an accessor that awaits it rather
// than racing it to the default, and a fallback that survives both a rejection and a payload
// `parse` doesn't recognise. Per-flag key/fail-direction/parsing is covered by that flag's own
// spec (see `cloudFreeRuns.test.ts`).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getOpsFlag = vi.fn()
vi.mock('./telemetry', () => ({ getOpsFlag: (...args: unknown[]) => getOpsFlag(...args) }))

import { makeOpsFlag } from './opsFlag'

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
  getOpsFlag.mockReset()
})

describe('makeOpsFlag', () => {
  it('resolves a recognised value', async () => {
    const flag = makeTestFlag()
    getOpsFlag.mockResolvedValue('disabled')
    await flag.init({ distinctId: 'anon' })
    expect(await flag.get()).toBe('disabled')
  })

  it.each([['garbage'], [true], [undefined]])('keeps the fallback for %s', async (value) => {
    // `parse` returning undefined is how an unrecognised payload is told apart from a
    // legitimate value — it must not overwrite the fail direction.
    const flag = makeTestFlag()
    getOpsFlag.mockResolvedValue(value)
    await flag.init({ distinctId: 'anon' })
    expect(await flag.get()).toBe('normal')
  })

  it('keeps the fallback when the fetch rejects', async () => {
    const flag = makeTestFlag()
    getOpsFlag.mockRejectedValue(new Error('network'))
    await flag.init({ distinctId: 'anon' })
    expect(await flag.get()).toBe('normal')
  })

  it('awaits the in-flight boot fetch rather than returning the fallback', async () => {
    const flag = makeTestFlag()
    let release: (v: unknown) => void = () => {}
    getOpsFlag.mockReturnValue(
      new Promise((r) => {
        release = r
      })
    )
    void flag.init({ distinctId: 'anon' })
    const pending = flag.get()
    release('disabled')
    expect(await pending).toBe('disabled')
  })

  it('is idempotent within a process — one fetch regardless of callers', async () => {
    const flag = makeTestFlag()
    getOpsFlag.mockResolvedValue('degraded')
    await Promise.all([flag.init({ distinctId: 'anon' }), flag.init({ distinctId: 'anon' })])
    expect(getOpsFlag).toHaveBeenCalledTimes(1)
  })

  it('passes the key, distinct id, and timeout through to the fetch', async () => {
    const flag = makeTestFlag()
    getOpsFlag.mockResolvedValue('normal')
    await flag.init({ distinctId: 'anon', timeoutMs: 50 })
    expect(getOpsFlag).toHaveBeenCalledWith('test-flag', 'anon', 50)
  })

  it('defaults the timeout when the caller omits one', async () => {
    const flag = makeTestFlag()
    getOpsFlag.mockResolvedValue('normal')
    await flag.init({ distinctId: 'anon' })
    expect(getOpsFlag).toHaveBeenCalledWith('test-flag', 'anon', expect.any(Number))
  })

  it('holds its own cache — two flags do not share state', async () => {
    const a = makeTestFlag()
    const b = makeTestFlag()
    getOpsFlag.mockResolvedValue('disabled')
    await a.init({ distinctId: 'anon' })
    expect(await a.get()).toBe('disabled')
    // `b` was never inited, so it has no fetch to await and reports its own fallback.
    expect(await b.get()).toBe('normal')
  })

  it('_resetForTest clears both the cache and the in-flight fetch', async () => {
    const flag = makeTestFlag()
    getOpsFlag.mockResolvedValue('disabled')
    await flag.init({ distinctId: 'anon' })
    flag._resetForTest()
    expect(await flag.get()).toBe('normal')
    // A fresh init must actually re-fetch rather than short-circuit on the old promise.
    getOpsFlag.mockResolvedValue('degraded')
    await flag.init({ distinctId: 'anon' })
    expect(await flag.get()).toBe('degraded')
    expect(getOpsFlag).toHaveBeenCalledTimes(2)
  })
})
