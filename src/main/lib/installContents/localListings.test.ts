import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir(), isPackaged: false } }))

import { listLocalWorkflows } from './workflows'
import { listLocalModels } from './models'
import { listLocalNodes } from './nodes'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'install-listings-'))
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

function write(relative: string, content = ''): string {
  const file = path.join(root, relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
  return file
}

describe('listLocalWorkflows', () => {
  it('lists saved workflows newest first, with their folder', async () => {
    const older = write('workflows/portraits/hero.json', '{}')
    write('workflows/flux.json', '{}')
    fs.utimesSync(older, new Date(2024, 0, 1), new Date(2024, 0, 1))
    const page = await listLocalWorkflows(path.join(root, 'workflows'), {})
    if (!page.ok) throw new Error(page.message)
    expect(page.items.map((w) => [w.name, w.folder])).toEqual([
      ['flux', ''],
      ['hero', 'portraits']
    ])
    const byName = await listLocalWorkflows(path.join(root, 'workflows'), { sort: 'name' })
    if (!byName.ok) throw new Error(byName.message)
    expect(byName.items.map((w) => w.name)).toEqual(['flux', 'hero'])
  })
})

describe('listLocalModels', () => {
  it('groups model files by type folder across roots and extra paths, once each', async () => {
    write('models/checkpoints/sdxl.safetensors', 'x')
    write('models/loras/style/ink.safetensors', 'x')
    write('models/loras/readme.txt')
    write('models/loose.safetensors')
    write('shared/checkpoints/flux.gguf', 'x')
    write('extra/my-vae/vae.pt', 'x')
    const page = await listLocalModels(
      {
        modelRoots: [
          path.join(root, 'models'),
          path.join(root, 'shared'),
          path.join(root, 'models')
        ],
        extraModelPaths: [
          {
            section: 's',
            basePath: null,
            type: 'vae',
            rawType: 'vae',
            dir: path.join(root, 'extra', 'my-vae'),
            isDefault: false
          }
        ]
      },
      {}
    )
    if (!page.ok) throw new Error(page.message)
    expect(page.items.map((m) => `${m.folder}:${m.name}`)).toEqual([
      'checkpoints:flux.gguf',
      'checkpoints:sdxl.safetensors',
      'loras:style/ink.safetensors',
      'vae:vae.pt'
    ])
    expect(page.total).toBe(4)
    expect(page.facets).toEqual([
      { value: 'checkpoints', count: 2 },
      { value: 'loras', count: 1 },
      { value: 'vae', count: 1 }
    ])

    const loras = await listLocalModels(
      { modelRoots: [path.join(root, 'models')], extraModelPaths: [] },
      { filter: 'loras' }
    )
    if (!loras.ok) throw new Error(loras.message)
    expect(loras.items.map((m) => m.name)).toEqual(['style/ink.safetensors'])
    // The filter row keeps every type, whichever one is chosen.
    expect(loras.facets?.map((f) => f.value)).toEqual(['checkpoints', 'loras'])
  })
})

describe('listLocalNodes', () => {
  it('lists enabled and disabled packs', async () => {
    write('ComfyUI/custom_nodes/ComfyUI-Impact-Pack/__init__.py', '')
    write('ComfyUI/custom_nodes/.disabled/rgthree-comfy/__init__.py', '')
    const page = await listLocalNodes(path.join(root, 'ComfyUI', 'custom_nodes'), {})
    if (!page.ok) throw new Error(page.message)
    expect(page.items.map((n) => [n.name, n.enabled])).toEqual([
      ['ComfyUI-Impact-Pack', true],
      ['rgthree-comfy', false]
    ])
  })
})
