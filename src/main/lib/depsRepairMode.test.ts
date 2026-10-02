// Default-off semantics for the requirements-repair rollout scope.
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
  DEPS_REPAIR_MODE_FLAG_KEY,
  _resetForTest
} from './depsRepairMode'

async function resolveWithResult(result: unknown): Promise<string> {
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

describe('depsRepairMode', () => {
  it('reads deps_repair_mode as a persisted flag', async () => {
    expect(DEPS_REPAIR_MODE_FLAG_KEY).toBe('deps_repair_mode')
    await resolveWithResult(value('all'))
    // The fourth argument is the late-result callback: present only for a persisted flag, so a
    // served scope still applies on later offline launches.
    expect(getOpsFlagResult).toHaveBeenCalledWith(
      DEPS_REPAIR_MODE_FLAG_KEY,
      'anon',
      expect.any(Number),
      expect.any(Function)
    )
  })

  it.each([['off'], ['adopted'], ['all']])('reads %s as served', async (v) => {
    expect(await resolveWithResult(value(v))).toBe(v)
  })

  it.each([['garbage'], ['auto'], [true], [false]])('reads %s as off', async (v) => {
    expect(await resolveWithResult(value(v))).toBe('off')
  })

  it('is off when the flag was never fetched (unreachable)', async () => {
    expect(await resolveWithResult({ kind: 'unreachable' })).toBe('off')
  })

  it('is off when the fetch rejects', async () => {
    getOpsFlagResult.mockRejectedValue(new Error('network'))
    await initDepsRepairMode({ distinctId: 'anon' })
    expect(await getDepsRepairModeAsync()).toBe('off')
  })

  it('holds a fetched scope through a later launch that cannot reach the flag', async () => {
    expect(await resolveWithResult(value('all'))).toBe('all')
    _resetForTest()
    expect(await resolveWithResult({ kind: 'unreachable' })).toBe('all')
  })

  it('narrows back to off once off is served, and holds that offline too', async () => {
    await resolveWithResult(value('all'))
    _resetForTest()
    expect(await resolveWithResult(value('off'))).toBe('off')
    _resetForTest()
    expect(await resolveWithResult({ kind: 'unreachable' })).toBe('off')
  })
})
