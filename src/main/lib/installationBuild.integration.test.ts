import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type * as GpuModule from './gpu'
import type * as I18nModule from './i18n'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  dialog: {},
  shell: {},
  BrowserWindow: { getAllWindows: () => [] },
  nativeTheme: { on: vi.fn(), shouldUseDarkColors: false }
}))
vi.mock('../installations', () => ({ add: vi.fn() }))
vi.mock('./gpu', async (importOriginal) => ({
  ...(await importOriginal<typeof GpuModule>()),
  detectGPU: vi.fn().mockResolvedValue(null)
}))
vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof I18nModule>()),
  t: (await import('./localeTestHelper')).lookupEnMessage
}))
vi.mock('./telemetry', () => ({
  trackedStep: async <T>(_name: string, _ctx: unknown, fn: () => Promise<T>) => fn()
}))

import { ipcMain } from 'electron'
import * as installations from '../installations'
import { standalone, buildPinnedVariant } from '../sources/standalone'
import type { FieldOption } from '../types/sources'
import { lookupEnMessage } from './localeTestHelper'
import { registerAppHandlers } from './ipc/registerAppHandlers'
import { registerSnapshotHandlers } from './ipc/registerSnapshotHandlers'
import { handleReleaseUpdate } from './ipc/sessionActions/copy'
import {
  migrateToStandaloneFromSnapshot,
  type StandaloneTargetSelection
} from './standaloneMigration'

describe('standalone build validation at caller boundaries', () => {
  let root: string
  let snapshotFile: string
  let release: FieldOption
  let variant: FieldOption
  const failure = { ok: false, message: lookupEnMessage('standalone.invalidRuntime') }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'installation-build-'))
    snapshotFile = path.join(root, 'snapshot.json')
    fs.writeFileSync(
      snapshotFile,
      JSON.stringify({
        type: 'comfyui-desktop-2-snapshot',
        version: 1,
        installationName: 'Original',
        snapshots: [
          {
            version: 1,
            createdAt: '2026-09-08T00:00:00Z',
            trigger: 'manual',
            comfyui: { ref: 'v0.18.3', commit: null, releaseTag: 'bundle', variant: 'linux-cpu' },
            customNodes: [],
            pipPackages: {}
          }
        ]
      })
    )
    // An empty Python version survives catalog parsing and reaches hydrated options.
    release = {
      value: 'stable',
      label: 'Stable',
      data: {
        vendorReleases: {
          'linux-cpu': [
            {
              tag: 'bundle',
              file: 'runtime.tar.gz',
              size: 1000,
              comfyui_version: '0.18.3',
              comfyui_commit: 'abc123',
              build: 1,
              date: '2026-09-08T00:00:00Z',
              python_version: '',
              torch_version: '2.7.0'
            }
          ]
        }
      }
    }
    variant = buildPinnedVariant(release, 'linux-cpu', 'bundle')!
    vi.spyOn(standalone, 'getFieldOptions').mockImplementation(async (field) =>
      field === 'release' ? [release] : field === 'variant' ? [variant] : []
    )
    registerAppHandlers()
    registerSnapshotHandlers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(root, { recursive: true, force: true })
  })

  async function invoke(channel: string, ...args: unknown[]) {
    const handler = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)![1]
    return handler({} as Electron.IpcMainInvokeEvent, ...args)
  }

  function migrate(owned: boolean, target: StandaloneTargetSelection = { mode: 'auto' }) {
    return migrateToStandaloneFromSnapshot(
      {
        installNameBase: 'Migrated',
        stagedSnapshot: { path: snapshotFile, owned },
        sourcePaths: {},
        labels: { userData: '', input: '', output: '', models: '' },
        target
      },
      {
        sourceMap: { standalone },
        sendProgress: vi.fn(),
        sendOutput: vi.fn(),
        uniqueName: vi.fn(),
        signal: new AbortController().signal
      }
    )
  }

  it('returns a localized build-installation failure instead of rejecting the invoke', async () => {
    await expect(invoke('build-installation', 'standalone', { release, variant })).resolves.toEqual(
      failure
    )
    expect(installations.add).not.toHaveBeenCalled()
  })

  it('returns successful build data separately from its status', async () => {
    variant.data!.manifest = { comfyui_ref: '0.18.3', python_version: '3.13.12' }
    await expect(
      invoke('build-installation', 'standalone', { release, variant })
    ).resolves.toMatchObject({
      ok: true,
      data: { sourceId: 'standalone', variant: 'linux-cpu', pythonVersion: '3.13.12' }
    })
  })

  it('returns a structured failure for an unknown source', async () => {
    await expect(invoke('build-installation', 'missing', {})).resolves.toEqual({
      ok: false,
      message: lookupEnMessage('errors.unknownSource')
    })
  })

  it('returns a release-update failure before creating a directory or installation', async () => {
    const inst = {
      id: 'old',
      sourceId: 'standalone',
      installPath: root
    } as installations.InstallationRecord
    await expect(
      handleReleaseUpdate({
        event: {} as Electron.IpcMainInvokeEvent,
        installationId: inst.id,
        inst,
        actionData: { name: 'Updated', releaseSelection: release, variantSelection: variant }
      })
    ).resolves.toEqual(failure)
    expect(installations.add).not.toHaveBeenCalled()
    expect(fs.readdirSync(root)).toEqual(['snapshot.json'])
  })

  it('returns a create-from-snapshot failure before staging or adding an installation', async () => {
    const copy = vi.spyOn(fs.promises, 'copyFile')
    await expect(
      invoke('create-from-snapshot', snapshotFile, 'New', 'stable', 'linux-cpu')
    ).resolves.toEqual(failure)
    expect(copy).not.toHaveBeenCalled()
    expect(installations.add).not.toHaveBeenCalled()
    expect(fs.existsSync(snapshotFile)).toBe(true)
  })

  it.each([
    { mode: 'auto', owned: true },
    { mode: 'auto', owned: false },
    { mode: 'selected', owned: true },
    { mode: 'selected', owned: false }
  ] as const)(
    'awaits migration cleanup with $mode selections and owned=$owned',
    async ({ mode, owned }) => {
      const target: StandaloneTargetSelection =
        mode === 'selected' ? { mode, release, variant } : { mode }
      await expect(migrate(owned, target)).rejects.toThrow(failure.message)
      expect(fs.existsSync(snapshotFile)).toBe(!owned)
      expect(installations.add).not.toHaveBeenCalled()
    }
  )

  it.each([
    { field: 'release', message: 'No releases available.' },
    { field: 'variant', message: 'No compatible variants found for this platform.' }
  ])('cleans up an owned snapshot when the $field catalog is empty', async ({ field, message }) => {
    vi.mocked(standalone.getFieldOptions!).mockImplementation(async (id) =>
      id === field ? [] : [release]
    )
    await expect(migrate(true)).rejects.toThrow(message)
    expect(fs.existsSync(snapshotFile)).toBe(false)
    expect(installations.add).not.toHaveBeenCalled()
  })

  it('cleans up an owned snapshot when loading the catalog rejects', async () => {
    vi.mocked(standalone.getFieldOptions!).mockRejectedValue(new Error('Catalog unavailable'))
    await expect(migrate(true)).rejects.toThrow('Catalog unavailable')
    expect(fs.existsSync(snapshotFile)).toBe(false)
    expect(installations.add).not.toHaveBeenCalled()
  })
})
