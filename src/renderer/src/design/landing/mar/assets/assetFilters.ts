import type { MarAsset } from '../pages/assetsStore'
import { factsFor } from './assetFacts'
import { tagsOf } from './assetTags'

/**
 * The asset filters both surfaces share (Better Asset Management PRD):
 * where it came from, more types, a date range and tags. Desktop shows
 * them in its Filters menu, ComfyUI's sidebar in its settings menu.
 */
export type AssetType = MarAsset['type']
export interface AssetFilter {
  source: 'all' | 'generated' | 'imported'
  types: AssetType[]
  /** yyyy-mm-dd, inclusive; empty for open. */
  from: string
  to: string
  tags: string[]
  /** Any tag picked (a union) instead of every one. */
  anyTag: boolean
  /** Read from the run (Alex's metadata filters): any picked one matches. */
  models: string[]
  loras: string[]
  workflows: string[]
}

export const noFilter = (): AssetFilter => ({
  source: 'all',
  types: [],
  from: '',
  to: '',
  tags: [],
  anyTag: false,
  models: [],
  loras: [],
  workflows: []
})

export const activeFilters = (f: AssetFilter): number =>
  (f.source !== 'all' ? 1 : 0) +
  f.types.length +
  (f.from || f.to ? 1 : 0) +
  f.tags.length +
  f.models.length +
  f.loras.length +
  f.workflows.length

const day = (age: number): string =>
  new Date(Date.now() - Math.max(0, age) * 60000).toISOString().slice(0, 10)

/** Types are a union with the page's own type choice: either may match. */
export function passes(a: MarAsset, f: AssetFilter): boolean {
  if (a.status) return f.source !== 'imported' && !f.tags.length && !meta(f)
  const imported = factsFor(a).imported
  if (f.source === 'generated' && imported) return false
  if (f.source === 'imported' && !imported) return false
  if (f.from && day(a.age) < f.from) return false
  if (f.to && day(a.age) > f.to) return false
  const m = metaOf(a)
  if (f.models.length && !f.models.some((x) => m.models.includes(x))) return false
  if (f.loras.length && !f.loras.some((x) => m.loras.includes(x))) return false
  if (f.workflows.length && !f.workflows.includes(m.workflow ?? '')) return false
  const tags = tagsOf(a)
  if (!f.tags.length) return true
  return f.anyTag ? f.tags.some((t) => tags.includes(t)) : f.tags.every((t) => tags.includes(t))
}

const meta = (f: AssetFilter): boolean =>
  !!(f.models.length || f.loras.length || f.workflows.length)

/** What the run recorded, split the way the filters ask: checkpoints and
 *  encoders as models, LoRAs on their own, and the workflow's name. */
export function metaOf(a: MarAsset): { models: string[]; loras: string[]; workflow?: string } {
  if (a.status) return { models: [], loras: [] }
  const f = factsFor(a)
  return {
    models: f.models.filter((x) => !/lora/i.test(x)),
    loras: f.models.filter((x) => /lora/i.test(x)),
    workflow: f.workflowName
  }
}

const uniq = (l: string[]): string[] => [...new Set(l)].sort()
export const metaIn = (
  list: MarAsset[]
): { models: string[]; loras: string[]; workflows: string[] } => {
  const all = list.map(metaOf)
  return {
    models: uniq(all.flatMap((m) => m.models)),
    loras: uniq(all.flatMap((m) => m.loras)),
    workflows: uniq(all.flatMap((m) => (m.workflow ? [m.workflow] : [])))
  }
}

export const tagsIn = (list: MarAsset[]): string[] =>
  [...new Set(list.filter((a) => !a.status).flatMap(tagsOf))].sort()
