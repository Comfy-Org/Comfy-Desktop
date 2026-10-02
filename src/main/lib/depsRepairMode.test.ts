// Parsing and resolution of the requirements-repair install-kind list.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const getOpsFlagResult = vi.fn()
vi.mock('./telemetry', () => ({
  getOpsFlagResult: (...args: unknown[]) => getOpsFlagResult(...args)
}))

// Pinned to a temp dir so a regression that persisted this flag would be visible (and would not
// land in the developer's own config).
let testConfigDir = ''
vi.mock('./paths', () => ({
  configDir: () => testConfigDir
}))

import {
  initDepsRepairMode,
  getDepsRepairModeAsync,
  getDepsRepairModeForDrift,
  parseDepsRepairKinds,
  DEPS_REPAIR_LATE_WAIT_MS,
  DEPS_REPAIR_MODE_FLAG_KEY,
  _resetForTest
} from './depsRepairMode'

async function resolveWithResult(result: unknown): Promise<readonly string[]> {
  getOpsFlagResult.mockResolvedValue(result)
  await initDepsRepairMode({ distinctId: 'anon' })
  return getDepsRepairModeAsync()
}

const value = (v: unknown): unknown => ({ kind: 'value', value: v, payload: undefined })

beforeEach(() => {
  _resetForTest()
  getOpsFlagResult.mockReset()
  testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deps-repair-mode-'))
})

afterEach(() => {
  fs.rmSync(testConfigDir, { recursive: true, force: true })
})

describe('parseDepsRepairKinds', () => {
  it.each([
    ['adopted', ['adopted']],
    ['managed', ['managed']],
    ['adopted,managed', ['adopted', 'managed']],
    ['managed,adopted', ['adopted', 'managed']],
    [' Adopted , MANAGED ', ['adopted', 'managed']],
    ['adopted,adopted', ['adopted']],
    ['adopted,portable', ['adopted']],
    ['portable', []],
    ['', []],
    [' , ', []],
    ['off', []],
    ['all', []],
    ['auto', []]
  ])('reads %j as %j', (list, kinds) => {
    expect(parseDepsRepairKinds(list, undefined)).toEqual(kinds)
  })

  it.each([[true], [false], [undefined], [42]])('reads a non-string value %j as nothing', (v) => {
    expect(parseDepsRepairKinds(v as never, undefined)).toEqual([])
  })

  it('reads the list from a string payload in preference to the value', () => {
    expect(parseDepsRepairKinds(true, 'adopted,managed')).toEqual(['adopted', 'managed'])
    expect(parseDepsRepairKinds('managed', 'adopted')).toEqual(['adopted'])
  })

  it.each([
    [
      ['adopted', 'managed'],
      ['adopted', 'managed']
    ],
    [[' Managed '], ['managed']],
    [['adopted', 'adopted'], ['adopted']],
    [['adopted', 'portable'], ['adopted']],
    [['adopted', 7, null, ['managed']], ['adopted']],
    [[], []],
    [['adopted,managed'], []]
  ])('reads an array payload %j as %j', (payload, kinds) => {
    expect(parseDepsRepairKinds(true, payload)).toEqual(kinds)
  })

  it('prefers an array payload to the value', () => {
    expect(parseDepsRepairKinds('managed', ['adopted'])).toEqual(['adopted'])
  })

  it.each([[{ kinds: ['adopted'] }], [42], [true]])(
    'repairs nothing for a malformed payload %j, whatever the value says',
    (payload) => {
      expect(parseDepsRepairKinds('adopted,managed', payload)).toEqual([])
    }
  )

  it('reads the value when the payload is null', () => {
    expect(parseDepsRepairKinds('managed', null)).toEqual(['managed'])
  })

  it.each([[['adopted', 'managed']], ['adopted,managed']])(
    'repairs nothing for a disabled flag, even with a supported payload %j',
    (payload) => {
      expect(parseDepsRepairKinds(false, payload)).toEqual([])
    }
  )
})

describe('depsRepairMode', () => {
  /** A boot fetch that lost its deadline and is still in flight. */
  async function bootLosingTheRace(): Promise<(result: unknown) => void> {
    getOpsFlagResult.mockResolvedValue({ kind: 'unreachable', abandoned: true })
    await initDepsRepairMode({ distinctId: 'anon' })
    return getOpsFlagResult.mock.calls.at(-1)?.[3] as (result: unknown) => void
  }

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads deps_repair_mode with a late-result callback', async () => {
    expect(DEPS_REPAIR_MODE_FLAG_KEY).toBe('deps_repair_mode')
    await resolveWithResult(value('adopted'))
    expect(getOpsFlagResult).toHaveBeenCalledWith(
      DEPS_REPAIR_MODE_FLAG_KEY,
      'anon',
      expect.any(Number),
      expect.any(Function)
    )
  })

  it('reads a served list', async () => {
    expect(await resolveWithResult(value('adopted,managed'))).toEqual(['adopted', 'managed'])
  })

  it('repairs nothing when the flag was never fetched (unreachable)', async () => {
    expect(await resolveWithResult({ kind: 'unreachable' })).toEqual([])
  })

  it('repairs nothing when the fetch rejects', async () => {
    getOpsFlagResult.mockRejectedValue(new Error('network'))
    await initDepsRepairMode({ distinctId: 'anon' })
    expect(await getDepsRepairModeAsync()).toEqual([])
  })

  it('applies a late answer to the next launch in the same session', async () => {
    const late = await bootLosingTheRace()
    expect(await getDepsRepairModeAsync()).toEqual([])

    late({ kind: 'value', value: true, payload: ['adopted', 'managed'] })

    expect(await getDepsRepairModeAsync()).toEqual(['adopted', 'managed'])
  })

  it.each([
    ['an empty list', { kind: 'value', value: true, payload: [] }],
    ['a disabled flag', { kind: 'value', value: false, payload: undefined }]
  ])('applies a late revocation (%s)', async (_label, revocation) => {
    const late = await bootLosingTheRace()
    late(revocation)
    expect(await getDepsRepairModeAsync()).toEqual([])
  })

  it('writes nothing to disk, in band or late', async () => {
    await resolveWithResult(value('adopted'))
    _resetForTest()
    const late = await bootLosingTheRace()
    late({ kind: 'value', value: true, payload: ['managed'] })
    expect(fs.readdirSync(testConfigDir)).toEqual([])
  })

  it('starts from nothing again after a restart, whatever the last session read', async () => {
    expect(await resolveWithResult(value('adopted,managed'))).toEqual(['adopted', 'managed'])
    _resetForTest()
    expect(await resolveWithResult({ kind: 'unreachable' })).toEqual([])
  })

  it('a launch with drift waits for a slow flag (3 s) and repairs per the served list', async () => {
    vi.useFakeTimers()
    const late = await bootLosingTheRace()

    const decided = getDepsRepairModeForDrift()
    await vi.advanceTimersByTimeAsync(3000)
    late({ kind: 'value', value: true, payload: ['managed'] })

    expect(await decided).toEqual(['managed'])
  })

  it('a launch with drift gives up on a hung flag at the cap and repairs nothing', async () => {
    vi.useFakeTimers()
    await bootLosingTheRace()

    let settled = false
    const decided = getDepsRepairModeForDrift().then((v) => ((settled = true), v))
    await vi.advanceTimersByTimeAsync(DEPS_REPAIR_LATE_WAIT_MS - 1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await decided).toEqual([])
    expect(DEPS_REPAIR_LATE_WAIT_MS).toBe(5000)
  })
})
