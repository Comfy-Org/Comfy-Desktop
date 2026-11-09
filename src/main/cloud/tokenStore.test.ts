// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const electronState = vi.hoisted(() => ({ userData: '', encryptionAvailable: true }))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => electronState.userData) },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => electronState.encryptionAvailable),
    encryptString: vi.fn((value: string) => Buffer.from(value, 'utf-8')),
    decryptString: vi.fn((value: Buffer) => value.toString('utf-8'))
  }
}))

import {
  _resetForTest,
  activateWorkspace,
  clearTokens,
  dropWorkspaceToken,
  getAuthStatus,
  getCachedWorkspaceName,
  loadActiveWorkspaceId,
  loadGrant,
  loadWorkspaceToken,
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
  fs.writeFileSync(vaultPath(), Buffer.from(JSON.stringify(payload), 'utf-8'))
}

function readVault(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(vaultPath(), 'utf-8')) as Record<string, unknown>
}

describe('grant vault', () => {
  beforeEach(() => {
    electronState.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'comfy-cloud-tokens-'))
    electronState.encryptionAvailable = true
    _resetForTest()
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
})
