import fs from 'node:fs'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InstallationRecord } from '../shared'
import type { LaunchCommand } from '../../../types/sources'

const { root } = await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  return { root: mkdtempSync(join(tmpdir(), 'launch-storage-')) }
})

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => path.join(root, 'userData'),
    getVersion: () => '0.0.0-test',
    getLocale: () => 'en'
  },
  ipcMain: { handle: vi.fn(), on: vi.fn(), off: vi.fn() },
  dialog: {},
  shell: {},
  WebContentsView: class {},
  BrowserWindow: { getAllWindows: () => [] },
  nativeTheme: { on: vi.fn(), shouldUseDarkColors: false }
}))

vi.mock('../../../settings', () => ({
  get: vi.fn((_key: string): unknown => undefined),
  set: vi.fn(async () => {}),
  getAll: vi.fn(() => ({})),
  getMirrorConfig: vi.fn(() => ({ pypiMirror: undefined, useChineseMirrors: false })),
  defaults: {
    modelsDirs: [path.join(root, 'default-models')],
    inputDir: path.join(root, 'default-input'),
    outputDir: path.join(root, 'default-output')
  }
}))

import { applyStorageLaunchArgs } from './launch'
import * as settingsMock from '../../../settings'

const globalInput = path.join(root, 'global-input')
const globalOutput = path.join(root, 'global-output')
let testCounter = 0

function makeInstall(overrides: Partial<InstallationRecord> = {}): InstallationRecord {
  const installPath = path.join(root, `install-${++testCounter}`)
  fs.mkdirSync(path.join(installPath, 'ComfyUI', 'models'), { recursive: true })
  return { installPath, ...overrides } as InstallationRecord
}

function makeLaunchCmd(overrides: Record<string, unknown> = {}): LaunchCommand {
  return {
    cmd: 'python',
    args: ['main.py'],
    cwd: root,
    port: 8188,
    ...overrides
  } as unknown as LaunchCommand
}

function yamlPath(installationId: string): string {
  return path.join(root, 'userData', 'instance-model-paths', `${installationId}.yaml`)
}

function mockSettings(values: Record<string, unknown>): void {
  vi.mocked(settingsMock.get).mockImplementation((key) => values[key])
}

beforeEach(() => {
  mockSettings({ inputDir: globalInput, outputDir: globalOutput, modelsDirs: [] })
})

afterEach(() => {
  vi.clearAllMocks()
})

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('applyStorageLaunchArgs', () => {
  it('combines shared and per-install model dirs in the per-install YAML', () => {
    const shared = path.join(root, 'shared-models')
    const owned = path.join(root, 'owned-models')
    const inst = makeInstall({ modelDirs: [owned] })
    fs.mkdirSync(path.join(inst.installPath, 'ComfyUI', 'models', 'z-extra'), { recursive: true })
    fs.mkdirSync(path.join(shared, 'a-extra'), { recursive: true })
    mockSettings({ modelsDirs: [shared], inputDir: globalInput, outputDir: globalOutput })
    const launchCmd = makeLaunchCmd()

    const state = applyStorageLaunchArgs(inst, 'combined', launchCmd)
    const target = yamlPath('combined')
    const yaml = fs.readFileSync(target, 'utf8')

    expect(launchCmd.args).toContain('--extra-model-paths-config')
    expect(launchCmd.args).toContain(target)
    expect(yaml).toContain(`base_path: '${path.resolve(shared)}'`)
    expect(yaml).toContain(`base_path: '${path.resolve(owned)}'`)
    expect(state.manageModelFolders).toBe(true)
    expect(state.preLaunchExtras).toEqual(['a-extra', 'z-extra'])
  })

  it('excludes shared model dirs when shared models are disabled', () => {
    const shared = path.join(root, 'excluded-shared')
    const owned = path.join(root, 'included-owned')
    mockSettings({ modelsDirs: [shared], inputDir: globalInput, outputDir: globalOutput })
    const launchCmd = makeLaunchCmd()

    applyStorageLaunchArgs(
      makeInstall({ useSharedModels: false, modelDirs: [owned] }),
      'owned',
      launchCmd
    )
    const yaml = fs.readFileSync(yamlPath('owned'), 'utf8')

    expect(yaml).toContain(`base_path: '${path.resolve(owned)}'`)
    expect(yaml).not.toContain(`base_path: '${path.resolve(shared)}'`)
  })

  it('does not write model YAML when shared models are disabled without per-install dirs', () => {
    mockSettings({
      modelsDirs: [path.join(root, 'unused-shared')],
      inputDir: globalInput,
      outputDir: globalOutput
    })
    const launchCmd = makeLaunchCmd()

    const state = applyStorageLaunchArgs(makeInstall({ useSharedModels: false }), 'none', launchCmd)

    expect(launchCmd.args).not.toContain('--extra-model-paths-config')
    expect(state.manageModelFolders).toBe(false)
    expect(fs.existsSync(yamlPath('none'))).toBe(false)
  })

  it('marks a shared primary model dir as the YAML default', () => {
    const first = path.join(root, 'shared-first')
    const primary = path.join(root, 'shared-primary')
    mockSettings({ modelsDirs: [first, primary], inputDir: globalInput, outputDir: globalOutput })

    applyStorageLaunchArgs(makeInstall({ modelDirsPrimary: primary }), 'primary', makeLaunchCmd())
    const yaml = fs.readFileSync(yamlPath('primary'), 'utf8')
    expect(yaml.match(/^ {2}is_default: true$/gm)).toHaveLength(1)
    const primaryIdx = yaml.indexOf(`base_path: '${path.resolve(primary)}'`)
    const defaultIdx = yaml.search(/^ {2}is_default: true$/m)
    const nextSectionIdx = yaml.indexOf('\ncomfy.desktop_', primaryIdx + 1)
    expect(defaultIdx).toBeGreaterThan(primaryIdx)
    expect(nextSectionIdx === -1 || defaultIdx < nextSectionIdx).toBe(true)
  })

  it('uses and creates shared input and output dirs by default', () => {
    const launchCmd = makeLaunchCmd()

    applyStorageLaunchArgs(makeInstall(), 'shared-io', launchCmd)

    expect(launchCmd.args!.slice(-4)).toEqual([
      '--input-directory',
      globalInput,
      '--output-directory',
      globalOutput
    ])
    expect(fs.statSync(globalInput).isDirectory()).toBe(true)
    expect(fs.statSync(globalOutput).isDirectory()).toBe(true)
  })

  it('uses per-install input or output independently when sharing is disabled', () => {
    const ownInput = path.join(root, 'own-input')
    const inputCmd = makeLaunchCmd()
    applyStorageLaunchArgs(
      makeInstall({ useSharedInput: false, inputDir: ownInput }),
      'own-input',
      inputCmd
    )
    expect(inputCmd.args!.slice(-4)).toEqual([
      '--input-directory',
      ownInput,
      '--output-directory',
      globalOutput
    ])
    expect(fs.statSync(ownInput).isDirectory()).toBe(true)

    const ownOutput = path.join(root, 'own-output')
    const outputCmd = makeLaunchCmd()
    applyStorageLaunchArgs(
      makeInstall({ useSharedOutput: false, outputDir: ownOutput }),
      'own-output',
      outputCmd
    )
    expect(outputCmd.args!.slice(-4)).toEqual([
      '--input-directory',
      globalInput,
      '--output-directory',
      ownOutput
    ])
    expect(fs.statSync(ownOutput).isDirectory()).toBe(true)
  })

  it('omits unshared input and output flags when per-install paths are unset', () => {
    const launchCmd = makeLaunchCmd()

    applyStorageLaunchArgs(
      makeInstall({ useSharedInput: false, useSharedOutput: false }),
      'unset-io',
      launchCmd
    )

    expect(launchCmd.args).toEqual(['main.py'])
  })

  it('handles every shared input and output combination', () => {
    for (const useSharedInput of [true, false]) {
      for (const useSharedOutput of [true, false]) {
        const ownInput = path.join(root, `matrix-input-${useSharedInput}-${useSharedOutput}`)
        const ownOutput = path.join(root, `matrix-output-${useSharedInput}-${useSharedOutput}`)
        const launchCmd = makeLaunchCmd()
        applyStorageLaunchArgs(
          makeInstall({
            useSharedInput,
            useSharedOutput,
            inputDir: ownInput,
            outputDir: ownOutput
          }),
          `matrix-${useSharedInput}-${useSharedOutput}`,
          launchCmd
        )
        expect(launchCmd.args).toEqual([
          'main.py',
          '--input-directory',
          useSharedInput ? globalInput : ownInput,
          '--output-directory',
          useSharedOutput ? globalOutput : ownOutput
        ])
      }
    }
  })

  it('does not apply storage args when shared paths are skipped', () => {
    const launchCmd = makeLaunchCmd({ skipSharedPaths: true })
    const state = applyStorageLaunchArgs(
      makeInstall({ modelDirs: [path.join(root, 'skipped-models')] }),
      'skipped',
      launchCmd
    )

    expect(launchCmd.args).toEqual(['main.py'])
    expect(state.preLaunchExtras).toEqual([])
    expect(state.manageModelFolders).toBe(false)
  })

  it('falls back to the default input dir when the setting is empty', () => {
    mockSettings({ inputDir: '', outputDir: globalOutput, modelsDirs: [] })
    const launchCmd = makeLaunchCmd()

    applyStorageLaunchArgs(makeInstall(), 'default-input', launchCmd)

    expect(launchCmd.args).toContain(settingsMock.defaults.inputDir)
    expect(fs.statSync(settingsMock.defaults.inputDir).isDirectory()).toBe(true)
  })
})
