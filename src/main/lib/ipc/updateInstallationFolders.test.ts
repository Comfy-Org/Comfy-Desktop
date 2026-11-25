import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'events'
import os from 'os'
import { ipcMain } from 'electron'
import type { InstallationRecord } from '../../installations'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => os.tmpdir(),
    getVersion: () => '0.0.0-test',
    getLocale: () => 'en'
  },
  ipcMain: { handle: vi.fn(), on: vi.fn(), off: vi.fn() },
  dialog: {},
  shell: {},
  session: {},
  WebContentsView: class {},
  BrowserWindow: { getAllWindows: () => [] },
  nativeTheme: { on: vi.fn(), shouldUseDarkColors: false }
}))

vi.mock('../i18n', () => ({
  t: (key: string) => key,
  init: vi.fn(),
  getMessages: () => ({}),
  getLocale: () => 'en',
  getAvailableLocales: () => []
}))

vi.mock('../../settings', () => ({
  get: vi.fn(() => undefined),
  set: vi.fn(async () => {}),
  getAll: vi.fn(() => ({})),
  getMirrorConfig: vi.fn(() => ({ pypiMirror: undefined, useChineseMirrors: false })),
  defaults: { modelsDirs: ['/unused'], inputDir: '/shared/input', outputDir: '/shared/output' }
}))

vi.mock('../../installations', () => ({
  installationEvents: new EventEmitter(),
  CLOUD_SOURCE_ID: 'cloud',
  list: vi.fn(async () => []),
  get: vi.fn(async () => null),
  update: vi.fn(async () => null),
  remove: vi.fn(async () => {}),
  hasNameConflict: vi.fn(async () => false)
}))

import * as installations from '../../installations'
import { registerInstallationHandlers } from './registerInstallationHandlers'

type UpdateHandler = (
  event: unknown,
  installationId: string,
  data: Record<string, unknown>
) => Promise<{ ok: boolean; message?: string }>

const FOLDER_SWITCHES = {
  useSharedInput: false,
  useSharedOutput: false,
  inputDir: '/own/input',
  outputDir: '/own/output'
}

function record(sourceId: string): InstallationRecord {
  return {
    id: `${sourceId}-1`,
    name: `${sourceId} build`,
    sourceId,
    sourceLabel: sourceId,
    installPath: `/builds/${sourceId}`,
    status: 'installed',
    createdAt: '2026-11-24T00:00:00.000Z'
  } as unknown as InstallationRecord
}

function updateHandler(): UpdateHandler {
  const call = vi
    .mocked(ipcMain.handle)
    .mock.calls.find(([channel]) => channel === 'update-installation')
  expect(call, 'update-installation is registered').toBeDefined()
  return call![1] as unknown as UpdateHandler
}

async function saveFolderSwitches(sourceId: string): Promise<Record<string, unknown>> {
  vi.mocked(installations.get).mockResolvedValue(record(sourceId))
  await updateHandler()(null, `${sourceId}-1`, { ...FOLDER_SWITCHES, useSharedModels: false })
  const [, saved] = vi.mocked(installations.update).mock.calls.at(-1)!
  return saved as Record<string, unknown>
}

beforeEach(() => {
  vi.mocked(ipcMain.handle).mockClear()
  vi.mocked(installations.update).mockClear()
  registerInstallationHandlers()
})

describe('saving the Folders tab switches', () => {
  it('does not let a git build stop using the shared input and output folders', async () => {
    const saved = await saveFolderSwitches('git')

    expect(saved).toEqual({ useSharedModels: false })
  })

  it.each(['standalone', 'portable'])(
    'still lets a %s build choose its own input and output folders',
    async (sourceId) => {
      const saved = await saveFolderSwitches(sourceId)

      expect(saved).toMatchObject(FOLDER_SWITCHES)
    }
  )
})
