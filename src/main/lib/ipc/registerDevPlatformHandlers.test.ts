import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  getAllWindows: vi.fn(() => [] as unknown[]),
  openExternal: vi.fn(async () => {}),
  // session
  login: vi.fn(),
  logout: vi.fn(),
  status: vi.fn(),
  isSignedIn: vi.fn(),
  listWorkspaces: vi.fn(),
  listWorkspaceMembers: vi.fn(),
  switchWorkspace: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
  clearVersionCache: vi.fn(),
  getVersionCacheGeneration: vi.fn(() => 3),
  // client + policy
  getBuilderClient: vi.fn(() => ({
    listBuilds: mocks.listBuilds,
    createBuildDraft: mocks.createBuildDraft
  })),
  listBuilds: vi.fn(),
  createBuildDraft: vi.fn(),
  resolveHost: vi.fn(async () => ({ os: 'linux', gpu: 'nvidia' })),
  resolveBuildRows: vi.fn(),
  resolveHostArtifact: vi.fn(),
  resolveSelectedHostArtifact: vi.fn(),
  // installations + shared helpers
  add: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
  associateUnownedBuildInstalls: vi.fn(),
  list: vi.fn(async () => [] as Record<string, unknown>[]),
  uniqueName: vi.fn(async (n: string) => n),
  sanitizeDirName: vi.fn((n: string) => n),
  allocateUniqueDir: vi.fn((parent: string, dir: string) => `${parent}/${dir}`),
  findDuplicatePath: vi.fn(async () => null),
  defaultInstallDir: vi.fn(() => '/installs'),
  saveSnapshot: vi.fn(),
  loadSnapshot: vi.fn(),
  getSnapshotCount: vi.fn(),
  buildExportEnvelope: vi.fn(),
  broadcastToRenderer: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: mocks.getAllWindows },
  ipcMain: { handle: mocks.handle },
  shell: { openExternal: mocks.openExternal }
}))

vi.mock('../../devplatform/session', () => ({
  getCloudSession: () => ({
    login: mocks.login,
    logout: mocks.logout,
    status: mocks.status,
    isSignedIn: mocks.isSignedIn,
    listWorkspaces: mocks.listWorkspaces,
    listWorkspaceMembers: mocks.listWorkspaceMembers,
    switchWorkspace: mocks.switchWorkspace
  }),
  getBuilderClient: mocks.getBuilderClient,
  setUnauthorizedHandler: mocks.setUnauthorizedHandler
}))

vi.mock('../../devplatform/builds', () => ({
  resolveHost: mocks.resolveHost,
  resolveBuildRows: mocks.resolveBuildRows,
  resolveHostArtifact: mocks.resolveHostArtifact,
  resolveSelectedHostArtifact: mocks.resolveSelectedHostArtifact
}))

vi.mock('../../devplatform/versionCache', () => ({
  clearVersionCache: mocks.clearVersionCache,
  getVersionCacheGeneration: mocks.getVersionCacheGeneration
}))

vi.mock('./shared', () => ({
  installations: {
    add: mocks.add,
    get: mocks.get,
    update: mocks.update,
    associateUnownedBuildInstalls: mocks.associateUnownedBuildInstalls,
    list: mocks.list
  },
  uniqueName: mocks.uniqueName,
  sanitizeDirName: mocks.sanitizeDirName,
  allocateUniqueDir: mocks.allocateUniqueDir,
  findDuplicatePath: mocks.findDuplicatePath,
  defaultInstallDir: mocks.defaultInstallDir,
  sourceMap: {
    standalone: { category: 'local' },
    desktop: { category: 'local' },
    comfybuilder: { category: 'local' },
    cloud: { category: 'cloud' }
  },
  saveSnapshot: mocks.saveSnapshot,
  loadSnapshot: mocks.loadSnapshot,
  getSnapshotCount: mocks.getSnapshotCount,
  buildExportEnvelope: mocks.buildExportEnvelope,
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
    mocks.status.mockReturnValue({ signedIn: true, workspaceId: 'w1', workspaceType: 'team' })
    mocks.get.mockResolvedValue({
      id: 'local-1',
      name: 'Local One',
      sourceId: 'standalone',
      status: 'installed',
      installPath: '/installs/local-1'
    })
    mocks.saveSnapshot.mockResolvedValue('fresh.json')
    mocks.loadSnapshot.mockResolvedValue({ version: 2, createdAt: '2026-08-21T00:00:00.000Z' })
    mocks.getSnapshotCount.mockResolvedValue(3)
    mocks.buildExportEnvelope.mockReturnValue({ type: 'comfyui-desktop-2-snapshot' })
    mocks.listBuilds.mockResolvedValue([])
    mocks.listWorkspaceMembers.mockResolvedValue([])
    mocks.createBuildDraft.mockResolvedValue({
      buildId: 'build-1',
      workspaceId: 'w1',
      editUrl: '/profile/builds/new?workspace=w1&edit=build-1'
    })
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

  it('opens the active workspace Builds page', async () => {
    await handler('comfybuilder:openBuildsPage')({})

    expect(mocks.openExternal).toHaveBeenCalledExactlyOnceWith(
      'https://platform.comfy.org/profile/builds?workspace=w1'
    )
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

  it('listBuilds is empty (no network) when signed out', async () => {
    mocks.isSignedIn.mockReturnValue(false)
    const rows = await handler('comfybuilder:listBuilds')({})
    expect(rows).toEqual([])
    expect(mocks.resolveBuildRows).not.toHaveBeenCalled()
  })

  it('listBuilds returns rows for the signed-in workspace', async () => {
    mocks.isSignedIn.mockReturnValue(true)
    mocks.listBuilds.mockResolvedValue([{ id: 'd1', name: 'Image' }])
    mocks.resolveBuildRows.mockResolvedValue([{ id: 'd1', name: 'Image', state: 'installable' }])
    const rows = await handler('comfybuilder:listBuilds')({})
    expect(rows).toEqual([{ id: 'd1', name: 'Image', state: 'installable' }])
    expect(mocks.associateUnownedBuildInstalls).toHaveBeenCalledOnce()
    expect(mocks.associateUnownedBuildInstalls.mock.calls[0]![0]).toBe('w1')
    expect(mocks.associateUnownedBuildInstalls.mock.calls[0]![1]).toEqual(new Set(['d1']))
    expect(mocks.resolveBuildRows.mock.calls[0]![2]).toEqual([{ id: 'd1', name: 'Image' }])
    expect(mocks.broadcastToRenderer).toHaveBeenCalledWith('installations-changed', {})
  })

  it('resolves Build creator ids to workspace member names', async () => {
    mocks.isSignedIn.mockReturnValue(true)
    mocks.listBuilds.mockResolvedValue([{ id: 'd1', name: 'Image', createdBy: 'user-1' }])
    mocks.resolveBuildRows.mockResolvedValue([
      { id: 'd1', name: 'Image', createdBy: 'user-1', state: 'installable' }
    ])
    mocks.listWorkspaceMembers.mockResolvedValue([
      { id: 'user-1', name: 'Builder Person', email: 'person@example.com' }
    ])

    await expect(handler('comfybuilder:listBuilds')({})).resolves.toEqual([
      {
        id: 'd1',
        name: 'Image',
        createdBy: 'user-1',
        creatorName: 'Builder Person',
        state: 'installable'
      }
    ])
  })

  it('keeps Builds usable when workspace member lookup fails', async () => {
    mocks.isSignedIn.mockReturnValue(true)
    mocks.listBuilds.mockResolvedValue([{ id: 'd1', name: 'Image', createdBy: 'user-1' }])
    mocks.resolveBuildRows.mockResolvedValue([
      { id: 'd1', name: 'Image', createdBy: 'user-1', state: 'installable' }
    ])
    mocks.listWorkspaceMembers.mockRejectedValue(new Error('members unavailable'))

    await expect(handler('comfybuilder:listBuilds')({})).resolves.toEqual([
      {
        id: 'd1',
        name: 'Image',
        createdBy: 'user-1',
        creatorName: 'user-1',
        state: 'installable'
      }
    ])
  })

  it('does not backfill ownership when the build catalog fails to load', async () => {
    mocks.isSignedIn.mockReturnValue(true)
    mocks.listBuilds.mockRejectedValue(new Error('catalog unavailable'))

    await expect(handler('comfybuilder:listBuilds')({})).rejects.toThrow('catalog unavailable')

    expect(mocks.associateUnownedBuildInstalls).not.toHaveBeenCalled()
    expect(mocks.resolveBuildRows).not.toHaveBeenCalled()
  })

  it('does not backfill ownership if the active workspace changes during the catalog read', async () => {
    mocks.isSignedIn.mockReturnValue(true)
    mocks.listBuilds.mockImplementationOnce(async () => {
      mocks.status.mockReturnValue({ signedIn: true, workspaceId: 'w2', workspaceType: 'team' })
      return [{ id: 'd1', name: 'Image' }]
    })
    mocks.resolveBuildRows.mockResolvedValue([])

    await handler('comfybuilder:listBuilds')({})

    expect(mocks.associateUnownedBuildInstalls).not.toHaveBeenCalled()
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

  it('captures fresh state, creates a draft, and opens the validated Platform URL', async () => {
    const result = await handler('comfybuilder:promoteLocalInstance')({}, 'local-1')

    expect(result).toEqual({ ok: true })
    expect(mocks.saveSnapshot).toHaveBeenCalledExactlyOnceWith(
      '/installs/local-1',
      expect.objectContaining({ id: 'local-1', sourceId: 'standalone' }),
      'manual'
    )
    expect(mocks.loadSnapshot).toHaveBeenCalledWith('/installs/local-1', 'fresh.json')
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith('local-1', {
      lastSnapshot: 'fresh.json',
      snapshotCount: 3
    })
    expect(mocks.buildExportEnvelope).toHaveBeenCalledWith('Local One', [
      {
        filename: 'fresh.json',
        snapshot: { version: 2, createdAt: '2026-08-21T00:00:00.000Z' }
      }
    ])
    expect(mocks.createBuildDraft).toHaveBeenCalledExactlyOnceWith({
      type: 'comfyui-desktop-2-snapshot'
    })
    expect(mocks.openExternal).toHaveBeenCalledExactlyOnceWith(
      'https://platform.comfy.org/profile/builds/new?workspace=w1&edit=build-1'
    )
  })

  it('does not start two promotions for the same instance', async () => {
    let finishCapture!: (filename: string) => void
    mocks.saveSnapshot.mockReturnValue(
      new Promise<string>((resolve) => {
        finishCapture = resolve
      })
    )

    const first = handler('comfybuilder:promoteLocalInstance')({}, 'local-1') as Promise<unknown>
    await vi.waitFor(() => expect(mocks.saveSnapshot).toHaveBeenCalledOnce())
    const second = await handler('comfybuilder:promoteLocalInstance')({}, 'local-1')

    expect(second).toEqual({ ok: false, message: 'Promotion is already in progress.' })
    finishCapture('fresh.json')
    await expect(first).resolves.toEqual({ ok: true })
    expect(mocks.createBuildDraft).toHaveBeenCalledOnce()
  })

  it.each([
    ['signed out', { signedIn: false }, 'Not signed in.'],
    ['missing an active workspace', { signedIn: true }, 'No active workspace.']
  ])('refuses promotion when %s', async (_label, status, message) => {
    mocks.status.mockReturnValue(status)

    const result = await handler('comfybuilder:promoteLocalInstance')({}, 'local-1')

    expect(result).toEqual({ ok: false, message })
    expect(mocks.saveSnapshot).not.toHaveBeenCalled()
    expect(mocks.createBuildDraft).not.toHaveBeenCalled()
  })

  it.each([
    ['a Builder install', { sourceId: 'comfybuilder' }],
    ['an active-workspace install', { workspaceId: 'w1' }],
    ['an install owned by another workspace', { workspaceId: 'w2' }],
    ['a cloud install', { sourceId: 'cloud' }],
    ['an incomplete install', { status: 'installing' }]
  ])('refuses to promote %s', async (_label, overrides) => {
    mocks.get.mockResolvedValue({
      id: 'local-1',
      name: 'Local One',
      sourceId: 'standalone',
      status: 'installed',
      installPath: '/installs/local-1',
      ...overrides
    })

    const result = await handler('comfybuilder:promoteLocalInstance')({}, 'local-1')

    expect(result).toEqual({
      ok: false,
      message: 'This instance cannot be promoted to a workspace.'
    })
    expect(mocks.saveSnapshot).not.toHaveBeenCalled()
    expect(mocks.createBuildDraft).not.toHaveBeenCalled()
  })

  it('does not upload if the active workspace changes during capture', async () => {
    const inst = {
      id: 'local-1',
      name: 'Local One',
      sourceId: 'standalone',
      status: 'installed',
      installPath: '/installs/local-1'
    }
    mocks.get.mockResolvedValueOnce(inst).mockImplementationOnce(async () => {
      mocks.status.mockReturnValue({ signedIn: true, workspaceId: 'w2', workspaceType: 'team' })
      return inst
    })

    const result = await handler('comfybuilder:promoteLocalInstance')({}, 'local-1')

    expect(result).toEqual({ ok: false, message: 'The active workspace changed. Try again.' })
    expect(mocks.createBuildDraft).not.toHaveBeenCalled()
    expect(mocks.openExternal).not.toHaveBeenCalled()
  })

  it('does not upload if the instance gains workspace ownership during capture', async () => {
    const inst = {
      id: 'local-1',
      name: 'Local One',
      sourceId: 'standalone',
      status: 'installed',
      installPath: '/installs/local-1'
    }
    mocks.get.mockResolvedValueOnce(inst).mockResolvedValueOnce({ ...inst, workspaceId: 'w1' })

    const result = await handler('comfybuilder:promoteLocalInstance')({}, 'local-1')

    expect(result).toEqual({ ok: false, message: 'The instance changed. Try again.' })
    expect(mocks.createBuildDraft).not.toHaveBeenCalled()
    expect(mocks.openExternal).not.toHaveBeenCalled()
  })

  it('does not open the draft if the active workspace changes during upload', async () => {
    mocks.createBuildDraft.mockImplementationOnce(async () => {
      mocks.status.mockReturnValue({ signedIn: true, workspaceId: 'w2', workspaceType: 'team' })
      return {
        buildId: 'build-1',
        workspaceId: 'w1',
        editUrl: 'https://platform.comfy.org/profile/builds/new?workspace=w1&edit=build-1'
      }
    })

    const result = await handler('comfybuilder:promoteLocalInstance')({}, 'local-1')

    expect(result).toEqual({ ok: false, message: 'The active workspace changed. Try again.' })
    expect(mocks.openExternal).not.toHaveBeenCalled()
  })

  it('does not open the draft if the instance gains workspace ownership during upload', async () => {
    const inst = {
      id: 'local-1',
      name: 'Local One',
      sourceId: 'standalone',
      status: 'installed',
      installPath: '/installs/local-1'
    }
    mocks.get
      .mockResolvedValueOnce(inst)
      .mockResolvedValueOnce(inst)
      .mockResolvedValueOnce({ ...inst, workspaceId: 'w1' })

    const result = await handler('comfybuilder:promoteLocalInstance')({}, 'local-1')

    expect(result).toEqual({ ok: false, message: 'The instance changed. Try again.' })
    expect(mocks.openExternal).not.toHaveBeenCalled()
  })

  it.each([
    'http://platform.comfy.org/profile/builds/new?workspace=w1&edit=build-1',
    'https://attacker.example/profile/builds/new?workspace=w1&edit=build-1'
  ])('refuses to open an unsafe draft URL: %s', async (draftUrl) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.createBuildDraft.mockResolvedValue({
      buildId: 'build-1',
      workspaceId: 'w1',
      editUrl: draftUrl
    })

    const result = await handler('comfybuilder:promoteLocalInstance')({}, 'local-1')

    expect(result).toEqual({
      ok: false,
      message: 'Comfy Builder returned an invalid draft URL.'
    })
    expect(mocks.openExternal).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('refuses to open a draft created for another workspace', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.createBuildDraft.mockResolvedValue({
      buildId: 'build-1',
      workspaceId: 'w2',
      editUrl: 'https://platform.comfy.org/profile/builds/new?workspace=w2&edit=build-1'
    })

    const result = await handler('comfybuilder:promoteLocalInstance')({}, 'local-1')

    expect(result).toEqual({
      ok: false,
      message: 'Comfy Builder created the draft in a different workspace.'
    })
    expect(mocks.openExternal).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('returns a capture error without assigning workspace ownership', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.saveSnapshot.mockRejectedValue(new Error('Could not inspect the Python environment.'))

    const result = await handler('comfybuilder:promoteLocalInstance')({}, 'local-1')

    expect(result).toEqual({
      ok: false,
      message: 'Could not inspect the Python environment.'
    })
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.createBuildDraft).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('installBuild creates an installing record carrying the resolved artifact', async () => {
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
    mocks.listBuilds.mockResolvedValue([{ id: 'd1', name: 'Image Baseline' }])
    mocks.add.mockResolvedValue({ id: 'inst-1', name: 'Image Baseline' })

    const result = await handler('comfybuilder:installBuild')(
      {},
      {
        buildId: 'd1',
        name: 'Custom Image',
        installRoot: '/custom-root'
      }
    )
    expect(result).toEqual({ ok: true, entry: { id: 'inst-1', name: 'Image Baseline' } })
    expect(mocks.uniqueName).toHaveBeenCalledWith('Custom Image')
    expect(mocks.allocateUniqueDir).toHaveBeenCalledWith('/custom-root', 'Custom Image')
    expect(mocks.add).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Custom Image',
        installPath: '/custom-root/Custom Image',
        sourceId: 'comfybuilder',
        workspaceId: 'w1',
        distributionId: 'd1',
        distributionName: 'Image Baseline',
        version: '7',
        artifactId: 'art-9',
        artifactSha256: 'deadbeef',
        useSharedModels: false,
        status: 'installing'
      })
    )
  })

  it('installBuild revalidates and persists an explicitly selected release target', async () => {
    mocks.isSignedIn.mockReturnValue(true)
    mocks.resolveSelectedHostArtifact.mockResolvedValue({
      version: 7,
      artifact: {
        id: 'art-cpu',
        os: 'linux',
        gpu: 'cpu',
        accelVariant: 'cpu',
        status: 'ready',
        archiveSha256: 'deadbeef'
      }
    })
    mocks.listBuilds.mockResolvedValue([{ id: 'd1', name: 'Image Baseline' }])
    mocks.add.mockResolvedValue({ id: 'inst-1', name: 'Image Baseline' })

    const result = await handler('comfybuilder:installBuild')(
      {},
      { buildId: 'd1', releaseVersion: 7, artifactId: 'art-cpu' }
    )

    expect(result).toMatchObject({ ok: true })
    expect(mocks.resolveSelectedHostArtifact).toHaveBeenCalledWith(
      expect.anything(),
      { os: 'linux', gpu: 'nvidia' },
      'd1',
      7,
      'art-cpu'
    )
    expect(mocks.resolveHostArtifact).not.toHaveBeenCalled()
    expect(mocks.add).toHaveBeenCalledWith(
      expect.objectContaining({
        version: '7',
        artifactId: 'art-cpu',
        artifactGpu: 'cpu',
        artifactAccelVariant: 'cpu'
      })
    )
  })

  it.each([
    [{ buildId: 'd1', artifactId: 'art-cpu' }],
    [{ buildId: 'd1', releaseVersion: 7 }],
    [{ buildId: 'd1', artifactId: '', releaseVersion: 7 }],
    [{ buildId: 'd1', artifactId: 'art-cpu', releaseVersion: 0 }]
  ])('installBuild rejects an invalid release target request', async (request) => {
    mocks.isSignedIn.mockReturnValue(true)

    const result = await handler('comfybuilder:installBuild')({}, request)

    expect(result).toEqual({ ok: false, message: 'Invalid Build release selection.' })
    expect(mocks.listBuilds).not.toHaveBeenCalled()
    expect(mocks.resolveSelectedHostArtifact).not.toHaveBeenCalled()
  })

  it('installBuild rejects a selected target that no longer belongs to the release', async () => {
    mocks.isSignedIn.mockReturnValue(true)
    mocks.listBuilds.mockResolvedValue([{ id: 'd1', name: 'Image Baseline' }])
    mocks.resolveSelectedHostArtifact.mockResolvedValue(null)

    const result = await handler('comfybuilder:installBuild')(
      {},
      { buildId: 'd1', releaseVersion: 7, artifactId: 'forged' }
    )

    expect(result).toEqual({ ok: false, message: 'No installable build for this machine.' })
    expect(mocks.add).not.toHaveBeenCalled()
  })

  it('installBuild rejects the legacy string request shape', async () => {
    mocks.isSignedIn.mockReturnValue(true)

    const result = await handler('comfybuilder:installBuild')({}, 'd1')

    expect(result).toEqual({ ok: false, message: 'Invalid build install request.' })
    expect(mocks.listBuilds).not.toHaveBeenCalled()
  })

  it('installBuild requires the Build to belong to the active workspace catalog', async () => {
    mocks.isSignedIn.mockReturnValue(true)
    mocks.listBuilds.mockResolvedValue([{ id: 'other', name: 'Other Build' }])

    const result = await handler('comfybuilder:installBuild')({}, { buildId: 'd1' })

    expect(result).toEqual({ ok: false, message: 'Build not found in the active workspace.' })
    expect(mocks.resolveHostArtifact).not.toHaveBeenCalled()
  })

  it('does not persist ownership if the active workspace changes during resolution', async () => {
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
    mocks.listBuilds.mockResolvedValue([{ id: 'd1', name: 'Image Baseline' }])
    mocks.findDuplicatePath.mockImplementationOnce(async () => {
      mocks.status.mockReturnValue({ signedIn: true, workspaceId: 'w2', workspaceType: 'team' })
      return null
    })

    const result = await handler('comfybuilder:installBuild')({}, { buildId: 'd1' })

    expect(result).toEqual({ ok: false, message: 'The active workspace changed. Try again.' })
    expect(mocks.add).not.toHaveBeenCalled()
  })

  it('installBuild refuses an artifact with no integrity value', async () => {
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
    mocks.listBuilds.mockResolvedValue([{ id: 'd1', name: 'Image Baseline' }])
    const result = await handler('comfybuilder:installBuild')({}, { buildId: 'd1' })
    expect(result).toEqual({ ok: false, message: 'This build has no SHA-256 integrity value.' })
    expect(mocks.add).not.toHaveBeenCalled()
  })

  it('installBuild refuses when no host artifact resolves', async () => {
    mocks.isSignedIn.mockReturnValue(true)
    mocks.resolveHostArtifact.mockResolvedValue(null)
    mocks.listBuilds.mockResolvedValue([{ id: 'd1', name: 'Image Baseline' }])
    const result = await handler('comfybuilder:installBuild')({}, { buildId: 'd1' })
    expect(result).toMatchObject({ ok: false })
    expect(mocks.add).not.toHaveBeenCalled()
  })

  // The in-flight set clears when the handler returns, so without the record
  // check a repeat IPC call would create a second record for one build.
  it('installBuild refuses a second record for an already-tracked build', async () => {
    mocks.isSignedIn.mockReturnValue(true)
    mocks.list.mockResolvedValue([
      {
        id: 'i1',
        sourceId: 'comfybuilder',
        workspaceId: 'w1',
        distributionId: 'd1',
        name: 'Image Baseline',
        status: 'installing'
      }
    ])
    const result = await handler('comfybuilder:installBuild')({}, { buildId: 'd1' })
    expect(result).toEqual({
      ok: false,
      message: '"Image Baseline" already installs this build.'
    })
    expect(mocks.add).not.toHaveBeenCalled()
  })

  it('installBuild proceeds when the only prior record for the build failed', async () => {
    mocks.isSignedIn.mockReturnValue(true)
    mocks.list.mockResolvedValue([
      {
        id: 'i1',
        sourceId: 'comfybuilder',
        workspaceId: 'w1',
        distributionId: 'd1',
        name: 'Broken',
        status: 'failed'
      }
    ])
    mocks.resolveHostArtifact.mockResolvedValue(null)
    mocks.listBuilds.mockResolvedValue([{ id: 'd1', name: 'Image Baseline' }])
    const result = await handler('comfybuilder:installBuild')({}, { buildId: 'd1' })
    // Past the duplicate guard: it failed only because no artifact resolved.
    expect(mocks.resolveHostArtifact).toHaveBeenCalled()
    expect(result).toMatchObject({ ok: false, message: 'No installable build for this machine.' })
  })

  it('installBuild refuses when signed out', async () => {
    mocks.isSignedIn.mockReturnValue(false)
    const result = await handler('comfybuilder:installBuild')({}, { buildId: 'd1' })
    expect(result).toMatchObject({ ok: false })
    expect(mocks.resolveHostArtifact).not.toHaveBeenCalled()
  })

  it('installBuild refuses when the session has no active workspace', async () => {
    mocks.isSignedIn.mockReturnValue(true)
    mocks.status.mockReturnValue({ signedIn: true })

    const result = await handler('comfybuilder:installBuild')({}, { buildId: 'd1' })

    expect(result).toEqual({ ok: false, message: 'No active workspace.' })
    expect(mocks.resolveHostArtifact).not.toHaveBeenCalled()
  })

  it('does not let another workspace record block the active workspace install', async () => {
    mocks.isSignedIn.mockReturnValue(true)
    mocks.list.mockResolvedValue([
      {
        id: 'i1',
        sourceId: 'comfybuilder',
        workspaceId: 'w2',
        distributionId: 'd1',
        name: 'Other Workspace',
        status: 'installed'
      }
    ])
    mocks.resolveHostArtifact.mockResolvedValue(null)

    mocks.listBuilds.mockResolvedValue([{ id: 'd1', name: 'Image Baseline' }])
    await handler('comfybuilder:installBuild')({}, { buildId: 'd1' })

    expect(mocks.resolveHostArtifact).toHaveBeenCalled()
  })

  it('listBuilds passes the installed-version map built from comfybuilder installs', async () => {
    mocks.isSignedIn.mockReturnValue(true)
    mocks.list.mockResolvedValue([
      { id: 'i1', sourceId: 'comfybuilder', workspaceId: 'w1', distributionId: 'd1', version: '3' },
      {
        id: 'failed',
        sourceId: 'comfybuilder',
        workspaceId: 'w1',
        distributionId: 'd1',
        version: '8',
        status: 'failed'
      },
      { id: 'i2', sourceId: 'comfybuilder', workspaceId: 'w2', distributionId: 'd2', version: '9' },
      { id: 'i3', sourceId: 'standalone', distributionId: 'ignored', version: '9' }
    ])
    mocks.resolveBuildRows.mockResolvedValue([])
    await handler('comfybuilder:listBuilds')({})
    const installed = mocks.resolveBuildRows.mock.calls[0]![3] as Map<string, number>
    expect(installed.get('d1')).toBe(3)
    expect(installed.has('d2')).toBe(false)
    expect(installed.has('ignored')).toBe(false)
    expect(mocks.resolveBuildRows.mock.calls[0]![4]).toBe(3)
  })
})
