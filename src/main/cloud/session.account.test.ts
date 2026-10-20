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
import { SignInFailure } from './signInFailure'
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
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
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
  it('clears an expired account session when the server requires sign-in', async () => {
    vi.setSystemTime(Date.now() + 3600000)
    vi.mocked(refresh).mockRejectedValue(
      new SignInFailure('expired', 'server_error', { reauthenticationRequired: true })
    )
    const onExpired = vi.fn()
    const session = new CloudSession(onExpired)
    await expect(session.getAccessToken()).resolves.toBeNull()
    expect(session.isSignedIn()).toBe(false)
    expect(onExpired).toHaveBeenCalledOnce()
    expect(loadAccountCredential()).toBeNull()
    expect(signIn).not.toHaveBeenCalled()
  })

  it('resumes browser sign-in for an explicit switch after account expiry', async () => {
    vi.mocked(refresh).mockRejectedValue(
      new SignInFailure('expired', 'server_error', { reauthenticationRequired: true })
    )
    const fresh = tokens('w2', 'replacement-login')
    vi.mocked(signIn).mockResolvedValue({
      tokens: fresh,
      status: statusFromAccessToken(fresh.accessToken)
    })
    await expect(new CloudSession().switchWorkspace('w2')).resolves.toMatchObject({
      workspaceId: 'w2'
    })
    expect(signIn).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'w2' })
    expect(loadAccountCredential()?.refreshToken).toBe('replacement-login')
  })

  it('keeps a still-valid access token during a transient refresh failure', async () => {
    const saved = loadTokens()
    vi.setSystemTime(Date.now() + 3570000)
    vi.mocked(refresh).mockRejectedValue(new SignInFailure('offline', 'network'))
    await expect(new CloudSession().getAccessToken()).resolves.toBe(saved?.accessToken)
    expect(loadAccountCredential()?.refreshToken).toBe('root-1')
  })

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

  it.each(['success', 'expired'])(
    'isolates a late %s from a replacement login',
    async (outcome) => {
      vi.setSystemTime(Date.now() + 3600000)
      const started = deferred<void>()
      const response = deferred<AuthTokens>()
      vi.mocked(refresh).mockImplementation(() => {
        started.resolve()
        return response.promise
      })
      const session = new CloudSession()
      const pending = session.getAccessToken()
      await started.promise
      const replacement = tokens('w1', 'replacement-login')
      vi.mocked(signIn).mockResolvedValue({
        tokens: replacement,
        status: statusFromAccessToken(replacement.accessToken)
      })
      await session.login()
      if (outcome === 'success') response.resolve(tokens('w1', 'old-successor'))
      else
        response.reject(
          new SignInFailure('expired', 'server_error', { reauthenticationRequired: true })
        )
      await expect(pending).resolves.toBeNull()
      expect(loadAccountCredential()?.refreshToken).toBe('replacement-login')
    }
  )

  it('does not return an expired token after rejecting a mismatched account response', async () => {
    vi.setSystemTime(Date.now() + 3600000)
    const wrongAccount = tokens('w1', 'wrong-account')
    const claims = Buffer.from(JSON.stringify({ sub: 'other-user', workspace_id: 'w1' })).toString(
      'base64url'
    )
    wrongAccount.accessToken = `e30.${claims}.sig`
    vi.mocked(refresh).mockResolvedValue(wrongAccount)
    await expect(new CloudSession().getAccessToken()).resolves.toBeNull()
    expect(loadAccountCredential()?.refreshToken).toBe('root-1')
  })

  it('skips a queued switch superseded by a newer workspace choice', async () => {
    vi.setSystemTime(Date.now() + 3600000)
    const started = deferred<void>()
    const first = deferred<AuthTokens>()
    vi.mocked(refresh).mockImplementationOnce(() => {
      started.resolve()
      return first.promise
    })
    vi.mocked(refresh).mockResolvedValueOnce(tokens('w3', 'root-3'))
    const session = new CloudSession()
    const renewal = session.getAccessToken()
    await started.promise
    const obsolete = session.switchWorkspace('w2')
    const latest = session.switchWorkspace('w3')
    first.resolve(tokens('w1', 'root-2'))
    await Promise.all([renewal, obsolete, latest])
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(refresh).toHaveBeenLastCalledWith('root-2', { workspaceId: 'w3', grantMode: 'account' })
    expect(session.currentWorkspaceId()).toBe('w3')
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

  it('reports a rejected token response as a failed switch', async () => {
    vi.mocked(refresh).mockResolvedValue(tokens('wrong-workspace', 'wrong-response'))
    const session = new CloudSession()
    await expect(session.switchWorkspace('w2')).rejects.toMatchObject({ reason: 'server_error' })
    expect(session.currentWorkspaceId()).toBe('w1')
    expect(loadAccountCredential()?.refreshToken).toBe('root-1')
  })

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
