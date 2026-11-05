/**
 * Comfy's imagery art direction (DS › Brand imagery). The chrome stays
 * neutral; colour only comes from pictures, and every picture we make goes
 * through one treatment, so the set reads as Comfy without a logo.
 */

/** ComfyUI's link colours, one per data type: the only hues imagery uses. */
export const WIRE = {
  model: '#b39ddb',
  clip: '#ffd500',
  conditioning: '#ffa931',
  latent: '#ff9cf9',
  vae: '#ff6e6e',
  image: '#64b5f6',
  mask: '#81c784'
} as const
export type Wire = keyof typeof WIRE

/** A duotone: what the darkest and the lightest pixels become. */
export interface Grade {
  shadow: string
  light: string
}

/** The Latent grade: MODEL's violet in the shadows, LATENT's pink in the
 *  light. The picture before it is decoded. Every category tile, cover and
 *  graded background uses this one. */
export const LATENT_GRADE: Grade = {
  shadow: 'oklch(0.26 0.1 282)',
  light: 'oklch(0.87 0.075 350)'
}

/** The Silver grade: graphite in the shadows, near white in the light, hard
 *  contrast and no hue. For pictures that sit in the chrome (the login strip),
 *  where the Latent grade's colour would be the loudest thing in the sidebar. */
export const SILVER_GRADE: Grade = {
  shadow: 'oklch(0.14 0.004 285)',
  light: 'oklch(0.97 0.003 85)'
}

/** One wire colour as a monochrome tint, for cards that each own a hue
 *  (use cases): a deep shade of it in the shadows, a pale one in the light. */
export function tint(wire: Wire): Grade {
  const c = WIRE[wire]
  return {
    shadow: `color-mix(in oklab, ${c} 45%, oklch(0.2 0.01 285))`,
    light: `color-mix(in oklab, ${c} 60%, oklch(0.97 0.005 85))`
  }
}

/** The film grain every treatment shares: one 160px tile, never scaled. */
export const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .5 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")"
