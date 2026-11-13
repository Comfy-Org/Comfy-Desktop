import { reactive } from 'vue'

/**
 * Each rail panel's width, dragged from its right edge as ComfyUI's
 * sidebar is, and kept per panel across reloads. Panels that lay out
 * by width (Assets' columns) read it from here.
 */
export const RAIL_MIN = 280
export const RAIL_DEFAULT = 320
const KEY = 'comfy.design.mar.rail.width'

function load(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, number>
  } catch {
    return {}
  }
}

export const railWidth = reactive<Record<string, number>>(load())

export function railMax(): number {
  return Math.max(RAIL_MIN, Math.min(760, window.innerWidth - 240))
}

export function setRailWidth(panel: string, w: number | null): void {
  if (w === null) delete railWidth[panel]
  else railWidth[panel] = Math.round(Math.min(railMax(), Math.max(RAIL_MIN, w)))
  try {
    localStorage.setItem(KEY, JSON.stringify(railWidth))
  } catch {
    /* the width just won't survive a reload */
  }
}
