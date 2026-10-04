import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  coreHasDatabase,
  performanceTestSessionKey,
  performanceTestWorkspace,
  removePerformanceTestWorkspace,
  removePerformanceTestWorkspaceSoon,
  sessionKindOf,
  withPerformanceTestWorkspace
} from './performanceTestWorkspace'

const WS = path.join(os.tmpdir(), 'ws')
const WORKSPACE_ARGS = [
  '--database-url',
  `sqlite:///${path.join(WS, 'comfyui.db')}`,
  '--output-directory',
  path.join(WS, 'output'),
  '--temp-directory',
  WS
]

describe('withPerformanceTestWorkspace', () => {
  it.each([
    [['-s', 'main.py', '--database-url', 'sqlite:///a.db', '--port', '1']],
    [['-s', 'main.py', '--database-url=sqlite:///a.db', '--port', '1']],
    [['-s', 'main.py', '--output-directory', '/out', '--port', '1', '--output-directory=/o2']],
    [
      ['-s', 'main.py', '--temp-directory', '/t', '--database-url', 'sqlite:///a.db', '--port', '1']
    ],
    [['-s', 'main.py', '--port', '1']]
  ])('points %j at the workspace, each flag once', (args) => {
    expect(withPerformanceTestWorkspace(args, WS)).toEqual([
      '-s',
      'main.py',
      '--port',
      '1',
      ...WORKSPACE_ARGS
    ])
  })
})

describe('sessionKindOf', () => {
  it('tells a Performance Test session from the install session', () => {
    expect(sessionKindOf(performanceTestSessionKey('inst-1'))).toBe('performance_test')
    expect(sessionKindOf('inst-1')).toBe('normal')
  })
})

describe('performanceTestWorkspace', () => {
  it('is one directory per install under the given base, whatever the id holds', () => {
    expect(performanceTestWorkspace('/state', 'inst/../x:1')).toBe(
      path.join('/state', 'perf-test', 'inst____x_1')
    )
    expect(performanceTestWorkspace('/state', 'a')).not.toBe(
      performanceTestWorkspace('/state', 'b')
    )
  })
})

describe('coreHasDatabase and removePerformanceTestWorkspace', () => {
  let dir = ''
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-ws-'))
  })
  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('finds the database module of a Core that has one', () => {
    expect(coreHasDatabase(dir)).toBe(false)
    fs.mkdirSync(path.join(dir, 'app', 'database'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'app', 'database', 'db.py'), '')
    expect(coreHasDatabase(dir)).toBe(true)
  })

  it('removes the whole workspace and nothing beside it', () => {
    const ws = path.join(dir, 'perf-test', 'inst')
    fs.mkdirSync(path.join(ws, 'output'), { recursive: true })
    fs.writeFileSync(path.join(ws, 'comfyui.db'), 'x')
    fs.writeFileSync(path.join(ws, 'output', 'a.png'), 'x')
    fs.writeFileSync(path.join(dir, 'other'), 'x')

    removePerformanceTestWorkspace(ws)

    expect(fs.existsSync(ws)).toBe(false)
    expect(fs.existsSync(path.join(dir, 'other'))).toBe(true)
    expect(() => removePerformanceTestWorkspace(ws)).not.toThrow()
  })

  it('leaves a workspace it cannot remove (a file still open on Windows) without throwing', () => {
    vi.spyOn(fs, 'rmSync').mockImplementation(() => {
      throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
    })
    expect(() => removePerformanceTestWorkspace(path.join(dir, 'ws'))).not.toThrow()
  })
})

describe('removePerformanceTestWorkspaceSoon', () => {
  let dir = ''
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-ws-soon-'))
    fs.mkdirSync(path.join(dir, 'output'))
    fs.writeFileSync(path.join(dir, 'comfyui.db-wal'), 'x')
  })
  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  /** Files still held for the first `n` attempts, as Windows holds a just-exited process's. */
  function heldFor(n: number): void {
    const real = fs.rmSync
    let calls = 0
    vi.spyOn(fs, 'rmSync').mockImplementation((...args) => {
      if (calls++ < n) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' })
      return real(...args)
    })
  }

  it('retries until the files are released', async () => {
    heldFor(2)
    await removePerformanceTestWorkspaceSoon(dir, () => true, 1)
    expect(fs.existsSync(dir)).toBe(false)
  })

  it('stops, leaving the workspace, once a new run owns it', async () => {
    heldFor(1)
    await removePerformanceTestWorkspaceSoon(dir, () => false, 1)
    expect(fs.existsSync(path.join(dir, 'comfyui.db-wal'))).toBe(true)
  })
})
