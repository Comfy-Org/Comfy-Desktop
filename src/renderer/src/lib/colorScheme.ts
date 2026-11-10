import { perceivedLuminance, LUMINANCE_LIGHT_THRESHOLD } from '../../../shared/colorLuminance'

export function isColorLight(color: string | null | undefined): boolean {
  if (!color) return false
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return false
  ctx.fillStyle = color
  const hex = ctx.fillStyle as string
  if (!hex.startsWith('#') || hex.length < 7) return false
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return perceivedLuminance(r, g, b) >= LUMINANCE_LIGHT_THRESHOLD
}
