// Parsing and persistence of the requirements-repair install-kind list.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const getOpsFlagResult = vi.fn()
vi.mock('./telemetry', () => ({
  getOpsFlagResult: (...args: unknown[]) => getOpsFlagResult(...args)
}))

// This flag persists, so a resolved value writes `ops-flags.json`: pin `configDir()` to a temp
// dir (as `coreBetaGrants.test.ts` does) so it never lands in the developer's own config.
let testConfigDir = ''
vi.mock('./paths', () => ({
  configDir: () => testConfigDir
}))

import {
  initDepsRepairMode,
  getDepsRepairModeAsync,
  parseDepsRepairKinds,
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
})

describe('depsRepairMode', () => {
  it('reads deps_repair_mode as a persisted flag', async () => {
    expect(DEPS_REPAIR_MODE_FLAG_KEY).toBe('deps_repair_mode')
    await resolveWithResult(value('adopted'))
    // The fourth argument is the late-result callback: present only for a persisted flag, so a
    // served list still applies on later offline launches.
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

  it('holds a fetched array payload through a later launch that cannot reach the flag', async () => {
    getOpsFlagResult.mockResolvedValue({ kind: 'value', value: true, payload: ['managed'] })
    await initDepsRepairMode({ distinctId: 'anon' })
    expect(await getDepsRepairModeAsync()).toEqual(['managed'])
    _resetForTest()
    expect(await resolveWithResult({ kind: 'unreachable' })).toEqual(['managed'])
  })

  it('repairs nothing when the flag was never fetched (unreachable)', async () => {
    expect(await resolveWithResult({ kind: 'unreachable' })).toEqual([])
  })

  it('repairs nothing when the fetch rejects', async () => {
    getOpsFlagResult.mockRejectedValue(new Error('network'))
    await initDepsRepairMode({ distinctId: 'anon' })
    expect(await getDepsRepairModeAsync()).toEqual([])
  })

  it('holds a fetched list through a later launch that cannot reach the flag', async () => {
    expect(await resolveWithResult(value('adopted,managed'))).toEqual(['adopted', 'managed'])
    _resetForTest()
    expect(await resolveWithResult({ kind: 'unreachable' })).toEqual(['adopted', 'managed'])
  })

  it('narrows to nothing once an empty list is served, and holds that offline too', async () => {
    await resolveWithResult(value('adopted,managed'))
    _resetForTest()
    expect(await resolveWithResult(value(''))).toEqual([])
    _resetForTest()
    expect(await resolveWithResult({ kind: 'unreachable' })).toEqual([])
  })
})
