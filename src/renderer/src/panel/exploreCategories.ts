import type { CatalogCategory } from '../types/ipc'

export const CATEGORY_ORDER: readonly CatalogCategory[] = ['image', 'video', '3d', 'audio']

export type CategoryCounts = Partial<Record<CatalogCategory, number>>

export function countCategories(
  items: readonly { category: CatalogCategory | null }[]
): CategoryCounts {
  const counts: CategoryCounts = {}
  for (const { category } of items) if (category) counts[category] = (counts[category] ?? 0) + 1
  return counts
}

export function byCategory<T extends { category: CatalogCategory | null }>(
  items: readonly T[],
  picked: readonly CatalogCategory[]
): T[] {
  if (picked.length === 0) return [...items]
  return items.filter((item) => item.category !== null && picked.includes(item.category))
}
