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
  flushAppLog,
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
    writeOperationOutput('nope')
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

  it('captures patched console output after init', async () => {
    initAppLog({ dir: tmpDir })
    console.error('handler exploded', { code: 2 })
    await flushAppLog()
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

  it('tees operation output verbatim', async () => {
    initAppLog({ dir: tmpDir })
    expect(getAppLogPath()).toBe(path.join(tmpDir, 'app.log'))
    writeOperationOutput('> uv pip install torch\n')
    await flushAppLog()
    expect(read()).toContain('> uv pip install torch')
  })
})
