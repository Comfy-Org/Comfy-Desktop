import { reactive, watch } from 'vue'

/**
 * Neutral palettes to try (UI Playground › Palette). All stay grey, so
 * imagery keeps the colour; each leans a hair towards one hue, enough to
 * tell them apart and to give the product a quiet signature. Only the
 * surfaces and greys move; the theme's contrast steps stay the same.
 */
export interface Palette {
  id: string
  label: string
  /** OKLCH hue the greys lean towards. */
  hue: number
  /** Chroma of the greys (0 = pure grey). */
  chroma: number
}

export const PALETTES: Palette[] = [
  { id: 'void', label: 'Void · cool grey (before)', hue: 285, chroma: 0.004 },
  { id: 'graphite', label: 'Graphite · pure grey (today)', hue: 0, chroma: 0 },
  { id: 'steel', label: 'Steel · grey with a touch of blue', hue: 235, chroma: 0.006 },
  { id: 'slate', label: 'Slate · a hint of blue', hue: 250, chroma: 0.01 },
  { id: 'ink', label: 'Ink · deep blue-violet', hue: 270, chroma: 0.012 },
  { id: 'indigo', label: 'Indigo · cooler, a bit more colour', hue: 278, chroma: 0.018 },
  { id: 'aubergine', label: 'Aubergine · like comfy.org', hue: 305, chroma: 0.016 },
  { id: 'plum', label: 'Plum · a hint of aubergine', hue: 320, chroma: 0.012 }
]

// v2: Graphite is the default (Pablo/Mar, Oct 30).
const KEY = 'comfy.design.mar.palette.v2'

export const palette = reactive<{ id: string }>({
  id: (() => {
    try {
      const v = localStorage.getItem(KEY)
      return PALETTES.some((p) => p.id === v) ? v! : 'graphite'
    } catch {
      return 'graphite'
    }
  })()
})

// Each step keeps the theme's lightness; only hue and chroma change.
const DARK: [string, number, number][] = [
  ['--color-app-background', 0.19, 0.75],
  ['--color-titlebar-background', 0.145, 0.75],
  ['--color-content-background', 0.14, 1.2],
  ['--color-card-background', 0.23, 2],
  ['--color-card-background-hover', 0.265, 2.2],
  ['--color-base-foreground', 0.955, 0.5],
  ['--color-muted-foreground', 0.76, 1.5],
  ['--color-subtle-foreground', 0.6, 2]
]
const LIGHT: [string, number, number][] = [
  ['--color-app-background', 0.982, 0.5],
  ['--color-titlebar-background', 0.975, 0.5],
  ['--color-content-background', 0.997, 0.4],
  ['--color-card-background', 1, 0],
  ['--color-card-background-hover', 0.985, 0.5],
  ['--color-base-foreground', 0.2, 1.2],
  ['--color-muted-foreground', 0.42, 2],
  ['--color-subtle-foreground', 0.52, 2.5]
]

function sheet(): HTMLStyleElement {
  let el = document.getElementById('mar-palette') as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = 'mar-palette'
    document.head.append(el)
  }
  return el
}

const rule = (steps: [string, number, number][], p: Palette): string =>
  steps.map(([n, l, k]) => `${n}: oklch(${l} ${(p.chroma * k).toFixed(4)} ${p.hue});`).join(' ')

watch(
  () => palette.id,
  (id) => {
    const p = PALETTES.find((x) => x.id === id) ?? PALETTES[0]!
    // Void is today's look: no override.
    sheet().textContent =
      id === 'void'
        ? ''
        : `:root[data-mar-ui='on']:not([data-ds-theme='light']) { ${rule(DARK, p)} }
:root[data-mar-ui='on'][data-ds-theme='light'] { ${rule(LIGHT, p)} }`
    try {
      localStorage.setItem(KEY, id)
    } catch {
      // Storage blocked: the pick lasts for this window only.
    }
  },
  { immediate: true }
)
