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

import { gitSource } from './git'
import { portable } from './portable'
import type { InstallationRecord } from '../installations'

type Field = { id?: string; value?: unknown; editable?: boolean }
type Section = { tab?: string; fields?: Field[] }

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

describe('the Folders tab of a build added from an existing git clone', () => {
  it('has a Folders section, so the build page shows the Folders tab', () => {
    const storage = storageFieldsOf(gitSource.getDetailSections(record()))

    expect(storage.length).toBeGreaterThan(0)
  })

  it('offers the same folder controls as a portable build', () => {
    const gitIds = storageFieldsOf(gitSource.getDetailSections(record())).map((f) => f.id)
    const portableIds = storageFieldsOf(
      portable.getDetailSections(record({ sourceId: 'portable' }))
    ).map((f) => f.id)

    expect(gitIds).toEqual(portableIds)
  })

  it('reports the shared folder switches the launch already applies', () => {
    const storage = storageFieldsOf(gitSource.getDetailSections(record({ useSharedOutput: false })))
    const valueOf = (id: string) => storage.find((f) => f.id === id)?.value

    expect(valueOf('useSharedModels')).toBe(true)
    expect(valueOf('useSharedInput')).toBe(true)
    expect(valueOf('useSharedOutput')).toBe(false)
  })

  describe('for a clone ComfyUI has already run from', () => {
    let clone = ''
    afterEach(() => fs.rmSync(clone, { recursive: true, force: true }))

    it('points the build own folders inside the clone, not a nested ComfyUI folder', () => {
      clone = fs.mkdtempSync(path.join(os.tmpdir(), 'git-clone-'))
      fs.writeFileSync(path.join(clone, 'main.py'), '')
      for (const dir of ['models', 'user', 'custom_nodes']) fs.mkdirSync(path.join(clone, dir))
      const storage = storageFieldsOf(gitSource.getDetailSections(record({ installPath: clone })))
      const valueOf = (id: string) => storage.find((f) => f.id === id)?.value

      expect(valueOf('installModelsDir')).toBe(path.join(clone, 'models'))
      expect(valueOf('inputDirDefault')).toBe(path.join(clone, 'input'))
      expect(valueOf('outputDirDefault')).toBe(path.join(clone, 'output'))
    })
  })
})
