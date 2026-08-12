import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  getSafeFileDiagnostics,
  readFileSafe,
  readFileSafeAsync,
  writeFileSafe,
  writeFileSafeAsync
} from './safe-file'

/**
 * Pins the `.bak` semantics that keep the startup-update loop-breaker marker
 * alive (issue #1367): transient locks are retried, a locked primary is served
 * from `.bak` WITHOUT restoring it (the primary is typically newer, so a
 * restore would roll back the most recent writes), and `.bak` is only restored
 * when the primary is genuinely missing or empty.
 */

function errnoError(code: string): NodeJS.ErrnoException {
  const err = new Error(`fake ${code}`) as NodeJS.ErrnoException
  err.code = code
  return err
}

let dir: string
let filePath: string
let bakPath: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-file-test-'))
  filePath = path.join(dir, 'settings.json')
  bakPath = filePath + '.bak'
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('writeFileSafe', () => {
  it('writes atomically and keeps the previous content in .bak', () => {
    writeFileSafe(filePath, 'first', { backup: true })
    writeFileSafe(filePath, 'second', { backup: true })
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('second')
    expect(fs.readFileSync(bakPath, 'utf-8')).toBe('first')
  })

  it('durable: fsyncs the temp file before the rename publishes it', () => {
    const order: string[] = []
    const realFsync = fs.fsyncSync.bind(fs)
    vi.spyOn(fs, 'fsyncSync').mockImplementation((fd) => {
      order.push('fsync')
      realFsync(fd)
    })
    const realRename = fs.renameSync.bind(fs)
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      order.push('rename')
      realRename(from, to)
    })

    writeFileSafe(filePath, 'data', { durable: true })
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('data')
    // The temp-file fsync must land BEFORE the rename publishes the file;
    // fsyncing only after would leave a window where a power cut publishes
    // unsynced bytes. (A post-rename directory fsync may add more entries.)
    expect(order[0]).toBe('fsync')
    expect(order).toContain('rename')
  })

  it('retries the rename through transient Windows locks (EPERM/EACCES/EBUSY)', () => {
    const realRename = fs.renameSync.bind(fs)
    let failures = 2
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (failures > 0) {
        failures--
        throw errnoError('EBUSY')
      }
      realRename(from, to)
    })

    writeFileSafe(filePath, 'data')
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('data')
    expect(fs.existsSync(filePath + '.tmp')).toBe(false)
  })

  it('throws and cleans up the tmp file on a non-transient rename error', () => {
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw errnoError('EXDEV')
    })

    expect(() => writeFileSafe(filePath, 'data')).toThrow()
    expect(fs.existsSync(filePath + '.tmp')).toBe(false)
    expect(fs.existsSync(filePath)).toBe(false)
  })
})

describe('readFileSafe', () => {
  it('returns the primary content when readable', () => {
    fs.writeFileSync(filePath, 'primary')
    fs.writeFileSync(bakPath, 'stale backup')
    expect(readFileSafe(filePath)).toEqual({ kind: 'data', data: 'primary' })
  })

  it('retries a transiently locked primary and returns its (newer) content', () => {
    fs.writeFileSync(filePath, 'newer primary')
    fs.writeFileSync(bakPath, 'stale backup')

    const realRead = fs.readFileSync.bind(fs) as typeof fs.readFileSync
    let failures = 2
    vi.spyOn(fs, 'readFileSync').mockImplementation(((
      p: fs.PathOrFileDescriptor,
      opts?: unknown
    ) => {
      if (p === filePath && failures > 0) {
        failures--
        throw errnoError('EPERM')
      }
      return realRead(p, opts as BufferEncoding)
    }) as typeof fs.readFileSync)

    expect(readFileSafe(filePath)).toEqual({ kind: 'data', data: 'newer primary' })
  })

  it('serves .bak WITHOUT restoring it when the primary stays locked (issue #1367)', () => {
    fs.writeFileSync(filePath, 'newer primary')
    fs.writeFileSync(bakPath, 'stale backup')

    const realRead = fs.readFileSync.bind(fs) as typeof fs.readFileSync
    vi.spyOn(fs, 'readFileSync').mockImplementation(((
      p: fs.PathOrFileDescriptor,
      opts?: unknown
    ) => {
      if (p === filePath) throw errnoError('EPERM') // lock never clears
      return realRead(p, opts as BufferEncoding)
    }) as typeof fs.readFileSync)
    const copySpy = vi.spyOn(fs, 'copyFileSync')

    // `primaryUnreadable` tells read-modify-write callers to fail closed:
    // saving state derived from this stale backup would overwrite the newer
    // locked primary once the lock clears.
    expect(readFileSafe(filePath)).toEqual({
      kind: 'data',
      data: 'stale backup',
      primaryUnreadable: true
    })
    // The primary still exists and is newer - restoring .bak over it would
    // roll back the most recent writes (the bug behind the update loop).
    expect(copySpy).not.toHaveBeenCalled()
    vi.restoreAllMocks()
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('newer primary')
  })

  it('retries a transiently locked .bak too (primary missing)', () => {
    fs.writeFileSync(bakPath, 'backup')

    const realRead = fs.readFileSync.bind(fs) as typeof fs.readFileSync
    let failures = 2
    vi.spyOn(fs, 'readFileSync').mockImplementation(((
      p: fs.PathOrFileDescriptor,
      opts?: unknown
    ) => {
      if (p === bakPath && failures > 0) {
        failures--
        throw errnoError('EACCES')
      }
      return realRead(p, opts as BufferEncoding)
    }) as typeof fs.readFileSync)

    expect(readFileSafe(filePath)).toEqual({ kind: 'data', data: 'backup' })
  })

  it('restores .bak over a genuinely missing primary and counts the fallback', () => {
    fs.writeFileSync(bakPath, 'backup')
    // The counter is process-wide and monotonic, so assert the delta - it is
    // the field signal (telemetry `bakFallbacks`) for issue #1367 machines.
    const before = getSafeFileDiagnostics().bakFallbacks
    expect(readFileSafe(filePath)).toEqual({ kind: 'data', data: 'backup' })
    expect(getSafeFileDiagnostics().bakFallbacks).toBe(before + 1)
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('backup')
  })

  it('restores .bak over an empty primary', () => {
    fs.writeFileSync(filePath, '')
    fs.writeFileSync(bakPath, 'backup')
    expect(readFileSafe(filePath)).toEqual({ kind: 'data', data: 'backup' })
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('backup')
  })

  it('reports absent when both the primary and .bak are missing', () => {
    expect(readFileSafe(filePath)).toEqual({ kind: 'absent' })
  })

  it('reports unreadable - NOT absent - when the primary stays locked and no .bak exists', () => {
    // The file's real content is unknown; treating it as absent would let a
    // later save overwrite the intact file with reconstructed defaults.
    fs.writeFileSync(filePath, 'locked content')
    const realRead = fs.readFileSync.bind(fs) as typeof fs.readFileSync
    vi.spyOn(fs, 'readFileSync').mockImplementation(((
      p: fs.PathOrFileDescriptor,
      opts?: unknown
    ) => {
      if (p === filePath) throw errnoError('EPERM') // lock never clears
      return realRead(p, opts as BufferEncoding)
    }) as typeof fs.readFileSync)

    expect(readFileSafe(filePath)).toEqual({ kind: 'unreadable' })
  })
})

describe('writeFileSafeAsync', () => {
  it('retries the rename through transient locks', async () => {
    const realRename = fs.promises.rename.bind(fs.promises)
    let failures = 2
    vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
      if (failures > 0) {
        failures--
        throw errnoError('EBUSY')
      }
      await realRename(from, to)
    })

    await writeFileSafeAsync(filePath, 'data')
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('data')
  })
})

describe('readFileSafeAsync', () => {
  it('serves .bak WITHOUT restoring it when the primary stays locked (issue #1367)', async () => {
    fs.writeFileSync(filePath, 'newer primary')
    fs.writeFileSync(bakPath, 'stale backup')

    const realRead = fs.promises.readFile.bind(fs.promises) as typeof fs.promises.readFile
    vi.spyOn(fs.promises, 'readFile').mockImplementation(((
      p: Parameters<typeof fs.promises.readFile>[0],
      opts?: unknown
    ) => {
      if (p === filePath) return Promise.reject(errnoError('EPERM'))
      return realRead(p, opts as BufferEncoding)
    }) as typeof fs.promises.readFile)
    const copySpy = vi.spyOn(fs.promises, 'copyFile')

    expect(await readFileSafeAsync(filePath)).toEqual({
      kind: 'data',
      data: 'stale backup',
      primaryUnreadable: true
    })
    expect(copySpy).not.toHaveBeenCalled()
    vi.restoreAllMocks()
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('newer primary')
  })

  it('restores .bak over a genuinely missing primary and counts the fallback', async () => {
    fs.writeFileSync(bakPath, 'backup')
    const before = getSafeFileDiagnostics().bakFallbacks
    expect(await readFileSafeAsync(filePath)).toEqual({ kind: 'data', data: 'backup' })
    expect(getSafeFileDiagnostics().bakFallbacks).toBe(before + 1)
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('backup')
  })

  it('reports unreadable when the primary stays locked and no .bak exists', async () => {
    fs.writeFileSync(filePath, 'locked content')
    const realRead = fs.promises.readFile.bind(fs.promises) as typeof fs.promises.readFile
    vi.spyOn(fs.promises, 'readFile').mockImplementation(((
      p: Parameters<typeof fs.promises.readFile>[0],
      opts?: unknown
    ) => {
      if (p === filePath) return Promise.reject(errnoError('EPERM'))
      return realRead(p, opts as BufferEncoding)
    }) as typeof fs.promises.readFile)

    expect(await readFileSafeAsync(filePath)).toEqual({ kind: 'unreadable' })
  })
})
