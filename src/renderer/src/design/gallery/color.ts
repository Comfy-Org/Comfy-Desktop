/**
 * OKLCH color math for the gallery (see the better-colors skill): parse any
 * CSS color the kit uses, convert between sRGB and OKLCH, format values the
 * same way everywhere, measure perceptual distance, and keep edits inside
 * the sRGB gamut.
 */

export interface Oklch {
  l: number
  c: number
  h: number
  alpha: number
}
type Rgb = [number, number, number]

// ── sRGB <-> OKLab (Björn Ottosson) ────────────────────────
const toLinear = (v: number): number =>
  v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
const fromLinear = (v: number): number =>
  v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055

function rgbToOklab([r, g, b]: Rgb): Rgb {
  const [lr, lg, lb] = [r, g, b].map(toLinear) as Rgb
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ]
}
/** Linear sRGB (may fall outside 0-1 when out of gamut). */
function oklabToLinear([L, a, b]: Rgb): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ]
}
const lchToLab = ({ l, c, h }: Oklch): Rgb => [
  l,
  c * Math.cos((h * Math.PI) / 180),
  c * Math.sin((h * Math.PI) / 180)
]

export function rgbToOklch(rgb: Rgb, alpha = 1): Oklch {
  const [l, a, b] = rgbToOklab(rgb)
  const c = Math.hypot(a, b)
  const h = c < 1e-4 ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360
  return { l, c: c < 1e-4 ? 0 : c, h, alpha }
}
/** sRGB 0-1, clipped. */
export const oklchToRgb = (o: Oklch): Rgb =>
  oklabToLinear(lchToLab(o)).map((v) => Math.min(1, Math.max(0, fromLinear(v)))) as Rgb

// ── Gamut ──────────────────────────────────────────────────
export const inGamut = (o: Oklch): boolean =>
  oklabToLinear(lchToLab(o)).every((v) => v >= -1e-4 && v <= 1 + 1e-4)
/** Highest chroma that stays in sRGB at this lightness and hue. */
export function maxChroma(l: number, h: number): number {
  let [lo, hi] = [0, 0.4]
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2
    if (inGamut({ l, c: mid, h, alpha: 1 })) lo = mid
    else hi = mid
  }
  return lo
}
/** Bring a color into sRGB by lowering chroma; L and H stay. */
export const clampToGamut = (o: Oklch): Oklch => (inGamut(o) ? o : { ...o, c: maxChroma(o.l, o.h) })

// ── Parse / format ─────────────────────────────────────────
const num = (s: string, pct = 1): number =>
  s.endsWith('%') ? parseFloat(s) / 100 : parseFloat(s) / pct

/** Hex (3/6/8), rgb()/rgba() and oklch(). Anything else: null. */
export function parseColor(v: string): Oklch | null {
  const s = v.trim().toLowerCase()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s)
  if (hex) {
    let h = hex[1]!
    if (h.length === 3) h = [...h].map((x) => x + x).join('')
    const n = (i: number): number => parseInt(h.slice(i, i + 2), 16) / 255
    return rgbToOklch([n(0), n(2), n(4)], h.length === 8 ? n(6) : 1)
  }
  const rgb =
    /^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:\s*[/,]\s*([\d.]+%?))?\s*\)$/.exec(s)
  if (rgb)
    return rgbToOklch(
      [num(rgb[1]!, 255), num(rgb[2]!, 255), num(rgb[3]!, 255)],
      rgb[4] ? num(rgb[4]) : 1
    )
  const lch =
    /^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(s)
  if (lch)
    return {
      l: num(lch[1]!),
      c: parseFloat(lch[2]!),
      h: parseFloat(lch[3]!),
      alpha: lch[4] ? num(lch[4]) : 1
    }
  return null
}

const fixed = (n: number, d = 3): string => {
  const s = n.toFixed(d).replace(/\.?0+$/, '')
  return s === '-0' ? '0' : s
}
/** `oklch(L C H)` / `oklch(L C H / a)`: 3 decimals, no trailing zeros. */
export function formatOklch({ l, c, h, alpha }: Oklch): string {
  const body = `${fixed(l)} ${fixed(c)} ${c ? fixed(h) : '0'}`
  return alpha < 1 ? `oklch(${body} / ${fixed(alpha)})` : `oklch(${body})`
}

// ── Distance ───────────────────────────────────────────────
/** Composite a (possibly translucent) color over an opaque backdrop, in
 *  sRGB like the browser does. */
function over(o: Oklch, backdrop: Oklch): Rgb {
  const f = oklchToRgb(o)
  const b = oklchToRgb(backdrop)
  return f.map((v, i) => v * o.alpha + b[i]! * (1 - o.alpha)) as Rgb
}
/**
 * Perceptual difference, ΔE in OKLab ×100 (2 ≈ the smallest difference
 * most people notice). A solid color and a tint are never alike: a tint
 * changes with what's under it. Two tints are compared as they render over
 * each backdrop (e.g. darkest and lightest surface), worst case wins.
 */
export function deltaE(a: Oklch, b: Oklch, backdrops: Oklch[]): number {
  const solid = (o: Oklch): boolean => o.alpha >= 1
  if (solid(a) !== solid(b)) return Infinity
  if (!backdrops.length) backdrops = [{ l: 0, c: 0, h: 0, alpha: 1 }]
  return Math.max(
    ...(solid(a) ? [backdrops[0]!] : backdrops).map((bg) => {
      const la = rgbToOklab(over(a, bg))
      const lb = rgbToOklab(over(b, bg))
      return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]) * 100
    })
  )
}
