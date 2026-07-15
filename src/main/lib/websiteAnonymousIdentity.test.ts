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

import { persistAnonymousDistinctId, readPersistedAnonymousDistinctId } from './anonymousIdentity'
import {
  decodeWebsiteAnonymousIdPayload,
  getInitialAnonymousDistinctId,
  pendingWebsiteAnonymousIdPath
} from './websiteAnonymousIdentity'

function encode(value: string): string {
  return Buffer.from(value, 'utf-8').toString('base64url')
}

describe('websiteAnonymousIdentity', () => {
  beforeEach(() => {
    testUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'website-anonymous-id-test-'))
    safeFileMock.failWrites = false
  })

  afterEach(() => {
    fs.rmSync(testUserData, { recursive: true, force: true })
  })

  it('decodes exact canonical UTF-8/base64url payloads without trimming W', () => {
    const websiteAnonymousId = '\ufeff  web-device-🚀  '

    expect(decodeWebsiteAnonymousIdPayload(encode(websiteAnonymousId))).toBe(websiteAnonymousId)
    expect(decodeWebsiteAnonymousIdPayload(encode('a'.repeat(160)))).toBe('a'.repeat(160))
  })

  it('rejects malformed, non-canonical, invalid UTF-8, and oversized payloads', () => {
    expect(decodeWebsiteAnonymousIdPayload('')).toBeNull()
    expect(decodeWebsiteAnonymousIdPayload('YQ==')).toBeNull()
    expect(decodeWebsiteAnonymousIdPayload('YQ+')).toBeNull()
    expect(decodeWebsiteAnonymousIdPayload('_w')).toBeNull()
    expect(decodeWebsiteAnonymousIdPayload('a')).toBeNull()
    expect(decodeWebsiteAnonymousIdPayload(encode('a'.repeat(161)))).toBeNull()
  })

  it('seeds a fresh install with website W before the first capture', () => {
    const websiteAnonymousId = '019abcde-website-device'
    fs.writeFileSync(pendingWebsiteAnonymousIdPath(), `${encode(websiteAnonymousId)}\r\n`)

    expect(getInitialAnonymousDistinctId()).toBe(websiteAnonymousId)
    expect(readPersistedAnonymousDistinctId()).toBe(websiteAnonymousId)
    expect(fs.existsSync(pendingWebsiteAnonymousIdPath())).toBe(false)
  })

  it('keeps an existing Desktop D and consumes a later website carrier', () => {
    const desktopAnonymousId = 'existing-desktop-anonymous-id'
    expect(persistAnonymousDistinctId(desktopAnonymousId)).toBe(true)
    fs.writeFileSync(pendingWebsiteAnonymousIdPath(), encode('later-website-device'))

    expect(getInitialAnonymousDistinctId()).toBe(desktopAnonymousId)
    expect(readPersistedAnonymousDistinctId()).toBe(desktopAnonymousId)
    expect(fs.existsSync(pendingWebsiteAnonymousIdPath())).toBe(false)
  })

  it('clears an invalid carrier and falls back to a persisted random D', () => {
    fs.writeFileSync(pendingWebsiteAnonymousIdPath(), 'not+base64url')

    const desktopAnonymousId = getInitialAnonymousDistinctId()
    expect(desktopAnonymousId).toBeTruthy()
    expect(readPersistedAnonymousDistinctId()).toBe(desktopAnonymousId)
    expect(fs.existsSync(pendingWebsiteAnonymousIdPath())).toBe(false)
  })

  it('does not use W unless it can be durably persisted', () => {
    const websiteAnonymousId = 'website-device'
    fs.writeFileSync(pendingWebsiteAnonymousIdPath(), encode(websiteAnonymousId))
    safeFileMock.failWrites = true

    expect(getInitialAnonymousDistinctId()).not.toBe(websiteAnonymousId)
    expect(readPersistedAnonymousDistinctId()).toBeNull()
    expect(fs.existsSync(pendingWebsiteAnonymousIdPath())).toBe(true)
  })
})
