import { go } from '../../useProto'
import { TEMPLATES, thumb, type Template } from '../../mock'
import { EXAMPLES, runExample } from './examples'

/** One card on the Home's arc: an app or a workflow. */
export interface ArcItem {
  id: string
  label: string
  does: string
  kind: 'app' | 'workflow'
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

const TOPIC_LABEL: Record<ArcItem['topic'], string> = {
  image: 'Image',
  video: 'Video',
  '3d': '3D',
  audio: 'Audio'
}

function workflow(t: Template): ArcItem {
  const [title, what] = t.title.split(':').map((x) => x.trim())
  return {
    id: t.id,
    label: what ? title! : t.title,
    does: what ?? TOPIC_LABEL[t.category],
    kind: 'workflow',
    topic: t.category,
    src: thumb(t.id),
    open: () => go('explore')
  }
}

export const ARC_WORKFLOWS: ArcItem[] = TEMPLATES.filter((t) => t.kind === 'graph').map(workflow)

/** Apps and workflows taking turns, as one featured set. */
export function interleave(a: ArcItem[], b: ArcItem[], max: number): ArcItem[] {
  const out: ArcItem[] = []
  for (let i = 0; out.length < max && (i < a.length || i < b.length); i++) {
    if (a[i]) out.push(a[i]!)
    if (b[i] && out.length < max) out.push(b[i]!)
  }
  return out
}
