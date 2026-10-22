import { computed, reactive, ref, watch } from 'vue'
import { TOKENS, type Token } from './tokens'

/**
 * The draft: token value overrides and component token swaps. Applied live
 * to the gallery and the embedded prototype (CSS variables + an injected
 * stylesheet), kept in localStorage, and only written to source on Publish.
 */
const KEY = 'comfy.design.gallery.draft'

export interface Swap {
  /** Component id, axis and option the class belongs to (axis 'base' = all). */
  component: string
  componentName: string
  file: string
  axis: string
  option: string
  from: string
  to: string
  /** Token names before and after, for display. */
  fromToken: string
  toToken: string
  /** Draft-only CSS that previews the swap before publishing. */
  selector: string
  css: string
}

interface Draft {
  tokens: Record<string, string>
  swaps: Swap[]
  /** Consolidation: token name -> the token it merges into. */
  merges: Record<string, string>
}

function load(): Draft {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return { tokens: d.tokens ?? {}, swaps: d.swaps ?? [], merges: d.merges ?? {} }
  } catch {
    return { tokens: {}, swaps: [], merges: {} }
  }
}

export const draft = reactive<Draft>(load())
export const overrides = draft.tokens

/** Every document that shows the draft (gallery + prototype iframe). */
const targets = new Set<Document>([document])
const STYLE_ID = 'gallery-draft-swaps'

function applyTo(doc: Document): void {
  const style = doc.documentElement.style
  for (const t of TOKENS) {
    const v = draft.tokens[t.name]
    if (v === undefined) style.removeProperty(`--${t.name}`)
    else style.setProperty(`--${t.name}`, v)
  }
  // A merged token points at the one it merges into (font sizes carry
  // their line-height with them).
  for (const [from, to] of Object.entries(draft.merges)) {
    style.setProperty(`--${from}`, `var(--${to})`)
    if (from.startsWith('text-'))
      style.setProperty(`--${from}--line-height`, `var(--${to}--line-height)`)
  }
  let sheet = doc.getElementById(STYLE_ID)
  if (!sheet) {
    sheet = doc.createElement('style')
    sheet.id = STYLE_ID
    doc.head.appendChild(sheet)
  }
  sheet.textContent = [
    ...draft.swaps.map((s) => `${s.selector} { ${s.css} }`),
    ...shadowRules()
  ].join('\n')
}

/** Tailwind inlines shadow values into `shadow-*` utilities instead of
 *  reading --shadow-* variables, so drafted and merged shadows need their
 *  own rules to show up. */
function shadowRules(): string[] {
  const value = (name: string): string | undefined =>
    draft.tokens[name] ?? TOKENS.find((t) => t.name === name)?.value
  const changed = new Map<string, string>()
  for (const t of TOKENS)
    if (t.group === 'shadow' && draft.tokens[t.name] !== undefined)
      changed.set(t.name, draft.tokens[t.name]!)
  for (const [from, to] of Object.entries(draft.merges))
    if (from.startsWith('shadow-') && value(to)) changed.set(from, value(to)!)
  return [...changed].map(([name, v]) => {
    const cls = name.replace(/^shadow-/, '')
    return `.shadow-${cls}, .hover\\:shadow-${cls}:hover { box-shadow: ${v} !important; }`
  })
}

watch(
  draft,
  (d) => {
    localStorage.setItem(KEY, JSON.stringify(d))
    targets.forEach(applyTo)
  },
  { deep: true, immediate: true }
)

export function attach(doc: Document): void {
  targets.add(doc)
  applyTo(doc)
}
export function detach(doc: Document): void {
  targets.delete(doc)
}

// ── Tokens ─────────────────────────────────────────────────
export const valueOf = (t: Token): string => draft.tokens[t.name] ?? t.value
export const isChanged = (t: Token): boolean =>
  draft.tokens[t.name] !== undefined && draft.tokens[t.name] !== t.value
export function setToken(t: Token, value: string): void {
  if (value === t.value) delete draft.tokens[t.name]
  else draft.tokens[t.name] = value
}
export function resetToken(t: Token): void {
  delete draft.tokens[t.name]
}

// ── Swaps ──────────────────────────────────────────────────
const swapKey = (s: Pick<Swap, 'component' | 'axis' | 'option' | 'from'>): string =>
  `${s.component}|${s.axis}|${s.option}|${s.from}`
/** The draft swap for a source class, if any. */
export const swapFor = (
  s: Pick<Swap, 'component' | 'axis' | 'option' | 'from'>
): Swap | undefined => draft.swaps.find((x) => swapKey(x) === swapKey(s))
export function setSwap(s: Swap): void {
  const i = draft.swaps.findIndex((x) => swapKey(x) === swapKey(s))
  if (s.to === s.from) {
    if (i >= 0) draft.swaps.splice(i, 1)
  } else if (i >= 0) draft.swaps[i] = s
  else draft.swaps.push(s)
}
export function removeSwap(s: Swap): void {
  const i = draft.swaps.findIndex((x) => swapKey(x) === swapKey(s))
  if (i >= 0) draft.swaps.splice(i, 1)
}

// ── Whole draft ────────────────────────────────────────────
export const changedTokens = computed(() => TOKENS.filter(isChanged))
export const changedCount = computed(
  () => changedTokens.value.length + draft.swaps.length + Object.keys(draft.merges).length
)

// ── Merges (consolidation) ─────────────────────────────────
export const mergedInto = (t: Token): string | undefined => draft.merges[t.name]
export function mergeToken(from: Token, to: Token | null): void {
  if (!to || to.name === from.name) delete draft.merges[from.name]
  else draft.merges[from.name] = to.name
}

// ── Scoped reverts ─────────────────────────────────────────
export const swapsOf = (component: string): Swap[] =>
  draft.swaps.filter((s) => s.component === component)
export function revertComponent(component: string): void {
  for (let i = draft.swaps.length - 1; i >= 0; i--)
    if (draft.swaps[i]!.component === component) draft.swaps.splice(i, 1)
}
export function revertToken(t: Token): void {
  delete draft.tokens[t.name]
  delete draft.merges[t.name]
}
/** Kept for the old Copy CSS flow. */
export function exportCss(): string {
  const lines = changedTokens.value.map((t) => `  --${t.name}: ${draft.tokens[t.name]};`)
  return lines.length ? `@theme {\n${lines.join('\n')}\n}\n` : ''
}
export function discardDraft(): void {
  for (const k of Object.keys(draft.tokens)) delete draft.tokens[k]
  for (const k of Object.keys(draft.merges)) delete draft.merges[k]
  draft.swaps.splice(0)
}
export const resetAll = discardDraft

// ── Publish / restore (dev server endpoint, see publish-plugin.mjs) ─────
export const published = ref<string[]>([])

export async function refreshStatus(): Promise<void> {
  try {
    const r = await fetch('/__gallery/status')
    if (r.ok) published.value = (await r.json()).backedUp ?? []
  } catch {
    published.value = []
  }
}

export async function publish(): Promise<string[]> {
  const body = {
    tokens: Object.fromEntries(changedTokens.value.map((t) => [t.name, draft.tokens[t.name]])),
    swaps: draft.swaps.map(({ file, axis, option, from, to }) => ({
      file,
      axis,
      option,
      from,
      to
    })),
    merges: Object.entries(draft.merges).map(([from, to]) => ({ from, to }))
  }
  const r = await fetch('/__gallery/publish', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  const res = await r.json()
  if (!r.ok) throw new Error(res.error ?? 'Publish failed')
  discardDraft()
  await refreshStatus()
  return res.written as string[]
}

/** Restore every published file to its state before the first publish. */
export async function restoreOriginal(): Promise<string[]> {
  const r = await fetch('/__gallery/restore', { method: 'POST' })
  const res = await r.json()
  if (!r.ok) throw new Error(res.error ?? 'Restore failed')
  discardDraft()
  await refreshStatus()
  return res.restored as string[]
}
