import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthStatus, Workspace } from '../../types/ipc'
import type { InstallationRecord } from '../installations'
import type { ComfyWindowEntry } from '../host/registry'

const state = vi.hoisted(() => ({
  status: { signedIn: true, workspaceId: 'personal-id', workspaceType: 'personal' } as AuthStatus,
  selected: 'personal' as string | undefined,
  subject: 'user-1',
  listWorkspaces: vi.fn<() => Promise<Workspace[]>>(),
  getInstallation: vi.fn<() => Promise<InstallationRecord | null>>()
}))

vi.mock('../devplatform/session', () => ({
  getCloudSession: () => ({
    status: () => state.status,
    currentSubject: () => state.subject,
    listWorkspaces: state.listWorkspaces
  })
}))
vi.mock('../settings', () => ({ get: () => state.selected }))
vi.mock('../installations', () => ({ get: state.getInstallation }))

import { cloudWorkspaceUrl, syncCloudWindowWorkspace } from './cloudWorkspace'

const CLOUD: InstallationRecord = {
  id: 'cloud',
  name: 'Comfy Cloud',
  sourceId: 'cloud',
  status: 'installed',
  installPath: '',
  createdAt: '2026-01-01T00:00:00.000Z'
}
const CLOUD_URL = 'https://cloud.comfy.org/?utm_source=comfy.desktop&utm_medium=app_feature'

beforeEach(() => {
  vi.clearAllMocks()
  state.status = { signedIn: true, workspaceId: 'personal-id', workspaceType: 'personal' }
  state.selected = 'personal'
  state.subject = 'user-1'
  state.listWorkspaces.mockResolvedValue([
    { id: 'personal-id', name: 'Personal Workspace', type: 'personal', role: 'owner' },
    { id: 'team-a', name: 'Team A', type: 'team', role: 'member' }
  ])
  state.getInstallation.mockResolvedValue(CLOUD)
})

describe('Cloud launch workspace', () => {
  it.each(['team-a', 'team-b'])(
    'opens the selected %s even while the Desktop session is still on Personal',
    async (workspaceId) => {
      state.selected = workspaceId
      const url = new URL(await cloudWorkspaceUrl(CLOUD, CLOUD_URL))

      expect(url.searchParams.get('workspace')).toBe(workspaceId)
      expect(url.searchParams.get('utm_source')).toBe('comfy.desktop')
      expect(url.searchParams.get('utm_medium')).toBe('app_feature')
      expect(state.listWorkspaces).not.toHaveBeenCalled()
    }
  )

  it('uses the real personal workspace id instead of the Desktop sentinel', async () => {
    const url = new URL(await cloudWorkspaceUrl(CLOUD, CLOUD_URL))

    expect(url.searchParams.get('workspace')).toBe('personal-id')
  })

  it('resolves Personal through membership when switching back from a team', async () => {
    state.status = { signedIn: true, workspaceId: 'team-a', workspaceType: 'team' }
    const url = new URL(await cloudWorkspaceUrl(CLOUD, CLOUD_URL))

    expect(url.searchParams.get('workspace')).toBe('personal-id')
    expect(state.listWorkspaces).toHaveBeenCalledOnce()
  })

  it('uses the active workspace when there is no saved dashboard selection', async () => {
    state.selected = undefined
    state.status = { signedIn: true, workspaceId: 'team-a', workspaceType: 'team' }

    expect(new URL(await cloudWorkspaceUrl(CLOUD, CLOUD_URL)).searchParams.get('workspace')).toBe(
      'team-a'
    )
  })

  it('preserves explicit Cloud installation ownership', async () => {
    state.selected = 'team-b'
    const url = await cloudWorkspaceUrl({ ...CLOUD, workspaceId: 'team-a' }, CLOUD_URL)

    expect(new URL(url).searchParams.get('workspace')).toBe('team-a')
  })

  it('leaves signed-out Cloud authentication to the Cloud page', async () => {
    state.status = { signedIn: false }

    expect(await cloudWorkspaceUrl(CLOUD, CLOUD_URL)).toBe(CLOUD_URL)
    expect(state.listWorkspaces).not.toHaveBeenCalled()
  })

  it.each([
    ['remote', CLOUD_URL],
    ['standalone', 'http://127.0.0.1:8188/'],
    ['cloud', 'https://untrusted.example/'],
    ['cloud', 'http://cloud.comfy.org/']
  ])('does not pass workspace context to %s at %s', async (sourceId, url) => {
    expect(await cloudWorkspaceUrl({ ...CLOUD, sourceId }, url)).toBe(url)
  })

  it('refuses to open a different workspace when Personal cannot be resolved', async () => {
    state.status = { signedIn: true, workspaceId: 'team-a', workspaceType: 'team' }
    state.listWorkspaces.mockResolvedValue([])

    await expect(cloudWorkspaceUrl(CLOUD, CLOUD_URL)).rejects.toThrow(
      'Could not determine the personal workspace'
    )
  })

  it.each(['selection', 'account'])(
    'discards personal workspace lookup after the %s changes',
    async (change) => {
      state.status = { signedIn: true, workspaceId: 'team-a', workspaceType: 'team' }
      state.listWorkspaces.mockImplementationOnce(async () => {
        if (change === 'selection') state.selected = 'team-b'
        else state.subject = 'user-2'
        return [{ id: 'personal-id', name: 'Personal Workspace', type: 'personal', role: 'owner' }]
      })

      await expect(cloudWorkspaceUrl(CLOUD, CLOUD_URL)).rejects.toThrow(
        'The selected workspace changed'
      )
    }
  )
})

describe('reopening a Cloud window', () => {
  function openWindow() {
    const loadURL = vi.fn(async () => {})
    const entry = {
      sourceCategory: 'cloud',
      installationId: CLOUD.id,
      comfyUrl: `${CLOUD_URL}&workspace=personal-id`,
      window: { isDestroyed: () => false },
      comfyView: { webContents: { isDestroyed: () => false, loadURL } }
    } as unknown as ComfyWindowEntry
    return { entry, loadURL }
  }

  it('retargets the existing window across team and Personal selections', async () => {
    const { entry, loadURL } = openWindow()

    for (const workspaceId of ['team-a', 'team-b', 'personal']) {
      state.selected = workspaceId
      await syncCloudWindowWorkspace(entry)
      const expected = workspaceId === 'personal' ? 'personal-id' : workspaceId
      expect(new URL(entry.comfyUrl).searchParams.get('workspace')).toBe(expected)
      expect(loadURL).toHaveBeenLastCalledWith(entry.comfyUrl)
    }
    expect(loadURL).toHaveBeenCalledTimes(3)
  })

  it('focuses the same workspace without reloading the workflow', async () => {
    const { entry, loadURL } = openWindow()

    await syncCloudWindowWorkspace(entry)

    expect(loadURL).not.toHaveBeenCalled()
  })

  it('does not navigate a local or remote window', async () => {
    const { entry, loadURL } = openWindow()
    entry.sourceCategory = 'local'
    state.selected = 'team-a'

    await syncCloudWindowWorkspace(entry)

    expect(loadURL).not.toHaveBeenCalled()
    expect(state.getInstallation).not.toHaveBeenCalled()
  })

  it('preserves the old launch URL when navigation fails', async () => {
    const { entry, loadURL } = openWindow()
    const previousUrl = entry.comfyUrl
    state.selected = 'team-a'
    loadURL.mockRejectedValueOnce(new Error('offline'))

    await expect(syncCloudWindowWorkspace(entry)).rejects.toThrow('offline')
    expect(entry.comfyUrl).toBe(previousUrl)
  })
})
