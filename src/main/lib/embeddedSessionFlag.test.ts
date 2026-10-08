import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const getOpsFlagResult = vi.fn()
vi.mock('./telemetry', () => ({
  getOpsFlagResult: (...args: unknown[]) => getOpsFlagResult(...args),
  getFlagEvaluationStaff: () => false
}))

let testConfigDir = ''
vi.mock('./paths', () => ({
  configDir: () => testConfigDir
}))

import {
  _resetForTest,
  EMBEDDED_SESSION_FLAG_KEY,
  initEmbeddedSessionFlag,
  isEmbeddedSessionEnabled
} from './embeddedSessionFlag'

beforeEach(() => {
  getOpsFlagResult.mockReset()
  _resetForTest()
  testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'embedded-session-flag-'))
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  vi.useRealTimers()
  fs.rmSync(testConfigDir, { recursive: true, force: true })
})

describe('embedded session flag', () => {
  it('is off for a launch whose installation id takes longer than the flag deadline', async () => {
    getOpsFlagResult.mockResolvedValue({ kind: 'value', value: true })
    let resolveId: (id: string) => void = () => {}
    void initEmbeddedSessionFlag({
      distinctId: new Promise<string>((r) => {
        resolveId = r
      })
    })

    await vi.advanceTimersByTimeAsync(2000)
    expect(await isEmbeddedSessionEnabled(), 'a slow id leaves it off for this launch').toBe(false)

    resolveId('final-id')
    await vi.advanceTimersByTimeAsync(0)
    expect(getOpsFlagResult).toHaveBeenCalledWith(
      EMBEDDED_SESSION_FLAG_KEY,
      'final-id',
      0,
      undefined,
      false
    )
    expect(await isEmbeddedSessionEnabled(), 'the late answer does not turn it on').toBe(false)
    expect(fs.existsSync(path.join(testConfigDir, 'ops-flags.json')), 'not persisted').toBe(false)
  })

  it('is on when the id resolves in time and the flag says so', async () => {
    getOpsFlagResult.mockResolvedValue({ kind: 'value', value: true })
    await initEmbeddedSessionFlag({ distinctId: Promise.resolve('final-id') })
    expect(await isEmbeddedSessionEnabled()).toBe(true)
  })
})
