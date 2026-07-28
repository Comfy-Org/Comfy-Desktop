import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  getOrCreateAnonymousDistinctId,
  normalizeAnonymousDistinctId,
  persistAnonymousDistinctId,
  readPersistedAnonymousDistinctId,
  rotatePersistedAnonymousDistinctId
} from './anonymousIdentity'
import {
  clearPendingIdentityMerges,
  enqueuePendingIdentityMerge,
  readPendingIdentityMerges,
  recoverPendingIdentityRotation,
  reservePendingIdentityMerge
} from './pendingIdentityMerge'

const ANONYMOUS_ID_1 = '019810a3-1d3c-7bde-9c7a-3f2b6f2a4e11'
const ANONYMOUS_ID_2 = '019810a3-1d3c-7bde-9c7a-3f2b6f2a4e12'
const ANONYMOUS_ID_3 = '019810a3-1d3c-7bde-9c7a-3f2b6f2a4e13'

beforeEach(() => {
  testUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'anonymous-identity-test-'))
  safeFileMock.failWrites = false
})

afterEach(() => {
  fs.rmSync(testUserData, { recursive: true, force: true })
})

describe('anonymousIdentity', () => {
  it('persists and reuses one anonymous UUID', () => {
    const created = getOrCreateAnonymousDistinctId()

    expect(readPersistedAnonymousDistinctId()).toBe(created)
    expect(getOrCreateAnonymousDistinctId()).toBe(created)
    expect(fs.readFileSync(anonymousDistinctIdPath(), 'utf-8')).toBe(created)
  })

  it.each([
    '',
    'anonymous',
    ANONYMOUS_ID_1.toUpperCase(),
    ANONYMOUS_ID_1.slice(1),
    `${ANONYMOUS_ID_1}a`
  ])('rejects invalid anonymous id %j', (value) => {
    expect(normalizeAnonymousDistinctId(value)).toBeNull()
    expect(persistAnonymousDistinctId(value)).toBe(false)
  })

  it('rotates only after the replacement is persisted', () => {
    expect(persistAnonymousDistinctId(ANONYMOUS_ID_1)).toBe(true)
    safeFileMock.failWrites = true

    expect(rotatePersistedAnonymousDistinctId()).toBeNull()
    expect(readPersistedAnonymousDistinctId()).toBe(ANONYMOUS_ID_1)
  })
})

describe('pendingIdentityMerge', () => {
  function merge(anonymousId: string, nextAnonymousId: string, userId: string) {
    return {
      anonymousId,
      userId,
      nextAnonymousId,
      installationId: 'installation-1',
      personSet: { installation_id: 'installation-1', is_authenticated: true }
    }
  }

  it('keeps retries until their acknowledged ids are cleared', () => {
    const first = enqueuePendingIdentityMerge(merge(ANONYMOUS_ID_1, ANONYMOUS_ID_2, 'firebase-1'))
    const second = enqueuePendingIdentityMerge(merge(ANONYMOUS_ID_2, ANONYMOUS_ID_3, 'firebase-2'))

    expect(readPendingIdentityMerges()).toHaveLength(2)
    expect(clearPendingIdentityMerges(new Set([first!.id]))).toBe(true)
    expect(readPendingIdentityMerges()).toEqual([second])
  })

  it('reserves the retry before rotating the reusable anonymous id', () => {
    expect(persistAnonymousDistinctId(ANONYMOUS_ID_1)).toBe(true)

    const pending = reservePendingIdentityMerge({
      anonymousId: ANONYMOUS_ID_1,
      userId: 'firebase-1',
      installationId: 'installation-1',
      personSet: { installation_id: 'installation-1', is_authenticated: true }
    })

    expect(readPendingIdentityMerges()).toEqual([pending])
    expect(readPersistedAnonymousDistinctId()).toBe(pending!.nextAnonymousId)
  })

  it('finishes an interrupted rotation before first capture', () => {
    expect(persistAnonymousDistinctId(ANONYMOUS_ID_1)).toBe(true)
    enqueuePendingIdentityMerge(merge(ANONYMOUS_ID_1, ANONYMOUS_ID_2, 'firebase-1'))

    expect(recoverPendingIdentityRotation(ANONYMOUS_ID_1)).toBe(ANONYMOUS_ID_2)
    expect(readPersistedAnonymousDistinctId()).toBe(ANONYMOUS_ID_2)
  })

  it('does not rotate without a durable retry record', () => {
    safeFileMock.failWrites = true

    expect(
      reservePendingIdentityMerge({
        anonymousId: ANONYMOUS_ID_1,
        userId: 'firebase-1',
        installationId: 'installation-1',
        personSet: { installation_id: 'installation-1', is_authenticated: true }
      })
    ).toBeNull()
    expect(readPendingIdentityMerges()).toEqual([])
  })
})
