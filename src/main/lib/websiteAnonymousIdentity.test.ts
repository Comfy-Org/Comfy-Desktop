import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type * as SafeFile from './safe-file'

let testUserData = ''
const safeFileMock = vi.hoisted(() => ({ failWrites: false, failNextWrites: 0 }))

vi.mock('./paths', () => ({
  configDir: () => testUserData
}))

vi.mock('./safe-file', async (importOriginal) => {
  const actual = await importOriginal<typeof SafeFile>()
  return {
    ...actual,
    writeFileSafe: (...args: Parameters<typeof actual.writeFileSafe>) => {
      if (safeFileMock.failWrites) throw new Error('disk unavailable')
      if (safeFileMock.failNextWrites > 0) {
        safeFileMock.failNextWrites -= 1
        throw new Error('transient rename lock')
      }
      return actual.writeFileSafe(...args)
    }
  }
})

import {
  anonymousDistinctIdPath,
  persistAnonymousDistinctId,
  readPersistedAnonymousDistinctId
} from './anonymousIdentity'
import {
  getInitialAnonymousDistinctId,
  parseWebsiteAnonymousIdPayload,
  pendingWebsiteAnonymousIdPath,
  pendingWebsiteAnonymousIdRetryPath
} from './websiteAnonymousIdentity'

beforeEach(() => {
  testUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'website-anonymous-identity-test-'))
  safeFileMock.failWrites = false
  safeFileMock.failNextWrites = 0
})

afterEach(() => {
  fs.rmSync(testUserData, { recursive: true, force: true })
})

describe('websiteAnonymousIdentity', () => {
  const websiteAnonymousId = '019810a3-1d3c-7bde-9c7a-3f2b6f2a4e11'

  it('removes obsolete download-token attribution state at boot', () => {
    const pendingTokenPath = path.join(testUserData, 'pending-download-token.txt')
    const attributedMarkerPath = path.join(testUserData, 'download-token-attributed')
    fs.writeFileSync(pendingTokenPath, 'opaque-token')
    fs.writeFileSync(attributedMarkerPath, '1')

    getInitialAnonymousDistinctId()

    expect(fs.existsSync(pendingTokenPath)).toBe(false)
    expect(fs.existsSync(attributedMarkerPath)).toBe(false)
  })

  it('accepts the raw lowercase UUID payload exactly as carried', () => {
    expect(parseWebsiteAnonymousIdPayload(websiteAnonymousId)).toBe(websiteAnonymousId)
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
    expect(parseWebsiteAnonymousIdPayload(`${websiteAnonymousId} (1)`)).toBeNull()
  })

  it('seeds a fresh install with website W before the first capture', () => {
    fs.writeFileSync(pendingWebsiteAnonymousIdPath(), `${websiteAnonymousId}\r\n`)

    expect(getInitialAnonymousDistinctId()).toBe(websiteAnonymousId)
    expect(readPersistedAnonymousDistinctId()).toBe(websiteAnonymousId)
    expect(fs.existsSync(pendingWebsiteAnonymousIdPath())).toBe(false)
  })

  it('keeps an existing Desktop D and consumes a later website carrier', () => {
    const desktopAnonymousId = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
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

  it('uses W only after reserving a durable cross-launch retry', () => {
    fs.writeFileSync(pendingWebsiteAnonymousIdPath(), websiteAnonymousId)
    safeFileMock.failWrites = true

    expect(getInitialAnonymousDistinctId()).toBe(websiteAnonymousId)
    expect(readPersistedAnonymousDistinctId()).toBeNull()
    expect(fs.existsSync(pendingWebsiteAnonymousIdPath())).toBe(false)
    expect(fs.existsSync(pendingWebsiteAnonymousIdRetryPath())).toBe(true)
  })

  it('does not adopt W when neither the identity nor retry reservation can persist', () => {
    fs.writeFileSync(pendingWebsiteAnonymousIdPath(), websiteAnonymousId)
    safeFileMock.failWrites = true
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('disk unavailable')
    })

    try {
      expect(getInitialAnonymousDistinctId()).not.toBe(websiteAnonymousId)
      expect(fs.existsSync(pendingWebsiteAnonymousIdRetryPath())).toBe(false)
    } finally {
      renameSpy.mockRestore()
    }
  })

  it('retries W after a transient persist failure instead of racing a random D to disk', () => {
    fs.writeFileSync(pendingWebsiteAnonymousIdPath(), websiteAnonymousId)
    safeFileMock.failNextWrites = 1

    const inMemoryCarrier = getInitialAnonymousDistinctId()
    expect(inMemoryCarrier).toBe(websiteAnonymousId)
    expect(readPersistedAnonymousDistinctId()).toBeNull()
    expect(fs.existsSync(pendingWebsiteAnonymousIdPath())).toBe(false)
    expect(fs.existsSync(pendingWebsiteAnonymousIdRetryPath())).toBe(true)

    // The first boot consumes its first-launch marker before this restart.
    expect(getInitialAnonymousDistinctId(true)).toBe(websiteAnonymousId)
    expect(readPersistedAnonymousDistinctId()).toBe(websiteAnonymousId)
    expect(fs.existsSync(pendingWebsiteAnonymousIdRetryPath())).toBe(false)
  })

  it('never adopts W over a corrupt Desktop D file', () => {
    fs.writeFileSync(anonymousDistinctIdPath(), 'b64id1_!!!', 'utf-8')
    fs.writeFileSync(pendingWebsiteAnonymousIdPath(), websiteAnonymousId)

    const regenerated = getInitialAnonymousDistinctId()
    expect(regenerated).not.toBe(websiteAnonymousId)
    expect(readPersistedAnonymousDistinctId()).toBe(regenerated)
    expect(fs.existsSync(pendingWebsiteAnonymousIdPath())).toBe(false)
  })

  it('does not adopt a carrier on the first upgrade from a pre-identity build', () => {
    fs.writeFileSync(pendingWebsiteAnonymousIdPath(), websiteAnonymousId)

    const desktopAnonymousId = getInitialAnonymousDistinctId(true)

    expect(desktopAnonymousId).not.toBe(websiteAnonymousId)
    expect(readPersistedAnonymousDistinctId()).toBe(desktopAnonymousId)
    expect(fs.existsSync(pendingWebsiteAnonymousIdPath())).toBe(false)
  })
})
