// Fail-open semantics for the requirements-repair kill switch.
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
    await resolveWithResult(value('off'))
    // The fourth argument is the late-result callback: present only for a persisted flag, so an
    // `off` served in an emergency holds through later offline launches.
    expect(getOpsFlagResult).toHaveBeenCalledWith(
      DEPS_REPAIR_MODE_FLAG_KEY,
      'anon',
      expect.any(Number),
      expect.any(Function)
    )
  })

  it('turns the repair off only on an explicit off', async () => {
    expect(await resolveWithResult(value('off'))).toBe('off')
  })

  it.each([['auto'], ['garbage'], [true], [false]])('reads %s as auto', async (v) => {
    _resetForTest()
    expect(await resolveWithResult(value(v))).toBe('auto')
  })

  it('fails open to auto when the flag is unreachable', async () => {
    expect(await resolveWithResult({ kind: 'unreachable' })).toBe('auto')
  })

  it('fails open to auto when the fetch rejects', async () => {
    getOpsFlagResult.mockRejectedValue(new Error('network'))
    await initDepsRepairMode({ distinctId: 'anon' })
    expect(await getDepsRepairModeAsync()).toBe('auto')
  })

  it('holds a fetched off through a later launch that cannot reach the flag', async () => {
    expect(await resolveWithResult(value('off'))).toBe('off')
    _resetForTest()
    expect(await resolveWithResult({ kind: 'unreachable' })).toBe('off')
  })

  it('turns the repair back on once auto is served, and holds that offline too', async () => {
    await resolveWithResult(value('off'))
    _resetForTest()
    expect(await resolveWithResult(value('auto'))).toBe('auto')
    _resetForTest()
    expect(await resolveWithResult({ kind: 'unreachable' })).toBe('auto')
  })
})
