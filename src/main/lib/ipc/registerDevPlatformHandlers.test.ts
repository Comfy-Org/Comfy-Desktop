import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  // client + policy
  getBuilderClient: vi.fn(() => ({ listDistributions: mocks.listDistributions })),
  listDistributions: vi.fn(),
  resolveHost: vi.fn(async () => ({ os: 'linux', gpu: 'nvidia' })),
  listDistributionRows: vi.fn(),
  resolveHostArtifact: vi.fn(),
  // installations + shared helpers
  add: vi.fn(),
  uniqueName: vi.fn(async (n: string) => n),
  sanitizeDirName: vi.fn((n: string) => n),
  allocateUniqueDir: vi.fn((parent: string, dir: string) => `${parent}/${dir}`),
  findDuplicatePath: vi.fn(async () => null),
  defaultInstallDir: vi.fn(() => '/installs')
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
  getBuilderClient: mocks.getBuilderClient
}))

vi.mock('../../devplatform/distributions', () => ({
  resolveHost: mocks.resolveHost,
  listDistributionRows: mocks.listDistributionRows,
  resolveHostArtifact: mocks.resolveHostArtifact
}))

vi.mock('./shared', () => ({
  installations: { add: mocks.add },
  uniqueName: mocks.uniqueName,
  sanitizeDirName: mocks.sanitizeDirName,
  allocateUniqueDir: mocks.allocateUniqueDir,
  findDuplicatePath: mocks.findDuplicatePath,
  defaultInstallDir: mocks.defaultInstallDir
}))

import { registerDevPlatformHandlers } from './registerDevPlatformHandlers'

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown

function handler(channel: string): IpcHandler {
  const call = mocks.handle.mock.calls.find(([name]) => name === channel)
  expect(call, `handler for ${channel} was registered`).toBeDefined()
  return call![1] as IpcHandler
}

describe('registerDevPlatformHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerDevPlatformHandlers()
  })

  it('signIn returns and broadcasts the status', async () => {
    const win = { webContents: { isDestroyed: () => false, send: vi.fn() } }
    mocks.getAllWindows.mockReturnValue([win])
    mocks.login.mockResolvedValue({ signedIn: true, email: 'a@b.c', workspaceId: 'w1' })

    const status = await handler('comfybuilder:signIn')({})
    expect(status).toMatchObject({ signedIn: true, email: 'a@b.c' })
    expect(win.webContents.send).toHaveBeenCalledWith('comfybuilder:authChanged', status)
  })

  it('signOut clears the session and broadcasts signed-out', async () => {
    const win = { webContents: { isDestroyed: () => false, send: vi.fn() } }
    mocks.getAllWindows.mockReturnValue([win])

    const status = handler('comfybuilder:signOut')({})
    expect(status).toEqual({ signedIn: false })
    expect(mocks.logout).toHaveBeenCalledOnce()
    expect(win.webContents.send).toHaveBeenCalledWith('comfybuilder:authChanged', { signedIn: false })
  })

  it('listDistributions is empty (no network) when signed out', async () => {
    mocks.isSignedIn.mockReturnValue(false)
    const rows = await handler('comfybuilder:listDistributions')({})
    expect(rows).toEqual([])
    expect(mocks.listDistributionRows).not.toHaveBeenCalled()
  })

  it('listDistributions returns rows for the signed-in workspace', async () => {
    mocks.isSignedIn.mockReturnValue(true)
    mocks.listDistributionRows.mockResolvedValue([{ id: 'd1', name: 'Image', state: 'installable' }])
    const rows = await handler('comfybuilder:listDistributions')({})
    expect(rows).toEqual([{ id: 'd1', name: 'Image', state: 'installable' }])
  })

  it('switchWorkspace re-scopes and broadcasts the new status', async () => {
    const win = { webContents: { isDestroyed: () => false, send: vi.fn() } }
    mocks.getAllWindows.mockReturnValue([win])
    mocks.switchWorkspace.mockResolvedValue({ signedIn: true, workspaceId: 'w2', workspaceType: 'team' })

    const status = await handler('comfybuilder:switchWorkspace')({}, 'w2')
    expect(mocks.switchWorkspace).toHaveBeenCalledWith('w2')
    expect(status).toMatchObject({ workspaceId: 'w2' })
    expect(win.webContents.send).toHaveBeenCalledWith('comfybuilder:authChanged', status)
  })

  it('installDistribution creates an installing record carrying the resolved artifact', async () => {
    mocks.isSignedIn.mockReturnValue(true)
    mocks.resolveHostArtifact.mockResolvedValue({
      version: 7,
      artifact: { id: 'art-9', os: 'linux', gpu: 'nvidia', accelVariant: 'cu128', status: 'ready', archiveSha256: 'deadbeef' }
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

  it('installDistribution omits the sha field when the artifact has none (fails closed later)', async () => {
    mocks.isSignedIn.mockReturnValue(true)
    mocks.resolveHostArtifact.mockResolvedValue({
      version: 1,
      artifact: { id: 'art-nohash', os: 'linux', gpu: 'nvidia', accelVariant: 'cu128', status: 'ready' }
    })
    mocks.listDistributions.mockResolvedValue([{ id: 'd1', name: 'NoHash' }])
    mocks.add.mockResolvedValue({ id: 'inst-2', name: 'NoHash' })

    const result = await handler('comfybuilder:installDistribution')({}, 'd1')
    expect(result).toMatchObject({ ok: true })
    expect(mocks.add.mock.calls[0]![0]).not.toHaveProperty('artifactSha256')
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
})
