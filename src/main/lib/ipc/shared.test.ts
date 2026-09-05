import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
    getVersion: () => '0.0.0-test',
    getLocale: () => 'en',
    whenReady: () => Promise.resolve(),
    on: vi.fn(),
    once: vi.fn(),
    quit: vi.fn(),
    isReady: () => true,
    getAppPath: () => '/tmp',
    getName: () => 'comfyui-desktop-2'
  },
  ipcMain: { handle: vi.fn(), on: vi.fn(), off: vi.fn() },
  dialog: { showMessageBox: vi.fn() },
  shell: { openExternal: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
  nativeTheme: { on: vi.fn(), shouldUseDarkColors: false },
  session: { defaultSession: { fromPartition: () => ({}), on: vi.fn() } }
}))

import type { InstallationRecord } from '../../installations'

const settingsMock = {
  getMirrorConfig: vi.fn(() => ({
    pypiMirror: undefined as string | undefined,
    hfMirror: undefined as string | undefined,
    useChineseMirrors: false
  }))
}

vi.mock('../../settings', () => ({
  getMirrorConfig: () => settingsMock.getMirrorConfig(),
  get: () => undefined,
  set: () => {},
  has: () => false,
  defaults: { onAppClose: 'tray' }
}))

const { buildLaunchEnv } = await import('./shared')

const baseInst: InstallationRecord = {
  id: 'inst',
  name: 'Test',
  createdAt: '2026-01-01T00:00:00.000Z',
  installPath: '/tmp/install',
  sourceId: 'git'
}

describe('buildLaunchEnv', () => {
  const originalHfEndpoint = process.env.HF_ENDPOINT

  beforeAll(() => {
    delete process.env.HF_ENDPOINT
  })

  afterAll(() => {
    if (originalHfEndpoint !== undefined) {
      process.env.HF_ENDPOINT = originalHfEndpoint
    } else {
      delete process.env.HF_ENDPOINT
    }
  })

  afterEach(() => {
    settingsMock.getMirrorConfig.mockReturnValue({
      pypiMirror: undefined,
      hfMirror: undefined,
      useChineseMirrors: false
    })
  })

  it('omits HF_ENDPOINT when no HuggingFace mirror is configured', () => {
    settingsMock.getMirrorConfig.mockReturnValue({
      pypiMirror: undefined,
      hfMirror: undefined,
      useChineseMirrors: false
    })

    const env = buildLaunchEnv(baseInst)

    expect(env.HF_ENDPOINT).toBeUndefined()
    expect(env.PYTHONIOENCODING).toBe('utf-8')
    expect(env.PYTHONFAULTHANDLER).toBe('1')
  })

  it('injects HF_ENDPOINT when a HuggingFace mirror is configured', () => {
    settingsMock.getMirrorConfig.mockReturnValue({
      pypiMirror: undefined,
      hfMirror: 'https://hf-mirror.com',
      useChineseMirrors: false
    })

    const env = buildLaunchEnv(baseInst)

    expect(env.HF_ENDPOINT).toBe('https://hf-mirror.com')
  })
})