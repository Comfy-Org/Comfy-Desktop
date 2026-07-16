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
import {
  getInitialAnonymousDistinctId,
  parseWebsiteAnonymousIdPayload,
  pendingWebsiteAnonymousIdPath
} from './websiteAnonymousIdentity'

beforeEach(() => {
  testUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'anonymous-identity-test-'))
  safeFileMock.failWrites = false
})

afterEach(() => {
  fs.rmSync(testUserData, { recursive: true, force: true })
})

describe('anonymousIdentity', () => {
  it('creates one persisted D and reuses it across startups', () => {
    const created = getOrCreateAnonymousDistinctId()
    expect(created).toBeTruthy()
    expect(readPersistedAnonymousDistinctId()).toBe(created)
    expect(getOrCreateAnonymousDistinctId()).toBe(created)
  })

  it('rotates to a fresh persisted D', () => {
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

  it('rejects a PostHog-illegal identity so boot regenerates a mergeable D', () => {
    // The full illegal-ID vocabulary is covered by opaqueIdentifier.test.ts;
    // this proves persist/read consult the shared check.
    expect(persistAnonymousDistinctId('anonymous')).toBe(false)

    fs.writeFileSync(anonymousDistinctIdPath(), 'undefined', 'utf-8')
    expect(readPersistedAnonymousDistinctId()).toBeNull()
    const regenerated = getOrCreateAnonymousDistinctId()
    expect(regenerated).not.toBe('undefined')
    expect(readPersistedAnonymousDistinctId()).toBe(regenerated)
  })
})

describe('websiteAnonymousIdentity', () => {
  const websiteAnonymousId = '019810a3-1d3c-7bde-9c7a-3f2b6f2a4e11'

  it('accepts the raw lowercase UUID payload exactly as carried', () => {
    expect(parseWebsiteAnonymousIdPayload(websiteAnonymousId)).toBe(websiteAnonymousId)
    // Version/variant nibbles are not pinned (posthog-js moved v4 -> v7).
    expect(parseWebsiteAnonymousIdPayload('00000000-0000-0000-0000-000000000000')).toBe(
      '00000000-0000-0000-0000-000000000000'
    )
  })

  it('rejects anything that is not a lowercase hyphenated UUID', () => {
    expect(parseWebsiteAnonymousIdPayload('')).toBeNull()
    expect(parseWebsiteAnonymousIdPayload(websiteAnonymousId.toUpperCase())).toBeNull()
    expect(parseWebsiteAnonymousIdPayload(websiteAnonymousId.slice(1))).toBeNull()
    expect(parseWebsiteAnonymousIdPayload(`${websiteAnonymousId}a`)).toBeNull()
    expect(parseWebsiteAnonymousIdPayload(websiteAnonymousId.replace('-', '_'))).toBeNull()
    expect(parseWebsiteAnonymousIdPayload('web-anon-123')).toBeNull()
    // NSIS extracts a fixed 36 chars, so a browser dedup tail never reaches
    // this validator; if one does (hand-edited file), it must be rejected.
    expect(parseWebsiteAnonymousIdPayload(`${websiteAnonymousId} (1)`)).toBeNull()
  })

  it('seeds a fresh install with website W before the first capture', () => {
    fs.writeFileSync(pendingWebsiteAnonymousIdPath(), `${websiteAnonymousId}\r\n`)

    expect(getInitialAnonymousDistinctId()).toBe(websiteAnonymousId)
    expect(readPersistedAnonymousDistinctId()).toBe(websiteAnonymousId)
    expect(fs.existsSync(pendingWebsiteAnonymousIdPath())).toBe(false)
  })

  it('keeps an existing Desktop D and consumes a later website carrier', () => {
    const desktopAnonymousId = 'existing-desktop-anonymous-id'
    expect(persistAnonymousDistinctId(desktopAnonymousId)).toBe(true)
    fs.writeFileSync(pendingWebsiteAnonymousIdPath(), '02f611c7-88a8-7dd1-b57e-032ea3e9b3aa')

    expect(getInitialAnonymousDistinctId()).toBe(desktopAnonymousId)
    expect(readPersistedAnonymousDistinctId()).toBe(desktopAnonymousId)
    expect(fs.existsSync(pendingWebsiteAnonymousIdPath())).toBe(false)
  })

  it('clears an invalid carrier and falls back to a persisted random D', () => {
    fs.writeFileSync(pendingWebsiteAnonymousIdPath(), 'web-anon-123')

    const desktopAnonymousId = getInitialAnonymousDistinctId()
    expect(desktopAnonymousId).toBeTruthy()
    expect(readPersistedAnonymousDistinctId()).toBe(desktopAnonymousId)
    expect(fs.existsSync(pendingWebsiteAnonymousIdPath())).toBe(false)
  })

  it('does not use W unless it can be durably persisted', () => {
    fs.writeFileSync(pendingWebsiteAnonymousIdPath(), websiteAnonymousId)
    safeFileMock.failWrites = true

    expect(getInitialAnonymousDistinctId()).not.toBe(websiteAnonymousId)
    expect(readPersistedAnonymousDistinctId()).toBeNull()
    expect(fs.existsSync(pendingWebsiteAnonymousIdPath())).toBe(true)
  })
})
