import { describe, it, expect } from 'vitest'
import { findLockingProcesses, type LockingProcess } from './file-lock-info'
import { fork } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

describe('findLockingProcesses', { timeout: 30_000 }, () => {
  it('returns an empty array for a file not locked by any process', async () => {
    const tmpFile = path.join(os.tmpdir(), `file-lock-test-${Date.now()}.txt`)
    fs.writeFileSync(tmpFile, 'test')
    try {
      const result = await findLockingProcesses(tmpFile)
      expect(Array.isArray(result)).toBe(true)
    } finally {
      try {
        fs.unlinkSync(tmpFile)
      } catch {}
    }
  })

  it('returns an empty array for a non-existent file', async () => {
    const result = await findLockingProcesses('/tmp/nonexistent-file-lock-test-' + Date.now())
    expect(result).toEqual([])
  })

  it('returns results with pid and name fields', async () => {
    const tmpFile = path.join(os.tmpdir(), `file-lock-shape-test-${Date.now()}.txt`)
    fs.writeFileSync(tmpFile, 'test')
    try {
      const result = await findLockingProcesses(tmpFile)
      for (const entry of result) {
        expect(typeof entry.pid).toBe('number')
        expect(typeof entry.name).toBe('string')
      }
    } finally {
      try {
        fs.unlinkSync(tmpFile)
      } catch {}
    }
  })

  // `findLockingProcesses` is best-effort by contract: it caps `lsof` at 10s
  // and returns an empty list when that cap kills it, which is
  // indistinguishable from "nothing holds this file". `lsof` walks every
  // process's fd table, so on a saturated machine - vitest runs 8 workers, CI
  // gives it 4 cores - it can and does blow past the cap. A single empty
  // answer is therefore not evidence the lookup is broken, so re-ask while
  // the child still holds the handle instead of failing the run on it.
  async function probeUntilHolderFound(
    filePath: string,
    pid: number,
    attempts = 3
  ): Promise<LockingProcess[]> {
    let result: LockingProcess[] = []
    for (let attempt = 0; attempt < attempts; attempt++) {
      // Back off first: an empty answer means the machine was too busy for
      // `lsof` to finish inside the cap, and three full fd-table scans run
      // back to back add to exactly the load that caused it.
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, attempt * 1000))
      result = await findLockingProcesses(filePath)
      if (result.some((entry) => entry.pid === pid)) break
    }
    return result
  }

  // Three 10s probes plus fork overhead have to fit inside the budget, or a
  // timeout re-introduces exactly the flake the retry exists to remove.
  it('detects a process holding a file open', { timeout: 60_000 }, async () => {
    // Windows' Restart Manager API doesn't detect arbitrary handles from console processes
    // like Node, so skip there; lsof works for all process types on Linux/macOS.
    if (process.platform === 'win32') return

    const tmpFile = path.join(os.tmpdir(), `file-lock-held-test-${Date.now()}.txt`)
    fs.writeFileSync(tmpFile, 'test')

    const child = fork(
      '-e',
      [
        `const fs = require('fs');` +
          `const fd = fs.openSync(${JSON.stringify(tmpFile)}, 'r+');` +
          `process.send('ready');` +
          `process.on('message', () => { fs.closeSync(fd); process.exit(); });`
      ],
      { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] }
    )

    await new Promise<void>((resolve) => {
      child.on('message', () => resolve())
    })
    await new Promise((r) => setTimeout(r, 500))

    try {
      const result = await probeUntilHolderFound(tmpFile, child.pid!)
      expect(result.length).toBeGreaterThanOrEqual(1)
      const pids = result.map((r) => r.pid)
      expect(pids).toContain(child.pid)
      for (const entry of result) {
        expect(entry.pid).toBeGreaterThan(0)
        expect(entry.name.length).toBeGreaterThan(0)
      }
    } finally {
      child.send('close')
      await new Promise<void>((resolve) => {
        child.on('exit', () => resolve())
      })
      try {
        fs.unlinkSync(tmpFile)
      } catch {}
    }
  })
})
