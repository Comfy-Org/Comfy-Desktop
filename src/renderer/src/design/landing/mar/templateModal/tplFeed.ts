import { reactive } from 'vue'

export type TplFeed = 'off' | 'feed' | 'strip'

export const TPL_FEEDS: { value: TplFeed; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'feed', label: 'Feed' },
  { value: 'strip', label: 'Strip' }
]

export const tplFeed = reactive<{ id: TplFeed }>({ id: 'off' })
