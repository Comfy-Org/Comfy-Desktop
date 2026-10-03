import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  coreHasDatabase,
  performanceTestDbPath,
  performanceTestSessionKey,
  removePerformanceTestDb,
  sessionKindOf,
  withDatabaseUrl
} from './performanceTestDb'

const URL = 'sqlite:///tmp/perf.db'

describe('withDatabaseUrl', () => {
  it.each([
    [['-s', 'main.py', '--database-url', 'sqlite:///a.db', '--port', '1']],
    [['-s', 'main.py', '--database-url=sqlite:///a.db', '--port', '1']],
    [
      [
        '-s',
        'main.py',
        '--database-url',
        'sqlite:///a.db',
        '--database-url=sqlite:///b.db',
        '--port',
        '1'
      ]
    ],
    [['-s', 'main.py', '--port', '1']]
  ])('replaces every database URL in %j with the given one', (args) => {
    expect(withDatabaseUrl(args, URL)).toEqual([
      '-s',
      'main.py',
      '--port',
      '1',
      '--database-url',
      URL
    ])
  })
})

describe('sessionKindOf', () => {
  it('tells a Performance Test session from the install session', () => {
    expect(sessionKindOf(performanceTestSessionKey('inst-1'))).toBe('performance_test')
    expect(sessionKindOf('inst-1')).toBe('normal')
  })
})

describe('performanceTestDbPath', () => {
  it('is one file per install under the temp directory, whatever the id holds', () => {
    const p = performanceTestDbPath('inst/../x:1')
    expect(path.dirname(p)).toBe(path.join(os.tmpdir(), 'comfy-desktop-perf-db'))
    expect(path.basename(p)).toBe('inst____x_1.db')
    expect(performanceTestDbPath('a')).not.toBe(performanceTestDbPath('b'))
  })
})

describe('coreHasDatabase and removePerformanceTestDb', () => {
  let dir = ''
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-db-core-'))
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('finds the database module of a Core that has one', () => {
    expect(coreHasDatabase(dir)).toBe(false)
    fs.mkdirSync(path.join(dir, 'app', 'database'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'app', 'database', 'db.py'), '')
    expect(coreHasDatabase(dir)).toBe(true)
  })

  it('removes the database and every file SQLite and Core keep beside it, and nothing else', () => {
    const db = path.join(dir, 'perf.db')
    const side = ['', '-wal', '-shm', '-journal', '.lock', '.bkp']
    for (const s of side) fs.writeFileSync(db + s, 'x')
    fs.writeFileSync(path.join(dir, 'other.db'), 'x')

    removePerformanceTestDb(db)

    for (const s of side) expect(fs.existsSync(db + s), s || 'db').toBe(false)
    expect(fs.existsSync(path.join(dir, 'other.db'))).toBe(true)
    // Nothing there is not an error.
    expect(() => removePerformanceTestDb(db)).not.toThrow()
  })
})
