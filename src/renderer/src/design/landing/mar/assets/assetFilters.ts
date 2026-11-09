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
}

export const noFilter = (): AssetFilter => ({
  source: 'all',
  types: [],
  from: '',
  to: '',
  tags: []
})

export const activeFilters = (f: AssetFilter): number =>
  (f.source !== 'all' ? 1 : 0) + f.types.length + (f.from || f.to ? 1 : 0) + f.tags.length

const day = (age: number): string =>
  new Date(Date.now() - Math.max(0, age) * 60000).toISOString().slice(0, 10)

/** Types are a union with the page's own type choice: either may match. */
export function passes(a: MarAsset, f: AssetFilter): boolean {
  if (a.status) return f.source !== 'imported' && !f.tags.length
  const imported = factsFor(a).imported
  if (f.source === 'generated' && imported) return false
  if (f.source === 'imported' && !imported) return false
  if (f.from && day(a.age) < f.from) return false
  if (f.to && day(a.age) > f.to) return false
  const tags = tagsOf(a)
  return f.tags.every((t) => tags.includes(t))
}

export const tagsIn = (list: MarAsset[]): string[] =>
  [...new Set(list.filter((a) => !a.status).flatMap(tagsOf))].sort()
