import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  coreSupportsMemoryDb,
  databaseModeOf,
  performanceTestSessionKey,
  sessionKindOf,
  withMemoryDatabase
} from './performanceTestDb'

describe('withMemoryDatabase', () => {
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
  ])('replaces every database URL in %j with the in-memory one', (args) => {
    expect(withMemoryDatabase(args)).toEqual([
      '-s',
      'main.py',
      '--port',
      '1',
      '--database-url',
      'sqlite:///:memory:'
    ])
  })
})

describe('databaseModeOf', () => {
  it.each([
    [undefined, 'file'],
    [[], 'file'],
    [['--database-url', 'sqlite:///a.db'], 'file'],
    [['--database-url', 'sqlite:///:memory:'], 'memory'],
    [['--database-url=sqlite://'], 'memory'],
    // Core's argparse keeps the last value.
    [['--database-url', 'sqlite:///:memory:', '--database-url', 'sqlite:///a.db'], 'file'],
    [['--database-url', 'sqlite:///a.db', '--database-url=sqlite:///:memory:'], 'memory']
  ] as const)('reads %j as %s', (args, mode) => {
    expect(databaseModeOf(args)).toBe(mode)
  })
})

describe('sessionKindOf', () => {
  it('tells a Performance Test session from the install session', () => {
    expect(sessionKindOf(performanceTestSessionKey('inst-1'))).toBe('performance_test')
    expect(sessionKindOf('inst-1')).toBe('normal')
  })
})

describe('coreSupportsMemoryDb', () => {
  let dir = ''
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-db-core-'))
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const writeDb = (text: string): void => {
    fs.mkdirSync(path.join(dir, 'app', 'database'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'app', 'database', 'db.py'), text)
  }

  it('is true for a Core that builds an in-memory database', () => {
    writeDb('def _is_memory_db(db_url):\n    return True\n')
    expect(coreSupportsMemoryDb(dir)).toBe(true)
  })

  it('is false for a Core from before v0.17.0', () => {
    writeDb('def init_db():\n    db_url = args.database_url\n')
    expect(coreSupportsMemoryDb(dir)).toBe(false)
  })

  it('is false when the checkout has no database module', () => {
    expect(coreSupportsMemoryDb(dir)).toBe(false)
  })
})
