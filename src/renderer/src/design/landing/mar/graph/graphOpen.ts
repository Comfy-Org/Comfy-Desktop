import { reactive } from 'vue'

/** What ComfyUI opens with when a share link asks for it (?comfy=assets
 *  or ?comfy=inspect): the Media Assets panel, and the first asset in
 *  Inspect asset. Read once, then cleared. */
export const graphOpen = reactive({ assets: false, inspect: false })
