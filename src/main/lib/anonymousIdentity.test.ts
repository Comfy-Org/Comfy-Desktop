import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type * as SafeFile from './safe-file'

let testUserData = ''
const safeFileMock = vi.hoisted(() => ({ failWrites: false }))

vi.mock('./paths', () => ({
  configDir: () => testUserData
}))

vi.mock('./safe-file', async (importOriginal) => {
  const actual = await importOriginal<typeof SafeFile>()
  return {
    ...actual,
    writeFileSafe: (...args: Parameters<typeof actual.writeFileSafe>) => {
      if (safeFileMock.failWrites) throw new Error('disk unavailable')
      return actual.writeFileSafe(...args)
    }
  }
})

import {
  anonymousDistinctIdPath,
  clearPersistedUnmergeableAnonymousEpoch,
  getOrCreateAnonymousDistinctId,
  hasPersistedUnmergeableAnonymousEpoch,
  persistAnonymousDistinctId,
  persistUnmergeableAnonymousEpoch,
  readPersistedAnonymousDistinctId,
  rotatePersistedAnonymousDistinctId
} from './anonymousIdentity'

describe('anonymousIdentity', () => {
  beforeEach(() => {
    testUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'anonymous-identity-test-'))
    safeFileMock.failWrites = false
  })

  afterEach(() => {
    fs.rmSync(testUserData, { recursive: true, force: true })
  })

  it('creates one persisted anonymous ID and reuses it across startups', () => {
    const created = getOrCreateAnonymousDistinctId()
    expect(created).toBeTruthy()
    expect(readPersistedAnonymousDistinctId()).toBe(created)
    expect(getOrCreateAnonymousDistinctId()).toBe(created)
  })

  it('rotates to a fresh persisted anonymous ID', () => {
    expect(persistAnonymousDistinctId('previous-anon-id')).toBe(true)
    const rotated = rotatePersistedAnonymousDistinctId()
    expect(rotated).not.toBe('previous-anon-id')
    expect(readPersistedAnonymousDistinctId()).toBe(rotated)
  })

  it('round-trips an exact Unicode website identity without trimming it', () => {
    const websiteAnonymousId = '\ufeff  website visitor 🚀  '

    expect(persistAnonymousDistinctId(websiteAnonymousId)).toBe(true)
    expect(readPersistedAnonymousDistinctId()).toBe(websiteAnonymousId)
    expect(fs.readFileSync(anonymousDistinctIdPath(), 'utf-8')).not.toContain(websiteAnonymousId)
  })

  it('fails closed instead of adopting an unpersisted rotation', () => {
    expect(persistAnonymousDistinctId('previous-anon-id')).toBe(true)
    safeFileMock.failWrites = true
    expect(rotatePersistedAnonymousDistinctId()).toBeNull()
    expect(readPersistedAnonymousDistinctId()).toBe('previous-anon-id')
  })

  it('fails closed on a Windows rename lock without retrying on the main thread', () => {
    expect(persistAnonymousDistinctId('previous-anon-id')).toBe(true)
    let attempts = 0
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      attempts++
      const error = new Error('temporarily locked') as NodeJS.ErrnoException
      error.code = 'EPERM'
      throw error
    })

    try {
      expect(rotatePersistedAnonymousDistinctId()).toBeNull()
      expect(readPersistedAnonymousDistinctId()).toBe('previous-anon-id')
      expect(attempts).toBe(1)
    } finally {
      renameSpy.mockRestore()
    }
  })

  it('persists an unmergeable epoch across restarts until a clean rotation clears it', () => {
    expect(persistAnonymousDistinctId('tainted-anon-id')).toBe(true)
    expect(persistUnmergeableAnonymousEpoch()).toBe(true)

    expect(hasPersistedUnmergeableAnonymousEpoch()).toBe(true)
    expect(readPersistedAnonymousDistinctId()).toBe('tainted-anon-id')
    expect(rotatePersistedAnonymousDistinctId()).not.toBeNull()
    expect(clearPersistedUnmergeableAnonymousEpoch()).toBe(true)
    expect(hasPersistedUnmergeableAnonymousEpoch()).toBe(false)
  })

  it('deletes the reusable identity if the taint marker cannot be written', () => {
    expect(persistAnonymousDistinctId('tainted-anon-id')).toBe(true)
    safeFileMock.failWrites = true

    expect(persistUnmergeableAnonymousEpoch()).toBe(true)
    expect(readPersistedAnonymousDistinctId()).toBeNull()
    expect(hasPersistedUnmergeableAnonymousEpoch()).toBe(false)
  })

  it('rejects malformed persisted identities', () => {
    fs.writeFileSync(anonymousDistinctIdPath(), 'bad\nidentity', 'utf-8')
    expect(readPersistedAnonymousDistinctId()).toBeNull()
    expect(persistAnonymousDistinctId('')).toBe(false)
    expect(persistAnonymousDistinctId('\ud800')).toBe(false)
  })

  it('rejects PostHog-illegal identities so boot regenerates a mergeable ID', () => {
    expect(persistAnonymousDistinctId('anonymous')).toBe(false)
    expect(persistAnonymousDistinctId('[object Object]')).toBe(false)

    fs.writeFileSync(anonymousDistinctIdPath(), 'undefined', 'utf-8')
    expect(readPersistedAnonymousDistinctId()).toBeNull()
    const regenerated = getOrCreateAnonymousDistinctId()
    expect(regenerated).not.toBe('undefined')
    expect(readPersistedAnonymousDistinctId()).toBe(regenerated)
  })
})
