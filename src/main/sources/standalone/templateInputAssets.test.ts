import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let sharedInputDir = ''
let bundledAssetDir = ''
let settingsThrows = false

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '/tmp/userdata' } }))
vi.mock('../../settings', () => ({
  get: (key: string) => {
    if (settingsThrows) throw new Error('settings store unreadable')
    return key === 'inputDir' ? sharedInputDir : undefined
  },
  defaults: { get inputDir() { return sharedInputDir } },
}))
vi.mock('../../lib/bundledScript', () => ({
  getBundledTemplateAssetPath: (name: string) => path.join(bundledAssetDir, name),
}))

import { resolveInputDir, copyTemplateInputAssets } from './templateInputAssets'
import { BUNDLED_TEMPLATES } from './bundledTemplates'
import type { InstallationRecord } from '../../installations'

const noopLog = (): void => {}

/** The one template that ships an input image today. */
const tripoSplat = BUNDLED_TEMPLATES.find((t) => t.id === '3d_triposplat_image_to_gaussian_splat')!
const assetName = tripoSplat.inputAssets![0]!

function inst(over: Partial<InstallationRecord> = {}): InstallationRecord {
  return { id: 'i1', installPath: '/installs/i1', ...over } as InstallationRecord
}

describe('resolveInputDir', () => {
  it('uses the shared global input dir by default', () => {
    expect(resolveInputDir(inst())).toBe(sharedInputDir)
  })

  it('uses the per-install dir when shared input/output is off', () => {
    const i = inst({ useSharedInputOutput: false, inputDir: '/custom/input' })
    expect(resolveInputDir(i)).toBe('/custom/input')
  })

  it('falls back to <installPath>/ComfyUI/input when shared is off and no per-install dir', () => {
    const i = inst({ useSharedInputOutput: false })
    expect(resolveInputDir(i)).toBe(path.join('/installs/i1', 'ComfyUI', 'input'))
  })
})

describe('copyTemplateInputAssets', () => {
  let workdir = ''

  beforeEach(() => {
    settingsThrows = false
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-input-'))
    sharedInputDir = path.join(workdir, 'input')
    bundledAssetDir = path.join(workdir, 'bundled')
    fs.mkdirSync(bundledAssetDir, { recursive: true })
    fs.writeFileSync(path.join(bundledAssetDir, assetName), 'PNGBYTES')
  })

  afterEach(() => {
    fs.rmSync(workdir, { recursive: true, force: true })
  })

  it('copies the bundled input image into the resolved input dir', async () => {
    const result = await copyTemplateInputAssets(inst(), tripoSplat.id, noopLog)

    expect(result).toEqual([{ filename: assetName, copied: true }])
    const dest = path.join(sharedInputDir, assetName)
    expect(fs.readFileSync(dest, 'utf-8')).toBe('PNGBYTES')
  })

  it('is a no-op for templates with no input assets', async () => {
    const imageTpl = BUNDLED_TEMPLATES.find((t) => t.modality === 'image')!
    expect(imageTpl.inputAssets).toBeUndefined()
    const result = await copyTemplateInputAssets(inst(), imageTpl.id, noopLog)
    expect(result).toEqual([])
  })

  it('skips an asset that is already present (idempotent)', async () => {
    fs.mkdirSync(sharedInputDir, { recursive: true })
    fs.writeFileSync(path.join(sharedInputDir, assetName), 'EXISTING')

    const result = await copyTemplateInputAssets(inst(), tripoSplat.id, noopLog)

    expect(result).toEqual([{ filename: assetName, copied: false }])
    expect(fs.readFileSync(path.join(sharedInputDir, assetName), 'utf-8')).toBe('EXISTING')
  })

  it('never throws when the bundled source file is missing', async () => {
    fs.rmSync(path.join(bundledAssetDir, assetName))
    const result = await copyTemplateInputAssets(inst(), tripoSplat.id, noopLog)
    expect(result).toEqual([])
    expect(fs.existsSync(path.join(sharedInputDir, assetName))).toBe(false)
  })

  it('returns [] for an unknown template id', async () => {
    const result = await copyTemplateInputAssets(inst(), 'no_such_template', noopLog)
    expect(result).toEqual([])
  })

  it('never throws when the input dir cannot be resolved', async () => {
    settingsThrows = true
    const result = await copyTemplateInputAssets(inst(), tripoSplat.id, noopLog)
    expect(result).toEqual([])
  })
})
