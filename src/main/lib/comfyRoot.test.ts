import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '', isPackaged: false },
  ipcMain: { handle: vi.fn() }
}))

import { findComfyUIDir } from './migrate'
import { installInputDir, installModelsDir, installOutputDir, resolveComfyDir } from './models'
import { resolveInputDir } from '../sources/standalone/templateInputAssets'
import type { InstallationRecord } from '../installations'

let root = ''

function make(...relativePaths: string[]): void {
  for (const rel of relativePaths) {
    const full = path.join(root, rel)
    if (rel.endsWith('.py')) {
      fs.mkdirSync(path.dirname(full), { recursive: true })
      fs.writeFileSync(full, '')
    } else {
      fs.mkdirSync(full, { recursive: true })
    }
  }
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'comfy-root-'))
})

afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('the ComfyUI folder of a git clone with ComfyUI at its root', () => {
  it('is the clone itself before ComfyUI has ever run there', () => {
    make('main.py', 'models', 'custom_nodes')

    expect(resolveComfyDir(root)).toBe(root)
    expect(installModelsDir(root)).toBe(path.join(root, 'models'))
    expect(installInputDir(root)).toBe(path.join(root, 'input'))
    expect(installOutputDir(root)).toBe(path.join(root, 'output'))
  })

  it('is the clone itself once ComfyUI has run there', () => {
    make('main.py', 'models', 'custom_nodes', 'user')

    expect(findComfyUIDir(root)).toBe(root)
  })

  it('is found for a migration even before ComfyUI has run there', () => {
    make('main.py', 'models', 'custom_nodes')

    expect(findComfyUIDir(root)).toBe(root)
  })
})

describe('template input downloads for a build that does not use the shared input folder', () => {
  const isolated = (extra: Record<string, unknown> = {}): InstallationRecord =>
    ({ useSharedInput: false, installPath: root, ...extra }) as unknown as InstallationRecord

  it('go to the input folder ComfyUI reads in a root-layout clone', () => {
    make('main.py', 'models', 'custom_nodes')

    expect(resolveInputDir(isolated())).toBe(path.join(root, 'input'))
  })

  it('go to the chosen input folder when the build has one', () => {
    make('main.py', 'models', 'custom_nodes')

    expect(resolveInputDir(isolated({ inputDir: '/chosen/input' }))).toBe('/chosen/input')
  })

  it('go to ComfyUI/input in a Standalone build', () => {
    make('ComfyUI/main.py', 'ComfyUI/models', 'standalone-env')

    expect(resolveInputDir(isolated())).toBe(path.join(root, 'ComfyUI', 'input'))
  })
})

describe('layouts without ComfyUI at the root keep their ComfyUI folder', () => {
  it('a Standalone build uses its ComfyUI folder', () => {
    make('ComfyUI/main.py', 'ComfyUI/models', 'standalone-env')

    expect(findComfyUIDir(root)).toBe(path.join(root, 'ComfyUI'))
  })

  it('a Standalone build not yet unpacked falls back to ComfyUI', () => {
    expect(findComfyUIDir(root)).toBeNull()
    expect(resolveComfyDir(root)).toBe(path.join(root, 'ComfyUI'))
  })

  it('a Portable build uses the ComfyUI folder beside its embedded Python', () => {
    make('ComfyUI_windows_portable/python_embeded', 'ComfyUI_windows_portable/ComfyUI/main.py')

    expect(findComfyUIDir(root)).toBe(path.join(root, 'ComfyUI_windows_portable', 'ComfyUI'))
  })

  it('a Legacy Desktop base folder is found by its models, user and custom_nodes', () => {
    make('models', 'user', 'custom_nodes')

    expect(findComfyUIDir(root)).toBe(root)
  })

  it('a folder with models and custom_nodes but no main.py or user is not a ComfyUI folder', () => {
    make('models', 'custom_nodes')

    expect(findComfyUIDir(root)).toBeNull()
  })
})
