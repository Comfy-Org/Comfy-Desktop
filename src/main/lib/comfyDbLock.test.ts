import { execFileSync, spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const dirs = vi.hoisted(() => ({ state: '' }))
vi.mock('./paths', () => ({ stateDir: () => dirs.state }))
// The real OS lookup, watched: the record path must never consult it.
vi.mock('./file-lock-info', async (importOriginal) => {
  const real = await importOriginal<typeof FileLockInfo>()
  return { ...real, findLockingProcesses: vi.fn(real.findLockingProcesses) }
})

import {
  databaseCandidates,
  identifyDbLockHolder,
  findDbLockOffer,
  isDbLockFailure,
  readHolderRecord,
  runsMainPy,
  stopDbLockOffer
} from './comfyDbLock'
import { isPidAlive, readStartTimes } from './processIdentity'
import { findLockingProcesses } from './file-lock-info'
import type * as FileLockInfo from './file-lock-info'
import type { DbLockOffer } from '../../types/ipc'

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

  it('takes the last of a repeated flag, as ComfyUI does', () => {
    const a = path.resolve('/a/comfyui.db')
    const b = path.resolve('/b/comfyui.db')
    const args = ['-s', main, '--database-url', `sqlite:///${a}`, `--database-url=sqlite:///${b}`]
    expect(databaseCandidates(cwd, args)).toEqual([b])
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

/** A stand-in ComfyUI writing the holder record contract (see the fixture's own header). */
const RECORDING_HOLDER = path.join(__dirname, '__fixtures__', 'db-lock-recording-holder.py')

describe.runIf(process.platform === 'linux' && hasTool('python3', '--version'))(
  'database-lock holder records (real holder writing the record contract)',
  () => {
    let root: string
    let install: string
    let db: string
    const spawned: ReturnType<typeof spawn>[] = []
    /** Run the holder from `script` (inside the install unless told otherwise). */
    const hold = async (
      opts: {
        outside?: boolean
        child?: boolean
        exit?: boolean
        parent?: 'sh'
        /** The database path the holder is given (default: the real one). */
        via?: string
      } = {}
    ): Promise<{ pid: number; child: number }> => {
      const dir = opts.outside ? path.join(root, 'elsewhere') : path.join(install, 'ComfyUI')
      const script = path.join(dir, 'main.py')
      fs.mkdirSync(dir, { recursive: true })
      fs.copyFileSync(RECORDING_HOLDER, script)
      const args = [
        script,
        `${opts.via ?? db}.lock`,
        ...(opts.child ? ['child'] : opts.exit ? ['exit'] : [])
      ]
      // With `sh` as the parent, it execs into sleep, which never reaps the holder it started.
      const h =
        opts.parent === 'sh'
          ? spawn('sh', ['-c', `python3 ${args.map((a) => `'${a}'`).join(' ')} & exec sleep 60`], {
              stdio: ['ignore', 'pipe', 'ignore'],
              detached: true
            })
          : spawn('python3', args, { stdio: ['ignore', 'pipe', 'ignore'], detached: true })
      spawned.push(h)
      const line = await new Promise<string>((r) => h.stdout!.once('data', (d) => r(String(d))))
      const [pid, child] = line.trim().split(' ').map(Number)
      return { pid: pid!, child: child! }
    }
    const find = (): ReturnType<typeof findDbLockOffer> =>
      findDbLockOffer({ installationId: 'inst-1', installPath: install, dbPath: db })
    const gone = async (pid: number): Promise<boolean> => {
      for (let i = 0; i < 100 && isPidAlive(pid); i++) await new Promise((r) => setTimeout(r, 50))
      return !isPidAlive(pid)
    }

    beforeEach(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'db-holder-record-'))
      dirs.state = path.join(root, 'state')
      install = path.join(root, 'install')
      fs.mkdirSync(path.join(install, 'ComfyUI', 'user'), { recursive: true })
      db = path.join(install, 'ComfyUI', 'user', 'comfyui.db')
    })
    afterEach(() => {
      for (const h of spawned.splice(0)) {
        try {
          process.kill(-h.pid!, 'SIGKILL')
        } catch {}
      }
      fs.rmSync(root, { recursive: true, force: true })
    })

    it("offers this install's ComfyUI from its record, and stops it alone, not its group", async () => {
      const { pid, child } = await hold({ child: true })
      const offer = await find()
      expect(offer).toEqual({
        pid,
        startTime: expect.stringMatching(/^[0-9a-f-]+:\d+$/),
        process: 'ComfyUI',
        sameInstall: true
      })
      expect(await stopDbLockOffer(offer!, db)).toBe(true)
      // The stop waited for it: no longer running the moment it answers.
      expect((await readStartTimes([pid]))?.has(pid)).toBe(false)
      // Still running, not a zombie (which `isPidAlive` would also count).
      expect((await readStartTimes([child]))?.has(child)).toBe(true)
      process.kill(child, 'SIGKILL')
    }, 20_000)

    it("names a ComfyUI of another install by its main.py, as not this install's", async () => {
      const { pid } = await hold({ outside: true })
      expect(await find()).toMatchObject({
        pid,
        process: path.join(root, 'elsewhere', 'main.py'),
        sameInstall: false
      })
    }, 20_000)

    it('ignores a record whose process is gone or whose pid now names another process', async () => {
      const { pid } = await hold()
      const record = JSON.parse(fs.readFileSync(`${db}.lock.json`, 'utf-8'))
      fs.writeFileSync(`${db}.lock.json`, JSON.stringify({ ...record, started: 'x:1' }))
      expect(await readHolderRecord(db)).toBeNull()
      fs.writeFileSync(`${db}.lock.json`, JSON.stringify(record))
      expect(await readHolderRecord(db)).toMatchObject({ pid })
      process.kill(-pid, 'SIGKILL')
      expect(await gone(pid)).toBe(true)
      // A crash leaves the record behind.
      expect(fs.existsSync(`${db}.lock.json`)).toBe(true)
      expect(await readHolderRecord(db)).toBeNull()
      expect(await find()).toBeNull()
      fs.writeFileSync(`${db}.lock.json`, '{not json')
      expect(await readHolderRecord(db)).toBeNull()
    }, 20_000)

    it('matches its database through a symlinked install, as ComfyUI resolves it', async () => {
      // ComfyUI records the resolved path; Desktop reaches the install through the link.
      const link = path.join(root, 'linked')
      fs.symlinkSync(install, link)
      const { pid } = await hold()
      fs.writeFileSync(db, '')
      const viaLink = path.join(link, 'ComfyUI', 'user', 'comfyui.db')
      expect(await readHolderRecord(viaLink)).toMatchObject({ pid })
    }, 20_000)

    it('matches a record that names the database through a symlink (an explicit path)', async () => {
      const link = path.join(root, 'linked')
      fs.symlinkSync(install, link)
      const viaLink = path.join(link, 'ComfyUI', 'user', 'comfyui.db')
      const { pid } = await hold({ via: viaLink })
      expect(JSON.parse(fs.readFileSync(`${db}.lock.json`, 'utf8')).db).toBe(viaLink)
      expect(await readHolderRecord(db)).toMatchObject({ pid })
    }, 20_000)

    it('matches it through a symlinked install before the database file exists', async () => {
      // ComfyUI takes the lock (and writes the record) before it creates the database.
      const link = path.join(root, 'linked')
      fs.symlinkSync(install, link)
      const { pid } = await hold()
      expect(fs.existsSync(db)).toBe(false)
      const viaLink = path.join(link, 'ComfyUI', 'user', 'comfyui.db')
      expect(await readHolderRecord(viaLink)).toMatchObject({ pid })
    }, 20_000)

    it('tells apart databases whose paths differ only by case on a case-sensitive file system', async () => {
      const { pid } = await hold()
      fs.writeFileSync(db, '')
      const other = path.join(root, 'INSTALL', 'ComfyUI', 'user', 'comfyui.db')
      fs.mkdirSync(path.dirname(other), { recursive: true })
      fs.writeFileSync(other, '')
      fs.copyFileSync(`${db}.lock.json`, `${other}.lock.json`)
      expect(await readHolderRecord(other)).toBeNull()
      expect(await readHolderRecord(db)).toMatchObject({ pid })
    }, 20_000)

    it('tells them apart too before either database file exists (compared by path, not case-folded)', async () => {
      const { pid } = await hold()
      const other = path.join(root, 'INSTALL', 'ComfyUI', 'user', 'comfyui.db')
      fs.mkdirSync(path.dirname(other), { recursive: true })
      fs.copyFileSync(`${db}.lock.json`, `${other}.lock.json`)
      expect(await readHolderRecord(other)).toBeNull()
      expect(await readHolderRecord(db)).toMatchObject({ pid })
    }, 20_000)

    // Root reads anything: only meaningful as an ordinary user.
    it.skipIf(process.getuid?.() === 0)(
      'reads a record it may not open (another account, mode 0600) as none',
      async () => {
        await hold()
        fs.chmodSync(`${db}.lock.json`, 0o000)
        try {
          expect(await readHolderRecord(db)).toBeNull()
        } finally {
          fs.chmodSync(`${db}.lock.json`, 0o600)
        }
      },
      20_000
    )

    it('offers nothing while a holder keeps the lock with no record, or a stale one: no OS lookup', async () => {
      const { pid } = await hold()
      vi.mocked(findLockingProcesses).mockClear()
      fs.rmSync(`${db}.lock.json`)
      // A fallback to lsof would name it: it holds the lock right now.
      expect(await find()).toBeNull()
      fs.writeFileSync(`${db}.lock.json`, JSON.stringify({ pid, started: 'x:1', db, main: 'm' }))
      expect(await find()).toBeNull()
      expect(isPidAlive(pid)).toBe(true)
      expect(findLockingProcesses).not.toHaveBeenCalled()
    }, 20_000)

    it('ignores the record of a holder that exited cleanly (ComfyUI never removes it)', async () => {
      const { pid } = await hold({ exit: true })
      expect(await gone(pid)).toBe(true)
      expect(fs.existsSync(`${db}.lock.json`)).toBe(true)
      expect(await find()).toBeNull()
    }, 20_000)

    it('ignores a live record copied beside another database (an install copied while running)', async () => {
      const { pid } = await hold()
      const copy = path.join(root, 'copy', 'ComfyUI', 'user', 'comfyui.db')
      fs.mkdirSync(path.dirname(copy), { recursive: true })
      fs.copyFileSync(`${db}.lock.json`, `${copy}.lock.json`)
      expect(await readHolderRecord(copy)).toBeNull()
      expect(await readHolderRecord(db)).toMatchObject({ pid })
    }, 20_000)

    it('stops nothing once another ComfyUI took the lock, or after a cancel', async () => {
      const first = await hold()
      const offer = (await find()) as DbLockOffer
      const cancelled = new AbortController()
      cancelled.abort()
      expect(await stopDbLockOffer(offer, db, cancelled.signal)).toBe(false)
      expect(isPidAlive(first.pid)).toBe(true)
      process.kill(-first.pid, 'SIGKILL')
      expect(await gone(first.pid)).toBe(true)
      const second = await hold()
      expect(await stopDbLockOffer(offer, db)).toBe(false)
      expect(await stopDbLockOffer({ ...offer, pid: second.pid }, db)).toBe(false)
      expect(isPidAlive(second.pid)).toBe(true)
    }, 20_000)

    it('counts a holder its parent never reaps (a zombie) as stopped', async () => {
      const { pid } = await hold({ parent: 'sh' })
      const offer = (await find()) as DbLockOffer
      expect(offer.pid).toBe(pid)
      expect(await stopDbLockOffer(offer, db)).toBe(true)
      expect(fs.readFileSync(`/proc/${pid}/stat`, 'utf-8').split(' ')[2]).toBe('Z')
    }, 15_000)
  }
)
