import type { Template } from '../../mock'
import { mock } from '../assets/mock'
import { hubById } from '../explore/hubWorkflows'
import type { TplMedia } from './templateData'
import { TEMPLATE_OUTPUTS } from './templateOutputs'

export interface TplExample {
  id: string
  pic: string
  clip?: string
  madeWith?: string
}

const CLIP_FILES = import.meta.glob<string>('../assets/examples/gv-*.mp4', {
  eager: true,
  import: 'default'
})
const clipOf = (slot: string): string | undefined => CLIP_FILES[`../assets/examples/gv-${slot}.mp4`]

const MAX_EXAMPLES = 5

function outputExample(slot: string, template: string, clip?: string): TplExample | undefined {
  const pic = mock(slot)
  if (!pic) return undefined
  const madeFrom = hubById(template)
  return { id: slot, pic, clip: clip ? clipOf(clip) : undefined, madeWith: madeFrom?.title }
}

const jobOf = (id: string): string | undefined => {
  const w = hubById(id)
  return w && `${w.useCase}/${w.media}/${/background/i.test(id) ? 'cutout' : ''}`
}

function sameKind(a: string, b: string): boolean {
  const job = jobOf(a)
  return Boolean(job && job === jobOf(b))
}

export function examplesFor(t: Template, media: TplMedia): TplExample[] {
  const list: TplExample[] = [{ id: 'hero', pic: media.hero }]
  if (media.output && media.output !== media.hero) list.push({ id: 'output', pic: media.output })
  const own = TEMPLATE_OUTPUTS.filter(([, id]) => id === t.id)
  const kin = TEMPLATE_OUTPUTS.filter(([, id]) => id !== t.id && sameKind(id, t.id))
  for (const [slot, id, clip] of [...own, ...kin]) {
    const ex = outputExample(slot, id, clip)
    if (!ex) continue
    if (id === t.id) ex.madeWith = undefined
    if (!list.some((x) => x.pic === ex.pic)) list.push(ex)
  }
  const shown = list.slice(0, MAX_EXAMPLES)
  return shown.length > 1 ? shown : []
}
