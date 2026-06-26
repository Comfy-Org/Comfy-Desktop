import { afterEach, describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() }
}))

import { pruneCrashDumps } from './crashDumps'

describe('pruneCrashDumps', () => {
  let tmpDir: string

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  /** Create `name` with an mtime `ageMs` in the past so ordering is deterministic. */
  function makeDump(dir: string, name: string, ageMs: number): string {
    const file = path.join(dir, name)
    fs.writeFileSync(file, 'dump')
    const t = Date.now() - ageMs
    fs.utimesSync(file, t / 1000, t / 1000)
    return file
  }

  it('keeps the newest maxFiles and deletes the rest', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crashdumps-'))
    const newest = makeDump(tmpDir, 'a.dmp', 0)
    const mid = makeDump(tmpDir, 'b.dmp', 10_000)
    const oldest = makeDump(tmpDir, 'c.dmp', 20_000)

    const deleted = pruneCrashDumps({ dir: tmpDir, maxFiles: 2 })

    expect(deleted).toBe(1)
    expect(fs.existsSync(newest)).toBe(true)
    expect(fs.existsSync(mid)).toBe(true)
    expect(fs.existsSync(oldest)).toBe(false)
  })

  it('recurses into Crashpad subdirectories', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crashdumps-'))
    const reports = path.join(tmpDir, 'reports')
    fs.mkdirSync(reports)
    const newest = makeDump(reports, 'a.dmp', 0)
    const oldest = makeDump(reports, 'b.dmp', 10_000)

    const deleted = pruneCrashDumps({ dir: tmpDir, maxFiles: 1 })

    expect(deleted).toBe(1)
    expect(fs.existsSync(newest)).toBe(true)
    expect(fs.existsSync(oldest)).toBe(false)
  })

  it('only touches .dmp files', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crashdumps-'))
    fs.writeFileSync(path.join(tmpDir, 'settings.dat'), 'keep')
    makeDump(tmpDir, 'a.dmp', 0)
    makeDump(tmpDir, 'b.dmp', 10_000)

    pruneCrashDumps({ dir: tmpDir, maxFiles: 1 })

    expect(fs.existsSync(path.join(tmpDir, 'settings.dat'))).toBe(true)
  })

  it('is a no-op when under the cap or the dir is missing', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crashdumps-'))
    makeDump(tmpDir, 'a.dmp', 0)
    expect(pruneCrashDumps({ dir: tmpDir, maxFiles: 10 })).toBe(0)
    expect(pruneCrashDumps({ dir: path.join(tmpDir, 'nope'), maxFiles: 1 })).toBe(0)
  })
})
