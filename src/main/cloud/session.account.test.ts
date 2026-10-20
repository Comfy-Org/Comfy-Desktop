// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const electronState = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => electronState.userData },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('./oauth', () => ({ signIn: vi.fn(), refresh: vi.fn(), openAuthorizePage: vi.fn() }))

import { statusFromAccessToken } from './claims'
import { refresh, signIn } from './oauth'
import { CloudSession } from './session'
import {
  _resetForTest,
  clearTokens,
  loadAccountCredential,
  loadTokens,
  loadWorkspaceTokens,
  saveTokens
} from './tokenStore'
import type { AuthTokens } from './types'

function tokens(workspace: string, refreshToken: string): AuthTokens {
  const claims = Buffer.from(JSON.stringify({ sub: 'user', workspace_id: workspace })).toString(
    'base64url'
  )
  return {
    grantMode: 'account',
    accessToken: `e30.${claims}.sig`,
    refreshToken,
    expiresAt: Date.now() + 3600000
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

beforeEach(() => {
  electronState.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'comfy-account-session-'))
  _resetForTest()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-19T12:00:00Z'))
  saveTokens(tokens('w1', 'root-1'))
})

afterEach(() => {
  clearTokens()
  fs.rmSync(electronState.userData, { recursive: true, force: true })
  _resetForTest()
  vi.useRealTimers()
  vi.resetAllMocks()
})

describe('account workspace tokens', () => {
  it('switches to an uncached workspace without browser authorization, then reuses its cache', async () => {
    vi.mocked(refresh).mockResolvedValue(tokens('w2', 'root-2'))
    const session = new CloudSession()
    await expect(session.switchWorkspace('w2')).resolves.toMatchObject({ workspaceId: 'w2' })
    await expect(session.switchWorkspace('w1')).resolves.toMatchObject({ workspaceId: 'w1' })
    expect(refresh).toHaveBeenCalledExactlyOnceWith('root-1', {
      workspaceId: 'w2',
      grantMode: 'account'
    })
    expect(signIn).not.toHaveBeenCalled()
    expect(loadTokens()?.refreshToken).toBeUndefined()
  })

  it('renews an expired workspace from the account credential only once', async () => {
    vi.setSystemTime(Date.now() + 3600000)
    const fresh = tokens('w1', 'root-2')
    vi.mocked(refresh).mockResolvedValue(fresh)
    const session = new CloudSession()
    await expect(
      Promise.all([session.getAccessToken(), session.getAccessToken()])
    ).resolves.toEqual([fresh.accessToken, fresh.accessToken])
    expect(refresh).toHaveBeenCalledExactlyOnceWith('root-1', {
      workspaceId: 'w1',
      grantMode: 'account'
    })
    expect(loadAccountCredential()?.refreshToken).toBe('root-2')
  })

  it('serializes rotating credentials and publishes only the latest workspace choice', async () => {
    const started = deferred<void>()
    const first = deferred<AuthTokens>()
    vi.mocked(refresh).mockImplementationOnce(() => {
      started.resolve()
      return first.promise
    })
    vi.mocked(refresh).mockResolvedValueOnce(tokens('w3', 'root-3'))
    const session = new CloudSession()
    const older = session.switchWorkspace('w2')
    await started.promise
    const newer = session.switchWorkspace('w3')
    expect(refresh).toHaveBeenCalledTimes(1)
    first.resolve(tokens('w2', 'root-2'))
    await Promise.all([older, newer])
    expect(refresh).toHaveBeenNthCalledWith(2, 'root-2', {
      workspaceId: 'w3',
      grantMode: 'account'
    })
    expect(session.currentWorkspaceId()).toBe('w3')
    expect(loadAccountCredential()?.refreshToken).toBe('root-3')
    expect(loadWorkspaceTokens('w2')).not.toBeNull()
  })

  it.each(['logout', 'new login'] as const)(
    'cannot restore an old account exchange after %s',
    async (action) => {
      const started = deferred<void>()
      const response = deferred<AuthTokens>()
      vi.mocked(refresh).mockImplementation(() => {
        started.resolve()
        return response.promise
      })
      const session = new CloudSession()
      const pending = session.switchWorkspace('w2')
      await started.promise
      if (action === 'logout') session.logout()
      else {
        const fresh = tokens('w3', 'new-login')
        vi.mocked(signIn).mockResolvedValue({
          tokens: fresh,
          status: statusFromAccessToken(fresh.accessToken)
        })
        await session.login()
      }
      response.resolve(tokens('w2', 'root-2'))
      await pending
      expect(loadAccountCredential()?.refreshToken).toBe(
        action === 'logout' ? undefined : 'new-login'
      )
      expect(loadWorkspaceTokens('w2')).toBeNull()
      expect(session.currentWorkspaceId()).toBe(action === 'logout' ? null : 'w3')
    }
  )

  it('keeps the current workspace and credential after a denied switch, then permits another target', async () => {
    vi.mocked(refresh).mockRejectedValueOnce(new Error('workspace membership lost'))
    vi.mocked(refresh).mockResolvedValueOnce(tokens('w3', 'root-2'))
    const session = new CloudSession()
    await expect(session.switchWorkspace('w2')).rejects.toThrow('workspace membership lost')
    expect(session.currentWorkspaceId()).toBe('w1')
    expect(loadAccountCredential()?.refreshToken).toBe('root-1')
    await expect(session.switchWorkspace('w3')).resolves.toMatchObject({ workspaceId: 'w3' })
    expect(signIn).not.toHaveBeenCalled()
  })
})
