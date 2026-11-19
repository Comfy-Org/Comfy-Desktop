import {
  addHslLightness,
  cssOf,
  hexToRgb,
  oklchToRgb,
  over,
  parseColor,
  rgbToHex,
  rgbToOklch,
  withAlpha,
  type Rgba
} from './color'

/**
 * The Theme playground's model: primitives (the charcoal curve and single
 * hues) → semantic tokens per mode → the names Desktop and the prototype
 * use today. Three starting points: the New Home as Mar's proposal paints
 * it (HOME), Alex's stack on ComfyUI_frontend (#22439 charcoal curve,
 * #22752 tokens) and origin/main, read from
 * packages/design-system/src/css/{_palette,theme}.css and
 * src/assets/palettes/{dark,light}.json.
 */
export type Mode = 'dark' | 'light'
export const MODES: Mode[] = ['dark', 'light']

export const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const

export interface Charcoal {
  /** OKLCH lightness per step, 50 → 950: the curve. */
  l: number[]
  /** OKLCH chroma per step (its shape), times `chroma`. */
  c: number[]
  hue: number
  chroma: number
  /** Per-step hues, when a scale isn't on one hue (main's). Moving the
   *  hue puts every step on it. */
  hues?: number[]
}

/** A token's value in one mode. */
export type Value =
  /** A primitive (`charcoal-900`, `white`, `azure-600`…), optionally at an opacity. */
  | { ref: string; pct?: number }
  /** Another token, optionally at an opacity (hover = accent at 40%). */
  | { token: string; pct?: number }
  /** A value that isn't on the palette (main's canvas #141414). */
  | { hex: string }

export interface Alias {
  /** The token it now means, or kept as it is (`keep`). */
  token: string
  pct?: number
}

export interface State {
  charcoal: Charcoal
  hues: Record<string, string>
  map: Record<Mode, Record<string, Value>>
  aliases: Record<string, Alias>
}

/** Single-value primitives: brand, status and the light-mode greys main uses. */
export const HUES: { id: string; use: string }[] = [
  { id: 'white', use: 'Foreground (dark)' },
  { id: 'black', use: '' },
  { id: 'azure-400', use: 'Primary (light)' },
  { id: 'azure-600', use: 'Primary (dark)' },
  { id: 'coral-500', use: 'Destructive (light)' },
  { id: 'coral-700', use: 'Destructive (dark)' },
  { id: 'gold-600', use: 'Warning (dark)' },
  { id: 'gold-700', use: 'Warning (light)' },
  { id: 'jade-600', use: 'Success' },
  { id: 'credit', use: 'Credits' },
  { id: 'magenta-700', use: 'Bypass' },
  { id: 'smoke-700', use: 'Node text (dark)' },
  { id: 'smoke-800', use: 'Muted text (dark)' },
  { id: 'home-green-dark', use: 'New Home: running (dark)' },
  { id: 'home-green-light', use: 'New Home: running (light)' },
  { id: 'home-red-dark', use: 'New Home: danger (dark)' },
  { id: 'home-red-light', use: 'New Home: danger (light)' }
]
const MAIN_HUES: Record<string, string> = {
  white: '#ffffff',
  black: '#000000',
  'azure-400': '#31b9f4',
  'azure-600': '#0b8ce9',
  'coral-500': '#f75951',
  'coral-700': '#b33a3a',
  'gold-600': '#fd9903',
  'gold-700': '#c77700',
  'jade-600': '#00cd72',
  credit: '#ddbd31',
  'magenta-700': '#6a246a',
  'smoke-700': '#a0a0a0',
  'smoke-800': '#8a8a8a',
  // Main's light theme reads these greys off the palette, not charcoal.
  'smoke-200': '#e9e9e9',
  'smoke-300': '#e1e1e1',
  'smoke-400': '#d9d9d9',
  'smoke-600': '#b4b4b4',
  'ash-800': '#444444'
}
/** Greys main's light theme uses; Alex's stack moves light onto charcoal. */
export const MAIN_ONLY_HUES = ['smoke-200', 'smoke-300', 'smoke-400', 'smoke-600', 'ash-800']

export interface TokenDef {
  id: string
  group: 'Core' | 'States' | 'Comfy'
  use: string
  /** One value for both modes (an @theme constant in theme.css). */
  shared?: boolean
  /** A Tailwind rule, not a variable (hover, selected). */
  rule?: string
  /** Lives in the palette JSON's litegraph_base, not in theme.css. */
  litegraph?: string
  /** Drawn by the playground only, not exported. */
  local?: boolean
}

export const TOKENS: TokenDef[] = [
  { id: 'background', group: 'Core', use: 'The app shell and page' },
  { id: 'foreground', group: 'Core', use: 'Text and icons' },
  { id: 'card', group: 'Core', use: 'Cards and raised panels' },
  { id: 'popover', group: 'Core', use: 'Menus and popovers' },
  { id: 'primary', group: 'Core', use: 'Primary action fill' },
  { id: 'primary-foreground', group: 'Core', use: 'Label on primary (#22752)' },
  { id: 'secondary', group: 'Core', use: 'Secondary fills' },
  { id: 'muted', group: 'Core', use: 'Quiet fills, scrollbars' },
  { id: 'muted-foreground', group: 'Core', use: 'Secondary text' },
  { id: 'accent', group: 'Core', use: 'Base of hover and selected' },
  { id: 'destructive', group: 'Core', use: 'Destructive actions, errors' },
  { id: 'border', group: 'Core', use: 'Hairlines on every surface' },
  { id: 'input', group: 'Core', use: 'Field fills (#22752)' },
  { id: 'ring', group: 'Core', use: 'Focus ring' },
  { id: 'hover', group: 'States', use: 'Rows, tabs, ghost buttons', rule: 'bg-accent/40' },
  { id: 'selected', group: 'States', use: 'The current row or tab', rule: 'bg-accent/60' },
  {
    id: 'canvas',
    group: 'Comfy',
    use: 'Graph canvas fill',
    litegraph: 'CLEAR_BACKGROUND_COLOR'
  },
  { id: 'canvas-grid', group: 'Comfy', use: 'Grid lines (lines only, #22900)', local: true },
  { id: 'node', group: 'Comfy', use: 'Node body' },
  { id: 'node-header', group: 'Comfy', use: 'Node title band' },
  {
    id: 'node-widget',
    group: 'Comfy',
    use: 'Widget fills in nodes (main: input; #22900 overrides it)',
    local: true
  },
  { id: 'node-border', group: 'Comfy', use: 'Node outline' },
  { id: 'node-foreground', group: 'Comfy', use: 'Widget labels and values' },
  { id: 'warning', group: 'Comfy', use: 'Warnings' },
  { id: 'success', group: 'Comfy', use: 'Running, done', shared: true },
  { id: 'credit', group: 'Comfy', use: 'Credits', shared: true },
  { id: 'bypass', group: 'Comfy', use: 'Bypassed nodes', shared: true }
]
export const tokenDef = (id: string): TokenDef => TOKENS.find((t) => t.id === id)!

// ── Charcoal ───────────────────────────────────────────────────────────

/** Alex's #22439 (Tailwind zinc's curve), fitted to OKLCH: exact to the hex. */
const ALEX_CHARCOAL: Charcoal = {
  l: [0.985, 0.967, 0.919, 0.871, 0.704, 0.551, 0.441, 0.37, 0.274, 0.21, 0.14],
  c: [0, 0.0013, 0.0027, 0.0041, 0.0086, 0.0107, 0.0097, 0.0085, 0.0036, 0.0039, 0.0022],
  hue: 286,
  chroma: 1
}
/** Main's charcoal (100 → 950, all dark; no 50), as hex. */
export const MAIN_CHARCOAL_HEX = [
  '#fafafa',
  '#55565e',
  '#494a50',
  '#3c3d42',
  '#313235',
  '#2d2e32',
  '#262729',
  '#202121',
  '#171718',
  '#111111',
  '#09090a'
]
const fit = (hexes: string[]): Charcoal => {
  const o = hexes.map((h) => rgbToOklch(hexToRgb(h)))
  return {
    l: o.map((x) => Math.round(x.l * 1000) / 1000),
    c: o.map((x) => Math.round(x.c * 10000) / 10000),
    hue: 286,
    chroma: 1,
    hues: o.map((x) => Math.round(x.h * 10) / 10)
  }
}

export function charcoalHex(ch: Charcoal): string[] {
  return ch.l.map((l, i) => rgbToHex(oklchToRgb(l, ch.c[i]! * ch.chroma, ch.hues?.[i] ?? ch.hue)))
}

/** Tailwind zinc's lightness curve: the curve's reset. */
export const ZINC_L = [...ALEX_CHARCOAL.l]

// ── Presets ────────────────────────────────────────────────────────────

const r = (ref: string, pct?: number): Value => (pct === undefined ? { ref } : { ref, pct })
const t = (token: string, pct?: number): Value => (pct === undefined ? { token } : { token, pct })
const c = (step: number): Value => ({ ref: `charcoal-${step}` })

const SHARED = {
  success: r('jade-600'),
  credit: r('credit'),
  bypass: r('magenta-700')
}

export const ALIAS_GROUPS: {
  id: string
  label: string
  source: string
  fixed?: boolean
  names: { name: string; uses?: number; note?: string }[]
}[] = [
  {
    id: 'proto',
    label: 'Prototype and Desktop renderer',
    source: 'src/renderer/src/design/landing/ui/tokens.css (Tailwind --color-*)',
    names: [
      { name: 'app-background', uses: 1, note: 'Glass page the sidebar sits on' },
      {
        name: 'titlebar-background',
        note: 'Also the panels sidebar: this mixed with white (6% dark, 40% light)'
      },
      { name: 'content-background', note: 'The inset content panel' },
      { name: 'base-foreground', uses: 96 },
      { name: 'muted-foreground', uses: 75 },
      { name: 'subtle-foreground', uses: 144, note: 'Tertiary text: merges into muted' },
      { name: 'card-background', uses: 22 },
      { name: 'card-background-hover', uses: 7 },
      { name: 'secondary-background', uses: 34 },
      { name: 'secondary-background-hover', uses: 10 },
      { name: 'inverted-background', uses: 9, note: 'Primary actions: white in dark' },
      { name: 'inverted-background-hover', uses: 2 },
      { name: 'inverted-foreground', uses: 8 },
      { name: 'border-default', uses: 18 },
      { name: 'border-strong', uses: 10 },
      { name: 'border-focus', uses: 19 },
      { name: 'media-overlay', uses: 10, note: 'Chips on imagery: same in both themes' },
      { name: 'status-running', uses: 7 },
      { name: 'status-danger', uses: 4 },
      { name: 'error-foreground' }
    ]
  },
  {
    id: 'desktop',
    label: 'Desktop app chrome',
    source: 'src/renderer/src/assets/main.css, chrome-void.css (plain --vars)',
    names: [
      { name: 'bg', uses: 27 },
      { name: 'surface', uses: 41 },
      { name: 'surface-recessed' },
      { name: 'text', uses: 154 },
      { name: 'text-muted', uses: 255 },
      { name: 'text-faint', uses: 9 },
      { name: 'border', uses: 77 },
      { name: 'border-hover', uses: 26 },
      {
        name: 'accent',
        uses: 136,
        note: 'Desktop’s primary action, not the shadcn accent: same name, other meaning'
      },
      { name: 'accent-hover' },
      { name: 'on-accent' },
      { name: 'selected' },
      { name: 'focus-ring', uses: 39 },
      { name: 'danger', uses: 77 },
      { name: 'warning', uses: 47 },
      { name: 'success', uses: 18 }
    ]
  },
  {
    id: 'frontend',
    label: 'Frontend deprecated aliases',
    source: 'packages/design-system/src/css/_deprecated-aliases.css (origin/main)',
    fixed: true,
    names: [
      { name: 'base-background' },
      { name: 'base-foreground' },
      { name: 'border-default' },
      { name: 'border-subtle' },
      { name: 'primary-background' },
      { name: 'secondary-background' },
      { name: 'secondary-background-hover' },
      { name: 'component-node-background' },
      { name: 'component-node-widget-background' },
      { name: 'component-node-widget-background-hovered' }
    ]
  }
]
export const aliasKey = (group: string, name: string): string => `${group}:${name}`

const a = (token: string, pct?: number): Alias => (pct === undefined ? { token } : { token, pct })
const ALIASES: Record<string, Alias> = {
  'proto:app-background': a('card'),
  'proto:titlebar-background': a('background'),
  'proto:content-background': a('background'),
  'proto:base-foreground': a('foreground'),
  'proto:muted-foreground': a('muted-foreground'),
  'proto:subtle-foreground': a('muted-foreground'),
  'proto:card-background': a('card'),
  'proto:card-background-hover': a('secondary'),
  'proto:secondary-background': a('secondary'),
  'proto:secondary-background-hover': a('accent'),
  'proto:inverted-background': a('foreground'),
  'proto:inverted-background-hover': a('foreground', 90),
  'proto:inverted-foreground': a('background'),
  'proto:border-default': a('border'),
  'proto:border-strong': a('foreground', 20),
  'proto:border-focus': a('ring'),
  'proto:media-overlay': a('keep'),
  'proto:status-running': a('success'),
  'proto:status-danger': a('destructive'),
  'proto:error-foreground': a('destructive'),
  'desktop:bg': a('background'),
  'desktop:surface': a('card'),
  'desktop:surface-recessed': a('background'),
  'desktop:text': a('foreground'),
  'desktop:text-muted': a('muted-foreground'),
  'desktop:text-faint': a('muted-foreground'),
  'desktop:border': a('border'),
  'desktop:border-hover': a('foreground', 20),
  'desktop:accent': a('foreground'),
  'desktop:accent-hover': a('foreground', 90),
  'desktop:on-accent': a('background'),
  'desktop:selected': a('foreground', 85),
  'desktop:focus-ring': a('ring'),
  'desktop:danger': a('destructive'),
  'desktop:warning': a('warning'),
  'desktop:success': a('success'),
  'frontend:base-background': a('background'),
  'frontend:base-foreground': a('foreground'),
  'frontend:border-default': a('border'),
  'frontend:border-subtle': a('border'),
  'frontend:primary-background': a('primary'),
  'frontend:secondary-background': a('secondary'),
  'frontend:secondary-background-hover': a('accent'),
  'frontend:component-node-background': a('node'),
  'frontend:component-node-widget-background': a('input'),
  'frontend:component-node-widget-background-hovered': a('accent')
}

const ALEX_HUES = Object.fromEntries(
  Object.entries(MAIN_HUES).filter(([k]) => !MAIN_ONLY_HUES.includes(k))
)

/** Alex's stack (#22439 + #22752), canvas from #22900's leading candidate. */
export const ALEX: State = {
  charcoal: ALEX_CHARCOAL,
  hues: ALEX_HUES,
  map: {
    dark: {
      background: c(950),
      foreground: r('white'),
      card: c(900),
      popover: t('background'),
      primary: r('azure-600'),
      'primary-foreground': r('white'),
      secondary: c(800),
      muted: c(700),
      'muted-foreground': r('smoke-800'),
      accent: c(700),
      destructive: r('coral-700'),
      border: r('white', 10),
      input: c(800),
      ring: t('muted-foreground'),
      hover: t('accent', 40),
      selected: t('accent', 60),
      // #22900's leading candidate: canvas 900, body 800, widgets 700.
      canvas: c(900),
      'canvas-grid': t('foreground', 6),
      node: c(800),
      'node-header': c(950),
      'node-widget': c(700),
      'node-border': c(700),
      'node-foreground': r('smoke-700'),
      warning: r('gold-600'),
      ...SHARED
    },
    light: {
      background: c(50),
      foreground: c(900),
      card: c(100),
      popover: t('background'),
      primary: r('azure-400'),
      'primary-foreground': c(900),
      secondary: c(200),
      muted: c(300),
      'muted-foreground': c(600),
      accent: c(300),
      destructive: r('coral-500'),
      border: r('black', 10),
      input: c(200),
      ring: c(400),
      hover: t('accent', 40),
      selected: t('accent', 60),
      // The stack leaves light's canvas as main has it.
      canvas: { hex: '#d3d3d3' },
      'canvas-grid': t('foreground', 6),
      node: t('card'),
      'node-header': c(50),
      'node-widget': t('input'),
      'node-border': c(300),
      'node-foreground': c(700),
      warning: r('gold-700'),
      ...SHARED
    }
  },
  aliases: ALIASES
}

/** origin/main. Hover was a solid accent and selected a solid muted. */
export const MAIN: State = {
  charcoal: fit(MAIN_CHARCOAL_HEX),
  hues: MAIN_HUES,
  map: {
    dark: {
      background: c(800),
      foreground: r('white'),
      card: c(600),
      popover: t('background'),
      primary: r('azure-600'),
      'primary-foreground': t('foreground'),
      secondary: c(600),
      muted: c(300),
      'muted-foreground': r('smoke-800'),
      accent: c(400),
      destructive: r('coral-700'),
      border: c(200),
      input: t('accent'),
      ring: t('muted-foreground'),
      hover: t('accent'),
      selected: t('muted'),
      canvas: { hex: '#141414' },
      'canvas-grid': { hex: '#222222' },
      node: t('card'),
      'node-header': c(700),
      'node-widget': t('input'),
      'node-border': c(100),
      'node-foreground': r('smoke-700'),
      warning: r('gold-600'),
      ...SHARED
    },
    light: {
      background: r('white'),
      foreground: c(800),
      card: r('white'),
      popover: t('background'),
      primary: r('azure-400'),
      'primary-foreground': t('foreground'),
      secondary: r('smoke-200'),
      muted: r('smoke-400'),
      'muted-foreground': c(200),
      accent: r('smoke-300'),
      destructive: r('coral-500'),
      border: r('smoke-600'),
      input: t('accent'),
      ring: r('smoke-800'),
      hover: t('accent'),
      selected: t('muted'),
      canvas: { hex: '#d3d3d3' },
      'canvas-grid': t('foreground', 6),
      node: t('card'),
      // Not in light.json: the stylesheet's dark default stays.
      'node-header': c(700),
      'node-widget': t('input'),
      'node-border': c(100),
      'node-foreground': r('ash-800'),
      warning: r('gold-700'),
      ...SHARED
    }
  },
  aliases: ALIASES
}

/**
 * The New Home as Mar's proposal paints it today (Graphite, Oct 30),
 * read off mar/palette.ts, mar/shell/light.css and the graph (MarGraph,
 * CanvasNode), put on the same primitive → token model. Nothing in the
 * prototype reads this: it is the playground's starting point only.
 * Where the Home has no token (no hairlines, a green per theme) its
 * legacy name is kept as is; the Integrate tab lists each case.
 */
const ok = (l: number, ch: number, h: number): string => rgbToHex(oklchToRgb(l, ch, h))
export const HOME_CHARCOAL: Charcoal = {
  // 50 light node · 100 dark text, light canvas · 200 light node title ·
  // 300 dark muted · 400 dark subtle · 500 light subtle · 600 light muted ·
  // 700 dark card hover · 800 dark card · 900 dark page, light text ·
  // 950 dark content and canvas.
  l: [0.985, 0.955, 0.93, 0.76, 0.6, 0.52, 0.42, 0.265, 0.23, 0.19, 0.14],
  // Graphite is pure grey: Alex's chroma shape at ×0, so Chroma brings it back.
  c: [...ALEX_CHARCOAL.c],
  hue: 285,
  chroma: 0
}
const HOME_HUES: Record<string, string> = {
  ...ALEX_HUES,
  'home-green-dark': ok(0.78, 0.15, 155),
  'home-green-light': ok(0.52, 0.14, 155),
  'home-red-dark': ok(0.62, 0.19, 25),
  'home-red-light': ok(0.55, 0.2, 25)
}
const HOME_ALIASES: Record<string, Alias> = {
  ...ALIASES,
  // The sidebar's page (one step up from the content in dark).
  'proto:app-background': a('muted'),
  'proto:subtle-foreground': a('muted-foreground', 80),
  'proto:card-background-hover': a('secondary'),
  'proto:secondary-background-hover': a('hover'),
  // The white button is foreground on background, as ComfyUI paints it
  // (bg-foreground text-background); primary stays its blue (executing).
  'proto:inverted-background': a('foreground'),
  'proto:inverted-background-hover': a('foreground', 90),
  'proto:inverted-foreground': a('background'),
  // The Home draws no hairlines and has a green per theme: no token yet.
  'proto:border-default': a('keep'),
  'proto:border-strong': a('keep'),
  'proto:status-running': a('keep')
}
export const HOME: State = {
  charcoal: HOME_CHARCOAL,
  hues: HOME_HUES,
  map: {
    dark: {
      background: c(950),
      foreground: c(100),
      card: c(800),
      popover: t('card'),
      primary: r('azure-600'),
      'primary-foreground': r('white'),
      secondary: r('white', 6),
      muted: c(900),
      'muted-foreground': c(300),
      // Hover 10% and selected 15% white, as the Home's rows.
      accent: r('white', 25),
      destructive: r('home-red-dark'),
      // The Home's edge line (--mar-edge-line): only ComfyUI draws it.
      border: t('foreground', 9),
      input: r('white', 5),
      ring: r('white', 45),
      hover: t('accent', 40),
      selected: t('accent', 60),
      canvas: c(950),
      'canvas-grid': t('foreground', 11),
      node: c(900),
      'node-header': c(800),
      'node-widget': r('white', 7),
      'node-border': t('border'),
      'node-foreground': c(300),
      warning: r('gold-600'),
      ...SHARED,
      success: r('home-green-dark')
    },
    light: {
      background: r('white'),
      foreground: c(900),
      card: r('white'),
      popover: t('card'),
      primary: r('azure-400'),
      'primary-foreground': c(900),
      secondary: r('black', 4),
      muted: c(50),
      'muted-foreground': c(600),
      accent: r('black', 16),
      destructive: r('home-red-light'),
      border: t('foreground', 5),
      input: r('black', 4),
      ring: r('black', 45),
      hover: t('accent', 40),
      selected: t('accent', 60),
      canvas: c(100),
      'canvas-grid': r('black', 13),
      node: c(50),
      'node-header': c(200),
      'node-widget': r('black', 5),
      'node-border': t('border'),
      'node-foreground': c(600),
      warning: r('gold-700'),
      ...SHARED,
      success: r('home-green-dark')
    }
  },
  aliases: HOME_ALIASES
}

export const clone = (s: State): State => JSON.parse(JSON.stringify(s))

// ── Resolving ──────────────────────────────────────────────────────────

/** Every primitive's hex: charcoal-50…950 and the single hues. */
export function primitives(s: State): Record<string, string> {
  const out: Record<string, string> = {}
  charcoalHex(s.charcoal).forEach((h, i) => (out[`charcoal-${STEPS[i]}`] = h))
  return { ...out, ...s.hues }
}

/** A token's colour (possibly translucent) in a mode. */
export function resolve(s: State, mode: Mode): Record<string, Rgba> {
  const prims = primitives(s)
  const map = s.map[mode]
  const out: Record<string, Rgba> = {}
  const get = (id: string, seen: string[] = []): Rgba => {
    if (out[id]) return out[id]!
    const v = map[id]
    let col: Rgba
    if (!v || seen.includes(id)) col = { r: 1, g: 0, b: 1, a: 1 }
    else if ('hex' in v) col = parseColor(v.hex)
    else if ('ref' in v)
      col = withAlpha(parseColor(prims[v.ref] ?? '#ff00ff'), (v.pct ?? 100) / 100)
    else col = withAlpha(get(v.token, [...seen, id]), (v.pct ?? 100) / 100)
    out[id] = col
    return col
  }
  for (const tk of TOKENS) get(tk.id)
  return out
}

/** Translucent tokens painted on what they sit on. */
export const flat = (c: Rgba, under: Rgba): Rgba => (c.a < 1 ? over(c, under) : c)

/** The custom node colours (LGraphCanvas.node_colors), as light mode
 *  draws them: HSL lightness + 0.5 (LIGHT_THEME_NODE_LIGHTNESS). */
export const NODE_COLORS: { id: string; color: string; bgcolor: string }[] = [
  { id: 'red', color: '#322', bgcolor: '#533' },
  { id: 'brown', color: '#332922', bgcolor: '#593930' },
  { id: 'green', color: '#232', bgcolor: '#353' },
  { id: 'blue', color: '#223', bgcolor: '#335' },
  { id: 'pale_blue', color: '#2a363b', bgcolor: '#3f5159' },
  { id: 'cyan', color: '#233', bgcolor: '#355' },
  { id: 'purple', color: '#323', bgcolor: '#535' },
  { id: 'yellow', color: '#432', bgcolor: '#653' },
  { id: 'black', color: '#222', bgcolor: '#000' }
]
export function nodeColor(hex: string, mode: Mode): Rgba {
  const c = hexToRgb(hex)
  return mode === 'light' ? addHslLightness(c, 0.5) : c
}

/** The CSS a specimen frame applies: tokens as --pg-*, then every alias. */
export function frameCss(s: State, mode: Mode): string {
  const tok = resolve(s, mode)
  const lines = Object.entries(tok).map(([k, v]) => `--pg-${k}: ${cssOf(v)}`)
  for (const g of ALIAS_GROUPS) {
    if (g.id === 'frontend') continue
    for (const n of g.names) {
      const al = s.aliases[aliasKey(g.id, n.name)]
      if (!al || al.token === 'keep') continue
      const val = cssOf(withAlpha(tok[al.token]!, (al.pct ?? 100) / 100))
      lines.push(g.id === 'proto' ? `--color-${n.name}: ${val}` : `--${n.name}: ${val}`)
    }
  }
  const decl = (vars: Record<string, string>): string =>
    Object.entries(vars)
      .map(([k, v]) => `${k}: ${v} !important`)
      .join('; ')
  return [
    `:root { ${lines.map((l) => `${l} !important`).join('; ')} }`,
    ...SURFACE.map(([sel, vars]) => `${sel} { ${decl(vars)} }`)
  ].join('\n')
}

/**
 * The surfaces that don't read the legacy names: the prototype's graph
 * editor (mar/graph: MarGraph's --mg-*, CanvasNode's --n-*), in both of
 * its looks, mapped onto the tokens the way ComfyUI's Vue nodes use them.
 */
const SURFACE: [string, Record<string, string>][] = [
  [
    '.mg',
    {
      '--mg-canvas': 'var(--pg-canvas)',
      '--mg-dot': 'var(--pg-canvas-grid)',
      '--mg-node': 'var(--pg-node)',
      '--mg-node-on': 'var(--pg-node)',
      '--mg-head-bg': 'var(--pg-node-header)',
      '--mg-well': 'var(--pg-input)',
      '--mg-well-line': 'var(--pg-border)',
      '--mg-float': 'var(--pg-popover)',
      '--mg-hover': 'var(--pg-hover)',
      '--mg-text': 'var(--pg-foreground)',
      '--mg-muted': 'var(--pg-muted-foreground)',
      '--mg-dim': 'var(--pg-muted-foreground)',
      '--mg-title': 'var(--pg-node-foreground)',
      '--mg-ring': 'var(--pg-canvas)',
      '--mg-chrome': 'var(--pg-background)',
      '--mg-chrome-2': 'var(--pg-secondary)',
      '--mg-chrome-line': 'var(--pg-border)',
      '--mg-run': 'var(--pg-primary)',
      '--mg-run-text': 'var(--pg-primary-foreground)'
    }
  ],
  [
    '.sg-node',
    {
      '--n-head': 'var(--pg-node-header)',
      '--n-body': 'var(--pg-node)',
      '--n-widget': 'var(--pg-node-widget)',
      '--n-widget-hover': 'var(--pg-accent)',
      '--n-widget-on': 'var(--pg-accent)',
      '--n-text': 'var(--pg-foreground)',
      '--n-slot-text': 'var(--pg-node-foreground)',
      '--n-icon': 'var(--pg-node-foreground)',
      '--n-outline': 'var(--pg-foreground)',
      '--n-exec': 'var(--pg-primary)',
      '--n-error': 'var(--pg-destructive)',
      '--n-bypass': 'var(--pg-bypass)'
    }
  ],
  // ComfyUI's nodes carry a 1px node-border; the prototype's have none.
  ['.sg-inner', { outline: '1px solid var(--pg-node-border)', 'outline-offset': '-1px' }]
]

/**
 * What ComfyUI (main) applies live (scripts/design/comfy-theme): the
 * theme.css names as the palette writes them on <html>, the @theme
 * constants, and litegraph's canvas fill. The same values as the export.
 */
export function liveTheme(
  s: State,
  mode: Mode
): { vars: Record<string, string>; litegraph: Record<string, string> } {
  const tok = resolve(s, mode)
  const vars: Record<string, string> = {}
  for (const t of TOKENS) {
    if (t.rule || t.local || t.litegraph) continue
    vars[t.shared ? `--color-${t.id}` : `--${t.id}`] = cssOf(tok[t.id]!)
  }
  return { vars, litegraph: { CLEAR_BACKGROUND_COLOR: cssOf(tok.canvas!) } }
}

// ── Export ─────────────────────────────────────────────────────────────

const pctCss = (base: string, pct: number, white?: 'white' | 'black'): string =>
  white
    ? `oklch(${white === 'white' ? 1 : 0} 0 0 / ${pct}%)`
    : `color-mix(in oklab, ${base} ${pct}%, transparent)`

function cssValue(v: Value, s: State): string {
  if ('hex' in v) return v.hex
  if ('ref' in v) {
    // Credit is a value of its own in theme.css, not a palette colour.
    if (v.ref === 'credit') return s.hues.credit!
    const base = `var(--color-${v.ref})`
    if (v.pct === undefined || v.pct === 100) return base
    return pctCss(base, v.pct, v.ref === 'white' || v.ref === 'black' ? v.ref : undefined)
  }
  const base = `var(--${v.token})`
  return v.pct === undefined || v.pct === 100 ? base : pctCss(base, v.pct)
}

export function exportPalette(s: State): string {
  const hex = charcoalHex(s.charcoal)
  const ok = s.charcoal.l.map((l, i) => {
    const r3 = (n: number, d: number): number => Math.round(n * 10 ** d) / 10 ** d
    const h = s.charcoal.hues?.[i] ?? s.charcoal.hue
    return `oklch(${r3(l, 3)} ${r3(s.charcoal.c[i]! * s.charcoal.chroma, 4)} ${r3(h, 1)})`
  })
  return [
    '  /* Palette Colors */',
    `  /* Charcoal: an OKLCH lightness curve, hue ${s.charcoal.hues ? 'per step' : s.charcoal.hue}, chroma ×${s.charcoal.chroma} */`,
    ...STEPS.map((st, i) => `  --color-charcoal-${st}: ${hex[i]}; /* ${ok[i]} */`)
  ].join('\n')
}

const ROOT_ORDER = TOKENS.filter((x) => !x.rule && !x.shared && !x.litegraph && !x.local).map(
  (x) => x.id
)

export function exportTheme(s: State): string {
  const d = s.map.dark
  const lines = ROOT_ORDER.map((id) => `  --${id}: ${cssValue(d[id]!, s)};`)
  const shared = TOKENS.filter((x) => x.shared).map(
    (x) => `  --color-${x.id}: ${cssValue(d[x.id]!, s)};`
  )
  return [
    '@theme {',
    ...shared,
    '}',
    '',
    ':root {',
    '  color-scheme: dark;',
    '',
    ...lines,
    '}',
    '',
    '@theme inline {',
    ...ROOT_ORDER.map((id) => `  --color-${id}: var(--${id});`),
    '}',
    '',
    `/* Hover: bg-accent/${pctOf(d.hover)}. Selected: bg-accent/${pctOf(d.selected)}. */`,
    ...(describe(d['node-widget']) === 'input'
      ? []
      : [
          `/* Node widgets: ${describe(d['node-widget'])} (today --component-node-widget-background: var(--input)). */`
        ])
  ].join('\n')
}
const pctOf = (v: Value | undefined): string =>
  v && 'token' in v ? `${v.pct ?? 100}${v.token === 'accent' ? '' : ` (of ${v.token})`}` : '?'

/** The palette JSON's `theme` (and the canvas fill), resolved to values. */
export function exportJson(s: State, mode: Mode): string {
  const tok = resolve(s, mode)
  const theme: Record<string, string> = {}
  for (const id of ROOT_ORDER) {
    const v = s.map[mode][id]!
    // A plain alias the stylesheet already makes needs no entry.
    if ('token' in v && v.pct === undefined && sameAsSheet(s, mode, id)) continue
    theme[id] =
      'ref' in v && v.pct !== undefined && (v.ref === 'white' || v.ref === 'black')
        ? cssValue(v, s)
        : cssOf(tok[id]!)
  }
  const canvas = cssOf(tok.canvas!)
  return JSON.stringify(
    { colors: { litegraph_base: { CLEAR_BACKGROUND_COLOR: canvas }, theme } },
    null,
    2
  )
}
function sameAsSheet(s: State, mode: Mode, id: string): boolean {
  const v = s.map[mode][id]!
  const d = s.map.dark[id]!
  return mode === 'dark' || JSON.stringify(v) === JSON.stringify(d)
}

export interface Change {
  where: string
  from: string
  to: string
}

/** What differs from main, value by value. */
export function diff(s: State): Change[] {
  const out: Change[] = []
  const a = charcoalHex(MAIN.charcoal)
  const b = charcoalHex(s.charcoal)
  STEPS.forEach((st, i) => {
    if (a[i] !== b[i]) out.push({ where: `charcoal-${st}`, from: i ? a[i]! : '—', to: b[i]! })
  })
  for (const m of MODES) {
    const ra = resolve(MAIN, m)
    const rb = resolve(s, m)
    for (const tk of TOKENS) {
      if (tk.local) continue
      if (tk.shared && m === 'light') continue
      const x = cssOf(ra[tk.id]!)
      const y = cssOf(rb[tk.id]!)
      const how = (st: State): string => describe(st.map[m][tk.id])
      if (x !== y || how(MAIN) !== how(s))
        out.push({
          where: `${tk.shared ? '' : `${m} · `}${tk.id}`,
          from: `${how(MAIN)} (${x})`,
          to: `${how(s)} (${y})`
        })
    }
  }
  return out
}

export function describe(v: Value | undefined): string {
  if (!v) return '—'
  if ('hex' in v) return v.hex
  const name = 'ref' in v ? v.ref : v.token
  return v.pct === undefined || v.pct === 100 ? name : `${name}/${v.pct}`
}

export function exportDiff(s: State): string {
  const ch = diff(s)
  if (!ch.length) return 'No change from main.'
  const w = Math.max(...ch.map((c) => c.where.length))
  return ch.map((c) => `${c.where.padEnd(w)}  ${c.from}  →  ${c.to}`).join('\n')
}
