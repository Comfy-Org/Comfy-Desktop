import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

let testUserData = ''

vi.mock('./paths', () => ({
  configDir: () => testUserData
}))

import {
  clearVerifiedLocalFirebaseUser,
  persistVerifiedLocalFirebaseUser,
  readVerifiedLocalFirebaseUser
} from './verifiedLocalFirebaseAuth'

beforeEach(() => {
  testUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'verified-local-firebase-auth-test-'))
})

afterEach(() => {
  fs.rmSync(testUserData, { recursive: true, force: true })
})

describe('verifiedLocalFirebaseAuth', () => {
  it('persists a main-verified user only for the exact loopback origin', () => {
    expect(persistVerifiedLocalFirebaseUser('http://127.0.0.1:8188', 'firebase-1')).toBe(true)
    expect(readVerifiedLocalFirebaseUser('http://127.0.0.1:8188')).toBe('firebase-1')
    expect(readVerifiedLocalFirebaseUser('http://127.0.0.1:8189')).toBeNull()
    expect(persistVerifiedLocalFirebaseUser('https://attacker.example', 'firebase-2')).toBe(false)
  })

  it('clears the trusted local user on logout', () => {
    expect(persistVerifiedLocalFirebaseUser('http://localhost:8188', 'firebase-1')).toBe(true)
    expect(clearVerifiedLocalFirebaseUser('http://localhost:8188')).toBe(true)
    expect(readVerifiedLocalFirebaseUser('http://localhost:8188')).toBeNull()
  })
})
