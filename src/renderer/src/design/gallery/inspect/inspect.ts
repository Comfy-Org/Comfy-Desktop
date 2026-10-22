import { stateCss, tokenUse, type PropKind, type TokenUse } from './classes'
import { identify, kitOf, selectorFor, sourceOf, type Kit, type Match } from './registry'
import { kitSource, occurrences } from './usage'

/**
 * Everything the panel shows for a selected element: which tokens it uses
 * (per property and state), what is hardcoded, and its layout values.
 */
export interface TokenRow {
  use: TokenUse
  /** Where the class is defined: a cva axis option, 'base', or 'file' (a
   *  class written once in the component's .vue file). null = call site,
   *  compound variant, or used more than once (ambiguous to publish). */
  source: { axis: string; option: string } | null
  /** Draft preview: selector + declaration for a swap, or null if unsupported. */
  selector: string | null
  stateSuffix: string | null
}

export interface RawRow {
  label: string
  value: string
  cls?: string
  note?: string
  offGrid?: boolean
}

export interface Inspection {
  name: string
  detail: string
  match: Match | null
  kit: Kit | null
  /** Token rows of the root element. */
  tokens: TokenRow[]
  /** The component's inner elements that use tokens (track, thumb, label…). */
  parts: { label: string; tokens: TokenRow[] }[]
  hardcoded: RawRow[]
  layout: RawRow[]
}

const ROLE_NAME: Record<string, string> = {
  switch: 'Switch',
  checkbox: 'Checkbox',
  tab: 'Tab',
  radio: 'Segment',
  menuitem: 'Menu item',
  menuitemcheckbox: 'Menu item',
  combobox: 'Select',
  meter: 'Meter',
  dialog: 'Dialog',
  tooltip: 'Tooltip',
  img: 'Icon'
}

const PART_NAME: Record<string, string> = {
  switch: 'Switch track',
  checkbox: 'Checkbox box',
  tab: 'Tab',
  tablist: 'Tab list',
  radio: 'Option'
}
function partLabel(el: HTMLElement): string {
  const role = el.getAttribute('role') ?? ''
  if (PART_NAME[role]) return PART_NAME[role]!
  if (el.tagName === 'LABEL') return 'Label'
  if (el.tagName === 'INPUT') return 'Input'
  if (el.tagName === 'H1' || el.tagName === 'H2' || el.tagName === 'H3') return 'Title'
  if (el.tagName === 'P') return 'Text'
  if (el.dataset.state !== undefined && el.parentElement?.getAttribute('role') === 'switch')
    return 'Thumb'
  return `<${el.tagName.toLowerCase()}>`
}

const px = (v: string): number | null => {
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec(v)
  return m ? Number(m[1]) : null
}
const off = (...vals: string[]): boolean =>
  vals.some((v) => {
    const n = px(v)
    return n !== null && n !== 0 && n % 4 !== 0
  })
const transparent = (v: string): boolean => v === 'rgba(0, 0, 0, 0)' || v === 'transparent'

const findClass = (el: HTMLElement, re: RegExp): string | undefined =>
  [...el.classList].find((c) => !c.includes(':') && re.test(c))

export function inspect(el: HTMLElement): Inspection {
  const match = identify(el)
  const kit = kitOf(el)
  // cva components publish into their variants file; the rest into their .vue.
  const file = match?.component.file ?? kit?.file ?? null
  const src = !match && kit ? kitSource(kit.file) : ''
  const cs = getComputedStyle(el)

  const rowsFor = (part: HTMLElement, cvaMatch: Match | null): TokenRow[] => {
    const own = [...part.classList]
    const rows: TokenRow[] = []
    for (const cls of own) {
      const use = tokenUse(cls)
      if (!use) continue
      const stateSuffix = stateCss(use.states)
      let source: TokenRow['source'] = null
      let selector: string | null = null
      if (cvaMatch) {
        source = sourceOf(cvaMatch, cls)
        if (source) selector = selectorFor(cvaMatch, source.axis, source.option)
      } else if (kit && occurrences(src || kitSource(kit.file), cls) === 1) {
        source = { axis: 'file', option: kit.file }
        selector = own.map((c) => `.${CSS.escape(c)}`).join('')
      }
      rows.push({ use, source, stateSuffix, selector: stateSuffix === null ? null : selector })
    }
    return rows
  }
  const tokens = rowsFor(el, match)

  // Inner elements of this component (not of nested kit components).
  const parts: Inspection['parts'] = []
  const walk = (node: Element): void => {
    for (const child of node.children) {
      if (!(child instanceof HTMLElement) && !(child instanceof SVGElement)) continue
      if (kitOf(child)) continue
      if (child instanceof HTMLElement) {
        const rows = rowsFor(child, null)
        if (rows.length) parts.push({ label: partLabel(child), tokens: rows })
      }
      if (parts.length < 6) walk(child)
    }
  }
  walk(el)

  // Properties with a default-state token don't need a raw row.
  const tokenized = new Set<PropKind>(
    tokens.filter((r) => !r.use.states.length).map((r) => r.use.kind)
  )
  const hardcoded: RawRow[] = []
  const check = (kind: PropKind, label: string, value: string, re: RegExp, skip = false) => {
    if (tokenized.has(kind) || skip) return
    const cls = findClass(el, re)
    if (!cls) return
    hardcoded.push({ label, value, cls, note: 'Not a token' })
  }
  check(
    'background',
    'Background',
    cs.backgroundColor,
    /^bg-(?!clip|cover|contain|center|no-repeat|linear|gradient)/,
    transparent(cs.backgroundColor)
  )
  check(
    'text',
    'Text color',
    cs.color,
    /^text-(?!left|center|right|justify|xs|sm|base|lg|xl|\d|ellipsis|clip|wrap|nowrap|balance|pretty)/
  )
  check(
    'border',
    'Border',
    cs.borderColor,
    /^border-(?!\d|t$|b$|l$|r$|x$|y$|solid|dashed|dotted|none|0)/,
    cs.borderStyle === 'none'
  )
  check(
    'radius',
    'Radius',
    parseFloat(cs.borderRadius) > 999 ? 'full (pill)' : cs.borderRadius,
    /^rounded/,
    cs.borderRadius === '0px'
  )
  check(
    'shadow',
    'Shadow',
    cs.boxShadow === 'none' ? 'none' : 'custom',
    /^shadow/,
    cs.boxShadow === 'none'
  )
  if (!tokenized.has('font-size') && findClass(el, /^text-(xs|sm|base|lg|xl|\[)/))
    hardcoded.push({
      label: 'Font size',
      value: cs.fontSize,
      cls: findClass(el, /^text-(xs|sm|base|lg|xl|\[)/),
      note: 'Not a token'
    })

  const pad = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft]
  const padding =
    new Set(pad).size === 1
      ? pad[0]!
      : pad[0] === pad[2] && pad[1] === pad[3]
        ? `${pad[0]} ${pad[1]}`
        : pad.join(' ')
  const layout: RawRow[] = [
    {
      label: 'Size',
      value: `${Math.round(el.offsetWidth)} × ${Math.round(el.offsetHeight)}px`,
      cls: findClass(el, /^(h|size|min-h)-/)
    },
    {
      label: 'Padding',
      value: padding,
      cls: findClass(el, /^(p|px|py|pt|pb|pl|pr)-/),
      offGrid: off(...pad)
    },
    ...(cs.display.includes('flex') || cs.display.includes('grid')
      ? [
          {
            label: 'Gap',
            value: cs.columnGap === 'normal' ? '0px' : cs.columnGap,
            cls: findClass(el, /^gap/),
            offGrid: off(cs.columnGap)
          }
        ]
      : []),
    {
      label: 'Font',
      value: `${cs.fontSize} / ${cs.lineHeight} · ${cs.fontWeight}`,
      cls: findClass(el, /^font-(medium|semibold|bold|normal)/)
    },
    ...(cs.borderStyle !== 'none' && cs.borderTopWidth !== '0px'
      ? [{ label: 'Border width', value: cs.borderTopWidth }]
      : [])
  ]
  const h = px(`${el.offsetHeight}px`)
  if (h !== null && h % 4 !== 0) layout[0]!.offGrid = true

  const role = el.getAttribute('role') ?? ''
  const name =
    kit?.name ?? match?.component.name ?? ROLE_NAME[role] ?? `<${el.tagName.toLowerCase()}>`
  const variants = match
    ? Object.entries(match.options)
        .map(([a, o]) => `${a} ${o}`)
        .join(' · ')
    : ''
  const detail = [variants, file && `ui/${file}`].filter(Boolean).join(' · ')

  return { name, detail, match, kit, tokens, parts, hardcoded, layout }
}
