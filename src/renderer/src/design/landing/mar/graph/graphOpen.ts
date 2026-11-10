import { reactive } from 'vue'

/** What ComfyUI opens with when a share link asks for it (?comfy=assets
 *  or ?comfy=inspect): the Media Assets panel, and the first asset in
 *  Inspect asset. Read once, then cleared. */
export const graphOpen = reactive({
  assets: false,
  inspect: false,
  /** Assets › Open workflow: ComfyUI opens on Media Assets with this one
   *  selected. */
  select: null as null | { id: string; name: string; src?: string; type: string }
})
