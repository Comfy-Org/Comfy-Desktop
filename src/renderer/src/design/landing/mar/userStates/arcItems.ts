import { openDetail } from '../../useProto'
import { thumb } from '../../mock'
import { HUB_WORKFLOWS, hubLine, hubThumb, type HubWorkflow } from '../explore/hubWorkflows'
import { EXAMPLES, runExample } from './examples'

/** One card on the Home's arc: an app or a template (a Hub workflow). */
export interface ArcItem {
  id: string
  label: string
  does: string
  kind: 'app' | 'template'
  /** Image, video or 3D: what a use-case chip groups it under. */
  topic: 'image' | 'video' | '3d' | 'audio'
  src: string
  /** What comes out, swept in on the front card (apps only). */
  after?: string
  focus?: [string, string]
  open: () => void
}

export const ARC_APPS: ArcItem[] = EXAMPLES.map((x) => ({
  id: x.app,
  label: x.label,
  does: x.does,
  kind: 'app',
  topic: x.kind === 'Video' ? 'video' : 'image',
  src: x.src,
  after: x.after,
  focus: x.focus,
  open: () => runExample(x)
}))

function template(w: HubWorkflow): ArcItem {
  const [title, what] = w.title.split(':').map((x) => x.trim())
  return {
    id: w.id,
    label: what ? title! : w.title,
    does: what ?? hubLine(w),
    kind: 'template',
    topic: w.media,
    src: hubThumb(w.id) ?? thumb(w.id),
    open: () => openDetail('template', w.id)
  }
}

export const ARC_TEMPLATES: ArcItem[] = [...HUB_WORKFLOWS]
  .sort((a, b) => b.usage - a.usage)
  .map(template)

/** Apps and templates taking turns, as one featured set. */
export function interleave(a: ArcItem[], b: ArcItem[], max: number): ArcItem[] {
  const out: ArcItem[] = []
  for (let i = 0; out.length < max && (i < a.length || i < b.length); i++) {
    if (a[i]) out.push(a[i]!)
    if (b[i] && out.length < max) out.push(b[i]!)
  }
  return out
}
