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
    mockConfigDir = path.join(dir, 'blocker')
    fs.writeFileSync(mockConfigDir, 'not a directory')
    expect(recordStartupAttempt('1.0.35', 'attempt-35')).toBe(false)
  })

  it('returns false when the marker writes but cannot be read back (fail closed)', () => {
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
    expect(fs.existsSync(markerFile())).toBe(true)
  })

  it('clearStartupAttemptMarker tolerates a missing file', () => {
    expect(() => clearStartupAttemptMarker()).not.toThrow()
  })
})
