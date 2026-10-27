import { reactive } from 'vue'
import { spaceById, type SpaceBrand } from './spaces'

/**
 * How an app looks to the people who use it, as a few tokens. Creators can
 * change all of them - by hand, with a theme, from a brand kit, or by
 * describing it to the agent - but only inside these guardrails, so every
 * app still works and looks good on every screen. The app page stays
 * Comfy's own components (no creator code on the page).
 */
export type AppFont = 'sans' | 'serif' | 'condensed' | 'rounded' | 'mono'
export type AppCorners = 'sharp' | 'soft' | 'round'
export type AppHeader = 'title' | 'hero' | 'minimal'

export interface AppTheme {
  mode: 'dark' | 'light'
  /** The Run button and highlights. */
  accent: string
  font: AppFont
  corners: AppCorners
  header: AppHeader
  /** Brand kit id: its logo replaces Comfy's in the header. */
  kit: string | null
  /** The Run button's words, for example "Relight it". */
  runLabel: string
  /** Quick-start presets above the inputs. */
  presets: boolean
  /** Dark page color from a brand kit (default: Comfy's). */
  surface?: string
}

export const DEFAULT_THEME: AppTheme = {
  mode: 'dark',
  accent: '#f4f4f5',
  font: 'sans',
  corners: 'soft',
  header: 'title',
  kit: null,
  runLabel: 'Run',
  presets: false
}
export const newTheme = (t: Partial<AppTheme> = {}): AppTheme => ({ ...DEFAULT_THEME, ...t })

/** The guardrails: the only values each token takes. */
export const ACCENTS = [
  '#f4f4f5',
  '#111113',
  '#8b7cf6',
  '#4f8cff',
  '#2bb3a3',
  '#7cc36b',
  '#e2b93b',
  '#f08a4b',
  '#e5687a'
]
export const FONTS: {
  id: AppFont
  label: string
  stack: string
  weight: number
  spacing: string
}[] = [
  {
    id: 'sans',
    label: 'Sans',
    stack: 'Inter, system-ui, sans-serif',
    weight: 650,
    spacing: '-0.02em'
  },
  {
    id: 'serif',
    label: 'Serif',
    stack: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
    weight: 500,
    spacing: '-0.01em'
  },
  {
    id: 'condensed',
    label: 'Condensed',
    stack: '"Helvetica Neue", "Arial Narrow", Arial, sans-serif',
    weight: 900,
    spacing: '-0.02em'
  },
  {
    id: 'rounded',
    label: 'Rounded',
    stack: 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif',
    weight: 750,
    spacing: '-0.01em'
  },
  {
    id: 'mono',
    label: 'Mono',
    stack: '"SF Mono", ui-monospace, Menlo, monospace',
    weight: 600,
    spacing: '-0.03em'
  }
]
export const fontOf = (id: AppFont) => FONTS.find((f) => f.id === id)!
export const CORNERS: { id: AppCorners; label: string }[] = [
  { id: 'sharp', label: 'Sharp' },
  { id: 'soft', label: 'Soft' },
  { id: 'round', label: 'Round' }
]
export const HEADERS: { id: AppHeader; label: string }[] = [
  { id: 'title', label: 'Title' },
  { id: 'hero', label: 'Cover image' },
  { id: 'minimal', label: 'Minimal' }
]

// --- Brand kits, saved in the workspace ---------------------------------------

export interface BrandKit {
  id: string
  name: string
  brand: SpaceBrand
  theme: Partial<AppTheme>
  /** Fonts and colors to show on its card. */
  colors: string[]
}

const fromSpace = (spaceId: string, theme: Partial<AppTheme>): BrandKit => {
  const sp = spaceById(spaceId)!
  return {
    id: spaceId,
    name: sp.brand.logo.name,
    brand: sp.brand,
    theme: { ...theme, accent: sp.brand.color, surface: sp.brand.theme?.surface },
    colors: [sp.brand.color, sp.brand.theme?.surface ?? '#0c0c0d', sp.brand.logo.bg ?? '#ffffff']
  }
}

export const BRAND_KITS = reactive<BrandKit[]>([
  {
    id: 'silverside',
    name: 'Silverside',
    brand: {
      color: '#d8d2c4',
      logo: { name: 'Silverside', mark: 'S', bg: '#d8d2c4', fg: '#141414' },
      headline: '',
      announcement: ''
    },
    theme: { accent: '#d8d2c4', font: 'serif', corners: 'sharp', mode: 'dark', surface: '#121211' },
    colors: ['#d8d2c4', '#121211', '#8a8377']
  },
  fromSpace('northwind', { font: 'condensed', corners: 'round', mode: 'dark' }),
  fromSpace('halcyon', { font: 'rounded', corners: 'round', mode: 'dark' }),
  fromSpace('atlas', { font: 'sans', corners: 'sharp', mode: 'dark' }),
  fromSpace('kite', { font: 'sans', corners: 'round', mode: 'dark' })
])
export const kitById = (id: string | null): BrandKit | undefined =>
  BRAND_KITS.find((k) => k.id === id)

/** A new kit read from a website (mocked): logo, colors, a font. */
export function addKitFromSite(url: string): BrandKit {
  const name =
    url
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split(/[./]/)[0]
      ?.replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase()) || 'Your brand'
  const kit: BrandKit = {
    id: `kit-${Date.now()}`,
    name,
    brand: {
      color: '#c8a46a',
      logo: { name, mark: name.charAt(0), bg: '#c8a46a', fg: '#14110f' },
      headline: '',
      announcement: ''
    },
    theme: { accent: '#c8a46a', font: 'serif', corners: 'sharp', mode: 'dark', surface: '#14110f' },
    colors: ['#c8a46a', '#14110f', '#efe7da']
  }
  BRAND_KITS.push(kit)
  return kit
}

// --- Curated themes ------------------------------------------------------------

export const THEMES: { id: string; label: string; hint: string; theme: Partial<AppTheme> }[] = [
  {
    id: 'studio',
    label: 'Studio',
    hint: 'Dark, quiet, the work up front',
    theme: { mode: 'dark', accent: '#f4f4f5', font: 'sans', corners: 'soft', header: 'title' }
  },
  {
    id: 'editorial',
    label: 'Editorial',
    hint: 'Light, serif, like a magazine',
    theme: { mode: 'light', accent: '#111113', font: 'serif', corners: 'sharp', header: 'hero' }
  },
  {
    id: 'playful',
    label: 'Playful',
    hint: 'Rounded, bright, friendly',
    theme: { mode: 'dark', accent: '#8b7cf6', font: 'rounded', corners: 'round', header: 'title' }
  },
  {
    id: 'technical',
    label: 'Technical',
    hint: 'Mono type, sharp, precise',
    theme: { mode: 'dark', accent: '#7cc36b', font: 'mono', corners: 'sharp', header: 'minimal' }
  },
  {
    id: 'gallery',
    label: 'Gallery',
    hint: 'Light and airy, a big cover',
    theme: { mode: 'light', accent: '#e5687a', font: 'sans', corners: 'round', header: 'hero' }
  }
]

// --- Applying a theme ------------------------------------------------------------

function onColor(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#111113' : '#ffffff'
}

const LIGHT: Record<string, string> = {
  '--color-app-background': '#f5f4f1',
  '--color-card-background': '#ffffff',
  '--color-card-background-hover': '#efeeea',
  '--color-base-foreground': '#17171a',
  '--color-muted-foreground': '#4f4f56',
  '--color-subtle-foreground': '#85858c',
  '--color-secondary-background': 'rgb(0 0 0 / 0.05)',
  '--color-secondary-background-hover': 'rgb(0 0 0 / 0.08)',
  '--color-border-default': 'rgb(0 0 0 / 0.09)',
  '--color-border-strong': 'rgb(0 0 0 / 0.16)',
  '--color-border-focus': 'rgb(0 0 0 / 0.4)'
}
const RADII: Record<AppCorners, Record<string, string>> = {
  sharp: { '--radius-card': '3px', '--radius-control': '2px', '--radius-panel': '4px' },
  soft: { '--radius-card': '12px', '--radius-control': '8px', '--radius-panel': '16px' },
  round: { '--radius-card': '22px', '--radius-control': '999px', '--radius-panel': '26px' }
}

/** CSS variables (and font) that put an app page in its theme. The page
 *  uses the design system's tokens, so overriding them themes it all. */
export function themeStyle(t: AppTheme): Record<string, string> {
  const f = fontOf(t.font)
  // A white accent on a light page would vanish: flip it to ink.
  const accent = t.mode === 'light' && t.accent === '#f4f4f5' ? '#111113' : t.accent
  return {
    ...(t.mode === 'light'
      ? LIGHT
      : t.surface
        ? { '--color-app-background': t.surface, '--color-card-background': t.surface }
        : {}),
    ...RADII[t.corners],
    '--color-inverted-background': accent,
    '--color-inverted-background-hover': `color-mix(in oklab, ${accent} 88%, white)`,
    '--color-inverted-foreground': onColor(accent),
    '--app-title-weight': String(f.weight),
    '--app-title-spacing': f.spacing,
    fontFamily: f.stack
  }
}

/** What changed, as readable chips (the Describe it recipe). */
export function recipe(t: AppTheme): { key: keyof AppTheme; label: string; value: string }[] {
  return [
    { key: 'kit', label: 'Brand', value: kitById(t.kit)?.name ?? 'Comfy' },
    { key: 'mode', label: 'Page', value: t.mode === 'dark' ? 'Dark' : 'Light' },
    { key: 'accent', label: 'Accent', value: t.accent },
    { key: 'font', label: 'Type', value: fontOf(t.font).label },
    { key: 'corners', label: 'Corners', value: CORNERS.find((c) => c.id === t.corners)!.label },
    { key: 'header', label: 'Header', value: HEADERS.find((h) => h.id === t.header)!.label },
    { key: 'runLabel', label: 'Button', value: t.runLabel }
  ]
}

/** "Describe it": words become tokens. Anything goes in the words; the
 *  result always lands inside the guardrails. */
export function themeFromWords(
  text: string,
  t: AppTheme
): { theme: AppTheme; layout?: 'left' | 'right' | 'bottom' } {
  const low = text.toLowerCase()
  const next = { ...t }
  let layout: 'left' | 'right' | 'bottom' | undefined
  const kit = BRAND_KITS.find((k) => low.includes(k.name.toLowerCase().split(/[\s-]/)[0]!))
  if (kit) Object.assign(next, kit.theme, { kit: kit.id })
  if (/light|white|bright page|airy|clean/.test(low)) next.mode = 'light'
  if (/dark|night|moody|black/.test(low)) next.mode = 'dark'
  if (/serif|editorial|elegant|luxury|magazine/.test(low)) next.font = 'serif'
  if (/bold|sneaker|sport|loud|drop|poster/.test(low)) {
    next.font = 'condensed'
    next.corners = 'round'
  }
  if (/friendly|soft|playful|fun|kids|cute/.test(low)) {
    next.font = 'rounded'
    next.corners = 'round'
  }
  if (/mono|technical|code|terminal|precise/.test(low)) {
    next.font = 'mono'
    next.corners = 'sharp'
  }
  if (/sharp|square|brutal/.test(low)) next.corners = 'sharp'
  const COLORS: [RegExp, string][] = [
    [/purple|violet/, '#8b7cf6'],
    [/blue/, '#4f8cff'],
    [/teal|turquoise/, '#2bb3a3'],
    [/green/, '#7cc36b'],
    [/yellow|gold/, '#e2b93b'],
    [/orange/, '#f08a4b'],
    [/pink|red|rose/, '#e5687a']
  ]
  const color = COLORS.find(([re]) => re.test(low))
  if (color) next.accent = color[1]
  if (/cover|hero|banner|big image/.test(low)) next.header = 'hero'
  if (/minimal|simple|nothing extra/.test(low)) next.header = 'minimal'
  if (/preset|example|starter/.test(low)) next.presets = true
  const label = /button (?:says|reads|label|should say) ["“]?([^"”.]+)/i.exec(text)?.[1]
  if (label) next.runLabel = label.trim().slice(0, 18)
  if (/chat|prompt bar|bottom|composer/.test(low)) layout = 'bottom'
  else if (/right/.test(low)) layout = 'right'
  else if (/left|side panel/.test(low)) layout = 'left'
  return { theme: next, layout }
}

/** Put a brand kit on (its colors, type, corners and logo), or take it
 *  off (null: back to Comfy's look, keeping the creator's other picks). */
export function withKit(t: AppTheme, id: string | null): AppTheme {
  const kit = kitById(id)
  if (!kit) return { ...t, kit: null, surface: undefined, accent: DEFAULT_THEME.accent }
  return { ...t, ...kit.theme, kit: kit.id }
}
