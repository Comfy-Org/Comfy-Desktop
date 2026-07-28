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
  markDownloadTokenAttributed,
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

  it('accepts router-issued base62 tokens and trims whitespace', () => {
    expect(normalizeDownloadToken('  AbC123xYz789  ')).toBe('AbC123xYz789')
  })

  it('rejects wrong-length or non-base62 token values', () => {
    expect(normalizeDownloadToken('AbC123xYz78')).toBeNull()
    expect(normalizeDownloadToken('AbC123xYz7890')).toBeNull()
    expect(normalizeDownloadToken('AbC123xYz78_')).toBeNull()
    expect(normalizeDownloadToken('AbC123xYz78-')).toBeNull()
    expect(normalizeDownloadToken('posthog-id@example.com')).toBeNull()
    expect(normalizeDownloadToken('abc12345/path')).toBeNull()
  })

  it('reads a valid pending Windows installer token from configDir', () => {
    fs.writeFileSync(pendingDownloadTokenPath(), 'AbC123xYz789\n', 'utf-8')

    expect(readPendingDownloadToken('anonymous-original')).toEqual({
      token: 'AbC123xYz789',
      source: 'windows_installer_filename',
      anonymousId: 'anonymous-original'
    })
    expect(fs.existsSync(pendingDownloadTokenPath())).toBe(true)
  })

  it('keeps retries pinned to the anonymous identity that first claimed the token', () => {
    fs.writeFileSync(pendingDownloadTokenPath(), 'AbC123xYz789\n', 'utf-8')

    expect(readPendingDownloadToken('anonymous-original')?.anonymousId).toBe(
      'anonymous-original'
    )
    expect(readPendingDownloadToken('anonymous-after-rotation')?.anonymousId).toBe(
      'anonymous-original'
    )
  })

  it('pins an all-numeric base62 token instead of parsing it as JSON', () => {
    fs.writeFileSync(pendingDownloadTokenPath(), '123456789012', 'utf-8')

    expect(readPendingDownloadToken('anonymous-original')?.token).toBe('123456789012')
  })

  it('returns null for missing or invalid pending token files', () => {
    expect(readPendingDownloadToken('anonymous-start')).toBeNull()

    fs.writeFileSync(pendingDownloadTokenPath(), 'not safe@example.com', 'utf-8')
    expect(readPendingDownloadToken('anonymous-start')).toBeNull()
    expect(fs.existsSync(pendingDownloadTokenPath())).toBe(false)
  })

  it('clears a pending token that was already attributed', () => {
    fs.writeFileSync(pendingDownloadTokenPath(), 'AbC123xYz789\n', 'utf-8')
    markDownloadTokenAttributed()

    expect(readPendingDownloadToken('anonymous-start')).toBeNull()
    expect(fs.existsSync(pendingDownloadTokenPath())).toBe(false)
  })

  it('clears the pending token file idempotently', () => {
    fs.writeFileSync(pendingDownloadTokenPath(), 'AbC123xYz789\n', 'utf-8')

    clearPendingDownloadToken()
    clearPendingDownloadToken()

    expect(fs.existsSync(pendingDownloadTokenPath())).toBe(false)
  })
})
