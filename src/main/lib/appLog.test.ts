import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

// appLog imports `app` from electron only for the default log dir; tests
// inject an explicit dir so the mock just needs to exist.
vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() }
}))

import {
  initAppLog,
  writeAppLog,
  writeAppLogSync,
  writeOperationOutput,
  flushOperationOutput,
  getAppLogPath,
  resetAppLogForTest
} from './appLog'

describe('appLog', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-log-'))
  })

  afterEach(() => {
    resetAppLogForTest()
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function read(): string {
    return fs.readFileSync(path.join(tmpDir, 'app.log'), 'utf8')
  }

  it('is a no-op before init', () => {
    writeAppLog('INFO', 'should not write')
    writeOperationOutput('inst-1', 'nope')
    expect(fs.existsSync(path.join(tmpDir, 'app.log'))).toBe(false)
  })

  it('writes a synchronous crash line that survives without a flush', () => {
    initAppLog({ dir: tmpDir })
    writeAppLogSync('CRITICAL', 'boom')
    expect(read()).toContain('[CRITICAL] boom')
  })

  it('strips ANSI escape codes before writing', () => {
    initAppLog({ dir: tmpDir })
    writeAppLogSync('INFO', '\u001b[31mred\u001b[0m text')
    expect(read()).toContain('red text')
    expect(read()).not.toContain('\u001b[31m')
  })

  it('scrubs credentials and usernames before writing', () => {
    initAppLog({ dir: tmpDir })
    writeAppLogSync('INFO', 'pip install --index-url https://user:tok@mirror.example/simple')
    writeAppLogSync('INFO', 'C:\\Users\\alice\\AppData\\comfy')
    const out = read()
    expect(out).toContain('//[REDACTED]@')
    expect(out).not.toContain('user:tok@')
    expect(out).toContain('C:\\Users\\[REDACTED]')
    expect(out).not.toContain('alice')
  })

  it('captures patched console output after init', () => {
    initAppLog({ dir: tmpDir })
    console.error('handler exploded', { code: 2 })
    expect(read()).toContain('[ERROR] handler exploded')
  })

  it('rotates the previous session log on init and keeps history', () => {
    initAppLog({ dir: tmpDir })
    writeAppLogSync('INFO', 'session one')
    resetAppLogForTest()

    initAppLog({ dir: tmpDir })
    writeAppLogSync('INFO', 'session two')

    const files = fs.readdirSync(tmpDir)
    const rotated = files.filter((f) =>
      /^app\.log_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.log$/.test(f)
    )
    expect(rotated).toHaveLength(1)
    expect(fs.readFileSync(path.join(tmpDir, rotated[0]!), 'utf8')).toContain('session one')
    expect(read()).toContain('session two')
    expect(read()).not.toContain('session one')
  })

  it('tees operation output once a line completes', () => {
    initAppLog({ dir: tmpDir })
    expect(getAppLogPath()).toBe(path.join(tmpDir, 'app.log'))
    writeOperationOutput('inst-1', '> uv pip install torch\n')
    expect(read()).toContain('> uv pip install torch')
  })

  it('scrubs a credential split across two operation chunks', () => {
    initAppLog({ dir: tmpDir })
    // The secret straddles the chunk boundary; per-chunk scrubbing would miss it.
    writeOperationOutput('inst-1', 'downloading from https://user:to')
    writeOperationOutput('inst-1', 'ken@mirror.example/simple\n')
    const out = read()
    expect(out).toContain('//[REDACTED]@')
    expect(out).not.toContain('user:token@')
  })

  it('does not interleave partial lines from concurrent installations', () => {
    initAppLog({ dir: tmpDir })
    writeOperationOutput('inst-a', 'alpha-')
    writeOperationOutput('inst-b', 'beta-')
    writeOperationOutput('inst-a', 'one\n')
    writeOperationOutput('inst-b', 'two\n')
    const out = read()
    expect(out).toContain('alpha-one')
    expect(out).toContain('beta-two')
  })

  it('flushes the final unterminated line on flushOperationOutput', () => {
    initAppLog({ dir: tmpDir })
    writeOperationOutput('inst-1', 'no trailing newline here')
    expect(read()).not.toContain('no trailing newline here')
    flushOperationOutput()
    expect(read()).toContain('no trailing newline here')
  })

  it('never rotates on the crash path, so a crash line past the cap is not dropped', () => {
    const isRotated = (f: string): boolean =>
      /^app\.log_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.log$/.test(f)
    initAppLog({ dir: tmpDir })
    // Fill the live log to exactly the 5 MB cap (the line's `[ts] [INFO] ..\n`
    // framing adds 35 bytes) without crossing it, so no rotation happens here.
    writeAppLog('INFO', 'x'.repeat(5 * 1024 * 1024 - 35))
    expect(fs.readdirSync(tmpDir).filter(isRotated)).toHaveLength(0)
    // The crash line crosses the cap; rotation here could fail and drop it, so
    // the crash path must append in place instead of rotating.
    writeAppLogSync('CRITICAL', 'final breath')
    expect(fs.readdirSync(tmpDir).filter(isRotated)).toHaveLength(0)
    expect(read()).toContain('[CRITICAL] final breath')
    // A later normal write is free to rotate the overage.
    writeAppLog('INFO', 'after crash')
    expect(fs.readdirSync(tmpDir).filter(isRotated)).toHaveLength(1)
  })

  it('flushes a buffered tail on the crash path without rotating past the cap', () => {
    const isRotated = (f: string): boolean =>
      /^app\.log_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.log$/.test(f)
    initAppLog({ dir: tmpDir })
    // A partial operation line with no trailing newline stays buffered.
    writeOperationOutput('inst-1', 'dying mid-line, no newline')
    // Fill the live log to exactly the 5 MB cap.
    writeAppLog('INFO', 'x'.repeat(5 * 1024 * 1024 - 35))
    expect(fs.readdirSync(tmpDir).filter(isRotated)).toHaveLength(0)
    // The crash-path flush (as called from processErrorHandlers) must append
    // the tail in place rather than rotate, which could drop it.
    flushOperationOutput(undefined, { rotate: false })
    expect(fs.readdirSync(tmpDir).filter(isRotated)).toHaveLength(0)
    expect(read()).toContain('dying mid-line, no newline')
  })

  it('flushes only the targeted installation, leaving others buffered', () => {
    initAppLog({ dir: tmpDir })
    writeOperationOutput('inst-a', 'partial-a')
    writeOperationOutput('inst-b', 'partial-b')
    flushOperationOutput('inst-a')
    const out = read()
    expect(out).toContain('partial-a')
    expect(out).not.toContain('partial-b')
  })
})
