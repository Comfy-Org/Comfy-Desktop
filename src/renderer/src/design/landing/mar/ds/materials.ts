/**
 * Materials · Blur (pages/MaterialsPage.vue, pages/MaterialsDoc.vue).
 *
 * LEVELS is the reading of the code: which glass recipes are in use and
 * who uses them. The values on the page are never typed here: specimens
 * carry the real selectors and show their computed style, and the
 * inventory below is parsed from the source files as they are now.
 */

export interface Level {
  id: string
  name: string
  /** Who uses it, in the default view unless said otherwise. */
  usedBy: string
  /** Where it is defined (paths from `landing/`). */
  defined: string
  /** The variables it would share, when consolidated. */
  prefix?: string
  /** Not glass on purpose, or not in the default view. */
  note?: string
}

export const LEVELS: Level[] = [
  {
    id: 'menu',
    name: 'Glass · menu',
    usedBy:
      'Every dropdown, select and popover: Create, workspace menu, credits flyout, run-on picker, build switcher, View menu, item kebab menus.',
    defined:
      'mar/shell/marShell.css (the family: radius, padding, ring, shadow) + mar/menus/layers.css (surface and blur; loads after it)',
    prefix: '--mar-glass-menu'
  },
  {
    id: 'palette',
    name: 'Glass · palette',
    usedBy: 'The ⌘K search palette.',
    defined: 'mar/search/search.css (.mar-search)',
    prefix: '--mar-glass-palette'
  },
  {
    id: 'tooltip',
    name: 'Glass · tooltip',
    usedBy: 'Every tooltip (ui/Tooltip.vue).',
    defined: 'mar/shell/marShell.css (.mar-tip)',
    prefix: '--mar-glass-tip'
  },
  {
    id: 'modal',
    name: 'Glass · modal',
    usedBy: 'Template modal, Deploy as API, the install wizard.',
    defined:
      'mar/templateModal/templateModal.css (.mar-tpl), mar/deploy/deploy.css (.mar-dep), mar/shell/marShell.css (.mar-wizard)',
    prefix: '--mar-glass-modal'
  },
  {
    id: 'scrim',
    name: 'Scrim',
    usedBy: 'Behind every modal.',
    defined:
      'mar/templateModal/templateModal.css (.mar-tpl-scrim), mar/deploy/deploy.css (.mar-dep-scrim), mar/shell/marShell.css (wizard), ui/DialogContent.vue (Pablo’s dialogs)',
    prefix: '--mar-scrim'
  },
  {
    id: 'bar',
    name: 'Glass · floating bar',
    usedBy: 'The select bar at the foot of a library page while items are picked.',
    defined: 'mar/pages/MarSelectBar.vue (.mar-selbar)',
    prefix: '--mar-glass-bar'
  },
  {
    id: 'chip',
    name: 'Glass · chip on media',
    usedBy:
      'Status chips, the star, the kebab and the select check on a picture; media and category chips.',
    defined:
      'mar/pages/MarStatus.vue (.on-media), mar/FavoriteStar.vue, mar/pages/MarItemMenu.vue, mar/pages/MarItem.vue, mar/MediaChip.vue, mar/CategoryChip.vue; token --color-media-overlay (ui/tokens.css, the New UI value in mar/shell/marShell.css)',
    prefix: '--mar-glass-chip'
  },
  {
    id: 'composer',
    name: 'Surface · prompt',
    usedBy: 'Home’s prompt box.',
    defined: 'mar/shell/marShell.css (.mar-prompt.bg-card-background, .mar-composer)',
    prefix: '--mar-glass-composer'
  },
  {
    id: 'control',
    name: 'Surface · control on the page',
    usedBy: 'Filters, selects and fields in a page’s toolbar, and bordered buttons.',
    defined: 'mar/shell/marShell.css (fields over the backdrop, Select trigger, bordered button)',
    prefix: '--mar-control'
  },
  {
    id: 'card',
    name: 'Card · on the page',
    usedBy: 'Workflow, space and row cards; library grid items.',
    defined:
      'mar/shell/marShell.css (.proto-main .bg-card-background, .mar-surface), mar/pages/MarItem.vue (.mar-item.is-grid)',
    note: 'Blurred today; the rule says solid. See the proposal below.'
  },
  {
    id: 'panel',
    name: 'Glass · sidebar',
    usedBy:
      'The floating sidebar (UI Playground › Navigation). The default (Classic) sidebar is solid.',
    defined: 'mar/shell/MarSidebar.vue (.mar-side, scoped)',
    prefix: '--mar-glass-panel',
    note: 'Not in the default view.'
  },
  {
    id: 'titlebar',
    name: 'Title bar',
    usedBy:
      'Solid in the default view (Classic). Glass only in the browser preview with another navigation, so the page photo runs under it.',
    defined: 'mar/shell/marShell.css (.glass-titlebar)',
    note: 'Solid by default.'
  },
  {
    id: 'toast',
    name: 'Toast',
    usedBy: 'Every confirmation, top right, in a tone: blue, green, orange or red.',
    defined: 'mar/pages/MarUndoToast.vue',
    note: 'Tinted glass: the tone over a blurred card.'
  }
]

/** One `backdrop-filter` (or Tailwind `backdrop-blur-*`) in the source. */
export interface Use {
  file: string
  line: number
  selector: string
  value: string
}

// Tailwind 4's scale, plus the prototype's own `--blur-glass` (ui/tokens.css).
const TW_BLUR: Record<string, string> = {
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '24px',
  '2xl': '40px',
  '3xl': '64px',
  glass: '28px'
}

const SOURCES = import.meta.glob(
  [
    '../**/*.{css,vue}',
    '!../ds/**',
    '../../ui/**/*.{css,vue,ts}',
    '../../parts/**/*.vue',
    '../../portal/**/*.vue'
  ],
  { query: '?raw', import: 'default', eager: true }
) as Record<string, string>

/** The selector of the rule a line sits in: the lines up to its `{`. */
function selectorAt(lines: string[], i: number): string {
  let open = i
  while (open >= 0 && !lines[open]!.includes('{')) open--
  if (open < 0) return ''
  const parts = [lines[open]!.split('{')[0]!.trim()]
  for (let j = open - 1; j >= 0; j--) {
    const l = lines[j]!.trim()
    if (!l || /[};{]$|\*\/$|^</.test(l)) break
    parts.unshift(l)
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

function parse(): Use[] {
  const uses: Use[] = []
  for (const [path, raw] of Object.entries(SOURCES)) {
    const file = path.replace(/^\.\.\/\.\.\//, '').replace(/^\.\.\//, 'mar/')
    const lines = raw.split('\n')
    lines.forEach((text, i) => {
      const css = /backdrop-filter:\s*([^;]+);/.exec(text)
      if (css && css[1]!.trim() !== 'none')
        uses.push({ file, line: i + 1, selector: selectorAt(lines, i), value: css[1]!.trim() })
      for (const m of text.matchAll(/backdrop-blur-(\[[^\]]+\]|[a-z0-9]+)/g)) {
        const k = m[1]!
        const px = k.startsWith('[') ? k.slice(1, -1) : TW_BLUR[k]
        const sat = /backdrop-saturate-\[([^\]]+)\]/.exec(text)
        uses.push({
          file,
          line: i + 1,
          selector: `class="… backdrop-blur-${k} …"`,
          value: `blur(${px ?? k})${sat ? ` saturate(${sat[1]})` : ''}`
        })
      }
    })
  }
  return uses.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
}

export const USES = parse()

/** Folders that are explorations behind other knobs, not the default view. */
const ELSEWHERE =
  /^mar\/(p20|graph|agent|explore|learn|build\/MarBuildOverview|MarStart(Original|Reel))/

export const isDefault = (u: Use): boolean =>
  !ELSEWHERE.test(u.file) && !u.file.startsWith('portal/')

/** Uses grouped by value, the most repeated first. */
export function byValue(uses: Use[]): { value: string; uses: Use[] }[] {
  const map = new Map<string, Use[]>()
  for (const u of uses) map.set(u.value, [...(map.get(u.value) ?? []), u])
  return [...map.entries()]
    .map(([value, list]) => ({ value, uses: list }))
    .sort((a, b) => b.uses.length - a.uses.length || a.value.localeCompare(b.value))
}

/** A source file's text by its path from `landing/`. */
function source(file: string): string | undefined {
  const key = file.startsWith('mar/') ? `../${file.slice(4)}` : `../../${file}`
  return SOURCES[key]
}

export interface Snippet {
  file: string
  line: number
  code: string
}

/**
 * The whole CSS rule around the `nth` line that contains `needle`, as it
 * is in the file now (or that one line, for a Tailwind class list or a
 * token). Undefined when the code has moved on; the page says so.
 */
export function snippet(file: string, needle: string, nth = 0, whole = true): Snippet | undefined {
  const lines = source(file)?.split('\n')
  if (!lines) return undefined
  const hits = lines.flatMap((l, i) => (l.includes(needle) ? [i] : []))
  const at = hits[nth]
  if (at === undefined) return undefined
  if (!whole) return { file, line: at + 1, code: lines[at]!.trim() }
  // Inside a rule's body: back to its `{`; in a selector: on to it.
  let open = at
  while (open >= 0 && !/[{}]/.test(lines[open]!)) open--
  if (open < 0 || lines[open]!.includes('}') || open === at) {
    open = at
    while (open < lines.length && !lines[open]!.includes('{')) open++
  }
  let start = open
  while (start > 0) {
    const prev = lines[start - 1]!.trim()
    if (!prev || /[};{]$|\*\/$|^</.test(prev)) break
    start--
  }
  let depth = 0
  let end = open
  for (; end < lines.length; end++) {
    depth += (lines[end]!.match(/\{/g) ?? []).length - (lines[end]!.match(/\}/g) ?? []).length
    if (depth <= 0) break
  }
  return { file, line: start + 1, code: lines.slice(start, end + 1).join('\n') }
}
