import { perceivedLuminance, LUMINANCE_LIGHT_THRESHOLD } from '../../shared/colorLuminance'

export const BRAND_YELLOW = '#F0FF41'

export const COMFY_BG_DARK = '#202020'

export const COMFY_BG_LIGHT = '#f5f5f5'

export const COMFY_BG = '#171717'

export const TITLEBAR_BG = '#050506'

export function readableSymbolColor(bg: string): string {
  const rgb = parseColor(bg)
  if (!rgb) return '#dddddd'
  const [r, g, b] = rgb
  return perceivedLuminance(r, g, b) >= LUMINANCE_LIGHT_THRESHOLD ? '#333333' : '#dddddd'
}

function parseColor(input: string): [number, number, number] | null {
  const s = input.trim().toLowerCase()
  const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/)
  if (hex?.[1]) {
    const h = hex[1]
    const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16)
    ]
  }
  const rgb = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/)
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  return null
}

export interface SplashTheme {
  bg: string
  fg: string
  isDark: boolean
}

export const SPLASH_DARK: SplashTheme = { bg: COMFY_BG_DARK, fg: '#ffffff', isDark: true }
export const SPLASH_LIGHT: SplashTheme = { bg: COMFY_BG_LIGHT, fg: '#000000', isDark: false }

export const SPLASH_DESKTOP: SplashTheme = { bg: TITLEBAR_BG, fg: '#ffffff', isDark: true }
