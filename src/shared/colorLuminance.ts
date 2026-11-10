export function perceivedLuminance(r: number, g: number, b: number): number {
  return (r * 299 + g * 587 + b * 114) / 1000
}

export const LUMINANCE_LIGHT_THRESHOLD = 128
