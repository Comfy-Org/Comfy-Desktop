import { shortName, TOKENS, type Token, type TokenGroup } from '../tokens'

/**
 * Reads Tailwind utility classes and maps them to design tokens.
 * `hover:bg-secondary-background/60` -> state "Hover", property
 * "Background", token color-secondary-background, opacity 60.
 */
export type PropKind =
  | 'background'
  | 'text'
  | 'border'
  | 'ring'
  | 'outline'
  | 'fill'
  | 'stroke'
  | 'divide'
  | 'radius'
  | 'shadow'
  | 'font-size'
  | 'blur'

export interface TokenUse {
  cls: string
  states: string[]
  utility: string
  kind: PropKind
  token: Token
  opacity?: number
}

export const PROP_LABEL: Record<PropKind, string> = {
  background: 'Background',
  text: 'Text color',
  border: 'Border',
  ring: 'Ring',
  outline: 'Outline',
  fill: 'Fill',
  stroke: 'Stroke',
  divide: 'Divider',
  radius: 'Radius',
  shadow: 'Shadow',
  'font-size': 'Font size',
  blur: 'Blur'
}

/** Which token group a property draws from (for swapping). */
export const KIND_GROUP: Record<PropKind, TokenGroup> = {
  background: 'color',
  text: 'color',
  border: 'color',
  ring: 'color',
  outline: 'color',
  fill: 'color',
  stroke: 'color',
  divide: 'color',
  radius: 'radius',
  shadow: 'shadow',
  'font-size': 'text',
  blur: 'blur'
}

const COLOR_PREFIX: Record<string, PropKind> = {
  bg: 'background',
  text: 'text',
  border: 'border',
  'border-t': 'border',
  'border-b': 'border',
  'border-l': 'border',
  'border-r': 'border',
  ring: 'ring',
  outline: 'outline',
  fill: 'fill',
  stroke: 'stroke',
  divide: 'divide',
  placeholder: 'text'
}

// utility (without state/opacity) -> { kind, token }
const LOOKUP = new Map<string, { kind: PropKind; token: Token }>()
for (const t of TOKENS) {
  const s = shortName(t)
  if (t.group === 'color')
    for (const [p, kind] of Object.entries(COLOR_PREFIX))
      LOOKUP.set(`${p}-${s}`, { kind, token: t })
  if (t.group === 'radius')
    for (const side of ['', 't-', 'b-', 'l-', 'r-', 'tl-', 'tr-', 'bl-', 'br-'])
      LOOKUP.set(`rounded-${side}${s}`, { kind: 'radius', token: t })
  if (t.group === 'shadow') LOOKUP.set(`shadow-${s}`, { kind: 'shadow', token: t })
  if (t.group === 'text') LOOKUP.set(`text-${s}`, { kind: 'font-size', token: t })
  if (t.group === 'blur') {
    LOOKUP.set(`blur-${s}`, { kind: 'blur', token: t })
    LOOKUP.set(`backdrop-blur-${s}`, { kind: 'blur', token: t })
  }
}

/** Splits `hover:data-[state=on]:bg-x/60` into states, utility, opacity. */
export function splitClass(cls: string): { states: string[]; utility: string; opacity?: number } {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of cls) {
    if (ch === '[') depth++
    if (ch === ']') depth--
    if (ch === ':' && depth === 0) {
      parts.push(cur)
      cur = ''
    } else cur += ch
  }
  const last = cur.replace(/^!/, '')
  const m = /^(.*?)\/(\d+)$/.exec(last)
  return {
    states: parts,
    utility: m ? m[1]! : last,
    opacity: m ? Number(m[2]) : undefined
  }
}

export function tokenUse(cls: string): TokenUse | null {
  const { states, utility, opacity } = splitClass(cls)
  const hit = LOOKUP.get(utility)
  return hit ? { cls, states, utility, opacity, ...hit } : null
}

const STATE_LABEL: Record<string, string> = {
  hover: 'Hover',
  'focus-visible': 'Focus',
  'focus-within': 'Focus within',
  focus: 'Focus',
  active: 'Pressed',
  disabled: 'Disabled',
  'data-[state=checked]': 'Checked',
  'data-[state=on]': 'Selected',
  'data-[state=open]': 'Open',
  'data-[state=active]': 'Active',
  'data-highlighted': 'Highlighted',
  'group-hover': 'Group hover',
  placeholder: 'Placeholder',
  'has-[:disabled]': 'Disabled'
}
export const stateLabel = (states: string[]): string =>
  states.length ? states.map((s) => STATE_LABEL[s] ?? s).join(' + ') : 'Default'

/** CSS selector suffix for a state, or null if a draft override can't express it. */
const STATE_CSS: Record<string, string> = {
  hover: ':hover',
  'focus-visible': ':focus-visible',
  'focus-within': ':focus-within',
  focus: ':focus',
  active: ':active',
  disabled: ':disabled',
  'data-[state=checked]': '[data-state="checked"]',
  'data-[state=on]': '[data-state="on"]',
  'data-[state=open]': '[data-state="open"]',
  'data-[state=active]': '[data-state="active"]',
  'data-highlighted': '[data-highlighted]'
}
export function stateCss(states: string[]): string | null {
  let out = ''
  for (const s of states) {
    const css = STATE_CSS[s]
    if (css === undefined) return null
    out += css
  }
  return out
}

/** CSS declaration that makes `kind` use token `t` (with optional opacity). */
export function declaration(kind: PropKind, t: Token, opacity?: number): string {
  const v = `var(--${t.name})`
  const color = opacity ? `color-mix(in oklab, ${v} ${opacity}%, transparent)` : v
  switch (kind) {
    case 'background':
      return `background-color: ${color} !important;`
    case 'text':
      return `color: ${color} !important;`
    case 'border':
    case 'divide':
      return `border-color: ${color} !important;`
    case 'ring':
      return `--tw-ring-color: ${color} !important;`
    case 'outline':
      return `outline-color: ${color} !important;`
    case 'fill':
      return `fill: ${color} !important;`
    case 'stroke':
      return `stroke: ${color} !important;`
    case 'radius':
      return `border-radius: ${v} !important;`
    case 'shadow':
      return `box-shadow: ${v} !important;`
    case 'font-size':
      return `font-size: ${v} !important; line-height: var(--${t.name}--line-height) !important;`
    case 'blur':
      return `--tw-backdrop-blur: blur(${v}) !important;`
  }
}

/** The utility class for `kind` using token `t`, keeping states and opacity. */
export function swapClass(use: TokenUse, t: Token): string {
  const s = shortName(t)
  const prefix = use.utility.slice(0, use.utility.length - shortName(use.token).length)
  const util = `${prefix}${s}${use.opacity ? `/${use.opacity}` : ''}`
  return [...use.states, util].join(':')
}
