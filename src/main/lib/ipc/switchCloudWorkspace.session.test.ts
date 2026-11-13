// @vitest-environment node
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import type { WebContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  userData: '',
  session: null as unknown,
  windows: [] as unknown[]
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => state.userData) },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) => Buffer.from(value, 'utf-8')),
    decryptString: vi.fn((value: Buffer) => value.toString('utf-8'))
  },
  BrowserWindow: { getAllWindows: () => state.windows },
  ipcMain: { handle: vi.fn() },
  shell: { openExternal: vi.fn(async () => {}) }
}))
vi.mock('../../cloud/oauth', () => ({
  signIn: vi.fn(),
  refresh: vi.fn(),
  revoke: vi.fn(async () => 'revoked'),
  openAuthorizePage: vi.fn(async () => {})
}))
vi.mock('../../devplatform/session', () => ({
  getCloudSession: () => state.session,
  getBuilderClient: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
  rejectAccessToken: vi.fn()
}))
vi.mock('../../devplatform/builds', () => ({
  resolveHost: vi.fn(),
  resolveBuildRows: vi.fn(),
  resolveHostArtifact: vi.fn(),
  resolveSelectedHostArtifact: vi.fn()
}))
vi.mock('../../devplatform/versionCache', () => ({
  clearVersionCache: vi.fn(),
  getVersionCacheGeneration: vi.fn(() => 0)
}))
vi.mock('../../popups/systemModal', () => ({ openSystemModalAsync: vi.fn() }))
vi.mock('./shared', () => ({
  installations: {},
  defaultInstallDir: vi.fn(),
  sourceMap: {},
  saveSnapshot: vi.fn(),
  loadSnapshot: vi.fn(),
  getSnapshotCount: vi.fn(),
  buildExportEnvelope: vi.fn(),
  _broadcastToRenderer: vi.fn(),
  _operationAborts: new Map(),
  i18n: { t: (key: string) => key }
}))
vi.mock('../telemetry', () => ({ emit: vi.fn() }))
vi.mock('../embeddedSessionFlag', () => ({ isEmbeddedSessionEnabled: async () => false }))
vi.mock('../workspaceMintSwitchFlag', () => ({ isWorkspaceMintSwitchEnabled: async () => true }))

import { CLOUD_CONFIG } from '../../cloud/config'
import { refresh, revoke, signIn } from '../../cloud/oauth'
import { CloudSession } from '../../cloud/session'
import { SignInFailure } from '../../cloud/signInFailure'
import { _resetForTest, clearTokens, saveGrant } from '../../cloud/tokenStore'
import type { AuthTokens } from '../../cloud/types'
import { _resetForTest as resetViewGrants, getViewWorkspaceGrants } from '../viewWorkspaceGrants'
import { switchCloudWorkspace } from './registerDevPlatformHandlers'

const FUTURE = Date.now() + 3_600_000
const PAST = Date.now() - 1_000
const viewV = { id: 'view-v' } as unknown as WebContents
const otherView = { id: 'other-view' } as unknown as WebContents

function jwt(claims: Record<string, unknown>): string {
  const b64 = (value: unknown): string =>
    Buffer.from(JSON.stringify(value), 'utf-8').toString('base64url')
  return `${b64({ alg: 'RS256' })}.${b64(claims)}.sig`
}

function grantOn(workspaceId: string, expiresAt = FUTURE): AuthTokens {
  return {
    accessToken: jwt({ sub: 'user-1', workspace_id: workspaceId, scope: CLOUD_CONFIG.scope }),
    refreshToken: `refresh-${workspaceId}`,
    expiresAt
  }
}

function mintedJwt(workspaceId: string): string {
  return jwt({ sub: 'user-1', workspace_id: workspaceId })
}

function consented(tokens: AuthTokens): Awaited<ReturnType<typeof signIn>> {
  return { tokens, status: { signedIn: true } }
}

function minted(workspaceId: string): Response {
  return new Response(
    JSON.stringify({ token: mintedJwt(workspaceId), expires_at: new Date(FUTURE).toISOString() }),
    { status: 200 }
  )
}

let mintReply: (workspaceId: string) => Response
let send: ReturnType<typeof vi.fn>

beforeEach(() => {
  state.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'switch-cloud-workspace-'))
  _resetForTest()
  resetViewGrants()
  state.session = new CloudSession()
  send = vi.fn()
  state.windows = [{ webContents: { isDestroyed: () => false, send } }]
  mintReply = minted
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) =>
      mintReply((JSON.parse(String(init.body)) as { workspace_id: string }).workspace_id)
    )
  )
})

afterEach(() => {
  clearTokens()
  _resetForTest()
  fs.rmSync(state.userData, { recursive: true, force: true })
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  vi.mocked(signIn).mockReset()
  vi.mocked(refresh).mockReset()
})

describe('switchCloudWorkspace with a real session, vault and view grants', () => {
  it('consent landing on another workspace of the same account leaves views a usable token', async () => {
    saveGrant(grantOn('A', PAST))
    getViewWorkspaceGrants().allowDesktop('A')
    vi.mocked(refresh).mockRejectedValue(
      new SignInFailure('refused', 'server_error', {
        httpStatus: 400,
        oauthError: 'invalid_grant'
      })
    )
    vi.mocked(signIn).mockResolvedValue(consented(grantOn('C')))
    mintReply = (workspaceId) =>
      workspaceId === 'B' ? new Response('{}', { status: 404 }) : minted(workspaceId)

    const { status: reply, reached } = await switchCloudWorkspace('B')

    expect(reply).toMatchObject({ workspaceId: 'C', workspaceSwitchFailure: 'unavailable' })
    expect(reached).toBe(false)
    expect(signIn).toHaveBeenCalledOnce()
    await expect(getViewWorkspaceGrants().tokenFor(viewV, 'C')).resolves.toBe(mintedJwt('C'))
    await expect(getViewWorkspaceGrants().tokenFor(otherView, 'C')).resolves.toBe(mintedJwt('C'))
  })

  it('consent on the requested workspace lets every view hold it', async () => {
    saveGrant(grantOn('A'))
    getViewWorkspaceGrants().allowDesktop('A')
    mintReply = () => new Response(JSON.stringify({ code: 'sso_required' }), { status: 403 })
    vi.mocked(signIn).mockResolvedValue(consented(grantOn('X')))

    await switchCloudWorkspace('X')
    mintReply = minted

    await expect(getViewWorkspaceGrants().tokenFor(otherView, 'X')).resolves.toBe(mintedJwt('X'))
    expect(revoke).toHaveBeenCalledExactlyOnceWith(
      grantOn('A').refreshToken,
      CLOUD_CONFIG.clientId,
      expect.any(String)
    )
  })

  it('a view switch that mints stays isolated to that view', async () => {
    saveGrant(grantOn('A'))
    getViewWorkspaceGrants().allowDesktop('A')
    getViewWorkspaceGrants().allowView(viewV, 'X')

    await expect(switchCloudWorkspace('X')).resolves.toMatchObject({
      status: { workspaceId: 'X' },
      reached: true
    })

    await expect(getViewWorkspaceGrants().tokenFor(viewV, 'X')).resolves.toBe(mintedJwt('X'))
    await expect(getViewWorkspaceGrants().tokenFor(otherView, 'X')).resolves.toBeNull()
    expect(signIn).not.toHaveBeenCalled()
  })

  it('a view switch that mints after a browser trip stays isolated to that view', async () => {
    saveGrant(grantOn('A'))
    getViewWorkspaceGrants().allowDesktop('A')
    getViewWorkspaceGrants().allowView(viewV, 'X')
    let replies = 0
    mintReply = (workspaceId) =>
      replies++ === 0
        ? new Response(JSON.stringify({ code: 'sso_required' }), { status: 403 })
        : minted(workspaceId)
    vi.mocked(signIn).mockResolvedValue(consented(grantOn('C')))

    await expect(switchCloudWorkspace('X')).resolves.toMatchObject({
      status: { workspaceId: 'X' },
      reached: true
    })

    await expect(getViewWorkspaceGrants().tokenFor(viewV, 'X')).resolves.toBe(mintedJwt('X'))
    await expect(getViewWorkspaceGrants().tokenFor(otherView, 'X')).resolves.toBeNull()
  })

  it('a re-anchored grant that stays on the old workspace widens nothing', async () => {
    saveGrant(grantOn('A'))
    getViewWorkspaceGrants().allowDesktop('A')
    mintReply = () => new Response(JSON.stringify({ code: 'sso_required' }), { status: 403 })
    vi.mocked(signIn).mockResolvedValue(consented(grantOn('C')))
    const allowDesktop = vi.spyOn(getViewWorkspaceGrants(), 'allowDesktop')

    await expect(switchCloudWorkspace('X')).resolves.toMatchObject({
      status: { workspaceId: 'A', workspaceSwitchFailure: 'retryable' },
      reached: false
    })

    expect(allowDesktop).not.toHaveBeenCalled()
  })

  it('keeps the internal consent marker off the reply and the broadcast', async () => {
    saveGrant(grantOn('A'))
    mintReply = () => new Response(JSON.stringify({ code: 'sso_required' }), { status: 403 })
    vi.mocked(signIn).mockResolvedValue(consented(grantOn('X')))

    const { status: reply } = await switchCloudWorkspace('X')

    expect(reply).not.toHaveProperty('reachedThroughConsent')
    expect(reply).not.toHaveProperty('reached')
    expect(send.mock.calls[0]?.[1]).not.toHaveProperty('reachedThroughConsent')
    expect(send.mock.calls[0]?.[1]).not.toHaveProperty('reached')
  })
})
