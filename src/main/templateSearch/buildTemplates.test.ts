import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() }
}))
vi.mock('../lib/fetch', () => ({ fetchJSON: vi.fn() }))

import { readBuildTemplates, type HasModel } from './buildTemplates'

function onDiskIn(...roots: string[]): HasModel {
  return async (directory, filename) =>
    roots.some((root) => fs.existsSync(path.join(root, directory, filename)))
}

let root: string
let sitePackages: string
let models: string

function write(file: string, content: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content))
}

function model(name: string, directory = 'checkpoints') {
  return { name, url: `https://huggingface.co/org/repo/resolve/main/${name}`, directory }
}

function index(...templates: { name: string; title?: string; mediaSubtype?: string }[]) {
  return [{ moduleName: 'default', title: 'Image', templates }]
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'build-templates-'))
  sitePackages = path.join(root, 'site-packages')
  models = path.join(root, 'models')
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('readBuildTemplates', () => {
  it('counts a template as installed only when every model it lists is on disk', async () => {
    const dir = path.join(sitePackages, 'comfyui_workflow_templates_json', 'templates')
    write(path.join(dir, 'index.json'), index({ name: 'poster' }, { name: 'video' }))
    write(path.join(dir, 'poster.json'), { models: [model('sdxl.safetensors')] })
    write(path.join(dir, 'video.json'), { models: [model('wan.safetensors', 'diffusion_models')] })
    write(path.join(models, 'checkpoints', 'sdxl.safetensors'), 'x')

    expect((await readBuildTemplates(sitePackages, onDiskIn(models))).installed).toEqual(['poster'])
  })

  it('needs every model a template lists, not just one of them', async () => {
    const dir = path.join(sitePackages, 'comfyui_workflow_templates_json', 'templates')
    write(path.join(dir, 'index.json'), index({ name: 'video' }))
    write(path.join(dir, 'video.json'), {
      models: [model('wan.safetensors', 'diffusion_models'), model('vae.safetensors', 'vae')]
    })
    write(path.join(models, 'diffusion_models', 'wan.safetensors'), 'x')
    expect((await readBuildTemplates(sitePackages, onDiskIn(models))).installed).toEqual([])

    write(path.join(models, 'vae', 'vae.safetensors'), 'x')
    expect((await readBuildTemplates(sitePackages, onDiskIn(models))).installed).toEqual(['video'])
  })

  it('finds a model in any of the model folders it is given', async () => {
    const dir = path.join(sitePackages, 'comfyui_workflow_templates_json', 'templates')
    write(path.join(dir, 'index.json'), index({ name: 'poster' }))
    write(path.join(dir, 'poster.json'), { models: [model('sdxl.safetensors')] })
    const shared = path.join(root, 'shared-models')
    write(path.join(shared, 'checkpoints', 'sdxl.safetensors'), 'x')

    expect((await readBuildTemplates(sitePackages, onDiskIn(models, shared))).installed).toEqual([
      'poster'
    ])
  })

  it('counts a template that needs no local model as installed, and one with no workflow file as not', async () => {
    const dir = path.join(sitePackages, 'comfyui_workflow_templates_json', 'templates')
    write(path.join(dir, 'index.json'), index({ name: 'api_partner' }, { name: 'missing' }))
    write(path.join(dir, 'api_partner.json'), { nodes: [] })

    expect((await readBuildTemplates(sitePackages, onDiskIn(models))).installed).toEqual([
      'api_partner'
    ])
  })

  it('labels each template with its title and a picture thumbnail, none for audio', async () => {
    const dir = path.join(sitePackages, 'comfyui_workflow_templates_json', 'templates')
    write(
      path.join(dir, 'index.json'),
      index(
        { name: 'poster', title: 'Bake sale poster', mediaSubtype: 'png' },
        { name: 'song', title: 'A song', mediaSubtype: 'mp3' },
        { name: 'untitled' }
      )
    )
    const { labels } = await readBuildTemplates(sitePackages, onDiskIn(models))
    expect(labels.get('poster')).toEqual({
      title: 'Bake sale poster',
      thumbnailUrl: expect.stringMatching(/\/poster-1\.png$/)
    })
    expect(labels.get('song')).toEqual({ title: 'A song', thumbnailUrl: null })
    expect(labels.get('untitled')?.title).toBe('untitled')
  })

  it('reads the older layout, with the index and workflows in the main template package', async () => {
    const dir = path.join(sitePackages, 'comfyui_workflow_templates', 'templates')
    write(path.join(dir, 'index.json'), index({ name: 'poster' }))
    write(path.join(dir, 'poster.json'), { nodes: [] })

    expect((await readBuildTemplates(sitePackages, onDiskIn(models))).installed).toEqual(['poster'])
  })

  it('knows no templates in a build without a template package', async () => {
    expect(await readBuildTemplates(sitePackages, onDiskIn(models))).toEqual({
      installed: [],
      labels: new Map()
    })
  })
})
