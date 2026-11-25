import { DETECTED, STARTERS } from './setupFlow'

/** What the canvas mocks show, from the flow's own data. */
export const D = DETECTED
export const REQUIRED_GB = (DETECTED.downloadGb * 2.25).toFixed(1)
export const IMAGE_STARTERS = STARTERS.image
export const imgUrl = (f: string): string => new URL(`../assets/${f}`, import.meta.url).href
/** ComfyUI plus a starter's models, as the Install button would show it. */
export const totalGb = (gb: number): string => `${(DETECTED.downloadGb + gb).toFixed(1)} GB`
