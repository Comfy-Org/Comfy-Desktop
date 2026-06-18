import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

let testUserData = ''

vi.mock('./paths', () => ({
  configDir: () => testUserData
}))

import {
  clearPendingDownloadToken,
  normalizeDownloadToken,
  pendingDownloadTokenPath,
  readPendingDownloadToken
} from './downloadAttribution'

describe('downloadAttribution', () => {
  beforeEach(() => {
    testUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'download-attribution-test-'))
  })

  afterEach(() => {
    fs.rmSync(testUserData, { recursive: true, force: true })
  })

  it('accepts opaque base64url-style tokens and trims whitespace', () => {
    expect(normalizeDownloadToken('  abcDEF123_-xyz  ')).toBe('abcDEF123_-xyz')
  })

  it('rejects short, oversized, or unsafe token values', () => {
    expect(normalizeDownloadToken('abc123')).toBeNull()
    expect(normalizeDownloadToken('a'.repeat(129))).toBeNull()
    expect(normalizeDownloadToken('posthog-id@example.com')).toBeNull()
    expect(normalizeDownloadToken('abc12345/path')).toBeNull()
  })

  it('reads a valid pending Windows installer token from configDir', () => {
    fs.writeFileSync(pendingDownloadTokenPath(), 'dtok_123456789\n', 'utf-8')

    expect(readPendingDownloadToken()).toEqual({
      token: 'dtok_123456789',
      source: 'windows_installer_filename'
    })
  })

  it('returns null for missing or invalid pending token files', () => {
    expect(readPendingDownloadToken()).toBeNull()

    fs.writeFileSync(pendingDownloadTokenPath(), 'not safe@example.com', 'utf-8')
    expect(readPendingDownloadToken()).toBeNull()
  })

  it('clears the pending token file idempotently', () => {
    fs.writeFileSync(pendingDownloadTokenPath(), 'dtok_123456789\n', 'utf-8')

    clearPendingDownloadToken()
    clearPendingDownloadToken()

    expect(fs.existsSync(pendingDownloadTokenPath())).toBe(false)
  })
})
