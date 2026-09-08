import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp', getVersion: () => '0.0.0-test' },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  dialog: {},
  shell: {},
  BrowserWindow: { getAllWindows: () => [] },
  nativeTheme: { on: vi.fn(), shouldUseDarkColors: false }
}))
vi.mock('../../installations', () => ({ add: vi.fn() }))
vi.mock('./installIdentity', () => ({ allocateInstallIdentity: vi.fn() }))

import { ipcMain } from 'electron'
import * as installations from '../../installations'
import { allocateInstallIdentity } from './installIdentity'
import { registerInstallationHandlers } from './registerInstallationHandlers'

describe('add-installation standalone runtime validation', () => {
  const runtime = {
    sourceId: 'standalone',
    version: '0.18.3',
    releaseTag: 'v0.18.3-env1',
    variant: 'linux-cpu',
    pythonVersion: '3.13.12',
    downloadUrl: 'https://example.com/runtime.tar.gz',
    downloadFiles: [
      { url: 'https://example.com/runtime.tar.gz', filename: 'runtime.tar.gz', size: 1000 }
    ]
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(allocateInstallIdentity).mockResolvedValue({
      ok: true,
      name: 'ComfyUI',
      installPath: '/tmp/install'
    })
    vi.mocked(installations.add).mockResolvedValue({
      id: 'new'
    } as installations.InstallationRecord)
    registerInstallationHandlers()
  })

  async function add(data: Record<string, unknown>) {
    const handler = vi
      .mocked(ipcMain.handle)
      .mock.calls.find(([channel]) => channel === 'add-installation')![1]
    return handler({} as Electron.IpcMainInvokeEvent, data)
  }

  it.each([
    { version: undefined },
    { releaseTag: '' },
    { variant: ' ' },
    { pythonVersion: undefined },
    { downloadFiles: [], downloadUrl: '' },
    { downloadFiles: [{}] },
    { downloadFiles: [{ url: '', filename: 'runtime.tar.gz' }] },
    { downloadFiles: [{ url: runtime.downloadUrl, filename: '' }] },
    { downloadFiles: 'invalid' }
  ])(
    'rejects malformed runtime data before any allocation or record creation: %j',
    async (data) => {
      await expect(add({ ...runtime, ...data })).resolves.toEqual({
        ok: false,
        message: 'standalone.invalidRuntime'
      })
      expect(allocateInstallIdentity).not.toHaveBeenCalled()
      expect(installations.add).not.toHaveBeenCalled()
    }
  )

  it('rejects a direct request without any runtime selections', async () => {
    await expect(add({ sourceId: 'standalone' })).resolves.toMatchObject({ ok: false })
    expect(allocateInstallIdentity).not.toHaveBeenCalled()
    expect(installations.add).not.toHaveBeenCalled()
  })

  it.each([
    {},
    { downloadFiles: undefined },
    { downloadFiles: [], updateChannel: 'latest' },
    { downloadUrl: undefined }
  ])(
    'persists valid runtimes, including legacy URL downloads and absent optional fields: %j',
    async (data) => {
      await expect(add({ ...runtime, ...data })).resolves.toMatchObject({
        ok: true,
        entry: { id: 'new' }
      })
      expect(installations.add).toHaveBeenCalledExactlyOnceWith({
        ...runtime,
        ...data,
        name: 'ComfyUI',
        installPath: '/tmp/install',
        status: 'installing',
        seen: false
      })
    }
  )

  it.each(['remote', 'cloud', 'git', 'portable', 'comfybuilder'])(
    'preserves the %s entry point',
    async (sourceId) => {
      await expect(add({ sourceId, status: 'installed' })).resolves.toMatchObject({ ok: true })
      expect(installations.add).toHaveBeenCalledWith(
        expect.objectContaining({ sourceId, status: 'installed' })
      )
    }
  )
})
