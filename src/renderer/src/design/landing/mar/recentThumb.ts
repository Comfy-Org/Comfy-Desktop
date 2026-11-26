import { reactive } from 'vue'

export type RecentThumb = 'image' | 'runsOn'

export const RECENT_THUMBS: { value: RecentThumb; label: string }[] = [
  { value: 'image', label: 'Image' },
  { value: 'runsOn', label: 'Local or Cloud icon' }
]

export const recentThumb = reactive<{ id: RecentThumb }>({ id: 'image' })
