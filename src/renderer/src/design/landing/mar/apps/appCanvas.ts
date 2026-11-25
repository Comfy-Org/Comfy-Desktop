import { createNode, type Control, type Group, type Link, type SNode } from '../graph/canvasData'
import type { AppGraph, AppGraphInput } from './appToComfy'

export const APP_INPUT_BADGE = 'App input'

const link = (from: string, to: string, inp = 0): Link => ({
  id: `${from}>${to}:${inp}`,
  from,
  out: 0,
  to,
  in: inp
})

const nodeTitle = (i: AppGraphInput | undefined, fallback: string): string =>
  i?.node.replace(/\s*#\d+$/, '') || fallback

function seedControl(seed: number): Control {
  const value = String(seed)
  return { kind: 'combo', key: 'seed', name: 'Seed', value, options: [value, 'Random'] }
}

export function appCanvas(g: AppGraph): { nodes: SNode[]; links: Link[]; groups: Group[] } {
  const badge = g.badges ? APP_INPUT_BADGE : undefined
  const imageIn = g.inputs.find((i) => i.kind === 'image')
  const textIn = g.inputs.find((i) => i.kind === 'text')
  const gen = createNode(g.video ? 'generateVideo' : 'generate', 420, 60, 'gen')
  gen.title = g.name
  gen.controls = [...gen.controls.filter((c) => c.key !== 'seed'), seedControl(g.seed)]
  const out = createNode('output', 830, 60, 'out')
  out.image = g.output
  out.chip = g.output ? 'Last run' : undefined
  const nodes: SNode[] = [gen, out]
  const links: Link[] = [link('gen', 'out')]
  if (textIn) {
    const prompt = createNode('prompt', 40, 60, 'prompt')
    prompt.title = nodeTitle(textIn, 'Prompt')
    prompt.text = g.prompt ?? ''
    prompt.badge = badge
    nodes.unshift(prompt)
    links.push(link('prompt', 'gen'))
  }
  if (imageIn) {
    const ref = createNode('image', 40, textIn ? 300 : 60, 'ref')
    ref.title = nodeTitle(imageIn, 'Load Image')
    ref.image = g.image
    ref.chip = g.image ? `${g.video ? 'clip.mp4' : 'photo.png'}` : undefined
    ref.badge = badge
    nodes.unshift(ref)
    links.push(link('ref', 'gen', 1))
  }
  return { nodes, links, groups: [] }
}
