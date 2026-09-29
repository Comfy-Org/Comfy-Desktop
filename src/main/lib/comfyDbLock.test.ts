import path from 'path'
import { describe, expect, it } from 'vitest'
import { databaseCandidates, isDbLockFailure } from './comfyDbLock'

describe('isDbLockFailure', () => {
  it.each([
    "RuntimeError: Could not acquire lock on database '/x/user/comfyui.db'. Another process",
    'Database is locked. Another ComfyUI process is already using this database.',
    'Database lock held by pid 1234 (python main.py), started 10:02'
  ])('recognizes %s', (line) => {
    expect(isDbLockFailure(`noise\n${line}\nTraceback: ImportError: unrelated`)).toBe(true)
  })

  it('ignores runtime SQLite busy errors and empty tails', () => {
    expect(isDbLockFailure('sqlite3.OperationalError: database is locked')).toBe(false)
    expect(isDbLockFailure(undefined)).toBe(false)
  })
})

describe('databaseCandidates', () => {
  const cwd = path.resolve('/installs/one')
  const main = path.join('ComfyUI', 'main.py')

  it('defaults to the ComfyUI user directory', () => {
    expect(databaseCandidates(cwd, ['-s', main])).toEqual([
      path.join(cwd, 'ComfyUI', 'user', 'comfyui.db')
    ])
  })

  it('follows --user-directory, keeping the older fixed default as a second guess', () => {
    const userDir = path.resolve('/data/user')
    expect(databaseCandidates(cwd, ['-s', main, '--user-directory', userDir])).toEqual([
      path.join(userDir, 'comfyui.db'),
      path.join(cwd, 'ComfyUI', 'user', 'comfyui.db')
    ])
  })

  it('uses a pinned sqlite --database-url and ignores non-file databases', () => {
    const db = path.resolve('/legacy/user/comfyui.db')
    expect(databaseCandidates(cwd, ['-s', main, `--database-url=sqlite:///${db}`])).toEqual([db])
    expect(databaseCandidates(cwd, ['-s', main, '--database-url', 'sqlite:///:memory:'])).toEqual(
      []
    )
    expect(databaseCandidates(cwd, ['--database-url', 'postgresql://x'])).toEqual([])
  })
})
