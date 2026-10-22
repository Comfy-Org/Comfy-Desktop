import { px, shortName, TOKENS, tokensIn, type Token } from '../tokens'
import { usageOf } from '../inspect/usage'
import { mergedInto, valueOf } from '../tweaks'
import { deltaE, parseColor, type Oklch } from '../color'

/**
 * Consolidation rules. Each rule is one entry in RULES: which token groups
 * it applies to, an optional number the user can tune, a proposed default
 * worked out from the tokens and their usage, and a `run` step.
 *
 * Rules run in order as a pipeline over the group's tokens: value fixes
 * first (minimum size, whole pixels, grid), then merges (same value, step,
 * look-alikes, usage). Each rule sees the result of the ones before it, so
 * two sizes rounded to the same value are caught by "Same value".
 */
export type ConsolidateGroup = 'color' | 'text' | 'radius' | 'shadow'
export const GROUP_LABEL: Record<ConsolidateGroup, string> = {
  color: 'Color',
  text: 'Type',
  radius: 'Radius',
  shadow: 'Elevation'
}

/** A token as the pipeline sees it: projected value and uses so far. */
export interface Entry {
  token: Token
  value: string
  uses: number
  files: number
}

/** Facts about a group, used to propose rule defaults and explain them. */
export interface Stats {
  label: string
  count: number
  median: number
  /** How many tokens carry 95% of all uses. */
  core: number
  oneFile: number
}

export interface Rule {
  id: string
  groups: ConsolidateGroup[]
  title: string
  /** One line on why, using the group's numbers. */
  why: (s: Stats, value: number) => string
  param?: {
    /** What the number is, shown next to the field. */
    label: string
    unit: string
    min: number
    max: (s: Stats) => number
    step?: number
    propose: (s: Stats) => number
  }
  /** Proposed on/off. */
  on: (s: Stats) => boolean
  run: (r: Run, value: number) => void
}

export interface Choices {
  /** Never retire these ("Don't merge"). */
  protect: Set<string>
  /** Keep these when they meet another token ("Keep this instead"). */
  prefer: Set<string>
  /** Don't change these values. */
  skipSet: Set<string>
  /** Merges picked by hand: run first, always win. */
  manual: { keep: string; retire: string[] }[]
}

export interface Plan {
  /** Retired token -> the token it merges into. */
  merges: Map<string, { from: Token; into: Token; rule: string }>
  sets: Map<string, { token: Token; value: string; rule: string }>
  /** Broke a rule but has no good neighbour: needs a person. */
  flagged: Map<string, { token: Token; rule: string }>
  reasons: Map<string, string[]>
  /** Tokens each rule touched. */
  hits: Record<string, number>
  before: number
  after: number
}

// ── Comparing tokens ───────────────────────────────────────

/** Tints are compared over the darkest and lightest solid colors in the
 *  kit, found by lightness so it survives renames and merges. */
const backdrops = (): Oklch[] => {
  const solid = tokensIn('color')
    .filter((t) => !mergedInto(t))
    .map((t) => parseColor(valueOf(t)))
    .filter((o): o is Oklch => !!o && o.alpha >= 1)
    .sort((a, b) => a.l - b.l)
  return solid.length ? [solid[0]!, solid[solid.length - 1]!] : []
}

/** How far apart two values are: px for sizes, perceptual ΔE (OKLab ×100)
 *  for colors, 0 or Infinity for anything else. */
export function gap(a: string, b: string): number {
  const ca = parseColor(a)
  const cb = parseColor(b)
  if (ca && cb) return deltaE(ca, cb, backdrops())
  const pa = px(a)
  const pb = px(b)
  if (pa !== null && pb !== null) return Math.abs(pa - pb)
  return a === b ? 0 : Infinity
}

/** A token's role, from its name. Only same-role tokens merge: a border
 *  and a surface can share a value and still mean different things. */
function role(t: Token): string {
  const s = shortName(t)
  if (t.group !== 'color') return t.group
  if (/foreground$/.test(s)) return 'foreground'
  if (/^border|edge$/.test(s)) return 'border'
  if (/background|^canvas$|^glass|overlay$|^scrim$/.test(s)) return 'surface'
  return s.replace(/-.*/, '')
}
/** Hover twins exist on purpose: never collapse a state into its base. */
export const isState = (t: Token): boolean => /-hover$/.test(shortName(t))
const related = (a: Token, b: Token): boolean =>
  shortName(a).startsWith(shortName(b)) || shortName(b).startsWith(shortName(a))
export const comparable = (a: Token, b: Token): boolean =>
  a.name !== b.name && role(a) === role(b) && !isState(a) && !isState(b) && !related(a, b)

// ── The pipeline ───────────────────────────────────────────

export class Run {
  readonly pool = new Map<string, Entry>()
  readonly plan: Plan
  rule = ''

  constructor(
    readonly group: ConsolidateGroup,
    private readonly choices: Choices
  ) {
    for (const t of tokensIn(group).filter((t) => !mergedInto(t))) {
      const u = usageOf(t)
      this.pool.set(t.name, { token: t, value: valueOf(t), uses: u.total, files: u.files.length })
    }
    this.plan = {
      merges: new Map(),
      sets: new Map(),
      flagged: new Map(),
      reasons: new Map(),
      hits: {},
      before: this.pool.size,
      after: this.pool.size
    }
  }

  live(): Entry[] {
    return [...this.pool.values()]
  }

  private note(name: string, reason: string): void {
    const list = this.plan.reasons.get(name) ?? []
    if (!list.includes(reason)) list.push(reason)
    this.plan.reasons.set(name, list)
    this.plan.hits[this.rule] = (this.plan.hits[this.rule] ?? 0) + 1
  }

  /** Change a value. `token` defaults to the entry's (line-heights pass
   *  their own). */
  set(e: Entry, value: string, reason: string, token = e.token): void {
    if (this.choices.skipSet.has(token.name) || value === valueOf(token)) return
    this.plan.sets.set(token.name, { token, value, rule: this.rule })
    if (token === e.token) e.value = value
    this.note(token.name, reason)
  }

  /** Retire `a` into `b`. Reasons don't name the keeper: chains re-point
   *  merges, and the review already shows what each token merges into.
   *  Respects "keep this instead" and "don't merge"
   *  unless forced (merges picked by hand). */
  merge(a: Entry, b: Entry, reason: string, force = false): boolean {
    let [from, into] = [a, b]
    if (!force && this.choices.prefer.has(a.token.name) && !this.choices.prefer.has(b.token.name))
      [from, into] = [b, a]
    if (!force && this.choices.protect.has(from.token.name)) return false
    if (!this.pool.has(from.token.name) || !this.pool.has(into.token.name)) return false
    this.pool.delete(from.token.name)
    into.uses += from.uses
    into.files = Math.max(into.files, from.files)
    const name = from.token.name
    this.plan.merges.set(name, { from: from.token, into: into.token, rule: this.rule })
    // Anything that was merging into `from` now goes straight to `into`.
    for (const m of this.plan.merges.values()) if (m.into.name === name) m.into = into.token
    this.plan.sets.delete(name)
    this.plan.sets.delete(`${name}--line-height`)
    this.plan.flagged.delete(name)
    this.plan.after = this.pool.size
    this.note(name, reason)
    return true
  }

  flag(e: Entry, reason: string): void {
    if (this.choices.protect.has(e.token.name)) return
    this.plan.flagged.set(e.token.name, { token: e.token, rule: this.rule })
    this.note(e.token.name, reason)
  }

  /** Closest live, same-role token, optionally within `max`. */
  nearest(e: Entry, max = Infinity, where: (o: Entry) => boolean = () => true): Entry | null {
    let best: Entry | null = null
    let bestGap = Infinity
    for (const o of this.pool.values()) {
      if (!comparable(e.token, o.token) || !where(o)) continue
      const d = gap(e.value, o.value)
      if (d <= max && d < bestGap) [best, bestGap] = [o, d]
    }
    return best
  }

  /** Least used first: they're the ones that should move. */
  byUses(): Entry[] {
    return this.live().sort((a, b) => a.uses - b.uses)
  }
}

const n = (e: Entry): number | null => px(e.value)
const isPx = (e: Entry): boolean => n(e) !== null

/** Closest whole value, preferring one no other token already has. */
function roundFree(r: Run, e: Entry, step = 1, floor = -Infinity): number {
  const x = n(e)!
  const taken = new Set(
    r
      .live()
      .filter((o) => o !== e)
      .map(n)
  )
  const opts = [Math.floor(x / step) * step, Math.ceil(x / step) * step]
    .map((v) => Math.max(floor, v))
    .sort((a, b) => Math.abs(a - x) - Math.abs(b - x))
  return opts.find((v) => !taken.has(v)) ?? opts[0]!
}

/** How far a one-off may travel to find a home. Further than this and
 *  merging would change how things look, so a person decides. */
const looseGap = (e: Entry): number => (parseColor(e.value) ? 5 : Math.max(4, (n(e) ?? 0) * 0.25))

/** Merge a one-off into a close neighbour, or flag it. */
function rehome(r: Run, e: Entry, why: string): void {
  if (isState(e.token) || r.plan.merges.has(e.token.name)) return
  const into = r.nearest(e, looseGap(e))
  if (!into || !r.merge(e, into, why)) r.flag(e, `${why} · no close neighbour`)
}

// ── Rules (pipeline order) ─────────────────────────────────

export const RULES: Rule[] = [
  {
    id: 'min-size',
    groups: ['text'],
    title: 'Minimum font size',
    param: { label: 'Smallest size', unit: 'px', min: 8, max: () => 16, propose: () => 12 },
    on: () => true,
    why: (_, v) => `Text under ${v}px is hard to read on desktop screens.`,
    run(r, v) {
      for (const e of r.live())
        if (isPx(e) && n(e)! < v) r.set(e, `${v}px`, `${e.value} is under ${v}px`)
    }
  },
  {
    id: 'whole-px',
    groups: ['text', 'radius'],
    title: 'Whole pixels only',
    on: () => true,
    why: () => 'Half pixels render soft and add sizes nobody can tell apart.',
    run(r) {
      for (const e of r.live())
        if (isPx(e) && !Number.isInteger(n(e)))
          r.set(e, `${roundFree(r, e)}px`, `${e.value} is not a whole pixel`)
    }
  },
  {
    id: 'grid',
    groups: ['radius'],
    title: 'On the grid',
    param: { label: 'Grid step', unit: 'px', min: 2, max: () => 8, step: 2, propose: () => 4 },
    on: () => true,
    why: (_, v) => `Radii in ${v}px steps keep nesting math simple (outer = inner + padding).`,
    run(r, v) {
      for (const e of r.live())
        if (isPx(e) && n(e)! % v)
          r.set(e, `${roundFree(r, e, v)}px`, `${e.value} is off the ${v}px grid`)
    }
  },
  {
    id: 'leading-grid',
    groups: ['text'],
    title: 'Line-heights on the grid',
    param: { label: 'Grid step', unit: 'px', min: 2, max: () => 8, step: 2, propose: () => 4 },
    on: () => true,
    why: (_, v) => `Line-heights in ${v}px steps keep text on the layout rhythm.`,
    run(r, v) {
      for (const e of r.live()) {
        const lh = TOKENS.find((t) => t.name === `${e.token.name}--line-height`)
        const x = lh && px(valueOf(lh))
        if (lh && x != null && x % v)
          r.set(e, `${Math.round(x / v) * v}px`, `line-height ${x}px is off the ${v}px grid`, lh)
      }
    }
  },
  {
    id: 'same-value',
    groups: ['color', 'text', 'radius', 'shadow'],
    title: 'Same value',
    on: () => true,
    why: () => 'Two names for one value make people guess which to use.',
    run(r) {
      for (const e of r.byUses()) {
        if (!r.pool.has(e.token.name)) continue
        const twin = r.nearest(e, 0, (o) => o.uses >= e.uses)
        if (twin) r.merge(e, twin, isPx(e) ? `same value (${e.value})` : 'same value')
      }
    }
  },
  {
    id: 'min-step',
    groups: ['text', 'radius'],
    title: 'Minimum step between sizes',
    param: {
      label: 'Smallest step',
      unit: 'px',
      min: 1,
      max: () => 8,
      propose: (s) => (s.label === 'Type' ? 2 : 4)
    },
    on: () => true,
    why: (_, v) => `Sizes less than ${v}px apart read as the same size.`,
    run(r, v) {
      for (let changed = true; changed; ) {
        changed = false
        const sized = r
          .live()
          .filter(isPx)
          .sort((a, b) => n(a)! - n(b)!)
        for (let i = 1; i < sized.length; i++) {
          const [a, b] = [sized[i - 1]!, sized[i]!]
          const d = n(b)! - n(a)!
          if (d === 0 || d >= v || !comparable(a.token, b.token)) continue
          const [from, into] = a.uses <= b.uses ? [a, b] : [b, a]
          if (r.merge(from, into, `only ${d}px apart`)) {
            changed = true
            break
          }
        }
      }
    }
  },
  {
    id: 'look-alike',
    groups: ['color'],
    title: 'Look-alike colors',
    param: {
      label: 'Largest difference',
      unit: 'ΔE',
      min: 0.5,
      max: () => 10,
      step: 0.5,
      propose: () => 2
    },
    on: () => true,
    why: (_, v) =>
      `Colors less than ${v} ΔE apart look the same. ΔE is perceptual distance in OKLCH; 2 is about the smallest difference people notice. A solid color never matches a tint; tints must match over both dark and light surfaces. Same role only.`,
    run(r, v) {
      for (const e of r.byUses()) {
        if (!r.pool.has(e.token.name)) continue
        const twin = r.nearest(e, v, (o) => o.uses >= e.uses)
        if (twin) r.merge(e, twin, `looks the same (ΔE ${gap(e.value, twin.value).toFixed(1)})`)
      }
    }
  },
  {
    id: 'rare',
    groups: ['color', 'text', 'radius', 'shadow'],
    title: 'Rarely used',
    param: {
      label: 'At most',
      unit: 'uses',
      min: 0,
      max: () => 20,
      propose: (s) => Math.min(5, Math.max(1, Math.round(s.median * 0.05)))
    },
    on: () => true,
    why: (s, v) =>
      `The median ${s.label.toLowerCase()} token is used ${s.median}×. At ${v}× or less it's a one-off; it moves to its closest neighbour.`,
    run(r, v) {
      for (const e of r.byUses())
        if (r.pool.has(e.token.name) && e.uses <= v)
          rehome(r, e, e.uses ? `used ${e.uses}×` : 'unused')
    }
  },
  {
    id: 'one-file',
    groups: ['color', 'text', 'radius', 'shadow'],
    title: 'Used in one file only',
    on: () => false,
    why: (s) =>
      `${s.oneFile} ${s.label.toLowerCase()} ${s.oneFile === 1 ? 'token appears' : 'tokens appear'} in a single file: local styling, not system.`,
    run(r) {
      for (const e of r.byUses())
        if (r.pool.has(e.token.name) && e.files === 1) rehome(r, e, 'used in 1 file')
    }
  },
  {
    id: 'cap',
    groups: ['color', 'text', 'radius', 'shadow'],
    title: 'Cap the scale',
    param: {
      label: 'Keep at most',
      unit: 'tokens',
      min: 1,
      max: (s) => s.count,
      propose: (s) => s.core
    },
    on: () => false,
    why: (s) =>
      `${s.core} of ${s.count} tokens carry 95% of all uses. The least used merge into their closest neighbour until the cap is met.`,
    run(r, v) {
      while (r.pool.size > v) {
        const moved = r
          .byUses()
          .filter((e) => !isState(e.token))
          .some((e) => {
            const into = r.nearest(e)
            return !!into && r.merge(e, into, `over the cap of ${v}`)
          })
        if (!moved) break
      }
    }
  }
]

export const rulesFor = (g: ConsolidateGroup): Rule[] => RULES.filter((r) => r.groups.includes(g))

export function statsOf(g: ConsolidateGroup): Stats {
  const live = tokensIn(g).filter((t) => !mergedInto(t))
  const uses = live.map((t) => usageOf(t).total).sort((a, b) => a - b)
  const total = uses.reduce((a, b) => a + b, 0)
  let core = 0
  for (let sum = 0, i = uses.length - 1; i >= 0 && sum < total * 0.95; i--, core++) sum += uses[i]!
  return {
    label: GROUP_LABEL[g],
    count: live.length,
    median: uses[Math.floor(uses.length / 2)] ?? 0,
    core: Math.max(1, core),
    oneFile: live.filter((t) => usageOf(t).files.length === 1).length
  }
}

export interface RuleSetting {
  on: boolean
  value: number
}

/** Run the enabled rules, after any merges picked by hand. */
export function plan(
  g: ConsolidateGroup,
  settings: (rule: Rule) => RuleSetting,
  choices: Choices
): Plan {
  const r = new Run(g, choices)
  r.rule = 'manual'
  for (const m of choices.manual) {
    const keep = r.pool.get(m.keep)
    for (const name of m.retire) {
      const e = r.pool.get(name)
      if (keep && e) r.merge(e, keep, 'merged by hand', true)
    }
  }
  for (const rule of rulesFor(g)) {
    const s = settings(rule)
    if (!s.on) continue
    r.rule = rule.id
    rule.run(r, s.value)
  }
  return r.plan
}
