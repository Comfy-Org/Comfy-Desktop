// @vitest-environment node
import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

import { isGraphWorkflow, readEmbeddedWorkflow } from './embeddedWorkflow'

const GRAPH = {
  last_node_id: 2,
  nodes: [
    { id: 1, type: 'CLIPTextEncode', widgets_values: ['a red fox {in snow}'] },
    { id: 2, type: 'SaveImage', widgets_values: ['ComfyUI'] }
  ],
  links: []
}
const PROMPT = {
  '1': { class_type: 'CLIPTextEncode', inputs: { text: 'a red fox' } },
  '2': { class_type: 'SaveImage', inputs: { images: ['1', 0] } }
}
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const encoder = new TextEncoder()

function concat(...parts: Uint8Array[]): Uint8Array {
  const all = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    all.set(part, at)
    at += part.length
  }
  return all
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const length = new Uint8Array(4)
  new DataView(length.buffer).setUint32(0, data.length)
  return concat(length, encoder.encode(type), data, new Uint8Array(4))
}

function png(...chunks: Uint8Array[]): Uint8Array {
  return concat(
    new Uint8Array(PNG_SIGNATURE),
    chunk('IHDR', new Uint8Array(13)),
    ...chunks,
    chunk('IDAT', encoder.encode('{"nodes":[{"id":9,"type":"Hidden"}]}')),
    chunk('IEND', new Uint8Array())
  )
}

function tEXt(key: string, text: string): Uint8Array {
  return chunk('tEXt', concat(encoder.encode(key), new Uint8Array([0]), encoder.encode(text)))
}

function zTXt(key: string, text: string): Uint8Array {
  return chunk(
    'zTXt',
    concat(encoder.encode(key), new Uint8Array([0, 0]), deflateSync(encoder.encode(text)))
  )
}

function iTXt(key: string, text: string, compressed: boolean): Uint8Array {
  const body = compressed ? deflateSync(encoder.encode(text)) : encoder.encode(text)
  return chunk(
    'iTXt',
    concat(encoder.encode(key), new Uint8Array([0, compressed ? 1 : 0, 0, 0, 0]), body)
  )
}

function binary(...texts: string[]): Uint8Array {
  const noise = new Uint8Array([0x00, 0x7b, 0xff, 0x22, 0x01, 0x7d, 0x9c])
  return concat(noise, ...texts.flatMap((text) => [encoder.encode(text), noise]))
}

describe('a ComfyUI graph workflow', () => {
  it('has a list of nodes that each have an id and a type', () => {
    expect(isGraphWorkflow(GRAPH)).toBe(true)
    expect(isGraphWorkflow({ nodes: [] })).toBe(false)
    expect(isGraphWorkflow({ nodes: [{ id: 1 }] })).toBe(false)
    expect(isGraphWorkflow(PROMPT)).toBe(false)
    expect(isGraphWorkflow(null)).toBe(false)
  })
})

describe('reading the workflow ComfyUI saved in a PNG', () => {
  it('prefers the graph over the prompt, so the layout opens as it was saved', () => {
    const file = png(
      tEXt('prompt', JSON.stringify(PROMPT)),
      tEXt('workflow', JSON.stringify(GRAPH))
    )

    expect(readEmbeddedWorkflow([file])).toEqual({ format: 'graph', data: GRAPH })
  })

  it('uses the prompt when the PNG has no graph', () => {
    expect(readEmbeddedWorkflow([png(tEXt('prompt', JSON.stringify(PROMPT)))])).toEqual({
      format: 'api',
      data: PROMPT
    })
  })

  it('reads compressed and international text chunks', () => {
    for (const text of [
      zTXt('workflow', JSON.stringify(GRAPH)),
      iTXt('workflow', JSON.stringify(GRAPH), true),
      iTXt('workflow', JSON.stringify(GRAPH), false)
    ]) {
      expect(readEmbeddedWorkflow([png(text)])).toEqual({ format: 'graph', data: GRAPH })
    }
  })

  it('reads text chunks saved after the picture data', () => {
    const file = concat(
      new Uint8Array(PNG_SIGNATURE),
      chunk('IHDR', new Uint8Array(13)),
      chunk('IDAT', new Uint8Array([0x78, 0x9c, 0x00])),
      tEXt('workflow', JSON.stringify(GRAPH)),
      chunk('IEND', new Uint8Array())
    )

    expect(readEmbeddedWorkflow([file])).toEqual({ format: 'graph', data: GRAPH })
  })

  it('finds nothing in a PNG without a workflow, even when the picture data looks like one', () => {
    expect(readEmbeddedWorkflow([png(tEXt('parameters', 'a red fox, 20 steps'))])).toBeNull()
  })

  it('does not unpack compressed text under other names, and stops unpacking past a total size', () => {
    const big = 'x'.repeat(9_000_000)
    const file = png(
      zTXt('comment', big),
      zTXt('workflow', big),
      zTXt('prompt', big),
      tEXt('workflow', JSON.stringify(GRAPH))
    )

    expect(readEmbeddedWorkflow([file])).toEqual({ format: 'graph', data: GRAPH })
  })

  it('finds nothing in text that is not valid JSON', () => {
    expect(readEmbeddedWorkflow([png(tEXt('workflow', '{"nodes": ['))])).toBeNull()
  })
})

describe('reading the workflow ComfyUI saved in other files', () => {
  it('reads the EXIF text of an animated WEBP', () => {
    const webp = binary(
      'RIFF....WEBPVP8X',
      `EXIF..Workflow:${JSON.stringify(GRAPH)}`,
      `Prompt:${JSON.stringify(PROMPT)}`
    )

    expect(readEmbeddedWorkflow([webp])).toEqual({ format: 'graph', data: GRAPH })
  })

  it('reads the comments of a FLAC sound', () => {
    const flac = binary(
      'fLaC',
      `prompt=${JSON.stringify(PROMPT)}`,
      `workflow=${JSON.stringify(GRAPH)}`
    )

    expect(readEmbeddedWorkflow([flac])).toEqual({ format: 'graph', data: GRAPH })
  })

  it('reads a video comment that holds the prompt as a string and the graph as an object', () => {
    const comment = JSON.stringify({ prompt: JSON.stringify(PROMPT), workflow: GRAPH })

    expect(readEmbeddedWorkflow([binary('ftypisom'), binary('moov', comment)])).toEqual({
      format: 'graph',
      data: GRAPH
    })
  })

  it('reads a video comment that only holds the prompt as a string', () => {
    const comment = JSON.stringify({ prompt: JSON.stringify(PROMPT) })

    expect(readEmbeddedWorkflow([binary('ftypisom', comment)])).toEqual({
      format: 'api',
      data: PROMPT
    })
  })

  it('prefers a graph at the end of a file over a prompt at its start', () => {
    const head = binary('ftypisom', `prompt=${JSON.stringify(PROMPT)}`)
    const tail = binary('moov', `workflow=${JSON.stringify(GRAPH)}`)

    expect(readEmbeddedWorkflow([head, tail])).toEqual({ format: 'graph', data: GRAPH })
  })

  it('finds nothing in a file with no workflow', () => {
    expect(readEmbeddedWorkflow([binary('ftypisom', '{"title":"holiday"}', '{broken')])).toBeNull()
    expect(readEmbeddedWorkflow([])).toBeNull()
  })
})

describe('reading a file made to be slow to read', () => {
  it('stops after a fixed amount of work, even before a later part that holds a workflow', () => {
    const short = encoder.encode('{"'.repeat(2_000))
    const endless = encoder.encode('{"'.repeat(2 * 1024 * 1024))
    const workflow = binary(`workflow=${JSON.stringify(GRAPH)}`)

    expect(readEmbeddedWorkflow([short, workflow])).toEqual({ format: 'graph', data: GRAPH })
    expect(readEmbeddedWorkflow([endless, workflow])).toBeNull()
  })
})
