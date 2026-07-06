// @vitest-environment node
// Integration test for the ComfyBuilder pipeline source. Runs the real source
// `getFieldOptions` against the mock Builder API (real fetch + real dto parsing),
// controlling signed-in state by mocking `tokenStore.loadTokens`. Also asserts
// the source is wired into the registry and that standalone is left untouched.
//
// The registry + standalone imports pull in electron and several heavy main
// subsystems; those are mocked below purely so the modules load in a node env —
// none of their behaviour is exercised here.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import os from 'os'
import fs from 'fs'
import path from 'path'
import { EventEmitter } from 'events'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: (_name: string) => os.tmpdir(),
    getVersion: () => '0.0.0-test',
    getLocale: () => 'en',
  },
  ipcMain: { handle: vi.fn(), on: vi.fn(), off: vi.fn() },
  dialog: {},
  shell: {},
  BrowserWindow: { getAllWindows: () => [] },
  nativeTheme: { on: vi.fn(), shouldUseDarkColors: false },
  net: {},
}))

vi.mock('../../lib/i18n', () => ({
  t: (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  init: vi.fn(async () => {}),
  getMessages: () => ({}),
  getLocale: () => 'en',
  getAvailableLocales: () => [],
}))

vi.mock('../../settings', () => ({
  get: vi.fn(() => undefined),
  set: vi.fn(async () => {}),
  getAll: vi.fn(() => ({})),
  getMirrorConfig: vi.fn(() => ({ pypiMirror: undefined, useChineseMirrors: false })),
  defaults: {
    modelsDirs: ['/unused-default-models'],
    inputDir: '/unused-default-input',
    outputDir: '/unused-default-output',
  },
}))

vi.mock('../../installations', () => ({
  installationEvents: new EventEmitter(),
  list: vi.fn(async () => []),
  get: vi.fn(async () => null),
  update: vi.fn(async () => null),
  remove: vi.fn(async () => {}),
  uniqueName: (baseName: string) => baseName,
}))

// Heavy subsystems pulled in transitively via standalone; unexercised here.
vi.mock('../../lib/snapshots', () => ({
  saveSnapshot: vi.fn(async () => 'noop.json'),
  getSnapshotCount: vi.fn(async () => 0),
  deduplicatePreUpdateSnapshot: vi.fn(async () => false),
}))
vi.mock('../../lib/pip', () => ({
  installFilteredRequirements: vi.fn(async () => 0),
  installFilteredRequirementsDetailed: vi.fn(async () => ({ code: 0, output: '' })),
}))

// ComfyBuilder leaf modules that import electron (app/safeStorage, shell):
// mocked so the source is electron-free and we can drive signed-in state.
vi.mock('../../comfybuilder/tokenStore', () => ({
  loadTokens: vi.fn(),
  saveTokens: vi.fn(),
}))
vi.mock('../../comfybuilder/oauth', () => ({
  refresh: vi.fn(),
}))

import sources from '../index'
import { standalone } from '../standalone'
import { comfybuilder, REQUIRES_AUTH_VALUE, _setApiClientOptionsForTest } from './index'
import type { PipelineOptionMeta } from './index'
import { loadTokens } from '../../comfybuilder/tokenStore'
import { startMockBuilderApi } from '../../../test/comfybuilder/mockServers'
import type { MockServer } from '../../../test/comfybuilder/mockServers'
import type { AuthTokens } from '../../comfybuilder/types'

function makeTokens(): AuthTokens {
  return { accessToken: 'test-access-token', expiresAt: Date.now() + 3_600_000 }
}

describe('comfybuilder source', () => {
  let api: MockServer
  let apiBase: string

  beforeAll(async () => {
    api = await startMockBuilderApi()
    apiBase = `${api.baseUrl}/api/v1`
  })

  afterAll(async () => {
    await api.stop()
  })

  afterEach(() => {
    _setApiClientOptionsForTest(undefined)
    vi.mocked(loadTokens).mockReset()
  })

  it('signed in: lists every pipeline as an install card with resolved metadata', async () => {
    vi.mocked(loadTokens).mockReturnValue(makeTokens())
    _setApiClientOptionsForTest({ apiBase })

    const options = await comfybuilder.getFieldOptions!('pipeline', {}, {})

    // Both pipelines are present — the un-installable one is NOT filtered out.
    expect(options).toHaveLength(2)
    expect(options.map((o) => o.value)).toEqual(
      expect.arrayContaining(['pipe-success', 'pipe-failed']),
    )

    const success = options.find((o) => o.value === 'pipe-success')
    expect(success).toBeDefined()
    expect(success!.label).toBe('Succeeded Pipeline')
    const successMeta = success!.data?.meta as PipelineOptionMeta
    expect(successMeta.installable).toBe(true)
    expect(successMeta.reason).toBeUndefined()
    expect(successMeta.deploymentId).toBe('dep-success-1')
    expect(successMeta.version).toBe('1.0.0')
    expect(successMeta.artifact?.filename).toBe('1.0.0.tar.gz')

    const failed = options.find((o) => o.value === 'pipe-failed')
    expect(failed).toBeDefined()
    expect(failed!.label).toBe('Failed Pipeline')
    const failedMeta = failed!.data?.meta as PipelineOptionMeta
    expect(failedMeta.installable).toBe(false)
    expect(failedMeta.reason).toBe('no-successful-build')
    expect(failedMeta.artifact).toBeUndefined()
  })

  it('signed out: returns a requiresAuth sentinel and makes zero network calls', async () => {
    vi.mocked(loadTokens).mockReturnValue(null)
    _setApiClientOptionsForTest({ apiBase })
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const options = await comfybuilder.getFieldOptions!('pipeline', {}, {})

    expect(options).toHaveLength(1)
    expect(options[0]?.value).toBe(REQUIRES_AUTH_VALUE)
    expect(options[0]?.data?.requiresAuth).toBe(true)
    expect(fetchSpy).not.toHaveBeenCalled()

    fetchSpy.mockRestore()
  })

  it('is registered in the sources registry and appears in getSources output', () => {
    // Wired into the registry alongside the pre-existing sources.
    const ids = sources.map((s) => s.id)
    expect(ids).toContain('comfybuilder')
    expect(ids).toContain('standalone')

    // Mirror the `get-sources` IPC filter (category !== 'cloud' && !hidden && platform).
    const visible = sources
      .filter((s) => s.category !== 'cloud' && !s.hidden)
      .filter((s) => !s.platforms || s.platforms.includes(process.platform))
      .map((s) => s.id)
    expect(visible).toContain('comfybuilder')

    // The primary field is a card-rendered pipeline picker.
    expect(comfybuilder.label).toBe('ComfyBuilder')
    expect(comfybuilder.category).toBe('local')
    const fields = comfybuilder.fields
    expect(fields).toHaveLength(1)
    expect(fields[0]?.id).toBe('pipeline')
    expect(fields[0]?.type).toBe('select')
    expect(fields[0]?.renderAs).toBe('cards')
  })

  it('leaves the standalone source unchanged', () => {
    expect(standalone.id).toBe('standalone')
    expect(standalone.category).toBe('local')
    expect(standalone.fields.map((f) => f.id)).toEqual([
      'release',
      'comfyVersion',
      'variant',
      'bundledTemplate',
    ])
  })

  it('wires install + reuses the standalone post-extract phases and manifest probe', () => {
    expect(typeof comfybuilder.install).toBe('function')
    expect(comfybuilder.install).not.toBe(standalone.install)

    // A ComfyBuilder artifact unpacks to the standalone layout, so the venv/
    // package phases and manifest probe are the standalone source's, reused as-is.
    expect(comfybuilder.postInstall).toBe(standalone.postInstall)
    expect(comfybuilder.probeInstallation).toBe(standalone.probeInstallation)

    expect(comfybuilder.installSteps?.map((s) => s.phase)).toEqual([
      'download',
      'extract',
      'setup',
      'cleanup',
    ])
  })

  // getLaunchCommand must append `--cpu` for a CPU distribution (CPU-only Torch
  // crashes on boot without it) and must NOT for a GPU one. Derivation reads the
  // extracted manifest, so a real install tree with a venv python + manifest is
  // laid down on disk per case.
  describe('getLaunchCommand CPU flag', () => {
    const pythonRel = process.platform === 'win32'
      ? path.join('ComfyUI', '.venv', 'Scripts', 'python.exe')
      : path.join('ComfyUI', '.venv', 'bin', 'python3')

    function makeInstall(manifest: Record<string, unknown>): string {
      const installPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-launch-'))
      const py = path.join(installPath, pythonRel)
      fs.mkdirSync(path.dirname(py), { recursive: true })
      fs.writeFileSync(py, '')
      fs.writeFileSync(path.join(installPath, 'ComfyUI', 'main.py'), '')
      fs.writeFileSync(path.join(installPath, 'manifest.json'), JSON.stringify(manifest))
      return installPath
    }

    const created: string[] = []
    const record = (installPath: string): string => {
      created.push(installPath)
      return installPath
    }
    afterEach(() => {
      while (created.length) {
        fs.rmSync(created.pop()!, { recursive: true, force: true })
      }
    })

    it('appends --cpu for a CPU manifest (torch_version +cpu, id linux-cpu-targz)', () => {
      const installPath = record(
        makeInstall({ id: 'linux-cpu-targz', torch_version: '2.5.1+cpu' }),
      )
      const cmd = comfybuilder.getLaunchCommand!({ installPath, launchArgs: '--enable-manager' } as never)
      expect(cmd?.args).toContain('--cpu')
    })

    it('does NOT append --cpu for a GPU manifest (torch_version +cu121, id linux-nvidia-targz)', () => {
      const installPath = record(
        makeInstall({ id: 'linux-nvidia-targz', torch_version: '2.5.1+cu121' }),
      )
      const cmd = comfybuilder.getLaunchCommand!({ installPath, launchArgs: '--enable-manager' } as never)
      expect(cmd?.args).not.toContain('--cpu')
    })

    it('does not duplicate --cpu when the user already set it', () => {
      const installPath = record(
        makeInstall({ id: 'linux-cpu-targz', torch_version: '2.5.1+cpu' }),
      )
      const cmd = comfybuilder.getLaunchCommand!({ installPath, launchArgs: '--enable-manager --cpu' } as never)
      expect((cmd?.args ?? []).filter((a) => a === '--cpu')).toHaveLength(1)
    })
  })
})
