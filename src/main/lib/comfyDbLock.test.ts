import { execFileSync, spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { describe, expect, it, vi } from 'vitest'

const dirs = vi.hoisted(() => ({ state: '' }))
vi.mock('./paths', () => ({ stateDir: () => dirs.state }))

import { writeRecord } from './comfyProcessRecord'
import {
  databaseCandidates,
  identifyDbLockHolder,
  isDbLockFailure,
  runsMainPy
} from './comfyDbLock'

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

describe('runsMainPy', () => {
  it.each([
    ['C:\\Python\\python.exe -s ComfyUI\\main.py --port 8188', true],
    ['"C:\\Python\\python.exe" "main.py" --listen', true],
    ['/usr/bin/python3 main.py', true],
    ['/opt/c/.venv/bin/python -s /opt/c/ComfyUI/main.py', true],
    ['python.exe -m pip install torch', false],
    ['python.exe domain.py', false],
    ['python.exe main.pyc', false],
    ['', false]
  ])('%s -> %s', (cmd, expected) => {
    expect(runsMainPy(cmd)).toBe(expected)
  })
})

function hasTool(cmd: string, versionFlag: string): boolean {
  try {
    execFileSync(cmd, [versionFlag], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

describe.runIf(
  process.platform === 'linux' && hasTool('python3', '--version') && hasTool('lsof', '-v')
)('identifyDbLockHolder (real lock holder)', () => {
  it('names a main.py holding the lock file, with its age, and not as this install', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'db-lock-holder-'))
    dirs.state = path.join(root, 'state')
    const install = path.join(root, 'install')
    const other = path.join(root, 'elsewhere')
    fs.mkdirSync(path.join(install, 'ComfyUI', 'user'), { recursive: true })
    fs.mkdirSync(other, { recursive: true })
    const lockFile = path.join(install, 'ComfyUI', 'user', 'comfyui.db.lock')
    // A stand-in for a ComfyUI Desktop did not start: a script called main.py outside the
    // install, holding the same flock ComfyUI takes.
    fs.writeFileSync(
      path.join(other, 'main.py'),
      `import fcntl, os, sys, time\nfd = os.open(sys.argv[1], os.O_RDWR | os.O_CREAT)\nfcntl.flock(fd, fcntl.LOCK_EX)\nprint('locked', flush=True)\ntime.sleep(60)\n`
    )
    const holder = spawn('python3', [path.join(other, 'main.py'), lockFile], {
      stdio: ['ignore', 'pipe', 'ignore']
    })
    try {
      await new Promise((r) => holder.stdout!.once('data', r))
      const found = await identifyDbLockHolder({
        sessionKey: 'inst-1',
        installationId: 'inst-1',
        installPath: install,
        cwd: install,
        args: ['-s', path.join('ComfyUI', 'main.py')],
        // lsof walks the whole process table: on a loaded machine it can exceed the product's
        // 10 s cap, which this test is not about.
        probeTimeoutMs: 25_000
      })
      expect(found).toMatchObject({
        pid: holder.pid,
        source: 'lsof',
        sameInstall: false,
        runsMainPy: true
      })
      // Started just now, but how long the lookup took on a loaded machine is not this test's
      // business: no upper bound.
      expect(found!.ageS).toBeGreaterThanOrEqual(0)
    } finally {
      holder.kill('SIGKILL')
      fs.rmSync(root, { recursive: true, force: true })
    }
    // Real lsof and ps against the whole process table: seconds on a loaded machine, so the
    // probe gets its own cap and the test more than the default 5 s.
  }, 60_000)
})

describe('identifyDbLockHolder and a Performance Test of the same install', () => {
  const record = (sessionKey: string, installPath: string) => ({
    v: 1 as const,
    sessionKey,
    installationId: 'inst-1',
    installPath,
    port: 8189,
    bootId: 'b',
    spawnedAt: Date.now(),
    desktopPid: process.pid,
    desktopStartTime: null,
    // Alive: this test process.
    childPid: process.pid,
    childStartTime: null
  })

  it.each([
    ['the install session', 'performance-test:inst-1', 'inst-1', false],
    // Same kind, another session key: still blamed, so the filter is what decides.
    ['a Performance Test', 'performance-test:inst-1', 'performance-test:inst-1-other', true]
  ])(
    'for %s, blames a live record of its own kind only',
    async (_who, recorded, failing, blamed) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dblock-perf-'))
      dirs.state = path.join(root, 'state')
      try {
        expect(writeRecord(record(recorded, root))).toBe(true)
        const found = await identifyDbLockHolder({
          sessionKey: failing,
          installationId: 'inst-1',
          installPath: root,
          cwd: root,
          args: ['-s', 'main.py', '--database-url', `sqlite:///${path.join(root, 'none.db')}`]
        })
        expect(found?.source === 'desktop_record').toBe(blamed)
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    }
  )
})
