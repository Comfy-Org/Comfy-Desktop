import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/userdata' },
  ipcMain: { handle: vi.fn() },
}))

// resolveTemplateInputAssets reads the workflow JSON via loadTemplateJson; stub
// it so we can feed crafted docs and assert the Load*-node scan + safety guards.
const loadTemplateJson = vi.fn()
vi.mock('./templateModels', () => ({
  loadTemplateJson: (...a: unknown[]) => loadTemplateJson(...a),
}))

import { resolveTemplateInputAssets, resolveInputDir } from './templateInputAssets'
import { TEMPLATE_INPUT_BASE } from './curatedTemplates'
import type { InstallationRecord } from '../../installations'

const inst = { id: 'i1', bundledTemplateId: 't' } as unknown as InstallationRecord

const loadNode = (type: string, filename: unknown) => ({ type, widgets_values: [filename] })

beforeEach(() => loadTemplateJson.mockReset())

describe('resolveTemplateInputAssets', () => {
  it('derives the input filename from a LoadImage node and points at the repo input dir', async () => {
    loadTemplateJson.mockResolvedValue({ nodes: [loadNode('LoadImage', 'white-hotel-on-rocky-island.png')] })
    const assets = await resolveTemplateInputAssets(inst, 't')
    expect(assets).toEqual([
      {
        filename: 'white-hotel-on-rocky-island.png',
        url: `${TEMPLATE_INPUT_BASE}/white-hotel-on-rocky-island.png`,
      },
    ])
  })

  it('scans nodes inside subgraph definitions', async () => {
    loadTemplateJson.mockResolvedValue({
      nodes: [],
      definitions: { subgraphs: [{ nodes: [loadNode('LoadImage', 'subject.png')] }] },
    })
    const assets = await resolveTemplateInputAssets(inst, 't')
    expect(assets.map((a) => a.filename)).toEqual(['subject.png'])
  })

  it('covers video and audio loaders, not just images', async () => {
    loadTemplateJson.mockResolvedValue({
      nodes: [loadNode('LoadVideo', 'clip.mp4'), loadNode('LoadAudio', 'voice.mp3')],
    })
    expect((await resolveTemplateInputAssets(inst, 't')).map((a) => a.filename)).toEqual([
      'clip.mp4',
      'voice.mp3',
    ])
  })

  it('de-duplicates a filename referenced by multiple nodes', async () => {
    loadTemplateJson.mockResolvedValue({
      nodes: [loadNode('LoadImage', 'dup.png'), loadNode('LoadImage', 'dup.png')],
    })
    expect(await resolveTemplateInputAssets(inst, 't')).toHaveLength(1)
  })

  it('rejects path-traversal and absolute names', async () => {
    loadTemplateJson.mockResolvedValue({
      nodes: [
        loadNode('LoadImage', '../escape.png'),
        loadNode('LoadImage', 'sub/dir.png'),
        loadNode('LoadImage', 'C:\\evil.png'),
      ],
    })
    expect(await resolveTemplateInputAssets(inst, 't')).toEqual([])
  })

  it('rejects non-media extensions (no arbitrary payloads through input/)', async () => {
    loadTemplateJson.mockResolvedValue({
      nodes: [loadNode('LoadImage', 'weights.safetensors'), loadNode('LoadImage', 'script.py')],
    })
    expect(await resolveTemplateInputAssets(inst, 't')).toEqual([])
  })

  it('ignores non-loader nodes and non-string widget values', async () => {
    loadTemplateJson.mockResolvedValue({
      nodes: [loadNode('KSampler', 'not-an-input.png'), loadNode('LoadImage', 42)],
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
})

describe('resolveInputDir', () => {
  it('uses the per-install dir when input/output is not shared', () => {
    const rec = { useSharedInputOutput: false, inputDir: '/custom/in' } as unknown as InstallationRecord
    expect(resolveInputDir(rec)).toBe('/custom/in')
  })

  it('falls back to <installPath>/ComfyUI/input when isolated with no override', () => {
    const rec = { useSharedInputOutput: false, installPath: '/apps/c' } as unknown as InstallationRecord
    expect(resolveInputDir(rec)).toMatch(/[/\\]apps[/\\]c[/\\]ComfyUI[/\\]input$/)
  })
})
