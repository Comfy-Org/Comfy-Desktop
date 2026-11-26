import type { CatalogWorkflow } from '../types/ipc'

export type RunsOn = 'local' | 'cloud'
export type WorkflowSort = 'popular' | 'newest' | 'name'
export type CardSize = 'small' | 'medium' | 'large'

export const CARD_SIZES: readonly CardSize[] = ['small', 'medium', 'large']
export const WORKFLOW_SORTS: readonly WorkflowSort[] = ['popular', 'newest', 'name']
export const RUNS_ON: readonly RunsOn[] = ['local', 'cloud']

export interface WorkflowFilters {
  useCase: string | null
  model: string | null
  runsOn: RunsOn | null
}

export interface FacetOption {
  value: string
  count: number
}

export interface WorkflowFacets {
  useCases: FacetOption[]
  models: FacetOption[]
}

export const NO_FILTERS: WorkflowFilters = { useCase: null, model: null, runsOn: null }

export function activeFilterCount(filters: WorkflowFilters): number {
  return [filters.useCase, filters.model, filters.runsOn].filter((value) => value !== null).length
}

function countValues(lists: string[][]): FacetOption[] {
  const counts = new Map<string, number>()
  for (const list of lists) {
    for (const value of list) counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
}

export function workflowFacets(workflows: readonly CatalogWorkflow[]): WorkflowFacets {
  return {
    useCases: countValues(workflows.map((workflow) => workflow.useCases)),
    models: countValues(workflows.map((workflow) => workflow.models))
  }
}

function runsOn(workflow: CatalogWorkflow, place: RunsOn): boolean {
  return place === 'local' ? workflow.canOpenLocal : workflow.canOpenCloud
}

function matchesQuery(workflow: CatalogWorkflow, needle: string): boolean {
  if (!needle) return true
  return [workflow.title, workflow.description, ...workflow.models]
    .join('\n')
    .toLocaleLowerCase()
    .includes(needle)
}

export function filterWorkflows(
  workflows: readonly CatalogWorkflow[],
  filters: WorkflowFilters,
  query: string
): CatalogWorkflow[] {
  const needle = query.trim().toLocaleLowerCase()
  return workflows.filter(
    (workflow) =>
      (filters.useCase === null || workflow.useCases.includes(filters.useCase)) &&
      (filters.model === null || workflow.models.includes(filters.model)) &&
      (filters.runsOn === null || runsOn(workflow, filters.runsOn)) &&
      matchesQuery(workflow, needle)
  )
}

function newestFirst(a: CatalogWorkflow, b: CatalogWorkflow): number {
  if (a.publishedAt === b.publishedAt) return 0
  if (a.publishedAt === null) return 1
  if (b.publishedAt === null) return -1
  return b.publishedAt.localeCompare(a.publishedAt)
}

export function sortWorkflows(
  workflows: readonly CatalogWorkflow[],
  sort: WorkflowSort,
  locale: string
): CatalogWorkflow[] {
  if (sort === 'popular') return [...workflows]
  if (sort === 'newest') return [...workflows].sort(newestFirst)
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true })
  return [...workflows].sort((a, b) => collator.compare(a.title, b.title))
}

export function humanizeSlug(slug: string): string {
  const words = slug.replace(/[-_]+/g, ' ').trim()
  return words ? words[0]!.toLocaleUpperCase() + words.slice(1) : slug
}
