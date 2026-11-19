/**
 * Colour math for the Theme playground: OKLCH ↔ sRGB, hex, alpha over a
 * surface, WCAG 2 contrast and APCA Lc (APCA-W3 0.0.98G). No gamut
 * mapping beyond clamping: the charcoal scale is near-neutral, so it never
 * leaves sRGB by much.
 */
export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

const clamp = (x: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, x))
const toLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
const toGamma = (c: number): number =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055

export function oklchToRgb(l: number, c: number, h: number, a = 1): Rgba {
  const hr = (h * Math.PI) / 180
  const A = c * Math.cos(hr)
  const B = c * Math.sin(hr)
  const l_ = Math.pow(l + 0.3963377774 * A + 0.2158037573 * B, 3)
  const m_ = Math.pow(l - 0.1055613458 * A - 0.0638541728 * B, 3)
  const s_ = Math.pow(l - 0.0894841775 * A - 1.291485548 * B, 3)
  const r = 4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_
  const g = -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_
  const b = -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_
  return { r: clamp(toGamma(r)), g: clamp(toGamma(g)), b: clamp(toGamma(b)), a }
}

export function rgbToOklch({ r, g, b }: Rgba): { l: number; c: number; h: number } {
  const R = toLinear(r)
  const G = toLinear(g)
  const B = toLinear(b)
  const l = Math.cbrt(0.4122214708 * R + 0.536301562 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const c = Math.hypot(A, Bb)
  const h = ((Math.atan2(Bb, A) * 180) / Math.PI + 360) % 360
  return { l: L, c, h }
}

export function hexToRgb(hex: string): Rgba {
  let h = hex.replace('#', '').trim()
  if (h.length === 3 || h.length === 4) h = [...h].map((x) => x + x).join('')
  const n = (i: number): number => parseInt(h.slice(i, i + 2), 16) / 255
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) : 1 }
}

export function rgbToHex({ r, g, b }: Rgba): string {
  const x = (v: number): string =>
    Math.round(clamp(v) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${x(r)}${x(g)}${x(b)}`
}

/** Hex, `oklch(L C H / a%)` and the CSS keywords the palettes use. */
export function parseColor(v: string): Rgba {
  const s = v.trim().toLowerCase()
  if (s.startsWith('#')) return hexToRgb(s)
  if (s === 'white') return { r: 1, g: 1, b: 1, a: 1 }
  if (s === 'black') return { r: 0, g: 0, b: 0, a: 1 }
  if (s === 'lightgray') return hexToRgb('#d3d3d3')
  const ok = s.match(/^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)(%?))?\s*\)$/)
  if (ok) {
    const l = Number(ok[1]) / (ok[2] ? 100 : 1)
    const a = ok[5] === undefined ? 1 : Number(ok[5]) / (ok[6] ? 100 : 1)
    return oklchToRgb(l, Number(ok[3]), Number(ok[4]), a)
  }
  const rgb = s.match(
    /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+)(%?))?\s*\)$/
  )
  if (rgb) {
    const a = rgb[4] === undefined ? 1 : Number(rgb[4]) / (rgb[5] ? 100 : 1)
    return { r: Number(rgb[1]) / 255, g: Number(rgb[2]) / 255, b: Number(rgb[3]) / 255, a }
  }
  return { r: 1, g: 0, b: 1, a: 1 }
}

/** `top` painted over an opaque `under`. */
export function over(top: Rgba, under: Rgba): Rgba {
  const a = top.a
  return {
    r: top.r * a + under.r * (1 - a),
    g: top.g * a + under.g * (1 - a),
    b: top.b * a + under.b * (1 - a),
    a: 1
  }
}

export const withAlpha = (c: Rgba, a: number): Rgba => ({ ...c, a: c.a * a })

export function cssOf(c: Rgba): string {
  if (c.a >= 1) return rgbToHex(c)
  const { l, c: ch, h } = rgbToOklch(c)
  const r = (n: number, d: number): number => Math.round(n * 10 ** d) / 10 ** d
  const grey = ch < 0.0005
  return `oklch(${r(l, 3)} ${grey ? 0 : r(ch, 3)} ${grey ? 0 : r(h, 1)} / ${r(c.a * 100, 1)}%)`
}

const luminance = ({ r, g, b }: Rgba): number =>
  0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)

/** WCAG 2 contrast ratio of two opaque colours. */
export function wcag(a: Rgba, b: Rgba): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** APCA Lc of `text` on `bg` (both opaque); negative for light on dark. */
export function apca(text: Rgba, bg: Rgba): number {
  const y = ({ r, g, b }: Rgba): number => {
    const v =
      0.2126729 * Math.pow(r, 2.4) + 0.7151522 * Math.pow(g, 2.4) + 0.072175 * Math.pow(b, 2.4)
    return v < 0.022 ? v + Math.pow(0.022 - v, 1.414) : v
  }
  const yt = y(text)
  const yb = y(bg)
  if (Math.abs(yb - yt) < 0.0005) return 0
  if (yb > yt) {
    const s = (Math.pow(yb, 0.56) - Math.pow(yt, 0.57)) * 1.14
    return s < 0.1 ? 0 : (s - 0.027) * 100
  }
  const s = (Math.pow(yb, 0.65) - Math.pow(yt, 0.62)) * 1.14
  return s > -0.1 ? 0 : (s + 0.027) * 100
}

/** The frontend's adjustColor({ lightness }): HSL lightness + n × 100. */
export function addHslLightness(c: Rgba, n: number): Rgba {
  const max = Math.max(c.r, c.g, c.b)
  const min = Math.min(c.r, c.g, c.b)
  let h = 0
  let s = 0
  let l = (max + min) / 2
  const d = max - min
  if (d) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    h =
      max === c.r
        ? (c.g - c.b) / d + (c.g < c.b ? 6 : 0)
        : max === c.g
          ? (c.b - c.r) / d + 2
          : (c.r - c.g) / d + 4
    h /= 6
  }
  l = clamp(l + n)
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const f = (t: number): number => {
    t = (t + 1) % 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return s ? { r: f(h + 1 / 3), g: f(h), b: f(h - 1 / 3), a: c.a } : { r: l, g: l, b: l, a: c.a }
}
