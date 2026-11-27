import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

vi.mock('./paths', () => ({
  dataDir: () => os.tmpdir()
}))

vi.mock('../settings', () => ({
  get: () => undefined,
  defaults: {}
}))

const {
  listInstallModels,
  listModelsInSearch,
  MAX_INSTALL_MODELS,
  MAX_INSTALL_MODELS_BYTES,
  MAX_MODEL_NAME_LENGTH
} = await import('./installModelList')

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

    const { models } = await listModelsInSearch(search({ modelRoots: [root] }))

    expect(models).toEqual([
      { folder: 'checkpoints', name: 'sdxl.safetensors', size: 12 },
      { folder: 'loras', name: 'sdxl/deep/style.pt', size: 3 },
      { folder: 'loras', name: 'sdxl/detail.safetensors', size: 7 }
    ])
  })

  it('never sends a machine path', async () => {
    const root = path.join(tmp, 'private-user', 'models')
    writeFile(path.join(root, 'vae', 'ae.safetensors'))

    const { models } = await listModelsInSearch(search({ modelRoots: [root] }))

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

    const { models } = await listModelsInSearch(search({ modelRoots: [root] }))

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

    const { models } = await listModelsInSearch(search({ modelRoots: [root] }))

    expect(models).toHaveLength(1)
  })

  it('names legacy folders by the kind ComfyUI loads them as', async () => {
    const root = path.join(tmp, 'models')
    writeFile(path.join(root, 'clip', 't5.safetensors'))
    writeFile(path.join(root, 'unet', 'flux.gguf'))
    writeFile(path.join(root, 't2i_adapter', 'sketch.pth'))

    const { models } = await listModelsInSearch(search({ modelRoots: [root] }))

    expect(models).toEqual([
      { folder: 'controlnet', name: 'sketch.pth', size: 1 },
      { folder: 'diffusion_models', name: 'flux.gguf', size: 1 },
      { folder: 'text_encoders', name: 't5.safetensors', size: 1 }
    ])
  })

  it('keeps custom folders a models root holds', async () => {
    const root = path.join(tmp, 'models')
    writeFile(path.join(root, 'ultralytics', 'bbox', 'face.pt'))

    const { models } = await listModelsInSearch(search({ modelRoots: [root] }))

    expect(models).toEqual([{ folder: 'ultralytics', name: 'bbox/face.pt', size: 1 }])
  })

  it('reads folders an extra_model_paths.yaml entry points at, under that entry kind', async () => {
    const elsewhere = path.join(tmp, 'a1111', 'Lora')
    writeFile(path.join(elsewhere, 'old.safetensors'), 5)

    const { models } = await listModelsInSearch(
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

  it('keeps an extra_model_paths.yaml kind with a slash, such as LLM/checkpoints', async () => {
    const dir = path.join(tmp, 'llm')
    writeFile(path.join(dir, 'chatglm3.safetensors'))

    const { models } = await listModelsInSearch(
      search({
        extraPaths: [
          {
            section: 'llm',
            basePath: null,
            type: 'LLM/checkpoints',
            rawType: 'LLM/checkpoints',
            dir,
            isDefault: false
          },
          {
            section: 'llm',
            basePath: null,
            type: 'LLM/../x',
            rawType: 'LLM/../x',
            dir,
            isDefault: false
          }
        ]
      })
    )

    expect(models).toEqual([{ folder: 'LLM/checkpoints', name: 'chatglm3.safetensors', size: 1 }])
  })

  it('lists a file once when two roots hold the same folder and name, keeping the first root', async () => {
    const own = path.join(tmp, 'own')
    const shared = path.join(tmp, 'shared')
    writeFile(path.join(own, 'loras', 'same.safetensors'), 2)
    writeFile(path.join(shared, 'loras', 'same.safetensors'), 9)
    writeFile(path.join(shared, 'loras', 'other.safetensors'), 4)

    const { models } = await listModelsInSearch(search({ modelRoots: [own, shared] }))

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

    const { models } = await listModelsInSearch(search({ modelRoots: [root] }))

    expect(models).toEqual([{ folder: 'checkpoints', name: 'base.safetensors', size: 1 }])
  })

  it.skipIf(process.platform === 'win32')(
    'leaves out a name with a control character',
    async () => {
      const root = path.join(tmp, 'models')
      writeFile(path.join(root, 'loras', 'bad\nname.safetensors'))
      writeFile(path.join(root, 'loras', 'good.safetensors'))

      const { models } = await listModelsInSearch(search({ modelRoots: [root] }))

      expect(models).toEqual([{ folder: 'loras', name: 'good.safetensors', size: 1 }])
    }
  )

  it('leaves out a name too long for the builder to keep', async () => {
    const root = path.join(tmp, 'models')
    const deep = path.join(root, 'loras', 'a'.repeat(200))
    writeFile(path.join(deep, `${'b'.repeat(60)}.safetensors`))
    writeFile(path.join(root, 'loras', 'short.safetensors'))

    const { models } = await listModelsInSearch(search({ modelRoots: [root] }))

    expect(models).toEqual([{ folder: 'loras', name: 'short.safetensors', size: 1 }])
  })

  it(`sends at most ${MAX_INSTALL_MODELS} files`, async () => {
    const root = path.join(tmp, 'models', 'loras')
    fs.mkdirSync(root, { recursive: true })
    for (let i = 0; i < MAX_INSTALL_MODELS + 5; i++) {
      fs.writeFileSync(path.join(root, `m${String(i).padStart(5, '0')}.safetensors`), '')
    }

    const { models } = await listModelsInSearch(search({ modelRoots: [path.join(tmp, 'models')] }))

    expect(models).toHaveLength(MAX_INSTALL_MODELS)
    expect(models[0]).toEqual({ folder: 'loras', name: 'm00000.safetensors', size: 0 })
  })

  it('keeps the list small enough for the builder request limit when names are long', async () => {
    const root = path.join(tmp, 'models')
    for (let i = 0; i < 40; i++) {
      const dir = path.join(root, 'loras', `${String(i).padStart(2, '0')}${'d'.repeat(180)}`)
      fs.mkdirSync(dir, { recursive: true })
      for (let j = 0; j < 50; j++) {
        fs.writeFileSync(
          path.join(dir, `${String(j).padStart(2, '0')}${'f'.repeat(50)}.safetensors`),
          ''
        )
      }
    }

    const { models } = await listModelsInSearch(search({ modelRoots: [root] }))

    expect(Buffer.byteLength(JSON.stringify(models))).toBeLessThanOrEqual(MAX_INSTALL_MODELS_BYTES)
    expect(models.length).toBeGreaterThan(1000)
    expect(models.length).toBeLessThan(MAX_INSTALL_MODELS)
  })

  it('keeps every folder kind when the cap cuts the list', async () => {
    const root = path.join(tmp, 'models')
    fs.mkdirSync(path.join(root, 'loras'), { recursive: true })
    for (let i = 0; i < MAX_INSTALL_MODELS + 5; i++) {
      fs.writeFileSync(path.join(root, 'loras', `m${String(i).padStart(5, '0')}.safetensors`), '')
    }
    writeFile(path.join(root, 'vae', 'ae.safetensors'))

    const { models } = await listModelsInSearch(search({ modelRoots: [root] }))

    expect(models).toHaveLength(MAX_INSTALL_MODELS)
    expect(models).toContainEqual({ folder: 'vae', name: 'ae.safetensors', size: 1 })
  })

  it('skips custom_nodes, output and cache folders nested inside a model folder', async () => {
    const root = path.join(tmp, 'models')
    writeFile(path.join(root, 'loras', 'keep.safetensors'))
    writeFile(path.join(root, 'loras', 'custom_nodes', 'pack', 'weights.bin'))
    writeFile(path.join(root, 'loras', 'output', 'run.pt'))
    writeFile(path.join(root, 'loras', '__pycache__', 'x.pkl'))
    writeFile(path.join(root, 'loras', 'models', 'nested.safetensors'))

    const { models } = await listModelsInSearch(search({ modelRoots: [root] }))

    expect(models).toEqual([
      { folder: 'loras', name: 'keep.safetensors', size: 1 },
      { folder: 'loras', name: 'models/nested.safetensors', size: 1 }
    ])
  })

  it('finds a folder first reached too deep when a shorter route reaches it later', async () => {
    const root = path.join(tmp, 'models')
    const shared = path.join(tmp, 'library')
    writeFile(path.join(shared, 'inner', 'found.safetensors'))
    let deep = path.join(root, 'checkpoints', 'a')
    for (let i = 0; i < 6; i++) deep = path.join(deep, 'a')
    fs.mkdirSync(deep, { recursive: true })
    fs.symlinkSync(shared, path.join(deep, 'link'), 'dir')
    fs.symlinkSync(shared, path.join(root, 'checkpoints', 'z'), 'dir')

    const { models } = await listModelsInSearch(search({ modelRoots: [root] }))

    expect(models).toContainEqual({
      folder: 'checkpoints',
      name: 'z/inner/found.safetensors',
      size: 1
    })
  })

  it('stops walking once the time budget is spent', async () => {
    const root = path.join(tmp, 'models')
    writeFile(path.join(root, 'loras', 'late.safetensors'))

    await expect(listModelsInSearch(search({ modelRoots: [root] }), 0)).resolves.toEqual({
      models: [],
      truncated: true
    })
  })

  it('reads no model root once the time budget is spent', async () => {
    const root = path.join(tmp, 'models')
    writeFile(path.join(root, 'loras', 'late.safetensors'))
    const readdir = vi.spyOn(fs.promises, 'readdir')

    try {
      const { truncated } = await listModelsInSearch(search({ modelRoots: [root, root] }), 0)

      expect(truncated).toBe(true)
      expect(readdir).not.toHaveBeenCalled()
    } finally {
      readdir.mockRestore()
    }
  })

  it('says the list was cut when a launch-arg model paths config cannot be read', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const root = path.join(tmp, 'models')
    writeFile(path.join(root, 'loras', 'open.safetensors'))
    const locked = path.join(tmp, 'locked.yaml')
    const missing = path.join(tmp, 'missing.yaml')
    writeFile(locked)
    const access = fs.promises.access.bind(fs.promises)
    const denied = vi
      .spyOn(fs.promises, 'access')
      .mockImplementation(((target: fs.PathLike, mode?: number) =>
        String(target) === locked
          ? Promise.reject(Object.assign(new Error('denied'), { code: 'EACCES' }))
          : access(target, mode)) as typeof fs.promises.access)

    try {
      const readable = await listModelsInSearch({
        ...search({ modelRoots: [root] }),
        configFiles: [missing]
      })
      const unreadable = await listModelsInSearch({
        ...search({ modelRoots: [root] }),
        configFiles: [locked]
      })

      expect(readable.truncated).toBe(false)
      expect(unreadable).toEqual({
        models: [{ folder: 'loras', name: 'open.safetensors', size: 1 }],
        truncated: true
      })
    } finally {
      denied.mockRestore()
      vi.mocked(console.warn).mockRestore()
    }
  })

  it('says the list is whole when nothing was cut', async () => {
    const root = path.join(tmp, 'models')
    writeFile(path.join(root, 'loras', 'one.safetensors'))

    const { truncated } = await listModelsInSearch(search({ modelRoots: [root] }))

    expect(truncated).toBe(false)
  })

  it('says the list was cut when the entry cap drops models', async () => {
    const root = path.join(tmp, 'models', 'loras')
    fs.mkdirSync(root, { recursive: true })
    for (let i = 0; i < MAX_INSTALL_MODELS + 1; i++) {
      fs.writeFileSync(path.join(root, `m${String(i).padStart(5, '0')}.safetensors`), '')
    }

    const { truncated } = await listModelsInSearch(
      search({ modelRoots: [path.join(tmp, 'models')] })
    )

    expect(truncated).toBe(true)
  })

  it('counts the name limit in characters, not bytes or UTF-16 units', async () => {
    const root = path.join(tmp, 'models')
    const nameOf = (character: string): string =>
      [...Array(3).fill(character.repeat(60)), `${character.repeat(60)}.safetensors`].join('/')
    const wide = nameOf('名')
    const astral = nameOf('🎨')
    writeFile(path.join(root, 'loras', ...wide.split('/')))
    writeFile(path.join(root, 'loras', ...astral.split('/')))
    writeFile(path.join(root, 'loras', ...`x${wide}`.split('/')))

    const { models } = await listModelsInSearch(search({ modelRoots: [root] }))

    expect([...wide]).toHaveLength(MAX_MODEL_NAME_LENGTH)
    expect(models.map((model) => model.name).sort()).toEqual([wide, astral].sort())
  })

  it.each([
    ['C1 control', '\u0085'],
    ['line separator', '\u2028'],
    ['right-to-left override', '\u202e'],
    ['first strong isolate', '\u2068']
  ])('leaves out a name with a %s', async (_label, character) => {
    const root = path.join(tmp, 'models')
    writeFile(path.join(root, 'loras', `a${character}gnp.safetensors`))

    const { models } = await listModelsInSearch(search({ modelRoots: [root] }))

    expect(models).toEqual([])
  })

  it('says the list was cut when a folder sits deeper than the walk goes', async () => {
    const root = path.join(tmp, 'models')
    writeFile(path.join(root, 'checkpoints', ...Array(9).fill('d'), 'deep.safetensors'))

    const result = await listModelsInSearch(search({ modelRoots: [root] }))

    expect(result).toEqual({ models: [], truncated: true })
  })

  it('says the list was cut and warns when a model folder cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const root = path.join(tmp, 'models')
    const locked = path.join(root, 'loras', 'locked')
    writeFile(path.join(locked, 'hidden.safetensors'))
    writeFile(path.join(root, 'loras', 'open.safetensors'))
    const readdir = fs.promises.readdir.bind(fs.promises)
    const denied = vi.spyOn(fs.promises, 'readdir').mockImplementation(((
      dir: fs.PathLike,
      options: unknown
    ) => {
      if (String(dir) === locked) {
        return Promise.reject(Object.assign(new Error('denied'), { code: 'EACCES' }))
      }
      return readdir(dir, options as { withFileTypes: true })
    }) as typeof fs.promises.readdir)

    try {
      const result = await listModelsInSearch(search({ modelRoots: [root] }))

      expect(result).toEqual({
        models: [{ folder: 'loras', name: 'open.safetensors', size: 1 }],
        truncated: true
      })
      expect(warn).toHaveBeenCalledWith(
        '[dev-platform] Some model folders could not be read; the models list is incomplete.'
      )
    } finally {
      denied.mockRestore()
      warn.mockRestore()
    }
  })

  it('reads a broken link as missing, not as an unreadable folder', async () => {
    const root = path.join(tmp, 'models')
    writeFile(path.join(root, 'loras', 'open.safetensors'))
    fs.symlinkSync(path.join(tmp, 'gone'), path.join(root, 'loras', 'broken'), 'dir')

    const result = await listModelsInSearch(search({ modelRoots: [root] }))

    expect(result).toEqual({
      models: [{ folder: 'loras', name: 'open.safetensors', size: 1 }],
      truncated: false
    })
  })

  it('returns nothing for a root that does not exist', async () => {
    await expect(
      listModelsInSearch(search({ modelRoots: [path.join(tmp, 'missing')] }))
    ).resolves.toEqual({ models: [], truncated: false })
  })
})

describe('listInstallModels', () => {
  it('logs and sends no models when the install record cannot be resolved', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await listInstallModels(installRecord(undefined as unknown as string), [])

    expect(result).toEqual({ models: [], truncated: true })
    expect(warn).toHaveBeenCalledWith(
      '[dev-platform] Could not list install models; sending none:',
      expect.anything()
    )
    warn.mockRestore()
  })

  it('walks the install models folder and the shared model folders', async () => {
    const installPath = path.join(tmp, 'install')
    const shared = path.join(tmp, 'shared-models')
    writeFile(path.join(installPath, 'ComfyUI', 'models', 'vae', 'own.safetensors'))
    writeFile(path.join(shared, 'loras', 'shared.safetensors'))

    const { models } = await listInstallModels(installRecord(installPath), [shared])

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

    const { models } = await listInstallModels(
      installRecord(installPath, { useSharedModels: false }),
      [shared]
    )

    expect(models).toEqual([{ folder: 'vae', name: 'own.safetensors', size: 1 }])
  })

  it('reads the model folders the install launch arguments name', async () => {
    const installPath = path.join(tmp, 'install')
    const modelsDirectory = path.join(tmp, 'flag-models')
    const baseDirectory = path.join(tmp, 'flag-base')
    const external = path.join(tmp, 'flag-extra')
    writeFile(path.join(modelsDirectory, 'loras', 'from-models-directory.safetensors'))
    writeFile(path.join(baseDirectory, 'models', 'vae', 'from-base-directory.safetensors'))
    writeFile(path.join(external, 'checkpoints', 'from-extra-config.safetensors'))
    const yamlPath = path.join(tmp, 'extra.yaml')
    fs.writeFileSync(
      yamlPath,
      `other:\n  base_path: ${JSON.stringify(external)}\n  checkpoints: checkpoints/\n`
    )

    const { models } = await listInstallModels(
      installRecord(installPath, {
        launchArgs: `--models-directory ${JSON.stringify(modelsDirectory)} --base-directory=${JSON.stringify(baseDirectory)} --extra-model-paths-config ${JSON.stringify(yamlPath)}`
      }),
      []
    )

    expect(models).toEqual([
      { folder: 'checkpoints', name: 'from-extra-config.safetensors', size: 1 },
      { folder: 'loras', name: 'from-models-directory.safetensors', size: 1 },
      { folder: 'vae', name: 'from-base-directory.safetensors', size: 1 }
    ])
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

    const { models } = await listInstallModels(installRecord(installPath), [])

    expect(models).toEqual([{ folder: 'checkpoints', name: 'far.safetensors', size: 1 }])
  })
})
