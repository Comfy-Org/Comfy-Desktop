import { reactive } from 'vue'

/** How ComfyUI's graph editor looks in Mar's proposal: Glass, the Home's
 *  language carried into the canvas. `current` is ComfyUI's own chrome,
 *  and only UI Playground › ComfyUI › Production sets it (comfyLook.ts);
 *  the proposal always opens Glass, so nothing is remembered here. */
export type GraphStyle = 'glass' | 'current'

export const graphStyle = reactive<{ id: GraphStyle }>({ id: 'glass' })
