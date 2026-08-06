// @vitest-environment node
// Integration test for the release-update success path. Stubs source.install /
// postInstall (a real download + venv bootstrap is infeasible) and runs
// migrate-from against a seeded source tree, asserting the new release-update
// entry, file migration, and newInstallationId hand-off.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { EventEmitter } from 'events'
import type { InstallationRecord } from '../../../installations'

const installationsStore = new Map<string, InstallationRecord>()
let idCounter = 0

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: (_name: string) => os.tmpdir(),
    getVersion: () => '0.0.0-test',
    getLocale: () => 'en'
  },
  ipcMain: { handle: vi.fn(), on: vi.fn(), off: vi.fn() },
  dialog: {},
  shell: {},
  BrowserWindow: { getAllWindows: () => [] },
  nativeTheme: { on: vi.fn(), shouldUseDarkColors: false }
}))

vi.mock('../../i18n', () => ({
  t: (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  init: vi.fn(async () => {}),
  getMessages: () => ({}),
  getLocale: () => 'en',
  getAvailableLocales: () => []
}))

vi.mock('../../../settings', () => {
  const get = vi.fn((_key: string): unknown => undefined)
  return {
    get,
    set: vi.fn(async () => {}),
    getAll: vi.fn(() => ({})),
    getMirrorConfig: vi.fn(() => ({ pypiMirror: undefined, useChineseMirrors: false })),
    defaults: {
      modelsDirs: ['/unused-default-models'],
      inputDir: '/unused-default-input',
      outputDir: '/unused-default-output'
    }
  }
})

vi.mock('../../../installations', () => ({
  installationEvents: new EventEmitter(),
  list: vi.fn(async () => Array.from(installationsStore.values())),
  add: vi.fn(async (data: Record<string, unknown>) => {
    const id = `inst-${++idCounter}`
    const entry = { id, createdAt: new Date(0).toISOString(), ...data } as InstallationRecord
    installationsStore.set(id, entry)
    return entry
  }),
  get: vi.fn(async (id: string) => installationsStore.get(id) ?? null),
  update: vi.fn(async (id: string, data: Record<string, unknown>) => {
    const cur = installationsStore.get(id)
    if (!cur) return null
    const next = { ...cur, ...data } as InstallationRecord
    installationsStore.set(id, next)
    return next
  }),
  remove: vi.fn(async (id: string) => {
    installationsStore.delete(id)
  }),
  uniqueName: (baseName: string, _existing: InstallationRecord[]) => baseName
}))

// Heavy subsystems pulled in transitively; unexercised here.
vi.mock('../../snapshots', () => ({
  saveSnapshot: vi.fn(async () => 'noop.json'),
  getSnapshotCount: vi.fn(async () => 0),
  deduplicatePreUpdateSnapshot: vi.fn(async () => false)
}))
vi.mock('../../../lib/pip', () => ({
  installFilteredRequirements: vi.fn(async () => 0),
  installFilteredRequirementsDetailed: vi.fn(async () => ({ code: 0, output: '' }))
}))

import { handleReleaseUpdate, handleCopyChangePytorch } from './copy'
import { standalone } from '../../../sources/standalone'
import * as settingsMock from '../../../settings'

// Fake WebContents that satisfies `makeSendProgress` / `makeSendOutput`.
function makeSender(): Electron.WebContents {
  return {
    isDestroyed: () => false,
    send: vi.fn()
  } as unknown as Electron.WebContents
}

const NODE_NAME = 'comfyui-test-node'
const NODE_FILE = 'node_entry.py'
const NODE_FILE_BODY = '# stub custom node module body — non-empty so mergeDirFlat copies it\n'
const MODEL_FILE = 'sample.safetensors'
const MODEL_BODY = 'binary-stub-model-bytes\n'
const INPUT_FILE = 'sample-input.png'
const INPUT_BODY = 'binary-stub-input-bytes\n'
const OUTPUT_FILE = 'sample-output.png'
const OUTPUT_BODY = 'binary-stub-output-bytes\n'

function seedSource(srcRoot: string): void {
  const srcComfyUI = path.join(srcRoot, 'ComfyUI')
  fs.mkdirSync(path.join(srcComfyUI, 'custom_nodes', NODE_NAME), { recursive: true })
  fs.writeFileSync(path.join(srcComfyUI, 'custom_nodes', NODE_NAME, NODE_FILE), NODE_FILE_BODY)
  fs.mkdirSync(path.join(srcComfyUI, 'models', 'checkpoints'), { recursive: true })
  fs.writeFileSync(path.join(srcComfyUI, 'models', 'checkpoints', MODEL_FILE), MODEL_BODY)
  fs.mkdirSync(path.join(srcComfyUI, 'input'), { recursive: true })
  fs.writeFileSync(path.join(srcComfyUI, 'input', INPUT_FILE), INPUT_BODY)
  fs.mkdirSync(path.join(srcComfyUI, 'output'), { recursive: true })
  fs.writeFileSync(path.join(srcComfyUI, 'output', OUTPUT_FILE), OUTPUT_BODY)
}

describe('handleReleaseUpdate (release-update success path)', () => {
  let tmpRoot: string
  let srcRoot: string
  let sharedModelsDir: string
  let sharedInputDir: string
  let sharedOutputDir: string
  let src: InstallationRecord
  const originalInstall = standalone.install
  const originalPostInstall = standalone.postInstall

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'release-update-'))
    srcRoot = path.join(tmpRoot, 'src')
    fs.mkdirSync(srcRoot, { recursive: true })
    seedSource(srcRoot)

    // The new install defaults to shared models/input/output, so migrate-from
    // routes them to settings.get's dirs; point those at per-test tmp dirs.
    sharedModelsDir = path.join(tmpRoot, 'shared-models')
    sharedInputDir = path.join(tmpRoot, 'shared-input')
    sharedOutputDir = path.join(tmpRoot, 'shared-output')
    fs.mkdirSync(sharedModelsDir, { recursive: true })
    fs.mkdirSync(sharedInputDir, { recursive: true })
    fs.mkdirSync(sharedOutputDir, { recursive: true })
    vi.mocked(settingsMock.get).mockImplementation((key: string): unknown => {
      if (key === 'modelsDirs') return [sharedModelsDir]
      if (key === 'inputDir') return sharedInputDir
      if (key === 'outputDir') return sharedOutputDir
      return undefined
    })

    src = {
      id: 'src-1',
      name: 'src',
      sourceId: 'standalone',
      installPath: srcRoot,
      status: 'installed',
      createdAt: new Date(0).toISOString()
    }
    installationsStore.set(src.id, src)

    // No-op the heavy hooks; handleReleaseUpdate + mergeDirFlat create the dirs.
    standalone.install = (async () => {}) as typeof standalone.install
    standalone.postInstall = (async () => {}) as typeof standalone.postInstall
  })

  afterEach(() => {
    standalone.install = originalInstall
    standalone.postInstall = originalPostInstall
    installationsStore.clear()
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('creates a new installation entry tagged release-update and migrates customNodes/models/input/output', async () => {
    const sender = makeSender()
    const event = { sender } as unknown as Electron.IpcMainInvokeEvent

    const result = await handleReleaseUpdate({
      event,
      installationId: src.id,
      inst: src,
      actionData: {
        name: 'src-updated',
        releaseSelection: { value: 'v1.0.0', label: 'v1.0.0' },
        variantSelection: {
          value: 'cuda',
          label: 'CUDA',
          data: {
            variantId: 'cuda',
            manifest: { id: 'cuda', comfyui_ref: 'v0.3.0', python_version: '3.12.4' },
            downloadFiles: [],
            downloadUrl: '',
            r2Release: {
              tag: 'v1.0.0',
              comfyui_version: '0.3.0',
              comfyui_commit: 'abc',
              build: 1,
              date: '2024-01-01',
              file: 'x.zip',
              size: 1,
              python_version: '3.12.4',
              torch_version: '2.0.0'
            }
          }
        }
      }
    })

    expect(result.ok, `release-update failed: ${result.message ?? ''}`).toBe(true)
    expect(result.navigate).toBe('list')
    expect(typeof result.newInstallationId).toBe('string')

    const newInst = installationsStore.get(result.newInstallationId!)
    expect(newInst).toBeTruthy()
    expect(newInst!.copyReason).toBe('release-update')
    expect(newInst!.copiedFrom).toBe(src.id)
    expect(newInst!.copiedFromName).toBe(src.name)
    expect(typeof newInst!.copiedAt).toBe('string')

    // Custom nodes land under the new install's own ComfyUI tree.
    const dstComfyUI = path.join(newInst!.installPath, 'ComfyUI')
    expect(
      fs.readFileSync(path.join(dstComfyUI, 'custom_nodes', NODE_NAME, NODE_FILE), 'utf-8')
    ).toBe(NODE_FILE_BODY)

    // Models route through useSharedModels and input/output route
    // through useSharedInput/useSharedOutput to the settings-provided dirs.
    expect(fs.readFileSync(path.join(sharedModelsDir, 'checkpoints', MODEL_FILE), 'utf-8')).toBe(
      MODEL_BODY
    )
    expect(fs.readFileSync(path.join(sharedInputDir, INPUT_FILE), 'utf-8')).toBe(INPUT_BODY)
    expect(fs.readFileSync(path.join(sharedOutputDir, OUTPUT_FILE), 'utf-8')).toBe(OUTPUT_BODY)
  })
})

describe('handleCopyChangePytorch (copy-pytorch)', () => {
  const STACK_ID = 'pytorch-index:cu130:2.13.0'
  let tmpRoot: string
  let srcRoot: string
  let src: InstallationRecord
  const originalFixupCopy = standalone.fixupCopy
  const originalHandleAction = standalone.handleAction

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-pytorch-'))
    srcRoot = path.join(tmpRoot, 'src')
    fs.mkdirSync(srcRoot, { recursive: true })
    seedSource(srcRoot)

    src = {
      id: 'src-1',
      name: 'src',
      sourceId: 'standalone',
      installPath: srcRoot,
      status: 'installed',
      createdAt: new Date(0).toISOString()
    }
    installationsStore.set(src.id, src)

    // A real venv fixup / pip transaction is infeasible here; the handler's
    // contract (copy first, delegate to change-pytorch, keep the copy on
    // failure) is what's under test.
    standalone.fixupCopy = (async () => {}) as typeof standalone.fixupCopy
    standalone.handleAction = vi.fn(async () => ({
      ok: true
    })) as unknown as typeof standalone.handleAction
  })

  afterEach(() => {
    standalone.fixupCopy = originalFixupCopy
    standalone.handleAction = originalHandleAction
    installationsStore.clear()
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  function invoke(actionData: Record<string, unknown>): ReturnType<typeof handleCopyChangePytorch> {
    const event = { sender: makeSender() } as unknown as Electron.IpcMainInvokeEvent
    return handleCopyChangePytorch({ event, installationId: src.id, inst: src, actionData })
  }

  it('rejects a missing name or stackId without copying anything', async () => {
    expect((await invoke({ stackId: STACK_ID })).ok).toBe(false)
    expect((await invoke({ name: 'copy' })).ok).toBe(false)
    expect(vi.mocked(standalone.handleAction)).not.toHaveBeenCalled()
    expect(installationsStore.size).toBe(1)
  })

  it('copies the whole install first, then runs change-pytorch on the copy', async () => {
    const result = await invoke({ name: 'src-torch', stackId: STACK_ID })

    expect(result.ok, `copy-pytorch failed: ${result.message ?? ''}`).toBe(true)
    expect(result.navigate).toBe('list')
    expect(typeof result.newInstallationId).toBe('string')

    const newInst = installationsStore.get(result.newInstallationId!)
    expect(newInst).toBeTruthy()
    expect(newInst!.copyReason).toBe('copy-pytorch')
    expect(newInst!.copiedFrom).toBe(src.id)
    expect(newInst!.copiedFromName).toBe(src.name)
    expect(newInst!.installPath).not.toBe(srcRoot)
    // The copy is a full clone of the source tree.
    expect(
      fs.readFileSync(
        path.join(newInst!.installPath, 'ComfyUI', 'custom_nodes', NODE_NAME, NODE_FILE),
        'utf-8'
      )
    ).toBe(NODE_FILE_BODY)

    // change-pytorch ran against the copied record, never the source.
    const calls = vi.mocked(standalone.handleAction).mock.calls
    expect(calls).toHaveLength(1)
    const [actionId, target, data] = calls[0] as unknown as [
      string,
      InstallationRecord,
      Record<string, unknown>
    ]
    expect(actionId).toBe('change-pytorch')
    expect(target.id).toBe(result.newInstallationId)
    expect(data).toEqual({ stackId: STACK_ID })
  })

  it('keeps the finished copy when the PyTorch change fails and leaves the source untouched', async () => {
    standalone.handleAction = vi.fn(async () => {
      throw new Error('pip transaction failed')
    }) as unknown as typeof standalone.handleAction

    const result = await invoke({ name: 'src-torch', stackId: STACK_ID })

    // Same principle as Copy & Update: the copy survives so the user can retry.
    expect(result.ok).toBe(true)
    expect(typeof result.newInstallationId).toBe('string')
    const newInst = installationsStore.get(result.newInstallationId!)
    expect(newInst).toBeTruthy()
    expect(fs.existsSync(newInst!.installPath)).toBe(true)
    expect(newInst!.copyReason).toBe('copy-pytorch')

    // Source registration and tree are intact.
    expect(installationsStore.get(src.id)).toBeTruthy()
    expect(
      fs.readFileSync(path.join(srcRoot, 'ComfyUI', 'custom_nodes', NODE_NAME, NODE_FILE), 'utf-8')
    ).toBe(NODE_FILE_BODY)
  })
})
