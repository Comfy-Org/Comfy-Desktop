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
  getAuthStatus,
  loadTokens,
  loadWorkspaceTokens,
  replaceWorkspaceTokens,
  saveTokens,
  saveWorkspaceNames
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

describe('workspace token vault', () => {
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

  it('keeps independent workspace bundles and reactivates either one', () => {
    const workspaceOne = tokens('user-1', 'w1')
    const workspaceTwo = tokens('user-1', 'w2')

    saveTokens(workspaceOne)
    saveTokens(workspaceTwo)
    expect(loadTokens()).toEqual(workspaceTwo)

    expect(activateWorkspace('w1')).toEqual(workspaceOne)
    expect(loadTokens()).toEqual(workspaceOne)
    expect(loadWorkspaceTokens('w2')).toEqual(workspaceTwo)
  })

  it('clears cached workspaces when browser auth changes account', () => {
    saveTokens(tokens('user-1', 'w1'))
    saveTokens(tokens('user-1', 'w2'))
    saveWorkspaceNames(loadTokens()!.accessToken, [
      { id: 'w1', name: 'Workspace One', type: 'team', role: 'owner' },
      { id: 'w2', name: 'Workspace Two', type: 'team', role: 'member' }
    ])

    const otherAccount = tokens('user-2', 'w3')
    saveTokens(otherAccount)

    expect(loadTokens()).toEqual(otherAccount)
    expect(loadWorkspaceTokens('w1')).toBeNull()
    expect(loadWorkspaceTokens('w2')).toBeNull()
    expect(getAuthStatus().workspaceName).toBeUndefined()
  })

  it('restores the active workspace name after a process restart', () => {
    const active = tokens('user-1', 'w1')
    saveTokens(active)
    saveWorkspaceNames(active.accessToken, [
      { id: 'w1', name: 'Workspace One', type: 'team', role: 'owner' },
      { id: 'w2', name: 'Workspace Two', type: 'team', role: 'member' }
    ])

    _resetForTest()

    expect(getAuthStatus()).toMatchObject({
      signedIn: true,
      workspaceId: 'w1',
      workspaceName: 'Workspace One'
    })
  })

  it('rejects workspace names from a request belonging to another account', () => {
    const stale = tokens('user-1', 'w1')
    saveTokens(stale)
    saveTokens(tokens('user-2', 'w2'))

    saveWorkspaceNames(stale.accessToken, [
      { id: 'w1', name: 'Workspace One', type: 'team', role: 'owner' }
    ])

    expect(getAuthStatus().workspaceName).toBeUndefined()
  })

  it('does not retain bundles when the new account identity cannot be proven', () => {
    saveTokens({ accessToken: tokenWithoutSubject('w1'), expiresAt: Date.now() + 1000 })
    saveTokens({ accessToken: tokenWithoutSubject('w2'), expiresAt: Date.now() + 1000 })

    expect(loadWorkspaceTokens('w1')).toBeNull()
    expect(loadWorkspaceTokens('w2')).not.toBeNull()
  })

  it('rotates only the matching workspace bundle', () => {
    const workspaceOne = tokens('user-1', 'w1')
    const workspaceTwo = tokens('user-1', 'w2')
    const rotated = tokens('user-1', 'w1', '-rotated')
    saveTokens(workspaceOne)
    saveTokens(workspaceTwo)

    expect(
      replaceWorkspaceTokens('w1', workspaceOne.accessToken, workspaceOne.refreshToken!, rotated)
    ).toBe(true)
    expect(loadWorkspaceTokens('w1')).toEqual(rotated)
    expect(loadWorkspaceTokens('w2')).toEqual(workspaceTwo)
  })

  it('rejects a refresh response scoped to another workspace', () => {
    const workspaceOne = tokens('user-1', 'w1')
    saveTokens(workspaceOne)

    expect(
      replaceWorkspaceTokens(
        'w1',
        workspaceOne.accessToken,
        workspaceOne.refreshToken!,
        tokens('user-1', 'w2')
      )
    ).toBe(false)
    expect(loadWorkspaceTokens('w1')).toEqual(workspaceOne)
  })

  it('migrates the original single-token payload', () => {
    const legacy = tokens('user-1', 'w1')
    fs.writeFileSync(
      path.join(electronState.userData, 'comfy-cloud-auth.bin'),
      Buffer.from(JSON.stringify(legacy), 'utf-8')
    )

    expect(loadTokens()).toEqual(legacy)
    expect(loadWorkspaceTokens('w1')).toEqual(legacy)

    const persisted = JSON.parse(
      fs.readFileSync(path.join(electronState.userData, 'comfy-cloud-auth.bin'), 'utf-8')
    ) as { version?: number }
    expect(persisted.version).toBe(1)
  })
})
