import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import type { CatalogCategory, CatalogRunsOn, CatalogUseCase } from '../types/ipc'

export const CATEGORY_ORDER: readonly CatalogCategory[] = ['image', 'video', '3d', 'audio']
const RUNS_ORDER: readonly CatalogRunsOn[] = ['cloud', 'local']
const FACET_ORDER = ['type', 'use', 'model', 'runs'] as const

export type FacetKey = (typeof FACET_ORDER)[number]
export type ExplorePicks = Partial<Record<FacetKey, string[]>>
export type ExploreSort = 'recommended' | 'az'

export interface ExploreCard {
  title: string
  description: string
  category: CatalogCategory | null
  useCase?: CatalogUseCase | null
  models?: string[]
  runsOn?: CatalogRunsOn | null
  rank?: number | null
}

export interface FilterOption {
  value: string
  label: string
  count: number
}

export interface FilterGroup {
  key: FacetKey
  options: FilterOption[]
}

export interface ExploreView {
  query: string
  picks: ExplorePicks
  sort: ExploreSort
}

interface FacetValue {
  value: string
  label: string
  order: number
}

function valuesOf(card: ExploreCard, key: FacetKey): FacetValue[] {
  switch (key) {
    case 'type':
      return card.category
        ? [
            {
              value: card.category,
              label: card.category,
              order: CATEGORY_ORDER.indexOf(card.category)
            }
          ]
        : []
    case 'use':
      return card.useCase
        ? [{ value: card.useCase.id, label: card.useCase.label, order: card.useCase.order }]
        : []
    case 'model':
      return (card.models ?? []).map((model) => ({ value: model, label: model, order: 0 }))
    case 'runs':
      return card.runsOn
        ? [{ value: card.runsOn, label: card.runsOn, order: RUNS_ORDER.indexOf(card.runsOn) }]
        : []
  }
}

function matchesQuery(card: ExploreCard, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  const haystack = [card.title, card.description, card.useCase?.label ?? '', ...(card.models ?? [])]
  return haystack.join(' ').toLowerCase().includes(needle)
}

function passes(card: ExploreCard, picks: ExplorePicks, skip?: FacetKey): boolean {
  return FACET_ORDER.every((key) => {
    const picked = picks[key] ?? []
    if (key === skip || picked.length === 0) return true
    return valuesOf(card, key).some((value) => picked.includes(value.value))
  })
}

function rankOf(card: ExploreCard): number {
  return card.rank ?? Number.POSITIVE_INFINITY
}

export function exploreCards<T extends ExploreCard>(cards: readonly T[], view: ExploreView): T[] {
  const shown = cards.filter((card) => matchesQuery(card, view.query) && passes(card, view.picks))
  if (view.sort === 'az') return shown.toSorted((a, b) => a.title.localeCompare(b.title))
  return shown
    .map((card, index) => ({ card, index }))
    .toSorted((a, b) => rankOf(a.card) - rankOf(b.card) || a.index - b.index)
    .map(({ card }) => card)
}

function distinctValues(cards: readonly ExploreCard[], key: FacetKey): FacetValue[] {
  const byValue = new Map<string, FacetValue & { cards: number }>()
  for (const card of cards) {
    for (const value of valuesOf(card, key)) {
      const seen = byValue.get(value.value)
      byValue.set(value.value, { ...value, cards: (seen?.cards ?? 0) + 1 })
    }
  }
  const ordered = [...byValue.values()]
  return key === 'model'
    ? ordered.toSorted((a, b) => b.cards - a.cards || a.label.localeCompare(b.label))
    : ordered.toSorted((a, b) => a.order - b.order || a.label.localeCompare(b.label))
}

export function filterGroups(cards: readonly ExploreCard[], view: ExploreView): FilterGroup[] {
  const searched = cards.filter((card) => matchesQuery(card, view.query))
  return FACET_ORDER.flatMap((key) => {
    const values = distinctValues(cards, key)
    if (values.length < 2 && !(view.picks[key]?.length ?? 0)) return []
    const reachable = searched.filter((card) => passes(card, view.picks, key))
    const options = values.map((value) => ({
      value: value.value,
      label: value.label,
      count: reachable.filter((card) =>
        valuesOf(card, key).some((candidate) => candidate.value === value.value)
      ).length
    }))
    return [{ key, options }]
  })
}

export function useExploreCards<T extends ExploreCard>(
  cards: MaybeRefOrGetter<readonly T[]>,
  view: MaybeRefOrGetter<ExploreView>
) {
  return {
    shown: computed(() => exploreCards(toValue(cards), toValue(view))),
    groups: computed(() => filterGroups(toValue(cards), toValue(view)))
  }
}

export const CARD_SIZES = ['small', 'medium', 'large'] as const
export type CardSize = (typeof CARD_SIZES)[number]

const GRID_COLUMNS: Record<CardSize, string> = {
  small: 'grid-cols-5',
  medium: 'grid-cols-4',
  large: 'grid-cols-3'
}

export function exploreGridClass(size: CardSize): string {
  return `m-0 grid list-none gap-4 p-0 ${GRID_COLUMNS[size]}`
}
