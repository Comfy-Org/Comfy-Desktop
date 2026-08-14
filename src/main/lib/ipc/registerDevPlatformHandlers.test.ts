import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  getAllWindows: vi.fn(() => [] as unknown[]),
  // session
  login: vi.fn(),
  logout: vi.fn(),
  status: vi.fn(),
  isSignedIn: vi.fn(),
  listWorkspaces: vi.fn(),
  switchWorkspace: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
  clearVersionCache: vi.fn(),
  getVersionCacheGeneration: vi.fn(() => 3),
  // client + policy
  getBuilderClient: vi.fn(() => ({ listDistributions: mocks.listDistributions })),
  listDistributions: vi.fn(),
  resolveHost: vi.fn(async () => ({ os: 'linux', gpu: 'nvidia' })),
  listDistributionRows: vi.fn(),
  resolveHostArtifact: vi.fn(),
  // installations + shared helpers
  add: vi.fn(),
  list: vi.fn(async () => [] as Record<string, unknown>[]),
  uniqueName: vi.fn(async (n: string) => n),
  sanitizeDirName: vi.fn((n: string) => n),
  allocateUniqueDir: vi.fn((parent: string, dir: string) => `${parent}/${dir}`),
  findDuplicatePath: vi.fn(async () => null),
  defaultInstallDir: vi.fn(() => '/installs'),
  broadcastToRenderer: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: mocks.getAllWindows },
  ipcMain: { handle: mocks.handle }
}))

vi.mock('../../devplatform/session', () => ({
  getCloudSession: () => ({
    login: mocks.login,
    logout: mocks.logout,
    status: mocks.status,
    isSignedIn: mocks.isSignedIn,
    listWorkspaces: mocks.listWorkspaces,
    switchWorkspace: mocks.switchWorkspace
  }),
  getBuilderClient: mocks.getBuilderClient,
  setUnauthorizedHandler: mocks.setUnauthorizedHandler
}))

vi.mock('../../devplatform/distributions', () => ({
  resolveHost: mocks.resolveHost,
  listDistributionRows: mocks.listDistributionRows,
  resolveHostArtifact: mocks.resolveHostArtifact
}))

vi.mock('../../devplatform/versionCache', () => ({
  clearVersionCache: mocks.clearVersionCache,
  getVersionCacheGeneration: mocks.getVersionCacheGeneration
}))

vi.mock('./shared', () => ({
  installations: { add: mocks.add, list: mocks.list },
  uniqueName: mocks.uniqueName,
  sanitizeDirName: mocks.sanitizeDirName,
  allocateUniqueDir: mocks.allocateUniqueDir,
  findDuplicatePath: mocks.findDuplicatePath,
  defaultInstallDir: mocks.defaultInstallDir,
  _broadcastToRenderer: mocks.broadcastToRenderer
}))

import { registerDevPlatformHandlers, signInToCloud } from './registerDevPlatformHandlers'
import { comfyWindows, type ComfyWindowEntry } from '../../host/registry'

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown

function handler(channel: string): IpcHandler {
  const call = mocks.handle.mock.calls.find(([name]) => name === channel)
  expect(call, `handler for ${channel} was registered`).toBeDefined()
  return call![1] as IpcHandler
}

/** A host entry carrying only the panelView the broadcast targets. Host windows
 *  load no page of their own, so the panelView IS the dashboard renderer. */
function registerHostWithPanel(key: number, opts: { destroyed?: boolean; none?: boolean } = {}) {
  const send = vi.fn()
  const panelView = opts.none
    ? null
    : { webContents: { isDestroyed: () => opts.destroyed ?? false, send } }
  comfyWindows.set(key, { panelView } as unknown as ComfyWindowEntry)
  return send
}

describe('registerDevPlatformHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    comfyWindows.clear()
    registerDevPlatformHandlers()
  })

  afterEach(() => {
    comfyWindows.clear()
  })

  it('signIn returns and broadcasts the status', async () => {
    const win = { webContents: { isDestroyed: () => false, send: vi.fn() } }
    mocks.getAllWindows.mockReturnValue([win])
    mocks.login.mockResolvedValue({ signedIn: true, email: 'a@b.c', workspaceId: 'w1' })

    const status = await handler('comfybuilder:signIn')({})
    expect(status).toMatchObject({ signedIn: true, email: 'a@b.c' })
    expect(mocks.clearVersionCache).toHaveBeenCalled()
    expect(win.webContents.send).toHaveBeenCalledWith('comfybuilder:authChanged', status)
  })

  // The regression that made a file-menu sign-in look like nothing happened:
  // the host window loads no page, so broadcasting only to `getAllWindows()`
  // reaches an empty webContents and the account chip never repaints.
  it('signIn reaches the dashboard renderer in each host panelView', async () => {
    mocks.getAllWindows.mockReturnValue([])
    const panelA = registerHostWithPanel(1)
    const panelB = registerHostWithPanel(2)
    mocks.login.mockResolvedValue({ signedIn: true, email: 'a@b.c', workspaceId: 'w1' })

    const status = await handler('comfybuilder:signIn')({})

    expect(panelA).toHaveBeenCalledWith('comfybuilder:authChanged', status)
    expect(panelB).toHaveBeenCalledWith('comfybuilder:authChanged', status)
  })

  it('a menu-driven signIn broadcasts the same way as the IPC one', async () => {
    mocks.getAllWindows.mockReturnValue([])
    const panel = registerHostWithPanel(1)
    mocks.login.mockResolvedValue({ signedIn: true, email: 'a@b.c' })

    const status = await signInToCloud()

    expect(panel).toHaveBeenCalledWith('comfybuilder:authChanged', status)
  })

  it('signOut reaches the panelViews too', async () => {
    mocks.getAllWindows.mockReturnValue([])
    const panel = registerHostWithPanel(1)

    handler('comfybuilder:signOut')({})

    expect(panel).toHaveBeenCalledWith('comfybuilder:authChanged', { signedIn: false })
  })

  it('broadcasts when the builder API invalidates the active token', () => {
    mocks.getAllWindows.mockReturnValue([])
    const panel = registerHostWithPanel(1)
    const onUnauthorized = mocks.setUnauthorizedHandler.mock.calls[0]![0] as () => void

    onUnauthorized()

    expect(panel).toHaveBeenCalledWith('comfybuilder:authChanged', { signedIn: false })
  })

  it('skips hosts whose panelView is torn down or absent', async () => {
    mocks.getAllWindows.mockReturnValue([])
    const destroyed = registerHostWithPanel(1, { destroyed: true })
    registerHostWithPanel(2, { none: true })
    const live = registerHostWithPanel(3)
    mocks.login.mockResolvedValue({ signedIn: true })

    await expect(handler('comfybuilder:signIn')({})).resolves.toBeDefined()

    expect(destroyed).not.toHaveBeenCalled()
    expect(live).toHaveBeenCalledOnce()
  })

  it('signOut clears the session and broadcasts signed-out', async () => {
    const win = { webContents: { isDestroyed: () => false, send: vi.fn() } }
    mocks.getAllWindows.mockReturnValue([win])

    const status = handler('comfybuilder:signOut')({})
    expect(status).toEqual({ signedIn: false })
    expect(mocks.logout).toHaveBeenCalledOnce()
    expect(win.webContents.send).toHaveBeenCalledWith('comfybuilder:authChanged', {
      signedIn: false
    })
  })

  it('listDistributions is empty (no network) when signed out', async () => {
    mocks.isSignedIn.mockReturnValue(false)
    const rows = await handler('comfybuilder:listDistributions')({})
    expect(rows).toEqual([])
    expect(mocks.listDistributionRows).not.toHaveBeenCalled()
  })

  it('listDistributions returns rows for the signed-in workspace', async () => {
    mocks.isSignedIn.mockReturnValue(true)
    mocks.listDistributionRows.mockResolvedValue([
      { id: 'd1', name: 'Image', state: 'installable' }
    ])
    const rows = await handler('comfybuilder:listDistributions')({})
    expect(rows).toEqual([{ id: 'd1', name: 'Image', state: 'installable' }])
    expect(mocks.broadcastToRenderer).toHaveBeenCalledWith('installations-changed', {})
  })

  it('switchWorkspace re-scopes and broadcasts the new status', async () => {
    const win = { webContents: { isDestroyed: () => false, send: vi.fn() } }
    mocks.getAllWindows.mockReturnValue([win])
    mocks.switchWorkspace.mockResolvedValue({
      signedIn: true,
      workspaceId: 'w2',
      workspaceType: 'team'
    })

    const status = await handler('comfybuilder:switchWorkspace')({}, 'w2')
    expect(mocks.switchWorkspace).toHaveBeenCalledWith('w2')
    expect(status).toMatchObject({ workspaceId: 'w2' })
    expect(win.webContents.send).toHaveBeenCalledWith('comfybuilder:authChanged', status)
  })

  it('installDistribution creates an installing record carrying the resolved artifact', async () => {
    mocks.isSignedIn.mockReturnValue(true)
    mocks.resolveHostArtifact.mockResolvedValue({
      version: 7,
      artifact: {
        id: 'art-9',
        os: 'linux',
        gpu: 'nvidia',
        accelVariant: 'cu128',
        status: 'ready',
        archiveSha256: 'deadbeef'
      }
    })
    mocks.listDistributions.mockResolvedValue([{ id: 'd1', name: 'Image Baseline' }])
    mocks.add.mockResolvedValue({ id: 'inst-1', name: 'Image Baseline' })

    const result = await handler('comfybuilder:installDistribution')({}, 'd1')
    expect(result).toEqual({ ok: true, entry: { id: 'inst-1', name: 'Image Baseline' } })
    expect(mocks.add).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: 'comfybuilder',
        distributionId: 'd1',
        distributionName: 'Image Baseline',
        version: '7',
        artifactId: 'art-9',
        artifactSha256: 'deadbeef',
        status: 'installing'
      })
    )
  })

  it('installDistribution refuses an artifact with no integrity value', async () => {
    mocks.isSignedIn.mockReturnValue(true)
    mocks.resolveHostArtifact.mockResolvedValue({
      version: 1,
      artifact: {
        id: 'art-nohash',
        os: 'linux',
        gpu: 'nvidia',
        accelVariant: 'cu128',
        status: 'ready'
      }
    })
    const result = await handler('comfybuilder:installDistribution')({}, 'd1')
    expect(result).toEqual({ ok: false, message: 'This build has no SHA-256 integrity value.' })
    expect(mocks.add).not.toHaveBeenCalled()
  })

  it('installDistribution refuses when no host artifact resolves', async () => {
    mocks.isSignedIn.mockReturnValue(true)
    mocks.resolveHostArtifact.mockResolvedValue(null)
    const result = await handler('comfybuilder:installDistribution')({}, 'd1')
    expect(result).toMatchObject({ ok: false })
    expect(mocks.add).not.toHaveBeenCalled()
  })

  it('installDistribution refuses when signed out', async () => {
    mocks.isSignedIn.mockReturnValue(false)
    const result = await handler('comfybuilder:installDistribution')({}, 'd1')
    expect(result).toMatchObject({ ok: false })
    expect(mocks.resolveHostArtifact).not.toHaveBeenCalled()
  })

  it('listDistributions passes the installed-version map built from comfybuilder installs', async () => {
    mocks.isSignedIn.mockReturnValue(true)
    mocks.list.mockResolvedValue([
      { id: 'i1', sourceId: 'comfybuilder', distributionId: 'd1', version: '3' },
      { id: 'i2', sourceId: 'standalone', distributionId: 'ignored', version: '9' } // non-builder: excluded
    ])
    mocks.listDistributionRows.mockResolvedValue([])
    await handler('comfybuilder:listDistributions')({})
    const installed = mocks.listDistributionRows.mock.calls[0]![2] as Map<string, number>
    expect(installed.get('d1')).toBe(3)
    expect(installed.has('ignored')).toBe(false)
    expect(mocks.listDistributionRows.mock.calls[0]![3]).toBe(3)
  })
})
