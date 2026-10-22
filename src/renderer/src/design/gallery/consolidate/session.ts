import { computed, reactive, ref, watch } from 'vue'
import type { Token } from '../tokens'
import { mergeToken, setToken } from '../tweaks'
import { selection, stopEdit, tokenByName } from '../inspect/selection'
import { usageOf } from '../inspect/usage'
import {
  GROUP_LABEL,
  plan as runPlan,
  rulesFor,
  statsOf,
  type Choices,
  type ConsolidateGroup,
  type Rule,
  type RuleSetting
} from './rules'

/**
 * A consolidation session: started from a token section's Consolidate
 * button, for that group only. Step 1 sets the rules, step 2 reviews what
 * they propose (plus merges picked by hand). Nothing touches the draft
 * until "Add to draft"; Cancel throws the session away.
 */
export const session = ref<{ group: ConsolidateGroup; step: 'rules' | 'review' } | null>(null)
export const sessionLabel = computed(() => (session.value ? GROUP_LABEL[session.value.group] : ''))

export const choices = reactive<Choices & { picked: string[]; pickKeep: string | null }>({
  protect: new Set(),
  prefer: new Set(),
  skipSet: new Set(),
  manual: [],
  /** Tokens clicked in the section for a merge by hand. */
  picked: [],
  pickKeep: null
})

// ── Rule settings: per group, kept across sessions ─────────
const KEY = 'comfy.design.gallery.rules'
type Saved = Partial<Record<ConsolidateGroup, Record<string, Partial<RuleSetting>>>>
const saved = reactive<Saved>(JSON.parse(localStorage.getItem(KEY) ?? '{}'))
watch(saved, (s) => localStorage.setItem(KEY, JSON.stringify(s)), { deep: true })

export const stats = computed(() => (session.value ? statsOf(session.value.group) : null))

/** The proposed setting for a rule, from the group's numbers. */
export function proposed(rule: Rule): RuleSetting {
  const s = stats.value!
  return { on: rule.on(s), value: rule.param?.propose(s) ?? 0 }
}
export function settingOf(rule: Rule): RuleSetting {
  const own = saved[session.value!.group]?.[rule.id]
  return { ...proposed(rule), ...own }
}
export function setRule(rule: Rule, patch: Partial<RuleSetting>): void {
  const g = session.value!.group
  const group = (saved[g] ??= {})
  group[rule.id] = { ...group[rule.id], ...patch }
}
/** Is any rule in this group set differently from the proposal? */
export const customised = computed(() => {
  if (!session.value) return false
  return rulesFor(session.value.group).some((r) => {
    const a = settingOf(r)
    const b = proposed(r)
    return a.on !== b.on || (!!r.param && a.value !== b.value)
  })
})
export function resetRules(): void {
  if (session.value) delete saved[session.value.group]
}

// ── The plan ───────────────────────────────────────────────
export const plan = computed(() =>
  session.value ? runPlan(session.value.group, settingOf, choices) : null
)
export const reasonsOf = (t: Token): string[] => plan.value?.reasons.get(t.name) ?? []

/** Merges grouped by the token that stays. */
export const keepers = computed(() => {
  const out = new Map<string, { keep: Token; retire: Token[] }>()
  for (const m of plan.value?.merges.values() ?? []) {
    const g = out.get(m.into.name) ?? { keep: m.into, retire: [] }
    g.retire.push(m.from)
    out.set(m.into.name, g)
  }
  return [...out.values()]
})
/** Value changes on tokens that stay. */
export const valueChanges = computed(() => [...(plan.value?.sets.values() ?? [])])
export const changeCount = computed(
  () => (plan.value?.merges.size ?? 0) + (plan.value?.sets.size ?? 0)
)

/** How a token shows in its section while a session is open. */
export type Mark =
  | { kind: 'picked'; keep: boolean }
  | { kind: 'retire'; into: Token }
  | { kind: 'keep'; absorbs: number }
  | { kind: 'set'; value: string }
export function markOf(t: Token): Mark | null {
  if (!session.value || t.group !== session.value.group) return null
  if (choices.picked.includes(t.name))
    return { kind: 'picked', keep: pickKeeper.value?.name === t.name }
  const p = plan.value
  const m = p?.merges.get(t.name)
  if (m) return { kind: 'retire', into: m.into }
  const k = keepers.value.find((g) => g.keep.name === t.name)
  if (k) return { kind: 'keep', absorbs: k.retire.length }
  const s = p?.sets.get(t.name)
  return s ? { kind: 'set', value: s.value } : null
}

// ── Choices made while reviewing ───────────────────────────
/** "Keep this instead": the whole group merges into `t`. */
export function keepInstead(t: Token, current: Token): void {
  choices.prefer.delete(current.name)
  choices.prefer.add(t.name)
  choices.protect.delete(t.name)
}
export const dontMerge = (t: Token): void => void choices.protect.add(t.name)
export const dontChange = (t: Token): void => void choices.skipSet.add(t.name)
export function restore(name: string): void {
  choices.protect.delete(name)
  choices.skipSet.delete(name)
  choices.manual = choices.manual
    .map((m) => ({ ...m, retire: m.retire.filter((r) => r !== name) }))
    .filter((m) => m.retire.length && m.keep !== name)
}
/** Tokens the user kept out of the plan, to bring back. */
export const skipped = computed(() =>
  [...new Set([...choices.protect, ...choices.skipSet])].map((n) => tokenByName(n)!)
)
export const mergedByHand = computed(() => choices.manual.flatMap((m) => m.retire))

// ── Merge by hand ──────────────────────────────────────────
export function togglePick(t: Token): void {
  const i = choices.picked.indexOf(t.name)
  if (i >= 0) choices.picked.splice(i, 1)
  else choices.picked.push(t.name)
  if (choices.pickKeep && !choices.picked.includes(choices.pickKeep)) choices.pickKeep = null
  if (session.value) session.value.step = 'review'
}
/** The picked token that stays: chosen, or the most used. */
export const pickKeeper = computed<Token | null>(() => {
  const picked = choices.picked.map((n) => tokenByName(n)!)
  if (!picked.length) return null
  if (choices.pickKeep) return tokenByName(choices.pickKeep) ?? null
  return picked.reduce((a, b) => (usageOf(b).total > usageOf(a).total ? b : a))
})

export function mergePicked(): void {
  const keep = pickKeeper.value
  if (!keep || choices.picked.length < 2) return
  mergeByHand(
    keep,
    choices.picked.filter((n) => n !== keep.name).map((n) => tokenByName(n)!)
  )
  choices.picked = []
  choices.pickKeep = null
}
export function mergeByHand(keep: Token, retire: Token[]): void {
  for (const t of retire) restore(t.name)
  choices.manual.push({ keep: keep.name, retire: retire.map((t) => t.name) })
}

// ── Start / finish ─────────────────────────────────────────
export function startConsolidate(group: ConsolidateGroup): void {
  stopEdit()
  selection.value = null
  choices.protect.clear()
  choices.prefer.clear()
  choices.skipSet.clear()
  choices.manual = []
  choices.picked = []
  choices.pickKeep = null
  session.value = { group, step: 'rules' }
}
export function cancelConsolidate(): void {
  session.value = null
}
/** Put the plan into the draft and close the session. */
export function applyPlan(): number {
  const p = plan.value
  if (!p) return 0
  for (const m of p.merges.values()) mergeToken(m.from, m.into)
  for (const s of p.sets.values()) setToken(s.token, s.value)
  const n = changeCount.value
  session.value = null
  return n
}

/** Classes for a token's sample in its section while a session is open:
 *  retiring tokens fade, picked ones get the gallery accent ring. */
export function sampleClass(t: Token): string {
  const m = markOf(t)
  if (!session.value || t.group !== session.value.group) return ''
  if (m?.kind === 'picked')
    return 'cursor-pointer ring-2 ring-(--gallery-accent) ring-offset-2 ring-offset-card-background'
  if (m?.kind === 'retire') return 'cursor-pointer opacity-30'
  return 'cursor-pointer'
}
