import type { CatalogCategory } from '../../types/ipc'

export interface CarouselCard {
  id: string
  title: string
  description?: string
  thumbnailUrl: string | null
  category: CatalogCategory | null
}

export type CarouselKind = 'apps' | 'workflows'
