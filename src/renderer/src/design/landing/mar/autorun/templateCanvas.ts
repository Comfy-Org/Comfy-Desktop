import { createNode, type Group, type Link, type SNode } from '../graph/canvasData'
import type { GraphAutorun } from '../graph/graphOpen'

const link = (from: string, to: string, inp = 0): Link => ({
  id: `${from}>${to}:${inp}`,
  from,
  out: 0,
  to,
  in: inp
})

export function autorunCanvas(a: GraphAutorun): { nodes: SNode[]; links: Link[]; groups: Group[] } {
  const prompt = createNode('prompt', 40, 60, 'prompt')
  prompt.text = a.prompt
  const gen = createNode(a.video ? 'generateVideo' : 'generate', 420, 60, 'gen')
  gen.title = a.model
  const model = gen.controls.find((c) => c.kind === 'model')
  if (model?.kind === 'model') model.value = a.model
  const out = createNode('output', 830, 60, 'out')
  out.image = undefined
  out.chip = undefined
  const nodes = [prompt, gen, out]
  const links = [link('prompt', 'gen'), link('gen', 'out')]
  if (a.input !== undefined) {
    const ref = createNode('image', 40, 300, 'ref')
    ref.title = 'Example image'
    if (a.input) {
      ref.image = a.input
      ref.chip = 'example.png'
    }
    nodes.splice(1, 0, ref)
    links.push(link('ref', 'gen', 1))
  }
  return { nodes, links, groups: [] }
}

export function addOwnImage(nodes: SNode[], links: Link[]): SNode | undefined {
  const have = nodes.find((n) => n.id === 'ref')
  if (have) return have
  const gen = nodes.find((n) => n.id === 'gen')
  if (!gen) return undefined
  const ref = createNode('image', 40, 300, 'ref')
  nodes.push(ref)
  links.push(link('ref', 'gen', 1))
  return ref
}
