import { apca, over, wcag, type Rgba } from './color'
import { NODE_COLORS, nodeColor, resolve, type Mode, type State } from './model'

/**
 * The pairs the Theme playground checks, by kind, with their bars:
 *   text     body text: WCAG 4.5:1 and APCA Lc 60
 *   label    secondary text, labels: WCAG 4.5:1 and Lc 45
 *   ui       icons, focus rings, status: WCAG 3:1 and Lc 30
 *   edge     borders and fills that tell surfaces apart: Lc 15 (APCA's
 *            floor for non-text); WCAG doesn't rule on decoration
 */
export type Kind = 'text' | 'label' | 'ui' | 'edge'
export const BARS: Record<Kind, { wcag?: number; lc: number; label: string }> = {
  text: { wcag: 4.5, lc: 60, label: 'Text' },
  label: { wcag: 4.5, lc: 45, label: 'Label' },
  ui: { wcag: 3, lc: 30, label: 'UI' },
  edge: { lc: 15, label: 'Edge' }
}

export interface Pair {
  id: string
  group: string
  label: string
  kind: Kind
  /** Bottom-up: the first is opaque, the rest painted on it. */
  bg: string[]
  fg: string
}

const P = (
  group: string,
  fg: string,
  bg: string[],
  kind: Kind,
  label = `${fg} on ${bg.join(' + ')}`
): Pair => ({ id: `${fg}@${bg.join('+')}`, group, label, kind, bg, fg })

export const PAIRS: Pair[] = [
  P('Text', 'foreground', ['background'], 'text'),
  P('Text', 'foreground', ['card'], 'text'),
  P('Text', 'foreground', ['popover'], 'text'),
  P('Text', 'foreground', ['background', 'selected'], 'text', 'foreground on selected row'),
  P('Text', 'foreground', ['input'], 'text'),
  P('Text', 'primary-foreground', ['primary'], 'text'),
  P('Text', 'muted-foreground', ['background'], 'label'),
  P('Text', 'muted-foreground', ['card'], 'label'),
  P('Text', 'muted-foreground', ['popover'], 'label'),
  P('Text', 'muted-foreground', ['input'], 'label'),
  P('Text', 'destructive', ['background'], 'ui'),
  P('UI', 'ring', ['background'], 'ui'),
  P('UI', 'primary', ['background'], 'ui'),
  P('UI', 'warning', ['background'], 'ui'),
  P('UI', 'success', ['background'], 'ui'),
  P('Surfaces', 'border', ['background'], 'edge'),
  P('Surfaces', 'border', ['card'], 'edge'),
  P('Surfaces', 'border', ['popover'], 'edge'),
  P('Surfaces', 'card', ['background'], 'edge'),
  P('Surfaces', 'input', ['card'], 'edge'),
  P('Surfaces', 'hover', ['background'], 'edge', 'hover row on background'),
  P('Surfaces', 'hover', ['card'], 'edge', 'hover row on card'),
  P('Surfaces', 'selected', ['background'], 'edge', 'selected row on background'),
  P('Canvas', 'node', ['canvas'], 'edge', 'node body on canvas'),
  P('Canvas', 'node-header', ['canvas'], 'edge', 'node header on canvas'),
  P('Canvas', 'node-border', ['canvas'], 'edge', 'node border on canvas'),
  P('Canvas', 'node-widget', ['node'], 'edge', 'widget on node body'),
  P('Canvas', 'node-foreground', ['node-header'], 'label', 'node title on header'),
  P('Canvas', 'foreground', ['canvas'], 'ui', 'selected outline on canvas'),
  P('Canvas', 'primary', ['canvas'], 'ui', 'executing outline on canvas'),
  P('Canvas', 'node-foreground', ['node'], 'label', 'widget label on node'),
  P('Canvas', 'node-foreground', ['node-widget'], 'label', 'widget label on widget'),
  P('Canvas', 'foreground', ['node-widget'], 'text', 'widget value on widget')
]

export interface Result {
  ratio: number
  lc: number
  pass: boolean
  /** Each bar on its own (WCAG is null where it doesn't rule). */
  wcagPass: boolean | null
  lcPass: boolean
  /** The two colours as painted. */
  fg: Rgba
  bg: Rgba
}

export function measure(fg: Rgba, bg: Rgba, kind: Kind): Result {
  const f = over(fg, bg)
  const ratio = wcag(f, bg)
  const lc = apca(f, bg)
  const bar = BARS[kind]
  const wcagPass = bar.wcag === undefined ? null : ratio >= bar.wcag
  const lcPass = Math.abs(lc) >= bar.lc
  return {
    ratio,
    lc,
    pass: lcPass && wcagPass !== false,
    wcagPass,
    lcPass,
    fg: f,
    bg
  }
}

/** Every pair in a mode, then each custom node colour's own. */
export function check(s: State, mode: Mode): Record<string, Result> {
  const tok = resolve(s, mode)
  const stack = (ids: string[]): Rgba =>
    ids.slice(1).reduce((acc, id) => over(tok[id]!, acc), over(tok[ids[0]!]!, tok.background!))
  const out: Record<string, Result> = {}
  for (const p of PAIRS) out[p.id] = measure(tok[p.fg]!, stack(p.bg), p.kind)
  const canvas = stack(['canvas'])
  for (const n of NODE_COLORS) {
    const body = nodeColor(n.bgcolor, mode)
    const head = nodeColor(n.color, mode)
    out[`${n.id}:text`] = measure(tok['node-foreground']!, body, 'label')
    out[`${n.id}:title`] = measure(tok['node-foreground']!, head, 'label')
    out[`${n.id}:canvas`] = measure(body, canvas, 'edge')
  }
  return out
}

export const NODE_PAIRS: { suffix: string; label: string; kind: Kind }[] = [
  { suffix: 'text', label: 'node-foreground on body', kind: 'label' },
  { suffix: 'title', label: 'title on header', kind: 'label' },
  { suffix: 'canvas', label: 'body on canvas', kind: 'edge' }
]
