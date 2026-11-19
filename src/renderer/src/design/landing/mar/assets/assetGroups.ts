import type { MarAsset } from '../pages/assetsStore'
import { createdAt, factsFor } from './assetFacts'

/** Group by, as the Assets page and ComfyUI's Assets panel offer it. */
export type AssetGroup = 'none' | 'job' | 'date' | 'type'
export const GROUPS: { value: AssetGroup; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'job', label: 'Job' },
  { value: 'date', label: 'Date' },
  { value: 'type', label: 'Type' }
]

type Head = { key: string; title: string }

/** Job: what one run made sits together. The mock keeps no job ids, so a
 *  job is the workflow a run came from and the day it ran; imports are one
 *  group of their own. */
function jobOf(a: MarAsset): Head {
  const f = factsFor(a)
  if (f.imported) return { key: 'imported', title: 'Imported' }
  const flow = (f.workflowName ?? a.name)
    .replace(/\.[^.]+$/, '')
    .replace(/_\d+$/, '')
    .replace(/[_-]+/g, ' ')
  return { key: `${flow}|${a.when}|${a.envId ?? ''}`, title: `${flow} · ${a.when}` }
}
/** Date: the day it was made, then the week, then earlier. */
function dayOf(a: MarAsset): Head {
  // The same day the card and the details name, from its "when".
  const day = (d: Date): number => new Date(d).setHours(0, 0, 0, 0)
  const days = Math.round((day(new Date()) - day(createdAt(a))) / 86400000)
  const t = days < 1 ? 'Today' : days < 2 ? 'Yesterday' : days < 7 ? 'This week' : 'Earlier'
  return { key: t, title: t }
}
/** Type: in the type tabs' order. */
const TYPES: Record<string, string> = {
  image: 'Images',
  video: 'Videos',
  '3d': '3D',
  audio: 'Audio',
  text: 'Text'
}
const typeOf = (a: MarAsset): Head => ({ key: a.type, title: TYPES[a.type] ?? 'Other' })

/** The list in groups, each under its header; one untitled group for None. */
export function groupAssets<T extends MarAsset>(
  list: T[],
  by: AssetGroup
): (Head & { items: T[] })[] {
  if (by === 'none') return [{ key: 'all', title: '', items: list }]
  const head = { job: jobOf, date: dayOf, type: typeOf }[by]
  const out: (Head & { items: T[] })[] = []
  for (const a of list) {
    const h = head(a)
    const g = out.find((x) => x.key === h.key)
    if (g) g.items.push(a)
    else out.push({ ...h, items: [a] })
  }
  if (by === 'type') {
    const order = Object.keys(TYPES)
    const at = (k: string): number => (order.includes(k) ? order.indexOf(k) : order.length)
    out.sort((x, y) => at(x.key) - at(y.key))
  }
  return out
}
