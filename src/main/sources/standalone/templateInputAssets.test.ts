import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/userdata' },
  ipcMain: { handle: vi.fn() }
}))

// resolveTemplateInputAssets reads the workflow JSON via loadTemplateJson; stub
// it so we can feed crafted docs and assert the Load*-node scan + safety guards.
const loadTemplateJson = vi.fn()
vi.mock('./templateModels', () => ({
  loadTemplateJson: (...a: unknown[]) => loadTemplateJson(...a)
}))

import * as templateInputAssets from './templateInputAssets'
import { TEMPLATE_INPUT_BASE } from './curatedTemplates'
import type { InstallationRecord } from '../../installations'

const { resolveTemplateInputAssets, resolveInputDir } = templateInputAssets
const resolveTemplateInputAssetSnapshot =
  (
    templateInputAssets as typeof templateInputAssets & {
      resolveTemplateInputAssetSnapshot?: (
        installation: InstallationRecord,
        templateId: string
      ) => Promise<unknown>
    }
  ).resolveTemplateInputAssetSnapshot ?? resolveTemplateInputAssets
const resolveTemplateInputAssetAvailability =
  (
    templateInputAssets as typeof templateInputAssets & {
      resolveTemplateInputAssetAvailability?: (
        installation: InstallationRecord,
        filenames: readonly string[],
        dependencies: { access: (filePath: string) => Promise<void> }
      ) => Promise<unknown>
    }
  ).resolveTemplateInputAssetAvailability ?? (async () => [])

const inst = { id: 'i1', bundledTemplateId: 't' } as unknown as InstallationRecord

const loadNode = (type: string, filename: unknown) => ({ type, widgets_values: [filename] })

beforeEach(() => loadTemplateJson.mockReset())

describe('resolveTemplateInputAssets', () => {
  it('derives trusted preview metadata from a declared LoadImage input', async () => {
    loadTemplateJson.mockResolvedValue({
      nodes: [loadNode('LoadImage', 'white-hotel-on-rocky-island.png')]
    })
    const assets = await resolveTemplateInputAssets(inst, 't')
    expect(assets).toEqual([
      {
        assetId: 'white-hotel-on-rocky-island.png',
        filename: 'white-hotel-on-rocky-island.png',
        mediaType: 'image',
        previewUrl: `${TEMPLATE_INPUT_BASE}/white-hotel-on-rocky-island.png`,
        url: `${TEMPLATE_INPUT_BASE}/white-hotel-on-rocky-island.png`
      }
    ])
  })

  it('scans nodes inside subgraph definitions', async () => {
    loadTemplateJson.mockResolvedValue({
      nodes: [],
      definitions: { subgraphs: [{ nodes: [loadNode('LoadImage', 'subject.png')] }] }
    })
    const assets = await resolveTemplateInputAssets(inst, 't')
    expect(assets.map((a) => a.filename)).toEqual(['subject.png'])
  })

  it('covers video and audio loaders, not just images', async () => {
    loadTemplateJson.mockResolvedValue({
      nodes: [loadNode('LoadVideo', 'clip.mp4'), loadNode('LoadAudio', 'voice.mp3')]
    })
    expect(await resolveTemplateInputAssets(inst, 't')).toMatchObject([
      { filename: 'clip.mp4', mediaType: 'video' },
      { filename: 'voice.mp3', mediaType: 'audio' }
    ])
  })

  it('de-duplicates a filename referenced by multiple nodes', async () => {
    loadTemplateJson.mockResolvedValue({
      nodes: [loadNode('LoadImage', 'dup.png'), loadNode('LoadImage', 'dup.png')]
    })
    expect(await resolveTemplateInputAssets(inst, 't')).toHaveLength(1)
  })

  it('rejects path-traversal and absolute names', async () => {
    loadTemplateJson.mockResolvedValue({
      nodes: [
        loadNode('LoadImage', '../escape.png'),
        loadNode('LoadImage', 'sub/dir.png'),
        loadNode('LoadImage', 'C:\\evil.png')
      ]
    })
    expect(await resolveTemplateInputAssets(inst, 't')).toEqual([])
  })

  it('rejects non-media extensions (no arbitrary payloads through input/)', async () => {
    loadTemplateJson.mockResolvedValue({
      nodes: [loadNode('LoadImage', 'weights.safetensors'), loadNode('LoadImage', 'script.py')]
    })
    expect(await resolveTemplateInputAssets(inst, 't')).toEqual([])
  })

  it('ignores non-loader nodes and non-string widget values', async () => {
    loadTemplateJson.mockResolvedValue({
      nodes: [loadNode('KSampler', 'not-an-input.png'), loadNode('LoadImage', 42)]
    })
    expect(await resolveTemplateInputAssets(inst, 't')).toEqual([])
  })

  it('strips query params before validating + naming', async () => {
    loadTemplateJson.mockResolvedValue({ nodes: [loadNode('LoadImage', 'a.png?v=2')] })
    expect((await resolveTemplateInputAssets(inst, 't'))[0]!.filename).toBe('a.png')
  })

  it('returns [] when the workflow JSON cannot be resolved', async () => {
    loadTemplateJson.mockResolvedValue(null)
    expect(await resolveTemplateInputAssets(inst, 't')).toEqual([])
  })

  it('keeps unresolved metadata distinct from a resolved template with no inputs', async () => {
    loadTemplateJson.mockResolvedValue(null)

    await expect(resolveTemplateInputAssetSnapshot(inst, 't')).resolves.toBeNull()
    await expect(resolveTemplateInputAssets(inst, 't')).resolves.toEqual([])
  })
})

describe('resolveInputDir', () => {
  it('uses the per-install dir when input is not shared', () => {
    const rec = {
      useSharedInput: false,
      inputDir: '/custom/in'
    } as unknown as InstallationRecord
    expect(resolveInputDir(rec)).toBe('/custom/in')
  })

  it('falls back to <installPath>/ComfyUI/input when isolated with no override', () => {
    const rec = {
      useSharedInput: false,
      installPath: '/apps/c'
    } as unknown as InstallationRecord
    expect(resolveInputDir(rec)).toMatch(/[/\\]apps[/\\]c[/\\]ComfyUI[/\\]input$/)
  })
})

describe('resolveTemplateInputAssetAvailability', () => {
  it('distinguishes exact files already present in the active input directory', async () => {
    const access = vi.fn(async (filePath: string) => {
      if (filePath.endsWith('present.png')) return
      const error = new Error('missing') as NodeJS.ErrnoException
      error.code = 'ENOENT'
      throw error
    })

    await expect(
      resolveTemplateInputAssetAvailability(
        {
          useSharedInput: false,
          inputDir: '/inputs'
        } as unknown as InstallationRecord,
        ['present.png', 'missing.png'],
        { access }
      )
    ).resolves.toEqual([
      { filename: 'present.png', status: 'present' },
      { filename: 'missing.png', status: 'missing' }
    ])
  })

  it('rejects unsafe and duplicate declarations without probing outside input', async () => {
    const access = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }))

    await expect(
      resolveTemplateInputAssetAvailability(
        {
          useSharedInput: false,
          inputDir: '/inputs'
        } as unknown as InstallationRecord,
        ['safe.png', '../escape.png', 'safe.png', 'weights.safetensors'],
        { access }
      )
    ).resolves.toEqual([{ filename: 'safe.png', status: 'missing' }])
    expect(access).toHaveBeenCalledTimes(1)
  })

  it('keeps non-ENOENT filesystem failures unknown instead of claiming missing', async () => {
    const access = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('permission denied'), { code: 'EACCES' }))

    await expect(
      resolveTemplateInputAssetAvailability(
        {
          useSharedInput: false,
          inputDir: '/inputs'
        } as unknown as InstallationRecord,
        ['private.png'],
        { access }
      )
    ).resolves.toEqual([{ filename: 'private.png', status: 'unknown' }])
  })
})
