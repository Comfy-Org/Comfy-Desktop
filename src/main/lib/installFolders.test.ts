import fs from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { InstallationRecord } from '../installations'
import type { LaunchCommand } from '../types/sources'

const { root, sharedInput, sharedOutput, sharedModels } = await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const root = mkdtempSync(join(tmpdir(), 'install-folders-'))
  return {
    root,
    sharedInput: join(root, 'shared-input'),
    sharedOutput: join(root, 'shared-output'),
    sharedModels: join(root, 'shared-models')
  }
})

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => path.join(root, 'userData'), getVersion: () => '0' }
}))

vi.mock('../settings', () => ({
  get: vi.fn((key: string): unknown =>
    key === 'inputDir' ? sharedInput : key === 'outputDir' ? sharedOutput : undefined
  ),
  defaults: { modelsDirs: [sharedModels], inputDir: sharedInput, outputDir: sharedOutput }
}))

import { resolveInstallFolders, storageIoDirs } from './installFolders'

let counter = 0
function makeInstall(overrides: Partial<InstallationRecord> = {}): InstallationRecord {
  const installPath = path.join(root, `install-${++counter}`)
  fs.mkdirSync(path.join(installPath, 'ComfyUI'), { recursive: true })
  fs.writeFileSync(path.join(installPath, 'ComfyUI', 'main.py'), '')
  return { id: `i${counter}`, installPath, ...overrides } as InstallationRecord
}

function launchOf(inst: InstallationRecord, args: string[] = []): LaunchCommand {
  return {
    cmd: 'python',
    args: ['-s', path.join('ComfyUI', 'main.py'), ...args],
    cwd: inst.installPath
  }
}

afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

describe('resolveInstallFolders', () => {
  it('reads a standard install inside its ComfyUI folder, with the shared input and output', () => {
    const inst = makeInstall()
    const comfy = path.join(inst.installPath, 'ComfyUI')
    const folders = resolveInstallFolders(inst, launchOf(inst))
    expect(folders).toMatchObject({
      user: path.join(comfy, 'user'),
      workflows: path.join(comfy, 'user', 'default', 'workflows'),
      customNodes: path.join(comfy, 'custom_nodes'),
      input: sharedInput,
      output: sharedOutput
    })
    expect(folders.modelRoots).toContain(path.join(comfy, 'models'))
    expect(folders.modelRoots).toContain(sharedModels)
  })

  it('follows the base and user folders an adopted install launches with', () => {
    const inst = makeInstall()
    const legacy = path.join(root, 'legacy-desktop')
    const folders = resolveInstallFolders(
      inst,
      launchOf(inst, ['--base-directory', legacy, '--user-directory', path.join(legacy, 'user')])
    )
    expect(folders.user).toBe(path.join(legacy, 'user'))
    expect(folders.workflows).toBe(path.join(legacy, 'user', 'default', 'workflows'))
    expect(folders.customNodes).toBe(path.join(legacy, 'custom_nodes'))
    expect(folders.modelRoots).toContain(path.join(legacy, 'models'))
  })

  it("uses an install's own output when it opts out of the shared one", () => {
    const own = path.join(root, 'own-output')
    const inst = makeInstall({ useSharedOutput: false, outputDir: own, useSharedInput: false })
    const folders = resolveInstallFolders(inst, launchOf(inst))
    expect(folders.output).toBe(own)
    // Opted out without a folder of its own: ComfyUI's default.
    expect(folders.input).toBe(path.join(inst.installPath, 'ComfyUI', 'input'))
  })

  it('lets the shared folders launch appends win over one set in the launch arguments', () => {
    const inst = makeInstall()
    const folders = resolveInstallFolders(
      inst,
      launchOf(inst, ['--output-directory', path.join(root, 'typed')])
    )
    expect(folders.output).toBe(sharedOutput)
  })

  it('resolves relative folders against the launch directory', () => {
    const inst = makeInstall({ useSharedOutput: false })
    const folders = resolveInstallFolders(inst, launchOf(inst, ['--output-directory=out']))
    expect(folders.output).toBe(path.join(inst.installPath, 'out'))
  })

  it("keeps ComfyUI's defaults when the install cannot launch yet", () => {
    const inst = makeInstall()
    expect(resolveInstallFolders(inst, null).input).toBe(
      path.join(inst.installPath, 'ComfyUI', 'input')
    )
  })
})

describe('storageIoDirs', () => {
  it('passes no folders for sources that manage their own launch', () => {
    const inst = makeInstall()
    expect(storageIoDirs(inst, { ...launchOf(inst), skipSharedPaths: true })).toEqual({})
  })
})
