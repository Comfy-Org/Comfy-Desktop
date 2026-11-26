import { describe, expect, it } from 'vitest'

import { summarizeWorkflow } from './workflowSummary'

function graph(nodes: Record<string, unknown>[]): Parameters<typeof summarizeWorkflow>[0] {
  return { format: 'graph', data: { nodes } }
}

function api(nodes: Record<string, unknown>): Parameters<typeof summarizeWorkflow>[0] {
  return { format: 'api', data: nodes }
}

describe('summarizeWorkflow', () => {
  it('names a model loaded from a full path on disk by its file name only', () => {
    expect(
      summarizeWorkflow(
        graph([
          {
            id: 1,
            type: 'CheckpointLoaderSimple',
            widgets_values: ['/Users/me/models/base.safetensors']
          },
          { id: 2, type: 'LoraLoader', widgets_values: ['C:\\Comfy\\loras\\grain.safetensors'] },
          { id: 3, type: 'LoraLoader', widgets_values: ['\\\\nas\\models\\shared.ckpt'] },
          { id: 4, type: 'LoraLoader', widgets_values: ['~/models/home.gguf'] },
          { id: 5, type: 'VAELoader', widgets_values: ['sdxl/vae.safetensors'] }
        ])
      ).models
    ).toEqual([
      'base.safetensors',
      'grain.safetensors',
      'shared.ckpt',
      'home.gguf',
      'sdxl/vae.safetensors'
    ])
  })

  it('takes the prompts and the model files out of a saved graph', () => {
    expect(
      summarizeWorkflow(
        graph([
          { id: 1, type: 'CheckpointLoaderSimple', widgets_values: ['sdxl/base.safetensors'] },
          { id: 2, type: 'LoraLoader', widgets_values: ['film-grain.safetensors', 0.8, 1] },
          { id: 3, type: 'CLIPTextEncode', widgets_values: ['a harbor at dusk'] },
          { id: 4, type: 'CLIPTextEncode', widgets_values: ['blurry, watermark'] },
          { id: 5, type: 'KSampler', widgets_values: [42, 'randomize', 20, 7.5] },
          { id: 6, type: 'SaveImage', widgets_values: ['ComfyUI'] }
        ])
      )
    ).toEqual({
      models: ['sdxl/base.safetensors', 'film-grain.safetensors'],
      prompts: ['a harbor at dusk', 'blurry, watermark']
    })
  })

  it('reads the same two lists out of an API workflow', () => {
    expect(
      summarizeWorkflow(
        api({
          '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'flux1-dev.sft' } },
          '6': { class_type: 'CLIPTextEncode', inputs: { text: 'a paper crane', clip: ['4', 1] } },
          '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'ComfyUI' } }
        })
      )
    ).toEqual({ models: ['flux1-dev.sft'], prompts: ['a paper crane'] })
  })

  it('keeps each name and each prompt once, and leaves blank text out', () => {
    expect(
      summarizeWorkflow(
        graph([
          { id: 1, type: 'CheckpointLoaderSimple', widgets_values: ['base.ckpt'] },
          { id: 2, type: 'CheckpointLoaderSimple', widgets_values: ['base.ckpt'] },
          { id: 3, type: 'CLIPTextEncode', widgets_values: ['  '] },
          { id: 4, type: 'CLIPTextEncode', widgets_values: ['a cat'] },
          { id: 5, type: 'CLIPTextEncode', widgets_values: ['a cat'] }
        ])
      )
    ).toEqual({ models: ['base.ckpt'], prompts: ['a cat'] })
  })

  it('cuts a very long prompt and stops after six of them', () => {
    const long = 'x'.repeat(2500)
    const summary = summarizeWorkflow(
      graph(
        Array.from({ length: 8 }, (_, at) => ({
          id: at,
          type: 'CLIPTextEncode',
          widgets_values: [at === 0 ? long : `prompt ${at}`]
        }))
      )
    )

    expect(summary.prompts).toHaveLength(6)
    expect(summary.prompts[0]).toBe(`${'x'.repeat(2000)}…`)
  })

  it('gives empty lists for a workflow with neither', () => {
    expect(summarizeWorkflow(graph([{ id: 1, type: 'PreviewImage', widgets_values: [] }]))).toEqual(
      {
        models: [],
        prompts: []
      }
    )
  })
})
