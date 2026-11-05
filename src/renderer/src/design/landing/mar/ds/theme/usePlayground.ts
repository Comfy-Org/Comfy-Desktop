import { computed, ref, watch } from 'vue'
import type { SelectOption } from '../../../ui/Select.vue'
import { cssOf } from './color'
import { CSS_KEY } from './apply'
import { check } from './checks'
import {
  ALEX,
  clone,
  diff,
  flat,
  frameCss,
  HOME,
  HUES,
  MAIN,
  MODES,
  primitives,
  resolve,
  STEPS,
  TOKENS,
  ZINC_L,
  type Mode,
  type State,
  type Value
} from './model'

/**
 * The Theme playground's state, shared by the studio's panels: kept in this
 * browser (localStorage), and written as CSS for the surface frames
 * (theme/apply.ts) on every change.
 */
// v3: starts from the New Home (Mar, Nov 4); primary stays azure.
const KEY = 'mar-ds.theme-playground.v3'
function load(): State {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '')
    if (s?.charcoal && s.map?.dark && s.map?.light && s.aliases) return s
  } catch {
    // A first visit, or an older shape: start from the New Home.
  }
  return clone(HOME)
}

export const state = ref<State>(load())
watch(
  state,
  (s) => {
    localStorage.setItem(KEY, JSON.stringify(s))
    localStorage.setItem(
      CSS_KEY,
      JSON.stringify({ dark: frameCss(s, 'dark'), light: frameCss(s, 'light') })
    )
  },
  { deep: true, immediate: true }
)
export const reset = (to: State): void => void (state.value = clone(to))

export const validHex = (v: string): boolean => /^#[0-9a-f]{6}$/i.test(v)

export const resolved = computed(() => ({
  dark: resolve(state.value, 'dark'),
  light: resolve(state.value, 'light')
}))
export const mainResolved = { dark: resolve(MAIN, 'dark'), light: resolve(MAIN, 'light') }

/** A token as it shows: translucent ones painted on the background. */
export const swatch = (m: Mode, id: string, from = resolved.value): string => {
  const c = from[m][id]!
  return cssOf(c.a < 1 ? flat(c, from[m].background!) : c)
}

export const results = computed(() => ({
  dark: check(state.value, 'dark'),
  light: check(state.value, 'light')
}))
export const changes = computed(() => diff(state.value).length)

// ── Primitives ─────────────────────────────────────────────────────────
export const hue = computed({
  get: () => state.value.charcoal.hue,
  set: (h: number) => {
    state.value.charcoal.hue = h
    delete state.value.charcoal.hues
  }
})
export function zinc(): void {
  state.value.charcoal.l = [...ZINC_L]
  state.value.charcoal.c = [...ALEX.charcoal.c]
  state.value.charcoal.chroma = 1
  delete state.value.charcoal.hues
}
export const hueList = computed(() =>
  Object.keys(state.value.hues).map((id) => ({
    id,
    use: HUES.find((h) => h.id === id)?.use ?? 'Main’s light theme'
  }))
)
export function setHue(id: string, v: string): void {
  if (validHex(v)) state.value.hues[id] = v.toLowerCase()
}

// ── Semantic mapping ───────────────────────────────────────────────────
export const valueOptions = computed<SelectOption[]>(() => {
  const prims = primitives(state.value)
  return [
    ...STEPS.map((st) => ({
      value: `ref:charcoal-${st}`,
      label: `charcoal-${st}`,
      hint: prims[`charcoal-${st}`],
      swatch: prims[`charcoal-${st}`]
    })),
    ...Object.keys(state.value.hues).map((id) => ({
      value: `ref:${id}`,
      label: id,
      hint: state.value.hues[id],
      swatch: state.value.hues[id]
    })),
    ...TOKENS.filter((t) => !t.rule && !t.local).map((t) => ({
      value: `token:${t.id}`,
      label: `→ ${t.id}`
    })),
    { value: 'hex', label: 'Off the palette (hex)' }
  ]
})
export const code = (v: Value | undefined): string =>
  !v ? '' : 'hex' in v ? 'hex' : 'ref' in v ? `ref:${v.ref}` : `token:${v.token}`
export function setCode(m: Mode, id: string, c: string): void {
  const map = state.value.map[m]
  const old = map[id]
  const pct = old && !('hex' in old) ? old.pct : undefined
  const keep = pct === undefined ? {} : { pct }
  const next: Value =
    c === 'hex'
      ? { hex: cssOf(resolved.value[m][id]!).slice(0, 7) }
      : c.startsWith('ref:')
        ? { ref: c.slice(4), ...keep }
        : { token: c.slice(6), ...keep }
  // A shared token is one value: both modes move together.
  if (TOKENS.find((t) => t.id === id)?.shared)
    for (const mm of MODES) state.value.map[mm][id] = { ...next }
  else map[id] = next
}
export const pctOf = (m: Mode, id: string): number => {
  const v = state.value.map[m][id]
  return v && !('hex' in v) ? (v.pct ?? 100) : 100
}
export function setPct(m: Mode, id: string, p: number): void {
  const v = state.value.map[m][id]
  if (!v || 'hex' in v) return
  if (p >= 100) delete v.pct
  else v.pct = Math.max(0, Math.round(p))
}
export function setHex(m: Mode, id: string, h: string): void {
  if (validHex(h)) state.value.map[m][id] = { hex: h.toLowerCase() }
}

// ── Legacy names ───────────────────────────────────────────────────────
export const aliasOptions: SelectOption[] = [
  ...TOKENS.filter((t) => !t.rule && !t.local).map((t) => ({ value: t.id, label: t.id })),
  { value: 'hover', label: 'hover (accent/40)' },
  { value: 'selected', label: 'selected (accent/60)' },
  { value: 'keep', label: 'Keep as is' }
]
export const aliasTo = (k: string): string => state.value.aliases[k]?.token ?? 'keep'
export function setAlias(k: string, token: string): void {
  const pct = state.value.aliases[k]?.pct
  state.value.aliases[k] = pct === undefined ? { token } : { token, pct }
}
export const aliasPct = (k: string): number => state.value.aliases[k]?.pct ?? 100
export function setAliasPct(k: string, p: number): void {
  const a = state.value.aliases[k]
  if (!a) return
  if (p >= 100) delete a.pct
  else a.pct = Math.max(0, Math.round(p))
}
export const aliasSwatch = (m: Mode, k: string): string | undefined => {
  const a = state.value.aliases[k]
  if (!a || a.token === 'keep') return undefined
  const c = resolved.value[m][a.token]!
  return cssOf(flat({ ...c, a: c.a * ((a.pct ?? 100) / 100) }, resolved.value[m].background!))
}

/** Which theme the panels edit and show first: the surface's. */
export const editing = ref<Mode>('dark')
export const compare = ref(true)
