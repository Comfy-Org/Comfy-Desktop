import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '', isPackaged: false },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn() },
  dialog: {},
  shell: { openPath: vi.fn() },
  net: { request: vi.fn() }
}))

vi.mock('../settings', () => ({
  get: vi.fn((key: string) =>
    key === 'inputDir' ? '/shared/input' : key === 'outputDir' ? '/shared/output' : undefined
  ),
  set: vi.fn(async () => {}),
  getAll: vi.fn(() => ({})),
  getMirrorConfig: vi.fn(() => ({ pypiMirror: undefined, useChineseMirrors: false })),
  defaults: { modelsDirs: [], inputDir: '/default/input', outputDir: '/default/output' }
}))

import { gitSource } from './git'
import { portable } from './portable'
import { resolveInputDir } from './standalone/templateInputAssets'
import type { InstallationRecord } from '../installations'

type Field = { id?: string; value?: unknown; editable?: boolean }
type Section = { tab?: string; fields?: Field[] }

const FOLDER_SWITCH_IDS = ['useSharedInput', 'useSharedOutput', 'inputDir', 'outputDir']

let clone = ''

afterEach(() => {
  if (clone) fs.rmSync(clone, { recursive: true, force: true })
  clone = ''
})

function rootLayoutClone(): string {
  clone = fs.mkdtempSync(path.join(os.tmpdir(), 'git-clone-'))
  fs.writeFileSync(path.join(clone, 'main.py'), '')
  for (const dir of ['models', 'custom_nodes']) fs.mkdirSync(path.join(clone, dir))
  return clone
}

const record = (overrides: Record<string, unknown> = {}): InstallationRecord =>
  ({
    id: 'git-1',
    name: 'ComfyUI Private',
    sourceId: 'git',
    sourceLabel: 'Git clone',
    installPath: '/home/me/comfy-private',
    venvPath: '/home/me/comfy-private/venv',
    status: 'installed',
    createdAt: '2026-11-24T00:00:00.000Z',
    version: '7b1f0111',
    ...overrides
  }) as unknown as InstallationRecord

function storageFieldsOf(sections: Record<string, unknown>[]): Field[] {
  return (sections as Section[])
    .filter((section) => section.tab === 'storage')
    .flatMap((section) => section.fields ?? [])
}

function gitStorage(overrides: Record<string, unknown> = {}): Field[] {
  return storageFieldsOf(gitSource.getDetailSections(record(overrides)))
}

const valueOf = (fields: Field[], id: string): unknown => fields.find((f) => f.id === id)?.value

describe('the Folders tab of a build added from an existing git clone', () => {
  it('has a Folders section, so the build page shows the Folders tab', () => {
    expect(gitStorage().length).toBeGreaterThan(0)
  })

  it('keeps the models controls', () => {
    const ids = gitStorage().map((f) => f.id)

    expect(ids).toEqual(
      expect.arrayContaining(['useSharedModels', 'modelDirs', 'installModelsDir'])
    )
  })

  it('has no switches to stop using the shared input and output folders', () => {
    const ids = gitStorage().map((f) => f.id)

    for (const id of FOLDER_SWITCH_IDS) expect(ids, id).not.toContain(id)
  })

  it('shows the shared input and output folders the build starts with, read-only', () => {
    const storage = gitStorage({ useSharedInput: false, useSharedOutput: false })

    expect(valueOf(storage, 'launchInputDir')).toEqual({ path: '/shared/input', shared: true })
    expect(valueOf(storage, 'launchOutputDir')).toEqual({ path: '/shared/output', shared: true })
    expect(storage.find((f) => f.id === 'launchInputDir')?.editable).toBe(false)
  })

  it('shows the folders set in Startup arguments instead, as not shared', () => {
    const storage = gitStorage({
      launchArgs: '--port 8190 --input-directory /my/in --output-directory=/my/out'
    })

    expect(valueOf(storage, 'launchInputDir')).toEqual({ path: '/my/in', shared: false })
    expect(valueOf(storage, 'launchOutputDir')).toEqual({ path: '/my/out', shared: false })
  })

  it('resolves a relative folder in Startup arguments from the ComfyUI folder it starts in', () => {
    const root = rootLayoutClone()
    const storage = gitStorage({ installPath: root, launchArgs: '--output-directory renders' })

    expect(valueOf(storage, 'launchOutputDir')).toEqual({
      path: path.join(root, 'renders'),
      shared: false
    })
  })

  it('points its own models folder inside a clone ComfyUI has never run from', () => {
    const root = rootLayoutClone()

    expect(valueOf(gitStorage({ installPath: root }), 'installModelsDir')).toBe(
      path.join(root, 'models')
    )
  })

  it('leaves a portable build its shared input and output switches', () => {
    const ids = storageFieldsOf(portable.getDetailSections(record({ sourceId: 'portable' }))).map(
      (f) => f.id
    )

    for (const id of FOLDER_SWITCH_IDS) expect(ids, id).toContain(id)
    expect(ids).not.toContain('launchInputDir')
  })
})

describe('template input downloads for a git build', () => {
  it('go to the shared input folder, even with an old shared-input switch saved off', () => {
    const root = rootLayoutClone()

    expect(resolveInputDir(record({ installPath: root, useSharedInput: false }))).toBe(
      '/shared/input'
    )
  })

  it('go to the input folder set in Startup arguments', () => {
    expect(resolveInputDir(record({ launchArgs: '--input-directory /my/in' }))).toBe('/my/in')
  })
})
