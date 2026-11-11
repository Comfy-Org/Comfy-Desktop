import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const electronState = vi.hoisted(() => ({ userData: '', encryptionAvailable: true }))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => electronState.userData) },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => electronState.encryptionAvailable),
    encryptString: vi.fn((value: string) =>
      Buffer.from(`enc:${Buffer.from(value, 'utf-8').toString('base64')}`, 'utf-8')
    ),
    decryptString: vi.fn((value: Buffer) => {
      const text = value.toString('utf-8')
      if (!text.startsWith('enc:')) throw new Error('not encrypted')
      return Buffer.from(text.slice(4), 'base64').toString('utf-8')
    })
  }
}))

vi.mock('../lib/telemetry', () => ({ emit: vi.fn() }))

import { app, safeStorage } from 'electron'

import * as mainTelemetry from '../lib/telemetry'
import { CLOUD_CONFIG } from './config'
import {
  STORED_SESSION_FAILED_EVENT,
  STORED_SESSION_RESTORED_EVENT,
  _resetForTest,
  activateWorkspace,
  addPendingRevocation,
  clearTokens,
  dropWorkspaceToken,
  getAuthStatus,
  getCachedWorkspaceName,
  loadActiveWorkspaceId,
  loadGrant,
  loadGrantOrigin,
  loadPendingRevocations,
  loadWorkspaceToken,
  removePendingRevocation,
  replaceGrant,
  saveGrant,
  saveWorkspaceNames,
  saveWorkspaceToken
} from './tokenStore'
import type { AuthTokens } from './types'

function jwt(subject: string, workspaceId: string): string {
  const b64 = (value: unknown): string =>
    Buffer.from(JSON.stringify(value), 'utf-8').toString('base64url')
  return `${b64({ alg: 'RS256' })}.${b64({ sub: subject, workspace_id: workspaceId })}.sig`
}

function tokenWithoutSubject(workspaceId: string): string {
  const b64 = (value: unknown): string =>
    Buffer.from(JSON.stringify(value), 'utf-8').toString('base64url')
  return `${b64({ alg: 'RS256' })}.${b64({ workspace_id: workspaceId })}.sig`
}

function tokens(subject: string, workspaceId: string, suffix = ''): AuthTokens {
  return {
    accessToken: jwt(subject, workspaceId) + suffix,
    refreshToken: `refresh-${workspaceId}${suffix}`,
    expiresAt: Date.now() + 3_600_000
  }
}

function mintedToken(subject: string, workspaceId: string): AuthTokens {
  return { accessToken: jwt(subject, workspaceId), expiresAt: Date.now() + 900_000 }
}

function vaultPath(): string {
  return path.join(electronState.userData, 'comfy-cloud-auth.bin')
}

function writeVault(payload: unknown): void {
  fs.writeFileSync(vaultPath(), safeStorage.encryptString(JSON.stringify(payload)))
}

function readVault(): Record<string, unknown> {
  return JSON.parse(safeStorage.decryptString(fs.readFileSync(vaultPath()))) as Record<
    string,
    unknown
  >
}

function eventsNamed(name: string): unknown[] {
  return vi
    .mocked(mainTelemetry.emit)
    .mock.calls.filter(([event]) => event === name)
    .map(([, context]) => context)
}

describe('grant vault', () => {
  beforeEach(() => {
    electronState.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'comfy-cloud-tokens-'))
    electronState.encryptionAvailable = true
    _resetForTest()
    vi.mocked(mainTelemetry.emit).mockClear()
  })

  afterEach(() => {
    clearTokens()
    fs.rmSync(electronState.userData, { recursive: true, force: true })
    _resetForTest()
  })

  it('persists one grant plus minted tokens as version 2', () => {
    const grant = tokens('user-1', 'w1')
    const minted = mintedToken('user-1', 'w2')
    saveGrant(grant)
    saveWorkspaceToken('w2', minted)
    activateWorkspace('w2')

    expect(readVault()).toEqual({
      version: 2,
      issuer: CLOUD_CONFIG.issuer,
      clientId: CLOUD_CONFIG.clientId,
      subject: 'user-1',
      grant,
      activeWorkspaceId: 'w2',
      workspaceTokens: { w2: minted }
    })

    _resetForTest()

    expect(loadGrant()).toEqual(grant)
    expect(loadActiveWorkspaceId()).toBe('w2')
    expect(loadWorkspaceToken('w2')).toEqual(minted)
  })

  it('writes the grant and minted tokens only through safeStorage', () => {
    const grant = tokens('user-1', 'w1')
    const minted = mintedToken('user-1', 'w2')
    saveGrant(grant)
    saveWorkspaceToken('w2', minted)

    const onDisk = fs.readFileSync(vaultPath(), 'utf-8')

    expect(onDisk.startsWith('enc:')).toBe(true)
    expect(onDisk).not.toContain(grant.accessToken)
    expect(onDisk).not.toContain(grant.refreshToken)
    expect(onDisk).not.toContain(minted.accessToken)
  })

  it('reads an unencrypted vault as signed out', () => {
    fs.writeFileSync(
      vaultPath(),
      JSON.stringify({
        version: 2,
        grant: tokens('user-1', 'w1'),
        activeWorkspaceId: 'w1',
        workspaceTokens: {}
      })
    )

    expect(loadGrant()).toBeNull()
    expect(getAuthStatus()).toEqual({ signedIn: false })
  })

  it('activates only the anchor or a workspace with a held token', () => {
    saveGrant(tokens('user-1', 'w1'))
    saveWorkspaceToken('w2', mintedToken('user-1', 'w2'))

    expect(activateWorkspace('w3')).toBe(false)
    expect(loadActiveWorkspaceId()).toBe('w1')
    expect(activateWorkspace('w2')).toBe(true)
    expect(loadActiveWorkspaceId()).toBe('w2')
    expect(activateWorkspace('w1')).toBe(true)
    expect(loadActiveWorkspaceId()).toBe('w1')
  })

  it('reports status from the active token, and from the grant identity once it is dropped', () => {
    saveGrant(tokens('user-1', 'w1'))
    saveWorkspaceToken('w2', mintedToken('user-1', 'w2'))
    saveWorkspaceNames(loadGrant()!.accessToken, [
      { id: 'w2', name: 'Workspace Two', type: 'team', role: 'member' }
    ])
    activateWorkspace('w2')

    expect(getAuthStatus()).toMatchObject({ workspaceId: 'w2', workspaceName: 'Workspace Two' })

    expect(dropWorkspaceToken(jwt('user-1', 'w2'))).toBe(true)

    expect(getAuthStatus()).toMatchObject({
      signedIn: true,
      workspaceId: 'w2',
      workspaceName: 'Workspace Two'
    })
    expect(loadWorkspaceToken('w2')).toBeNull()
  })

  it('dropping an unknown or grant token changes nothing', () => {
    saveGrant(tokens('user-1', 'w1'))

    expect(dropWorkspaceToken('unknown')).toBe(false)
    expect(dropWorkspaceToken(loadGrant()!.accessToken)).toBe(false)
    expect(loadGrant()).not.toBeNull()
  })

  it('replaces the grant for the same account and keeps its held tokens and active workspace', () => {
    saveGrant(tokens('user-1', 'w1'))
    const held = mintedToken('user-1', 'w2')
    saveWorkspaceToken('w2', held)
    activateWorkspace('w2')

    const next = tokens('user-1', 'w3')
    saveGrant(next)

    expect(loadGrant()).toEqual(next)
    expect(loadActiveWorkspaceId()).toBe('w2')
    expect(loadWorkspaceToken('w2')).toEqual(held)
  })

  it('keeps the old access token, without its refresh token, for the old anchor when re-anchored', () => {
    const previous = tokens('user-1', 'w1')
    saveGrant(previous)

    saveGrant(tokens('user-1', 'w3'))

    expect(loadActiveWorkspaceId()).toBe('w1')
    expect(loadWorkspaceToken('w1')).toEqual({
      accessToken: previous.accessToken,
      expiresAt: previous.expiresAt
    })
    expect(getAuthStatus()).toMatchObject({ workspaceId: 'w1' })
  })

  it('moves to the new anchor when the old anchor token has expired', () => {
    saveGrant({ ...tokens('user-1', 'w1'), expiresAt: Date.now() - 1000 })

    saveGrant(tokens('user-1', 'w3'))

    expect(loadActiveWorkspaceId()).toBe('w3')
    expect(loadWorkspaceToken('w1')).toBeNull()
  })

  it('clears everything when browser auth changes account', () => {
    saveGrant(tokens('user-1', 'w1'))
    saveWorkspaceToken('w2', mintedToken('user-1', 'w2'))
    saveWorkspaceNames(loadGrant()!.accessToken, [
      { id: 'w1', name: 'Workspace One', type: 'team', role: 'owner' }
    ])

    const otherAccount = tokens('user-2', 'w3')
    saveGrant(otherAccount)

    expect(loadGrant()).toEqual(otherAccount)
    expect(loadActiveWorkspaceId()).toBe('w3')
    expect(loadWorkspaceToken('w2')).toBeNull()
    expect(getCachedWorkspaceName('w1')).toBeNull()
  })

  it('does not keep minted tokens when the new account identity cannot be proven', () => {
    saveGrant({ accessToken: tokenWithoutSubject('w1'), expiresAt: Date.now() + 1000 })
    saveWorkspaceToken('w2', mintedToken('user-1', 'w2'))

    saveGrant({ accessToken: tokenWithoutSubject('w3'), expiresAt: Date.now() + 1000 })

    expect(loadWorkspaceToken('w2')).toBeNull()
  })

  it('restores the active workspace name after a process restart', () => {
    const grant = tokens('user-1', 'w1')
    saveGrant(grant)
    saveWorkspaceNames(grant.accessToken, [
      { id: 'w1', name: 'Workspace One', type: 'team', role: 'owner' },
      { id: 'w2', name: 'Workspace Two', type: 'team', role: 'member' }
    ])

    _resetForTest()

    expect(getAuthStatus()).toMatchObject({
      signedIn: true,
      workspaceId: 'w1',
      workspaceName: 'Workspace One'
    })
    expect(getCachedWorkspaceName('w2')).toBe('Workspace Two')
  })

  it('rejects workspace names from a request belonging to another account', () => {
    const stale = tokens('user-1', 'w1')
    saveGrant(stale)
    saveGrant(tokens('user-2', 'w2'))

    saveWorkspaceNames(stale.accessToken, [
      { id: 'w1', name: 'Workspace One', type: 'team', role: 'owner' }
    ])

    expect(getAuthStatus().workspaceName).toBeUndefined()
  })

  it('rotates the grant only when it still matches', () => {
    const grant = tokens('user-1', 'w1')
    const rotated = tokens('user-1', 'w1', '-rotated')
    saveGrant(grant)

    expect(replaceGrant('other', grant.refreshToken!, rotated)).toBe(false)
    expect(replaceGrant(grant.accessToken, 'other', rotated)).toBe(false)
    expect(replaceGrant(grant.accessToken, grant.refreshToken!, rotated)).toBe(true)
    expect(loadGrant()).toEqual(rotated)
  })

  it('rejects a rotation for another workspace or account', () => {
    const grant = tokens('user-1', 'w1')
    saveGrant(grant)

    expect(replaceGrant(grant.accessToken, grant.refreshToken!, tokens('user-1', 'w2'))).toBe(false)
    expect(replaceGrant(grant.accessToken, grant.refreshToken!, tokens('user-2', 'w1'))).toBe(false)
    expect(loadGrant()).toEqual(grant)
  })

  it('keeps tokens in memory only when secure storage is unavailable', () => {
    electronState.encryptionAvailable = false
    const grant = tokens('user-1', 'w1')

    saveGrant(grant)

    expect(loadGrant()).toEqual(grant)
    expect(fs.existsSync(vaultPath())).toBe(false)
  })

  it('records the Cloud a grant came from at sign-in and at each refresh, and assumes the configured Cloud for an older vault', () => {
    const grant = tokens('user-1', 'w1')
    saveGrant(grant)
    expect(loadGrantOrigin()).toEqual({
      issuer: CLOUD_CONFIG.issuer,
      clientId: CLOUD_CONFIG.clientId
    })

    const { issuer: _issuer, clientId: _clientId, ...older } = readVault()
    writeVault(older)
    _resetForTest()
    expect(loadGrantOrigin()).toEqual({
      issuer: CLOUD_CONFIG.issuer,
      clientId: CLOUD_CONFIG.clientId
    })

    replaceGrant(grant.accessToken, grant.refreshToken ?? '', tokens('user-1', 'w1', '-next'))
    expect(loadGrantOrigin()).toEqual({
      issuer: CLOUD_CONFIG.issuer,
      clientId: CLOUD_CONFIG.clientId
    })
  })

  it('keeps queued revocations encrypted, outside the vault, one file each', () => {
    const first = {
      issuer: 'https://cloud.test',
      clientId: 'cid',
      refreshToken: 'refresh-1',
      queuedAt: 1
    }
    const second = { ...first, refreshToken: 'refresh-2' }
    saveGrant(tokens('user-1', 'w1'))

    addPendingRevocation(first)
    addPendingRevocation(second)
    clearTokens()
    _resetForTest()

    expect(loadPendingRevocations()).toEqual({
      pending: expect.arrayContaining([first, second]),
      complete: true
    })
    const dir = path.join(electronState.userData, 'comfy-cloud-revocations')
    const files = fs.readdirSync(dir)
    expect(files).toHaveLength(2)
    for (const file of files) {
      expect(fs.readFileSync(path.join(dir, file), 'utf-8')).not.toMatch(/refresh-/)
    }
  })

  it('drops an unreadable queue file once it has outlived the refresh token, and only then', () => {
    const revocation = {
      issuer: 'https://cloud.test',
      clientId: 'cid',
      refreshToken: 'refresh-1',
      queuedAt: 1
    }
    addPendingRevocation(revocation)
    const dir = path.join(electronState.userData, 'comfy-cloud-revocations')
    const unreadable = path.join(dir, 'unreadable.bin')
    fs.writeFileSync(unreadable, 'garbage')
    expect(loadPendingRevocations()).toEqual({ pending: [revocation], complete: false })

    const monthAgo = new Date(Date.now() - 31 * 24 * 3_600_000)
    fs.utimesSync(unreadable, monthAgo, monthAgo)

    expect(loadPendingRevocations()).toEqual({ pending: [revocation], complete: true })
    expect(fs.existsSync(unreadable)).toBe(false)
  })

  it('never loses a queued revocation to an unreadable sibling entry', () => {
    const first = {
      issuer: 'https://cloud.test',
      clientId: 'cid',
      refreshToken: 'refresh-1',
      queuedAt: 1
    }
    addPendingRevocation(first)
    const dir = path.join(electronState.userData, 'comfy-cloud-revocations')
    fs.writeFileSync(path.join(dir, 'unreadable.bin'), 'garbage')

    addPendingRevocation({ ...first, refreshToken: 'refresh-2' })
    removePendingRevocation('refresh-2')

    expect(loadPendingRevocations()).toEqual({ pending: [first], complete: false })
    expect(fs.readFileSync(path.join(dir, 'unreadable.bin'), 'utf-8')).toBe('garbage')
  })

  it('keeps a revocation in memory while it cannot be saved, and saves it once storage works', () => {
    const revocation = {
      issuer: 'https://cloud.test',
      clientId: 'cid',
      refreshToken: 'refresh-1',
      queuedAt: 1
    }
    electronState.encryptionAvailable = false

    addPendingRevocation(revocation)

    expect(loadPendingRevocations().pending).toEqual([revocation])
    expect(fs.existsSync(path.join(electronState.userData, 'comfy-cloud-revocations'))).toBe(false)

    electronState.encryptionAvailable = true
    expect(loadPendingRevocations().pending).toEqual([revocation])
    _resetForTest()
    expect(loadPendingRevocations()).toEqual({ pending: [revocation], complete: true })
  })

  it('migrates a version 1 vault: the active bundle becomes the grant, others are dropped', () => {
    const active = tokens('user-1', 'w2')
    writeVault({
      version: 1,
      activeKey: 'workspace:w2',
      subject: 'user-1',
      bundles: { 'workspace:w1': tokens('user-1', 'w1'), 'workspace:w2': active },
      workspaceNames: { w2: 'Workspace Two' }
    })

    expect(loadGrant()).toEqual(active)
    expect(loadActiveWorkspaceId()).toBe('w2')
    expect(loadWorkspaceToken('w1')).toBeNull()
    expect(getAuthStatus()).toMatchObject({ workspaceId: 'w2', workspaceName: 'Workspace Two' })
    expect(readVault()).toEqual({
      version: 2,
      subject: 'user-1',
      grant: active,
      activeWorkspaceId: 'w2',
      workspaceTokens: {},
      workspaceNames: { w2: 'Workspace Two' }
    })
  })

  it('migrates the original single-token payload', () => {
    const legacy = tokens('user-1', 'w1')
    writeVault(legacy)

    expect(loadGrant()).toEqual(legacy)
    expect(loadActiveWorkspaceId()).toBe('w1')
    expect(readVault()).toMatchObject({ version: 2 })
  })

  it.each<[string, unknown]>([
    ['an unknown version', { version: 3, grant: tokens('user-1', 'w1') }],
    [
      'a version 2 vault with no grant',
      { version: 2, activeWorkspaceId: 'w1', workspaceTokens: {} }
    ],
    [
      'a version 2 vault with a malformed minted token',
      {
        version: 2,
        grant: tokens('user-1', 'w1'),
        activeWorkspaceId: 'w1',
        workspaceTokens: { w2: { accessToken: 7 } }
      }
    ],
    [
      'a version 2 vault with a non-string active workspace',
      { version: 2, grant: tokens('user-1', 'w1'), activeWorkspaceId: 7, workspaceTokens: {} }
    ],
    [
      'a version 2 vault with malformed names',
      {
        version: 2,
        grant: tokens('user-1', 'w1'),
        activeWorkspaceId: 'w1',
        workspaceTokens: {},
        workspaceNames: { w1: 7 }
      }
    ],
    [
      'a version 1 vault whose active bundle is missing',
      { version: 1, activeKey: 'workspace:w2', bundles: { 'workspace:w1': tokens('user-1', 'w1') } }
    ],
    [
      'a version 1 vault with a malformed bundle',
      {
        version: 1,
        activeKey: 'workspace:w1',
        bundles: { 'workspace:w1': tokens('user-1', 'w1'), 'workspace:w2': { accessToken: 7 } }
      }
    ]
  ])('reads %s as signed out', (_name, payload) => {
    writeVault(payload)

    expect(loadGrant()).toBeNull()
    expect(getAuthStatus()).toEqual({ signedIn: false })
  })

  describe('stored session telemetry', () => {
    it('reports a session restored from disk once, however often it is read', () => {
      saveGrant(tokens('user-1', 'w1'))
      _resetForTest()

      loadGrant()
      loadActiveWorkspaceId()
      getAuthStatus()

      expect(eventsNamed(STORED_SESSION_RESTORED_EVENT)).toEqual([{ format: 'current' }])
      expect(eventsNamed(STORED_SESSION_FAILED_EVENT)).toEqual([])
    })

    it.each<[string, unknown]>([
      [
        'a version 1 vault',
        {
          version: 1,
          activeKey: 'workspace:w1',
          bundles: { 'workspace:w1': tokens('user-1', 'w1') }
        }
      ],
      ['the original single-token payload', tokens('user-1', 'w1')]
    ])('reports %s moved to the current format', (_name, payload) => {
      writeVault(payload)

      expect(loadGrant()).not.toBeNull()

      expect(eventsNamed(STORED_SESSION_RESTORED_EVENT)).toEqual([{ format: 'legacy' }])
      expect(eventsNamed(STORED_SESSION_FAILED_EVENT)).toEqual([])
    })

    it.each<[string, () => void, string]>([
      [
        'cannot be decrypted',
        () => fs.writeFileSync(vaultPath(), JSON.stringify({ version: 2 })),
        'undecryptable'
      ],
      [
        'is not JSON',
        () => fs.writeFileSync(vaultPath(), safeStorage.encryptString('not json')),
        'invalid'
      ],
      [
        'has an unknown version',
        () => writeVault({ version: 3, grant: tokens('user-1', 'w1') }),
        'invalid'
      ],
      [
        'is a version 1 vault with no active session',
        () => writeVault({ version: 1, activeKey: 'workspace:w2', bundles: {} }),
        'invalid'
      ],
      ['cannot be read', () => fs.mkdirSync(vaultPath()), 'unreadable']
    ])('reports once a stored session that %s', (_name, store, reason) => {
      store()

      expect(loadGrant()).toBeNull()
      expect(getAuthStatus()).toEqual({ signedIn: false })
      expect(loadGrant()).toBeNull()

      expect(eventsNamed(STORED_SESSION_FAILED_EVENT)).toEqual([{ operation: 'load', reason }])
      expect(eventsNamed(STORED_SESSION_RESTORED_EVENT)).toEqual([])
    })

    it('reads a session as signed out, and says it was unreadable, when the read throws no error object', () => {
      vi.mocked(app.getPath).mockImplementationOnce(() => {
        throw null
      })
      onTestFinished(() => {
        vi.mocked(app.getPath).mockReset()
      })

      expect(loadGrant()).toBeNull()

      expect(eventsNamed(STORED_SESSION_FAILED_EVENT)).toEqual([
        { operation: 'load', reason: 'unreadable' }
      ])
    })

    it('reports nothing when no session is stored', () => {
      expect(loadGrant()).toBeNull()

      expect(vi.mocked(mainTelemetry.emit)).not.toHaveBeenCalled()
    })

    it('reports nothing for a session saved and read back in the same process', () => {
      saveGrant(tokens('user-1', 'w1'))
      saveWorkspaceToken('w2', mintedToken('user-1', 'w2'))

      expect(loadGrant()).not.toBeNull()

      expect(vi.mocked(mainTelemetry.emit)).not.toHaveBeenCalled()
    })

    it('reports once a session kept only in memory because secure storage is unavailable', () => {
      electronState.encryptionAvailable = false

      expect(saveGrant(tokens('user-1', 'w1'))).toBe(true)
      saveWorkspaceToken('w2', mintedToken('user-1', 'w2'))
      activateWorkspace('w2')

      expect(eventsNamed(STORED_SESSION_FAILED_EVENT)).toEqual([
        { operation: 'save', reason: 'secure_storage_unavailable' }
      ])
    })

    it('reports once a session that could not be written to disk', () => {
      const keychainLocked = (): never => {
        throw new Error('keychain locked')
      }
      vi.mocked(safeStorage.encryptString)
        .mockImplementationOnce(keychainLocked)
        .mockImplementationOnce(keychainLocked)
      onTestFinished(() => {
        vi.mocked(safeStorage.encryptString).mockReset()
      })
      const grant = tokens('user-1', 'w1')

      expect(saveGrant(grant)).toBe(false)
      saveWorkspaceToken('w2', mintedToken('user-1', 'w2'))

      expect(fs.existsSync(vaultPath())).toBe(false)
      expect(loadGrant()).toEqual(grant)
      expect(eventsNamed(STORED_SESSION_FAILED_EVENT)).toEqual([
        { operation: 'save', reason: 'write_failed' }
      ])
    })

    it('reports a legacy session that was read but could not be saved in the current format', () => {
      const legacy = tokens('user-1', 'w1')
      writeVault(legacy)
      const stored = fs.readFileSync(vaultPath())
      vi.mocked(safeStorage.encryptString).mockImplementationOnce(() => {
        throw new Error('keychain locked')
      })
      onTestFinished(() => {
        vi.mocked(safeStorage.encryptString).mockReset()
      })

      expect(loadGrant()).toEqual(legacy)

      expect(fs.readFileSync(vaultPath())).toEqual(stored)
      expect(eventsNamed(STORED_SESSION_RESTORED_EVENT)).toEqual([{ format: 'legacy' }])
      expect(eventsNamed(STORED_SESSION_FAILED_EVENT)).toEqual([
        { operation: 'save', reason: 'write_failed' }
      ])
    })
  })
})
