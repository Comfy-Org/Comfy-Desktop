import { reactive } from 'vue'

export type TplFeed = 'off' | 'feed'

export const TPL_FEEDS: { value: TplFeed; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'feed', label: 'Feed' }
]

export const tplFeed = reactive<{ id: TplFeed }>({ id: 'off' })
