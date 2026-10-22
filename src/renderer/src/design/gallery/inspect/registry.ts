import avatarSrc from '../../landing/ui/Avatar.vue?raw'
import badgeSrc from '../../landing/ui/badge.variants.ts?raw'
import buttonSrc from '../../landing/ui/button.variants.ts?raw'
import cardSrc from '../../landing/ui/card.variants.ts?raw'
import fieldSrc from '../../landing/ui/field.variants.ts?raw'
import { KIT_DIR, REPO_ROOT } from '../config'

/** Kit components live under this path (config.ts). */
const KIT_MARKER = `/${REPO_ROOT}/${KIT_DIR}/`

/**
 * Kit components defined with cva. Parsed from their source so the gallery
 * knows which classes each variant adds, can recognise a rendered element,
 * and can publish a token swap back into the right string.
 */
export interface CvaDef {
  base: string[]
  axes: Record<string, Record<string, string[]>>
}

export interface Component {
  id: string
  name: string
  /** Path relative to design/landing/ui (what the publish endpoint edits). */
  file: string
  def: CvaDef
}

const words = (s: string): string[] => s.split(/\s+/).filter(Boolean)
const strings = (s: string): string[] => [...s.matchAll(/'([^']*)'/g)].map((m) => m[1]!)

/** Text between the brace/bracket opening at `from` and its match. */
function block(src: string, from: number): string {
  const open = src[from]!
  const close = open === '{' ? '}' : ']'
  let depth = 0
  for (let i = from; i < src.length; i++) {
    if (src[i] === open) depth++
    else if (src[i] === close && --depth === 0) return src.slice(from + 1, i)
  }
  return ''
}

export function parseCva(source: string): CvaDef {
  const src = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  const start = src.indexOf('cva(')
  const body = start >= 0 ? src.slice(start) : src
  const def: CvaDef = { base: [], axes: {} }

  const baseAt = body.search(/\bbase:\s*/)
  if (baseAt >= 0) {
    const rest = body.slice(baseAt).replace(/^base:\s*/, '')
    def.base = rest.startsWith('[')
      ? words(strings(block(rest, 0)).join(' '))
      : words(/^'([^']*)'/.exec(rest)?.[1] ?? '')
  }

  const varAt = body.search(/\bvariants:\s*\{/)
  if (varAt >= 0) {
    const variants = block(body, body.indexOf('{', varAt))
    for (const m of variants.matchAll(/(\w+):\s*\{/g)) {
      const axis = m[1]!
      const inner = block(variants, m.index! + m[0].length - 1)
      def.axes[axis] = {}
      for (const o of inner.matchAll(/['"]?([\w-]+)['"]?\s*:\s*'([^']*)'/g))
        def.axes[axis]![o[1]!] = words(o[2]!)
    }
  }
  return def
}

export const COMPONENTS: Component[] = [
  { id: 'button', name: 'Button', file: 'button.variants.ts', def: parseCva(buttonSrc) },
  { id: 'badge', name: 'Badge', file: 'badge.variants.ts', def: parseCva(badgeSrc) },
  { id: 'card', name: 'Card', file: 'card.variants.ts', def: parseCva(cardSrc) },
  { id: 'field', name: 'Field', file: 'field.variants.ts', def: parseCva(fieldSrc) },
  { id: 'avatar', name: 'Avatar', file: 'Avatar.vue', def: parseCva(avatarSrc) }
]

export interface Match {
  component: Component
  /** Matched option per axis, e.g. { variant: 'primary', size: 'md' }. */
  options: Record<string, string>
  el: HTMLElement
}

const ratio = (needles: string[], have: Set<string>): number =>
  needles.length ? needles.filter((c) => have.has(c)).length / needles.length : 0

/** Recognise a kit component from its rendered classes. Tolerates a few
 *  classes dropped by tailwind-merge at the call site. */
export function identify(el: HTMLElement): Match | null {
  const have = new Set(el.classList)
  let best: { m: Match; score: number } | null = null
  for (const c of COMPONENTS) {
    const baseScore = ratio(c.def.base, have)
    if (baseScore < 0.75) continue
    const options: Record<string, string> = {}
    let axisScore = 0
    let axes = 0
    for (const [axis, opts] of Object.entries(c.def.axes)) {
      let top: [string, number] | null = null
      for (const [opt, cls] of Object.entries(opts)) {
        const r = ratio(cls, have)
        if (
          r > 0.6 &&
          (!top || r > top[1] || (r === top[1] && cls.length > (opts[top[0]]?.length ?? 0)))
        )
          top = [opt, r]
      }
      if (top) {
        options[axis] = top[0]
        axisScore += top[1]
        axes++
      }
    }
    // A generic base (Card is just `relative border`) needs a variant match too.
    if (c.def.base.length < 4 && !axes) continue
    const score = baseScore + axisScore
    if (!best || score > best.score) best = { m: { component: c, options, el }, score }
  }
  return best?.m ?? null
}

/** Where a class on a matched element comes from: base or an axis option.
 *  Classes from compound variants or the call site return null. */
export function sourceOf(m: Match, cls: string): { axis: string; option: string } | null {
  if (m.component.def.base.includes(cls)) return { axis: 'base', option: 'base' }
  for (const [axis, opt] of Object.entries(m.options))
    if (m.component.def.axes[axis]?.[opt]?.includes(cls)) return { axis, option: opt }
  return null
}

/** Selector for every element of this component with this axis option. */
export function selectorFor(m: Match, axis: string, option: string): string {
  const own = axis === 'base' ? [] : (m.component.def.axes[axis]?.[option] ?? [])
  const base = m.component.def.base.filter((c) => m.el.classList.contains(c))
  return [...new Set([...base, ...own])].map((c) => `.${CSS.escape(c)}`).join('')
}

// ── Any kit component (cva or not), via Vue's dev-mode instance info ──────
interface VNodeLike {
  el: unknown
  component?: { subTree: VNodeLike } | null
  children?: unknown
}
interface VueInstance {
  type: { __name?: string; __file?: string; name?: string }
  subTree: VNodeLike
  parent: VueInstance | null
}
export interface Kit {
  name: string
  /** File name inside landing/ui, e.g. 'Switch.vue'. */
  file: string
}

/** First real DOM element a vnode renders (components and fragments
 *  like reka's SelectRoot render no element of their own). */
function firstEl(v: VNodeLike | undefined, depth = 0): Element | null {
  if (!v || depth > 12) return null
  if (v.el instanceof Element) return v.el
  if (v.component) return firstEl(v.component.subTree, depth + 1)
  if (Array.isArray(v.children))
    for (const c of v.children as VNodeLike[]) {
      const el = firstEl(c, depth + 1)
      if (el) return el
    }
  return null
}

/** The kit component whose root element is `el`, if any. Uses the
 *  outermost one (MediaCard over the Card it renders). Dev builds only. */
export function kitOf(el: Element): Kit | null {
  let inst = (el as { __vueParentComponent?: VueInstance }).__vueParentComponent ?? null
  let found: Kit | null = null
  while (inst && firstEl(inst.subTree) === el) {
    const file = inst.type.__file ?? ''
    const at = file.indexOf(KIT_MARKER)
    if (at >= 0) {
      const name = file.slice(at + KIT_MARKER.length)
      found = { name: inst.type.__name ?? name.replace(/\.vue$/, ''), file: name }
    }
    inst = inst.parent
  }
  return found
}
