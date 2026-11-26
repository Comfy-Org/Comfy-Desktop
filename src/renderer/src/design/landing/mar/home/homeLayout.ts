import { reactive } from 'vue'

export type HomeLayout = 'current' | 'recents' | 'featured' | 'editorial' | 'bento' | 'masonry'

export type HomeVersion = Extract<HomeLayout, 'featured' | 'editorial' | 'bento' | 'masonry'>

export const HOME_LAYOUTS: { value: HomeLayout; label: string }[] = [
  { value: 'current', label: 'Current' },
  { value: 'recents', label: 'Recents first' },
  { value: 'featured', label: 'Featured' },
  { value: 'editorial', label: 'Editorial' },
  { value: 'bento', label: 'Bento' },
  { value: 'masonry', label: 'Feed' }
]

const VERSIONS: HomeLayout[] = ['featured', 'editorial', 'bento', 'masonry']

export const homeVersion = (id: HomeLayout): HomeVersion | null =>
  VERSIONS.includes(id) ? (id as HomeVersion) : null

export const homeLayout = reactive<{ id: HomeLayout }>({ id: 'recents' })
