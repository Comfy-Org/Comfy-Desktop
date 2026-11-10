import { reactive } from 'vue'

/** What ComfyUI opens with when a share link asks for it (?comfy=assets,
 *  tab or inspect): the Media Assets panel, expanded to a tab, and the
 *  first asset in Inspect asset. Read once, then cleared. */
export const graphOpen = reactive({
  assets: false,
  tab: false,
  inspect: false,
  /** Assets › Open workflow: ComfyUI opens on Media Assets with this one
   *  selected. */
  select: null as null | { id: string; name: string; src?: string; type: string }
})
