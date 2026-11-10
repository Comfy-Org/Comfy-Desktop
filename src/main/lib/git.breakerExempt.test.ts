import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  configurePygit2,
  findMergeBaseOrNone,
  getPygit2Status,
  resetPygit2State,
  withoutPygit2Breaker
} from './git'

const SHA = 'a'.repeat(40)
let dir = ''
let okHelper = ''
let missingHelper = ''

const failures = (): number => {
  const status = getPygit2Status()
  return status.status === 'healthy' ? status.failures : -1
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pygit2-breaker-'))
  okHelper = path.join(dir, 'ok-helper')
  fs.writeFileSync(okHelper, '#!/bin/sh\necho a\nexit 0\n', { mode: 0o755 })
  missingHelper = path.join(dir, 'missing-helper')
  resetPygit2State()
})

afterEach(() => {
  resetPygit2State()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe.skipIf(process.platform === 'win32')('withoutPygit2Breaker', () => {
  it('keeps launch failures inside it from counting toward disabling pygit2', async () => {
    configurePygit2(missingHelper, 'git_operations.py')
    for (let i = 0; i < 3; i++) {
      await withoutPygit2Breaker(() => findMergeBaseOrNone(dir, SHA, SHA))
    }
    expect(getPygit2Status().status).toBe('healthy')
    expect(failures()).toBe(0)
  })

  it('counts the same failures outside it, which is what the test above relies on', async () => {
    configurePygit2(missingHelper, 'git_operations.py')
    for (let i = 0; i < 3; i++) await findMergeBaseOrNone(dir, SHA, SHA)
    expect(getPygit2Status().status).toBe('disabled')
  })

  it('keeps a success inside it from resetting failures counted outside it', async () => {
    configurePygit2(missingHelper, 'git_operations.py')
    await findMergeBaseOrNone(dir, SHA, SHA)
    await findMergeBaseOrNone(dir, SHA, SHA)
    expect(failures()).toBe(2)

    const healthy = getPygit2Status()
    if (healthy.status !== 'healthy') throw new Error('expected a healthy fallback')
    Object.assign(healthy, { python: okHelper })

    await expect(withoutPygit2Breaker(() => findMergeBaseOrNone(dir, SHA, SHA))).resolves.toBe('a')
    expect(failures()).toBe(2)
    await findMergeBaseOrNone(dir, SHA, SHA)
    expect(failures(), 'the same success outside it does reset the count').toBe(0)
  })
})
