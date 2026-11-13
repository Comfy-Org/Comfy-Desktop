import type { CatalogCategory } from '../../types/ipc'

const CATEGORIES: readonly CatalogCategory[] = ['image', 'video', '3d', 'audio']

const GENERATION_SUFFIXES: ReadonlyArray<[string, CatalogCategory]> = [
  ['images', 'image'],
  ['image', 'image'],
  ['videos', 'video'],
  ['video', 'video'],
  ['3d', '3d'],
  ['audio', 'audio']
]

function asCategory(value: unknown): CatalogCategory | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return CATEGORIES.find((category) => category === normalized) ?? null
}

function categoryFromOutputs(outputs: unknown): CatalogCategory | null {
  if (!Array.isArray(outputs)) return null
  for (const output of outputs) {
    if (!output || typeof output !== 'object') continue
    const category = asCategory((output as { kind?: unknown }).kind)
    if (category) return category
  }
  return null
}

function categoryFromGenerationType(generationType: unknown): CatalogCategory | null {
  if (typeof generationType !== 'string') return null
  const normalized = generationType.trim().toLowerCase()
  const match = GENERATION_SUFFIXES.find(([suffix]) => normalized.endsWith(suffix))
  return match ? match[1] : null
}

export function catalogCategory(data: unknown): CatalogCategory | null {
  if (!data || typeof data !== 'object') return null
  const record = data as { outputs?: unknown; generation_type?: unknown }
  return categoryFromOutputs(record.outputs) ?? categoryFromGenerationType(record.generation_type)
}
