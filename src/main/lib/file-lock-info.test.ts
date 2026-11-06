import { describe, it, expect } from 'vitest'
import { findLockingProcesses, type LockingProcess, type LockProbeResult } from './file-lock-info'
import { fork } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'

describe('findLockingProcesses', { timeout: 30_000 }, () => {
  function expectWellFormedProbe(result: LockProbeResult): void {
    if (result.ok) {
      expect(Array.isArray(result.processes)).toBe(true)
    } else {
      expect(['timeout', 'unavailable']).toContain(result.reason)
    }
  }

  it('returns a well-formed result for a file not locked by any process', async () => {
    const tmpFile = path.join(os.tmpdir(), `file-lock-test-${Date.now()}.txt`)
    fs.writeFileSync(tmpFile, 'test')
    try {
      expectWellFormedProbe(await findLockingProcesses(tmpFile))
    } finally {
      try {
        fs.unlinkSync(tmpFile)
      } catch {}
    }
  })

  it('finds nothing holding a non-existent file', async () => {
    const result = await findLockingProcesses('/tmp/nonexistent-file-lock-test-' + Date.now())
    expectWellFormedProbe(result)
    if (result.ok) expect(result.processes).toEqual([])
  })

  it('returns results with pid and name fields', async () => {
    const tmpFile = path.join(os.tmpdir(), `file-lock-shape-test-${Date.now()}.txt`)
    fs.writeFileSync(tmpFile, 'test')
    try {
      const result = await findLockingProcesses(tmpFile)
      expectWellFormedProbe(result)
      for (const entry of result.ok ? result.processes : []) {
        expect(typeof entry.pid).toBe('number')
        expect(typeof entry.name).toBe('string')
      }
    } finally {
      try {
        fs.unlinkSync(tmpFile)
      } catch {}
    }
  })

  async function probeUntilHolderFound(
    filePath: string,
    pid: number,
    attempts = 3
  ): Promise<LockingProcess[]> {
    let result: LockingProcess[] = []
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, attempt * 1000))
      const probe = await findLockingProcesses(filePath)
      result = probe.ok ? probe.processes : []
      if (result.some((entry) => entry.pid === pid)) break
    }
    return result
  }

  it('detects a process holding a file open', { timeout: 60_000 }, async () => {
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
