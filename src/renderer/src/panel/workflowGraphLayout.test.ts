import { describe, expect, it } from 'vitest'
import { layOutGraph } from './workflowGraphLayout'

const GRAPH = {
  nodes: [
    {
      id: 1,
      type: 'CheckpointLoaderSimple',
      pos: [0, 0],
      size: [300, 100],
      outputs: [
        { name: 'MODEL', type: 'MODEL', links: [1] },
        { name: 'CLIP', type: 'CLIP', links: [] }
      ],
      inputs: [{ name: 'ckpt_name', type: 'COMBO', widget: { name: 'ckpt_name' }, link: null }],
      widgets_values: ['flux.safetensors']
    },
    {
      id: 2,
      type: 'KSampler',
      title: 'Sampler',
      pos: { 0: 400, 1: 50 },
      size: [300, 200],
      inputs: [
        { name: 'model', type: 'MODEL', link: 1 },
        { name: 'seed', type: 'INT', widget: { name: 'seed' }, link: null }
      ],
      outputs: [],
      widgets_values: [42, 'randomize']
    },
    { id: 3, type: 'MarkdownNote', pos: [-900, -900], size: [100, 100] }
  ],
  links: [[1, 1, 0, 2, 0, 'MODEL']],
  groups: [{ title: 'Load', bounding: [-20, -60, 360, 200], color: '#3f789e' }]
}

describe('drawing a catalog workflow’s graph', () => {
  it('places nodes, their linked slots and widget values, and leaves notes out', () => {
    const layout = layOutGraph(GRAPH)!

    expect(layout.nodes.map(({ id, title }) => [id, title])).toEqual([
      ['1', 'CheckpointLoaderSimple'],
      ['2', 'Sampler']
    ])
    expect(layout.nodes[1]!.inputs.map(({ name }) => name)).toEqual(['model'])
    expect(layout.nodes[0]!.widgets).toMatchObject([
      { label: 'ckpt_name', value: 'flux.safetensors' }
    ])
    expect(layout.nodes[1]!.widgets.map(({ value }) => value)).toEqual(['42', 'randomize'])
  })

  it('joins an output to the input it feeds', () => {
    const [link] = layOutGraph(GRAPH)!.links

    expect(link).toMatchObject({ type: 'MODEL' })
    expect(link!.path.startsWith('M300,12')).toBe(true)
    expect(link!.path.endsWith('400,62')).toBe(true)
  })

  it('frames every node and group', () => {
    expect(layOutGraph(GRAPH)!.bounds).toEqual({ x: -20, y: -60, width: 720, height: 310 })
  })

  it('draws nothing for a graph with no nodes', () => {
    expect(layOutGraph({ nodes: [] })).toBeNull()
    expect(layOutGraph(null)).toBeNull()
  })
})
