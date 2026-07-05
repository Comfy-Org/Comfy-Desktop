// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Buffer } from 'buffer'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { app, safeStorage } from 'electron'

import type { AuthTokens } from './types'
import * as tokenStore from './tokenStore'

// A visible, reversible stand-in for OS encryption so tests can prove the bytes
// on disk are ciphertext, not plaintext. `enc:` marks a processed blob.
const codec = vi.hoisted(() => ({
  encrypt: (plain: string): Buffer =>
    Buffer.from('enc:' + Buffer.from(plain, 'utf-8').toString('base64'), 'utf-8'),
  decrypt: (blob: Buffer): string =>
    Buffer.from(blob.toString('utf-8').replace(/^enc:/, ''), 'base64').toString('utf-8'),
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-userdata'),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn(codec.encrypt),
    decryptString: vi.fn(codec.decrypt),
  },
}))

const AUTH_FILENAME = 'comfybuilder-auth.bin'

/** Build a syntactically valid JWT whose payload segment carries `payload`. */
function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' }), 'utf-8').toString(
    'base64url',
  )
  const body = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url')
  return `${header}.${body}.signature`
}

describe('comfybuilder tokenStore', () => {
  let tmpDir: string

  beforeEach(() => {
    vi.clearAllMocks()
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-auth-'))
    vi.mocked(app.getPath).mockReturnValue(tmpDir)
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true)
    tokenStore._resetForTest()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('round-trips tokens through encrypted storage and reports signed-in status', () => {
    const accessToken = makeJwt({
      email: 'builder@example.com',
      workspace_id: 'ws_abc123',
      workspace_type: 'team',
      role: 'admin',
      exp: 9999999999,
    })
    const tokens: AuthTokens = {
      accessToken,
      refreshToken: 'refresh-secret-value',
      expiresAt: 9999999999,
    }

    tokenStore.saveTokens(tokens)

    const authFile = path.join(tmpDir, AUTH_FILENAME)
    expect(fs.existsSync(authFile)).toBe(true)
    expect(safeStorage.encryptString).toHaveBeenCalledWith(JSON.stringify(tokens))

    // Bytes on disk are ciphertext: the processed marker is present and no secret leaks through.
    const onDisk = fs.readFileSync(authFile, 'utf-8')
    expect(onDisk.startsWith('enc:')).toBe(true)
    expect(onDisk).not.toContain(accessToken)
    expect(onDisk).not.toContain('refresh-secret-value')
    expect(onDisk).not.toContain('builder@example.com')

    // Drop the in-memory cache so the reload is served from disk.
    tokenStore._resetForTest()

    const loaded = tokenStore.loadTokens()
    expect(loaded).toEqual(tokens)
    expect(safeStorage.decryptString).toHaveBeenCalled()

    expect(tokenStore.getAuthStatus()).toEqual({
      signedIn: true,
      email: 'builder@example.com',
      workspaceId: 'ws_abc123',
      workspaceType: 'team',
      role: 'admin',
    })
  })

  it('keeps tokens in memory only when secure storage is unavailable', () => {
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false)

    const tokens: AuthTokens = {
      accessToken: makeJwt({ email: 'offline@example.com', workspace_id: 'ws_off' }),
      refreshToken: 'refresh-in-memory-only',
      expiresAt: 9999999999,
    }

    tokenStore.saveTokens(tokens)

    // Nothing is written to disk and encryption is never attempted.
    const authFile = path.join(tmpDir, AUTH_FILENAME)
    expect(fs.existsSync(authFile)).toBe(false)
    expect(safeStorage.encryptString).not.toHaveBeenCalled()
    expect(tokenStore.secureStorageUnavailable).toBe(true)

    // Reads are served from the in-memory cache, not disk.
    expect(tokenStore.loadTokens()).toEqual(tokens)
    expect(tokenStore.getAuthStatus().signedIn).toBe(true)

    // Clearing empties both memory and disk.
    tokenStore.clearTokens()
    expect(tokenStore.loadTokens()).toBeNull()
    expect(fs.existsSync(authFile)).toBe(false)
  })
})
