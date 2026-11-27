import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

vi.mock('./paths', () => ({
  dataDir: () => os.tmpdir()
}))

const { listInstallModels, listModelsInSearch, MAX_INSTALL_MODELS } =
  await import('./installModelList')

import type { InstallationRecord } from '../installations'
import type { InstallModelSearch } from './models'

let tmp: string

function writeFile(target: string, bytes = 1): void {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, Buffer.alloc(bytes))
}

function search(overrides: Partial<InstallModelSearch> = {}): InstallModelSearch {
  return { downloadBaseDir: tmp, modelRoots: [], extraPaths: [], ...overrides }
}

function installRecord(
  installPath: string,
  extra: Record<string, unknown> = {}
): InstallationRecord {
  return {
    id: 'local-1',
    name: 'Local',
    sourceId: 'standalone',
    installPath,
    ...extra
  } as InstallationRecord
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'install-models-'))
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('listModelsInSearch', () => {
  it('lists model files by folder kind with names relative to the folder and their size', async () => {
    const root = path.join(tmp, 'models')
    writeFile(path.join(root, 'checkpoints', 'sdxl.safetensors'), 12)
    writeFile(path.join(root, 'loras', 'sdxl', 'detail.safetensors'), 7)
    writeFile(path.join(root, 'loras', 'sdxl', 'deep', 'style.pt'), 3)

    const models = await listModelsInSearch(search({ modelRoots: [root] }))

    expect(models).toEqual([
      { folder: 'checkpoints', name: 'sdxl.safetensors', size: 12 },
      { folder: 'loras', name: 'sdxl/deep/style.pt', size: 3 },
      { folder: 'loras', name: 'sdxl/detail.safetensors', size: 7 }
    ])
  })

  it('never sends a machine path', async () => {
    const root = path.join(tmp, 'private-user', 'models')
    writeFile(path.join(root, 'vae', 'ae.safetensors'))

    const models = await listModelsInSearch(search({ modelRoots: [root] }))

    expect(JSON.stringify(models)).not.toContain(tmp)
    expect(JSON.stringify(models)).not.toContain('private-user')
    expect(models).toEqual([{ folder: 'vae', name: 'ae.safetensors', size: 1 }])
  })

  it('keeps only model files and skips hidden entries, downloads in progress and non-model folders', async () => {
    const root = path.join(tmp, 'models')
    writeFile(path.join(root, 'loras', 'keep.safetensors'))
    writeFile(path.join(root, 'loras', 'readme.txt'))
    writeFile(path.join(root, 'loras', 'preview.png'))
    writeFile(path.join(root, 'loras', '.hidden.safetensors'))
    writeFile(path.join(root, 'loras', '.cache', 'cached.safetensors'))
    writeFile(path.join(root, '.desktop2-downloads', 'partial.safetensors'))
    writeFile(path.join(root, 'custom_nodes', 'pack', 'weights.pth'))
    writeFile(path.join(root, 'loose.safetensors'))

    const models = await listModelsInSearch(search({ modelRoots: [root] }))

    expect(models).toEqual([{ folder: 'loras', name: 'keep.safetensors', size: 1 }])
  })

  it.each([
    ['.safetensors'],
    ['.sft'],
    ['.ckpt'],
    ['.pt'],
    ['.pt2'],
    ['.pth'],
    ['.bin'],
    ['.pkl'],
    ['.gguf'],
    ['.onnx'],
    ['.SAFETENSORS']
  ])('counts a %s file as a model', async (extension) => {
    const root = path.join(tmp, 'models')
    writeFile(path.join(root, 'unet', `model${extension}`))

    const models = await listModelsInSearch(search({ modelRoots: [root] }))

    expect(models).toHaveLength(1)
  })

  it('names legacy folders by the kind ComfyUI loads them as', async () => {
    const root = path.join(tmp, 'models')
    writeFile(path.join(root, 'clip', 't5.safetensors'))
    writeFile(path.join(root, 'unet', 'flux.gguf'))
    writeFile(path.join(root, 't2i_adapter', 'sketch.pth'))

    const models = await listModelsInSearch(search({ modelRoots: [root] }))

    expect(models).toEqual([
      { folder: 'controlnet', name: 'sketch.pth', size: 1 },
      { folder: 'diffusion_models', name: 'flux.gguf', size: 1 },
      { folder: 'text_encoders', name: 't5.safetensors', size: 1 }
    ])
  })

  it('keeps custom folders a models root holds', async () => {
    const root = path.join(tmp, 'models')
    writeFile(path.join(root, 'ultralytics', 'bbox', 'face.pt'))

    const models = await listModelsInSearch(search({ modelRoots: [root] }))

    expect(models).toEqual([{ folder: 'ultralytics', name: 'bbox/face.pt', size: 1 }])
  })

  it('reads folders an extra_model_paths.yaml entry points at, under that entry kind', async () => {
    const elsewhere = path.join(tmp, 'a1111', 'Lora')
    writeFile(path.join(elsewhere, 'old.safetensors'), 5)

    const models = await listModelsInSearch(
      search({
        extraPaths: [
          {
            section: 'a111',
            basePath: path.join(tmp, 'a1111'),
            type: 'loras',
            rawType: 'loras',
            dir: elsewhere,
            isDefault: false
          },
          {
            section: 'a111',
            basePath: path.join(tmp, 'a1111'),
            type: 'custom_nodes',
            rawType: 'custom_nodes',
            dir: elsewhere,
            isDefault: false
          }
        ]
      })
    )

    expect(models).toEqual([{ folder: 'loras', name: 'old.safetensors', size: 5 }])
  })

  it('lists a file once when two roots hold the same folder and name, keeping the first root', async () => {
    const own = path.join(tmp, 'own')
    const shared = path.join(tmp, 'shared')
    writeFile(path.join(own, 'loras', 'same.safetensors'), 2)
    writeFile(path.join(shared, 'loras', 'same.safetensors'), 9)
    writeFile(path.join(shared, 'loras', 'other.safetensors'), 4)

    const models = await listModelsInSearch(search({ modelRoots: [own, shared] }))

    expect(models).toEqual([
      { folder: 'loras', name: 'other.safetensors', size: 4 },
      { folder: 'loras', name: 'same.safetensors', size: 2 }
    ])
  })

  it('follows a symlinked folder without looping on a link back to itself', async () => {
    const root = path.join(tmp, 'models')
    const library = path.join(tmp, 'library')
    writeFile(path.join(library, 'base.safetensors'))
    fs.mkdirSync(root, { recursive: true })
    fs.symlinkSync(library, path.join(root, 'checkpoints'), 'dir')
    fs.symlinkSync(library, path.join(library, 'loop'), 'dir')

    const models = await listModelsInSearch(search({ modelRoots: [root] }))

    expect(models).toEqual([{ folder: 'checkpoints', name: 'base.safetensors', size: 1 }])
  })

  it('leaves out a name with a control character', async () => {
    const root = path.join(tmp, 'models')
    writeFile(path.join(root, 'loras', 'bad\nname.safetensors'))
    writeFile(path.join(root, 'loras', 'good.safetensors'))

    const models = await listModelsInSearch(search({ modelRoots: [root] }))

    expect(models).toEqual([{ folder: 'loras', name: 'good.safetensors', size: 1 }])
  })

  it('leaves out a name too long for the builder to keep', async () => {
    const root = path.join(tmp, 'models')
    const deep = path.join(root, 'loras', 'a'.repeat(200))
    writeFile(path.join(deep, `${'b'.repeat(60)}.safetensors`))
    writeFile(path.join(root, 'loras', 'short.safetensors'))

    const models = await listModelsInSearch(search({ modelRoots: [root] }))

    expect(models).toEqual([{ folder: 'loras', name: 'short.safetensors', size: 1 }])
  })

  it(`sends at most ${MAX_INSTALL_MODELS} files`, async () => {
    const root = path.join(tmp, 'models', 'loras')
    fs.mkdirSync(root, { recursive: true })
    for (let i = 0; i < MAX_INSTALL_MODELS + 5; i++) {
      fs.writeFileSync(path.join(root, `m${String(i).padStart(5, '0')}.safetensors`), '')
    }

    const models = await listModelsInSearch(search({ modelRoots: [path.join(tmp, 'models')] }))

    expect(models).toHaveLength(MAX_INSTALL_MODELS)
    expect(models[0]).toEqual({ folder: 'loras', name: 'm00000.safetensors', size: 0 })
  })

  it('returns nothing for a root that does not exist', async () => {
    await expect(
      listModelsInSearch(search({ modelRoots: [path.join(tmp, 'missing')] }))
    ).resolves.toEqual([])
  })
})

describe('listInstallModels', () => {
  it('walks the install models folder and the shared model folders', async () => {
    const installPath = path.join(tmp, 'install')
    const shared = path.join(tmp, 'shared-models')
    writeFile(path.join(installPath, 'ComfyUI', 'models', 'vae', 'own.safetensors'))
    writeFile(path.join(shared, 'loras', 'shared.safetensors'))

    const models = await listInstallModels(installRecord(installPath), [shared])

    expect(models).toEqual([
      { folder: 'loras', name: 'shared.safetensors', size: 1 },
      { folder: 'vae', name: 'own.safetensors', size: 1 }
    ])
  })

  it('leaves out the shared folders when the install does not use them', async () => {
    const installPath = path.join(tmp, 'install')
    const shared = path.join(tmp, 'shared-models')
    writeFile(path.join(installPath, 'ComfyUI', 'models', 'vae', 'own.safetensors'))
    writeFile(path.join(shared, 'loras', 'shared.safetensors'))

    const models = await listInstallModels(installRecord(installPath, { useSharedModels: false }), [
      shared
    ])

    expect(models).toEqual([{ folder: 'vae', name: 'own.safetensors', size: 1 }])
  })

  it('reads the install extra_model_paths.yaml', async () => {
    const installPath = path.join(tmp, 'install')
    const external = path.join(tmp, 'external')
    writeFile(path.join(external, 'checkpoints', 'far.safetensors'))
    fs.mkdirSync(path.join(installPath, 'ComfyUI'), { recursive: true })
    fs.writeFileSync(
      path.join(installPath, 'ComfyUI', 'extra_model_paths.yaml'),
      `other:\n  base_path: ${JSON.stringify(external)}\n  checkpoints: checkpoints/\n`
    )

    const models = await listInstallModels(installRecord(installPath), [])

    expect(models).toEqual([{ folder: 'checkpoints', name: 'far.safetensors', size: 1 }])
  })
})
