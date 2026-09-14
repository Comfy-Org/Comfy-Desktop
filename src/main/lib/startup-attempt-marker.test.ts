import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  clearStartupAttemptMarker,
  readStartupAttemptMarker,
  recordStartupAttempt,
  recordStartupAttemptOutcome
} from './startup-attempt-marker'

/**
 * Issue #1367 - the durable sidecar loop-breaker marker. Its whole job is to
 * survive the boot-into-installer transition on machines where settings.json
 * gets rolled back, so these tests exercise the real filesystem in a temp
 * config dir rather than mocking fs (except where a persistent lock must be
 * simulated).
 */

let mockConfigDir: string

vi.mock('./paths', () => ({
  configDir: () => mockConfigDir
}))

const markerFile = (): string => path.join(mockConfigDir, 'startup-update-attempt.json')

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'startup-marker-test-'))
  mockConfigDir = dir
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('startup attempt marker', () => {
  it('reads absent when no marker exists', () => {
    expect(readStartupAttemptMarker()).toEqual({ state: 'absent' })
  })

  it('records, reads back, and clears a marker', () => {
    expect(recordStartupAttempt('1.0.35', 'attempt-35')).toBe(true)
    const read = readStartupAttemptMarker()
    expect(read).toMatchObject({
      state: 'present',
      marker: { version: '1.0.35', attemptId: 'attempt-35' }
    })
    expect(read.state === 'present' && read.marker.attemptedAt).toBeTruthy()

    clearStartupAttemptMarker()
    expect(readStartupAttemptMarker()).toEqual({ state: 'absent' })
    expect(fs.existsSync(markerFile())).toBe(false)
  })

  it('overwrites a previous marker with the new version', () => {
    expect(recordStartupAttempt('1.0.34', 'attempt-34')).toBe(true)
    expect(recordStartupAttempt('1.0.35', 'attempt-35')).toBe(true)
    const read = readStartupAttemptMarker()
    expect(read).toMatchObject({
      state: 'present',
      marker: { version: '1.0.35', attemptId: 'attempt-35' }
    })
  })

  it('records an emitted outcome without removing the loop-breaker', () => {
    expect(recordStartupAttempt('1.0.35', 'attempt-35')).toBe(true)
    const read = readStartupAttemptMarker()
    expect(read.state).toBe('present')
    if (read.state !== 'present') return

    recordStartupAttemptOutcome(read.marker, 'still_pending')

    expect(readStartupAttemptMarker()).toMatchObject({
      state: 'present',
      marker: {
        version: '1.0.35',
        attemptId: 'attempt-35',
        reportedOutcome: 'still_pending'
      }
    })
  })

  it('treats a corrupt marker file as absent instead of throwing', () => {
    fs.writeFileSync(markerFile(), '{not json')
    expect(readStartupAttemptMarker()).toEqual({ state: 'absent' })
  })

  it('treats valid JSON with the wrong shape as absent', () => {
    fs.writeFileSync(markerFile(), JSON.stringify({ version: 42 }))
    expect(readStartupAttemptMarker()).toEqual({ state: 'absent' })
  })

  it('reports unavailable - NOT absent - when the marker file exists but stays locked (issue #1367)', () => {
    // "Absent" is what authorizes a startup install; a persistently locked
    // marker may record an attempt of exactly the pending version, so it must
    // surface as unavailable and fail the install decision closed.
    fs.writeFileSync(markerFile(), JSON.stringify({ version: '1.0.35', attemptedAt: '' }))
    const realRead = fs.readFileSync.bind(fs) as typeof fs.readFileSync
    vi.spyOn(fs, 'readFileSync').mockImplementation(((
      p: fs.PathOrFileDescriptor,
      opts?: unknown
    ) => {
      if (p === markerFile()) {
        const err = new Error('fake EPERM') as NodeJS.ErrnoException
        err.code = 'EPERM'
        throw err
      }
      return realRead(p, opts as BufferEncoding)
    }) as typeof fs.readFileSync)

    expect(readStartupAttemptMarker()).toEqual({ state: 'unavailable' })
  })

  it('returns false when the marker cannot be persisted (fail closed)', () => {
    // Block the config dir path with a regular FILE so the write fails
    // (writeFileSafe creates missing parent dirs, so a missing dir alone is
    // not enough); the caller must treat this as "do not install".
    mockConfigDir = path.join(dir, 'blocker')
    fs.writeFileSync(mockConfigDir, 'not a directory')
    expect(recordStartupAttempt('1.0.35', 'attempt-35')).toBe(false)
  })

  it('returns false when the marker writes but cannot be read back (fail closed)', () => {
    // Let the write land, then make every read of the marker fail with a
    // non-transient error (skips the retry budget). A marker that cannot be
    // VERIFIED on disk must not authorize an install.
    const realRead = fs.readFileSync.bind(fs) as typeof fs.readFileSync
    vi.spyOn(fs, 'readFileSync').mockImplementation(((
      p: fs.PathOrFileDescriptor,
      opts?: unknown
    ) => {
      if (p === markerFile()) {
        const err = new Error('fake EIO') as NodeJS.ErrnoException
        err.code = 'EIO'
        throw err
      }
      return realRead(p, opts as BufferEncoding)
    }) as typeof fs.readFileSync)

    expect(recordStartupAttempt('1.0.35', 'attempt-35')).toBe(false)
    vi.restoreAllMocks()
    // The write itself landed; only the read-back verification failed.
    expect(fs.existsSync(markerFile())).toBe(true)
  })

  it('clearStartupAttemptMarker tolerates a missing file', () => {
    expect(() => clearStartupAttemptMarker()).not.toThrow()
  })
})
