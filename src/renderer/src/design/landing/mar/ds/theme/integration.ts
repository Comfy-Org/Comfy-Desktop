import { ALEX, ALIAS_GROUPS, aliasKey, flat, MODES, resolve, TOKENS, type State } from './model'
import type { Rgba } from './color'

/**
 * The Integrate tab's reading: how the New Home's colours land in
 * @comfyorg/design-system, and what is left outside the tokens. The
 * hardcoded list comes from painting every token magenta on each surface
 * and keeping what didn't move (Nov 4).
 */

/** Where a token is written in ComfyUI_frontend. */
export function fileOf(id: string): string {
  const t = TOKENS.find((x) => x.id === id)!
  if (t.local) return 'Not exported (playground only)'
  if (t.rule) return `theme.css comment: ${t.rule}`
  if (t.litegraph) return `dark.json / light.json: litegraph_base.${t.litegraph}`
  if (t.shared) return 'theme.css @theme (one value)'
  return 'theme.css :root and light.json'
}

export type Verdict = 'Matches Alex' | 'Changes Alex' | 'New primitive'

const same = (a: Rgba, b: Rgba): boolean =>
  Math.abs(a.r - b.r) < 0.012 && Math.abs(a.g - b.g) < 0.012 && Math.abs(a.b - b.b) < 0.012

/** Each token in this start against Alex's stack, as painted. */
export function versusAlex(s: State): { id: string; verdict: Verdict; modes: string[] }[] {
  const mine = { dark: resolve(s, 'dark'), light: resolve(s, 'light') }
  const alex = { dark: resolve(ALEX, 'dark'), light: resolve(ALEX, 'light') }
  return TOKENS.filter((t) => !t.local).map((t) => {
    const moved = MODES.filter((m) => {
      const bg = mine[m].background!
      const a = flat(mine[m][t.id]!, bg)
      const b = flat(alex[m][t.id]!, alex[m].background!)
      return !same(a, b)
    })
    const usesNew = MODES.some((m) => {
      const v = s.map[m][t.id]
      return !!v && 'ref' in v && v.ref.startsWith('home-')
    })
    return {
      id: t.id,
      verdict: usesNew ? 'New primitive' : moved.length ? 'Changes Alex' : 'Matches Alex',
      modes: moved
    }
  })
}

/** Legacy names this start keeps as they are: no token carries them. */
export const untokened = (s: State): string[] =>
  ALIAS_GROUPS.filter((g) => g.id === 'proto')
    .flatMap((g) => g.names.map((n) => n.name))
    .filter((n) => s.aliases[aliasKey('proto', n)]?.token === 'keep')

/** Colours the New Home paints outside every token. */
export const HARDCODED: { what: string; value: string; where: string; then: string }[] = [
  {
    what: 'Member avatars',
    value: '#3a3a3d, #55555a, #46464b, #3a3a3e, #606066',
    where: 'ui/Avatar.vue, parts/MemberAvatar.vue, account.ts, mock.ts',
    then: 'muted, or foreground at 10–30%'
  },
  {
    what: 'Credits coin',
    value: '#ddbd31 (dark), oklch(0.66 0.13 85) (light)',
    where: 'parts/WorkspaceMenu.vue, mar/shell/marShell.css',
    then: 'credit (already a token)'
  },
  {
    what: 'Light page glow',
    value: 'oklch(0.84 0.06 290 / 0.35), oklch(0.9 0.04 290 / 0.3)',
    where: 'mar/shell/homeBackgrounds.css, marShell.css',
    then: 'Brand imagery, not a token: keep as is'
  },
  {
    what: 'Running dot (light)',
    value: 'oklch(0.68 0.15 155)',
    where: 'mar/shell/light.css',
    then: 'success'
  },
  {
    what: 'Hairlines',
    value: 'border-default and border-strong are transparent',
    where: 'mar/uiTuner.ts (Borders knob, None by default)',
    then: 'The Home draws none; ComfyUI needs border'
  },
  {
    what: 'Graph wires and slots',
    value: '#64b5f6 and the other type colours',
    where: 'mar/graph/canvasData.ts',
    then: 'Data colours, as in ComfyUI: not theme tokens'
  }
]

/** What ComfyUI asks of the tokens that the Home never needed. */
export const GAPS: { need: string; home: string; fallback: string }[] = [
  {
    need: 'Node header',
    home: 'None: the Home has no title bands.',
    fallback: 'charcoal-800 dark, charcoal-200 light: one step off the node body.'
  },
  {
    need: 'Canvas and grid',
    home: 'The graph’s own: content colour in dark, 0.955 grey in light.',
    fallback:
      'canvas = background (dark) and charcoal-100 (light); grid = foreground 11% / black 13%.'
  },
  {
    need: 'Node border',
    home: 'None: the Home has no hairlines.',
    fallback: 'border = foreground 9% / 5% (the Home’s edge line).'
  },
  {
    need: 'Primary (executing, Run)',
    home: 'The Home’s white button is foreground on background, not primary.',
    fallback: 'primary keeps Alex’s azure, so executing doesn’t read as selected.'
  },
  {
    need: 'Custom node colours',
    home: 'None: fixed in LGraphCanvas.node_colors, lightened +0.5 in light.',
    fallback: 'Checked in Contrast (Node colours); no token.'
  },
  {
    need: 'Hover and selected',
    home: 'Rows at white 10% (hover); no selected tint.',
    fallback:
      'accent = white 25% / black 16%, so accent/40 is the Home’s hover and accent/60 is selected.'
  },
  {
    need: 'One success for both modes',
    home: 'A green per theme (0.78 dark, 0.52 light).',
    fallback: 'The dark green, shared; the Home’s light green kept as is.'
  },
  {
    need: 'Floating panels',
    home: 'Glass: foreground 8% over the canvas.',
    fallback: 'popover = card (opaque).'
  }
]
