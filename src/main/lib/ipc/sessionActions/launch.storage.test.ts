import fs from 'node:fs'
import path from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import type { InstallationRecord } from '../shared'
import type { LaunchCommand } from '../../../types/sources'

const { root, priorXdgDataHome } = await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const root = mkdtempSync(join(tmpdir(), 'launch-storage-'))
  // dataDir() resolves via XDG on Linux (not Electron userData); pin it under
  // the test root so the per-install YAML lands in the sandbox on every OS.
  const priorXdgDataHome = process.env.XDG_DATA_HOME
  process.env.XDG_DATA_HOME = join(root, 'xdg-data')
  return { root, priorXdgDataHome }
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
import { dataDir } from '../../paths'
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
  return path.join(dataDir(), 'instance-model-paths', `${installationId}.yaml`)
}

/** Desktop's folder settings, as the launch's one settings read hands them over. */
function storage(
  modelsDirs: string[] = [],
  inputDir = globalInput,
  outputDir = globalOutput
): Parameters<typeof applyStorageLaunchArgs>[3] {
  return { modelsDirs, inputDir, outputDir }
}

afterEach(() => {
  vi.clearAllMocks()
})

afterAll(() => {
  if (priorXdgDataHome === undefined) delete process.env.XDG_DATA_HOME
  else process.env.XDG_DATA_HOME = priorXdgDataHome
  fs.rmSync(root, { recursive: true, force: true })
})

describe('applyStorageLaunchArgs', () => {
  it('combines shared and per-install model dirs in the per-install YAML', () => {
    const shared = path.join(root, 'shared-models')
    const owned = path.join(root, 'owned-models')
    const inst = makeInstall({ modelDirs: [owned] })
    fs.mkdirSync(path.join(inst.installPath, 'ComfyUI', 'models', 'z-extra'), { recursive: true })
    fs.mkdirSync(path.join(shared, 'a-extra'), { recursive: true })
    const launchCmd = makeLaunchCmd()

    const state = applyStorageLaunchArgs(inst, 'combined', launchCmd, storage([shared]))
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
    const launchCmd = makeLaunchCmd()

    applyStorageLaunchArgs(
      makeInstall({ useSharedModels: false, modelDirs: [owned] }),
      'owned',
      launchCmd,
      storage([shared])
    )
    const yaml = fs.readFileSync(yamlPath('owned'), 'utf8')

    expect(yaml).toContain(`base_path: '${path.resolve(owned)}'`)
    expect(yaml).not.toContain(`base_path: '${path.resolve(shared)}'`)
  })

  it('does not write model YAML when shared models are disabled without per-install dirs', () => {
    const launchCmd = makeLaunchCmd()

    const state = applyStorageLaunchArgs(
      makeInstall({ useSharedModels: false }),
      'none',
      launchCmd,
      storage([path.join(root, 'unused-shared')])
    )

    expect(launchCmd.args).not.toContain('--extra-model-paths-config')
    expect(state.manageModelFolders).toBe(false)
    expect(fs.existsSync(yamlPath('none'))).toBe(false)
  })

  it('marks a shared primary model dir as the YAML default', () => {
    const first = path.join(root, 'shared-first')
    const primary = path.join(root, 'shared-primary')

    applyStorageLaunchArgs(
      makeInstall({ modelDirsPrimary: primary }),
      'primary',
      makeLaunchCmd(),
      storage([first, primary])
    )
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

    applyStorageLaunchArgs(makeInstall(), 'shared-io', launchCmd, storage())

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
      inputCmd,
      storage()
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
      outputCmd,
      storage()
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
      launchCmd,
      storage()
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
          launchCmd,
          storage()
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
      launchCmd,
      storage()
    )

    expect(launchCmd.args).toEqual(['main.py'])
    expect(state.preLaunchExtras).toEqual([])
    expect(state.manageModelFolders).toBe(false)
  })

  it('gives a governed build its shared and per-install model dirs', () => {
    const shared = path.join(root, 'governed-shared')
    fs.mkdirSync(shared, { recursive: true })
    const owned = path.join(root, 'governed-owned')
    const launchCmd = makeLaunchCmd()

    const inst = makeInstall({ modelDirs: [owned] })
    fs.mkdirSync(path.join(inst.installPath, 'ComfyUI', 'governance'))
    fs.writeFileSync(
      path.join(inst.installPath, 'ComfyUI', 'governance', 'policy.signed.json'),
      '{}'
    )

    const state = applyStorageLaunchArgs(inst, 'governed', launchCmd, storage([shared]))
    const target = yamlPath('governed')
    const yaml = fs.readFileSync(target, 'utf8')

    expect(launchCmd.args).toEqual([
      'main.py',
      '--extra-model-paths-config',
      target,
      '--input-directory',
      globalInput,
      '--output-directory',
      globalOutput
    ])
    // Every section header, root and default in the YAML, in order: one
    // section per dir, the shared dir first and the default.
    expect(
      yaml.split('\n').filter((l) => /^(comfy\.desktop_| {2}base_path:| {2}is_default:)/.test(l))
    ).toEqual([
      'comfy.desktop_0:',
      `  base_path: '${path.resolve(shared)}'`,
      '  is_default: true',
      'comfy.desktop_1:',
      `  base_path: '${path.resolve(owned)}'`
    ])
    expect(state).toEqual({
      preLaunchExtras: [],
      manageModelFolders: true,
      modelDirsForLaunch: [path.resolve(shared), path.resolve(owned)],
      modelSyncOptions: { yamlPath: target, primaryDir: path.resolve(shared) }
    })
  })

  it('reads the folders from the launch snapshot, never from settings again', () => {
    const shared = path.join(root, 'snapshot-models')
    const launchCmd = makeLaunchCmd()

    applyStorageLaunchArgs(makeInstall(), 'snapshot', launchCmd, storage([shared]))

    expect(fs.readFileSync(yamlPath('snapshot'), 'utf8')).toContain(
      `base_path: '${path.resolve(shared)}'`
    )
    expect(launchCmd.args).toEqual(
      expect.arrayContaining(['--input-directory', globalInput, '--output-directory', globalOutput])
    )
    for (const key of ['modelsDirs', 'inputDir', 'outputDir']) {
      expect(settingsMock.get).not.toHaveBeenCalledWith(key)
    }
  })

  it('falls back to the default input dir when the setting is empty', () => {
    const launchCmd = makeLaunchCmd()

    applyStorageLaunchArgs(makeInstall(), 'default-input', launchCmd, storage([], ''))

    expect(launchCmd.args).toContain(settingsMock.defaults.inputDir)
    expect(fs.statSync(settingsMock.defaults.inputDir).isDirectory()).toBe(true)
  })

  it('falls back to the default output dir when the setting is empty', () => {
    const launchCmd = makeLaunchCmd()

    applyStorageLaunchArgs(makeInstall(), 'default-output', launchCmd, storage([], globalInput, ''))

    expect(launchCmd.args).toContain(settingsMock.defaults.outputDir)
    expect(fs.statSync(settingsMock.defaults.outputDir).isDirectory()).toBe(true)
  })
})
