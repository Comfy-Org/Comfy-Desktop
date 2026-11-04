<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Check, Copy, RotateCcw, X } from 'lucide-vue-next'
import Button from '../../../ui/Button.vue'
import Input from '../../../ui/Input.vue'
import NumberField from '../../../ui/NumberField.vue'
import Select, { type SelectOption } from '../../../ui/Select.vue'
import Switch from '../../../ui/Switch.vue'
import MarSeg from '../../pages/MarSeg.vue'
import { cssOf } from '../theme/color'
import { CSS_KEY } from '../theme/apply'
import { BARS, check, NODE_PAIRS, PAIRS, type Kind, type Result } from '../theme/checks'
import {
  ALEX,
  ALIAS_GROUPS,
  aliasKey,
  charcoalHex,
  clone,
  describe,
  diff,
  exportDiff,
  exportJson,
  exportPalette,
  exportTheme,
  flat,
  frameCss,
  HUES,
  MAIN,
  MODES,
  NODE_COLORS,
  primitives,
  resolve,
  STEPS,
  TOKENS,
  ZINC_L,
  type Mode,
  type State,
  type Value
} from '../theme/model'

/**
 * Theme playground: primitives → semantic tokens → every product, in dark
 * and light side by side, with contrast checks and a patch for
 * @comfyorg/design-system. State lives in this browser (localStorage);
 * the specimen frames read the tokens through theme/apply.ts.
 */
const KEY = 'mar-ds.theme-playground.v1'
function load(): State {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '')
    if (s?.charcoal && s.map?.dark && s.map?.light && s.aliases) return s
  } catch {
    // A first visit, or an older shape: start from Alex's.
  }
  return clone(ALEX)
}
const state = ref<State>(load())
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
const reset = (to: State): void => void (state.value = clone(to))

// ── Primitives ───────────────────────────────────────────────────────
const hexes = computed(() => charcoalHex(state.value.charcoal))
const textOn = (hex: string): string =>
  parseInt(hex.slice(1, 3), 16) > 140 ? '#09090a' : '#fafafa'
const hue = computed({
  get: () => state.value.charcoal.hue,
  set: (h: number) => {
    state.value.charcoal.hue = h
    delete state.value.charcoal.hues
  }
})
function zinc(): void {
  state.value.charcoal.l = [...ZINC_L]
  state.value.charcoal.c = [...ALEX.charcoal.c]
  state.value.charcoal.chroma = 1
  delete state.value.charcoal.hues
}
// The curve, drawn: lightness per step.
const curve = computed(() =>
  state.value.charcoal.l
    .map((l, i) => `${(i / (STEPS.length - 1)) * 100},${(1 - l) * 100}`)
    .join(' ')
)
const hueList = computed(() =>
  Object.keys(state.value.hues).map((id) => ({
    id,
    use: HUES.find((h) => h.id === id)?.use ?? 'Main’s light theme'
  }))
)
const validHex = (v: string): boolean => /^#[0-9a-f]{6}$/i.test(v)
function setHue(id: string, v: string): void {
  if (validHex(v)) state.value.hues[id] = v.toLowerCase()
}

// ── Semantic mapping ─────────────────────────────────────────────────
const prims = computed(() => primitives(state.value))
const valueOptions = computed<SelectOption[]>(() => [
  ...STEPS.map((st) => ({
    value: `ref:charcoal-${st}`,
    label: `charcoal-${st}`,
    hint: prims.value[`charcoal-${st}`],
    swatch: prims.value[`charcoal-${st}`]
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
])
const code = (v: Value | undefined): string =>
  !v ? '' : 'hex' in v ? 'hex' : 'ref' in v ? `ref:${v.ref}` : `token:${v.token}`
function setCode(m: Mode, id: string, c: string): void {
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
const pctOf = (m: Mode, id: string): number => {
  const v = state.value.map[m][id]
  return v && !('hex' in v) ? (v.pct ?? 100) : 100
}
function setPct(m: Mode, id: string, p: number): void {
  const v = state.value.map[m][id]
  if (!v || 'hex' in v) return
  if (p >= 100) delete v.pct
  else v.pct = Math.max(0, Math.round(p))
}
function setHex(m: Mode, id: string, h: string): void {
  if (validHex(h)) state.value.map[m][id] = { hex: h.toLowerCase() }
}
const resolved = computed(() => ({
  dark: resolve(state.value, 'dark'),
  light: resolve(state.value, 'light')
}))
const mainResolved = { dark: resolve(MAIN, 'dark'), light: resolve(MAIN, 'light') }
const compare = ref(true)
const swatch = (m: Mode, id: string, from = resolved.value): string => {
  const c = from[m][id]!
  return cssOf(c.a < 1 ? flat(c, from[m].background!) : c)
}
const shownValue = (m: Mode, id: string): string => cssOf(resolved.value[m][id]!)
const groups = ['Core', 'States', 'Comfy'] as const

// ── Specimens ────────────────────────────────────────────────────────
type Screen = 'none' | 'mac' | 'windows' | 'glare'
const SCREENS: { value: Screen; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'mac', label: 'Mac' },
  { value: 'windows', label: 'Dim Windows laptop' },
  { value: 'glare', label: 'Glare' }
]
const SCREEN_NOTES: Record<Screen, string> = {
  none: 'As the values are.',
  mac: 'A bright, high-contrast panel: a little more contrast and colour.',
  windows: 'A dim, low-contrast laptop panel: darks crush together (gamma 1.5), brightness at 85%.',
  glare: 'Ambient light on the screen: blacks lift, everything washes towards grey.'
}
const screen = ref<Screen>('none')
const heights = ref<Record<string, number>>({})
const frames = ref<HTMLIFrameElement[]>([])
function onMessage(e: MessageEvent): void {
  const f = frames.value.find((x) => x.contentWindow === e.source)
  if (f && e.data?.type === 'mar-ds:height')
    heights.value = { ...heights.value, [f.dataset.theme!]: e.data.h }
}
onMounted(() => window.addEventListener('message', onMessage))
onBeforeUnmount(() => window.removeEventListener('message', onMessage))
const src = (m: Mode): string => `?frame=tokens&theme=${m}&proposal=mariana&pg=1`

// ── Contrast ─────────────────────────────────────────────────────────
const results = computed(() => ({
  dark: check(state.value, 'dark'),
  light: check(state.value, 'light')
}))
const failingOnly = ref(false)
interface Row {
  id: string
  group: string
  label: string
  kind: Kind
}
const ROWS: Row[] = [
  ...PAIRS.map((p) => ({ id: p.id, group: p.group, label: p.label, kind: p.kind })),
  ...NODE_COLORS.flatMap((n) =>
    NODE_PAIRS.map((np) => ({
      id: `${n.id}:${np.suffix}`,
      group: 'Node colours',
      label: `${n.id.replace('_', ' ')} · ${np.label}`,
      kind: np.kind
    }))
  )
]
const rows = computed(() =>
  ROWS.filter((r) => !failingOnly.value || MODES.some((m) => !results.value[m][r.id]!.pass))
)
const fails = computed(() =>
  MODES.map((m) => ({ m, n: ROWS.filter((r) => !results.value[m][r.id]!.pass).length }))
)
const fmt = (r: Result): { ratio: string; lc: string } => ({
  ratio: `${r.ratio.toFixed(2)}`,
  lc: `${Math.round(r.lc)}`
})
const barText = (k: Kind): string => {
  const b = BARS[k]
  return `${b.label}: ${b.wcag ? `${b.wcag}:1 · ` : ''}Lc ${b.lc}`
}

// ── Legacy names ─────────────────────────────────────────────────────
const aliasOptions: SelectOption[] = [
  ...TOKENS.filter((t) => !t.rule && !t.local).map((t) => ({ value: t.id, label: t.id })),
  { value: 'hover', label: 'hover (accent/40)' },
  { value: 'selected', label: 'selected (accent/60)' },
  { value: 'keep', label: 'Keep as is' }
]
const aliasTo = (k: string): string => state.value.aliases[k]?.token ?? 'keep'
function setAlias(k: string, token: string): void {
  const pct = state.value.aliases[k]?.pct
  state.value.aliases[k] = pct === undefined ? { token } : { token, pct }
}
const aliasPct = (k: string): number => state.value.aliases[k]?.pct ?? 100
function setAliasPct(k: string, p: number): void {
  const a = state.value.aliases[k]
  if (!a) return
  if (p >= 100) delete a.pct
  else a.pct = Math.max(0, Math.round(p))
}
const aliasSwatch = (m: Mode, k: string): string | undefined => {
  const a = state.value.aliases[k]
  if (!a || a.token === 'keep') return undefined
  const c = resolved.value[m][a.token]!
  const al = { ...c, a: c.a * ((a.pct ?? 100) / 100) }
  return cssOf(flat(al, resolved.value[m].background!))
}
const varName = (group: string, name: string): string =>
  group === 'proto' ? `--color-${name}` : `--${name}`

// ── On this page ─────────────────────────────────────────────────────
const JUMPS = [
  { id: 'pg-primitives', label: 'Primitives' },
  { id: 'pg-tokens', label: 'Tokens' },
  { id: 'pg-live', label: 'Live' },
  { id: 'pg-contrast', label: 'Contrast' },
  { id: 'pg-legacy', label: 'Legacy' },
  { id: 'pg-export', label: 'Export' }
]
function jump(id: string): void {
  const el = document.getElementById(id)
  const main = el?.closest('.ds-main')
  if (!el || !main) return
  const top = el.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop
  main.scrollTo({ top: top - 64, behavior: 'smooth' })
}

// ── Export ───────────────────────────────────────────────────────────
type Out = 'palette' | 'theme' | 'dark' | 'light' | 'diff'
const OUTS: { value: Out; label: string }[] = [
  { value: 'palette', label: '_palette.css' },
  { value: 'theme', label: 'theme.css' },
  { value: 'dark', label: 'dark.json' },
  { value: 'light', label: 'light.json' },
  { value: 'diff', label: 'Diff vs main' }
]
const OUT_NOTES: Record<Out, string> = {
  palette: 'packages/design-system/src/css/_palette.css: replaces the charcoal lines in @theme.',
  theme:
    'packages/design-system/src/css/theme.css: the @theme constants, :root (dark) and the @theme inline names it needs.',
  dark: 'src/assets/palettes/dark.json: merge into colors.theme and colors.litegraph_base.',
  light: 'src/assets/palettes/light.json: merge into colors.theme and colors.litegraph_base.',
  diff: 'Every value that moves from origin/main, in both modes.'
}
const out = ref<Out>('palette')
const changes = computed(() => diff(state.value).length)
const text = computed(() => {
  const s = state.value
  if (out.value === 'palette') return exportPalette(s)
  if (out.value === 'theme') return exportTheme(s)
  if (out.value === 'dark' || out.value === 'light') return exportJson(s, out.value)
  return exportDiff(s)
})
const copied = ref(false)
async function copy(): Promise<void> {
  await navigator.clipboard.writeText(text.value)
  copied.value = true
  setTimeout(() => (copied.value = false), 1200)
}
</script>

<template>
  <div class="pg proto-ui">
    <svg class="pg-filters" aria-hidden="true">
      <filter id="pg-screen-mac">
        <feComponentTransfer>
          <feFuncR type="linear" slope="1.06" intercept="-0.02" />
          <feFuncG type="linear" slope="1.06" intercept="-0.02" />
          <feFuncB type="linear" slope="1.06" intercept="-0.02" />
        </feComponentTransfer>
        <feColorMatrix type="saturate" values="1.08" />
      </filter>
      <filter id="pg-screen-windows">
        <feComponentTransfer>
          <feFuncR type="gamma" amplitude="0.85" exponent="1.5" offset="0" />
          <feFuncG type="gamma" amplitude="0.85" exponent="1.5" offset="0" />
          <feFuncB type="gamma" amplitude="0.85" exponent="1.5" offset="0" />
        </feComponentTransfer>
        <feColorMatrix type="saturate" values="0.85" />
      </filter>
      <filter id="pg-screen-glare">
        <feComponentTransfer>
          <feFuncR type="linear" slope="0.72" intercept="0.2" />
          <feFuncG type="linear" slope="0.72" intercept="0.2" />
          <feFuncB type="linear" slope="0.72" intercept="0.2" />
        </feComponentTransfer>
        <feColorMatrix type="saturate" values="0.8" />
      </filter>
    </svg>

    <div class="pg-bar">
      <span>Start from</span>
      <Button variant="secondary" size="sm" @click="reset(ALEX)"
        ><RotateCcw :size="13" />Alex’s stack</Button
      >
      <Button variant="ghost" size="sm" @click="reset(MAIN)"><RotateCcw :size="13" />main</Button>
      <label class="pg-toggle"><Switch v-model="compare" />Show main</label>
      <nav class="pg-jump" aria-label="On this page">
        <a v-for="j in JUMPS" :key="j.id" href="#/theme-playground" @click.prevent="jump(j.id)">{{
          j.label
        }}</a>
      </nav>
      <span class="pg-bar-count">{{ changes }} changes from main</span>
    </div>

    <!-- Primitives -->
    <section id="pg-primitives" class="pg-block">
      <h2 class="ds-h2">Primitives</h2>
      <p class="pg-note">
        Charcoal is one OKLCH lightness curve, 50 to 950, shared by light and dark (#22439 starts
        from Tailwind zinc). Drag a step to move it; hue and chroma apply to every step.
      </p>
      <div class="pg-scale">
        <div v-for="(st, i) in STEPS" :key="st" class="pg-step">
          <div class="pg-chip" :style="{ background: hexes[i], color: textOn(hexes[i]!) }">
            <b>{{ st }}</b>
            <span>{{ hexes[i] }}</span>
          </div>
          <input
            v-model.number="state.charcoal.l[i]"
            class="pg-l"
            type="range"
            min="0"
            max="1"
            step="0.001"
            :aria-label="`charcoal-${st} lightness`"
          />
          <output>L {{ state.charcoal.l[i]!.toFixed(3) }}</output>
        </div>
      </div>
      <div class="pg-curve-row">
        <svg class="pg-curve" viewBox="-2 -2 104 104" preserveAspectRatio="none" aria-hidden="true">
          <polyline :points="curve" />
        </svg>
        <div class="pg-knobs">
          <label class="pg-knob">
            <span>Hue</span>
            <input v-model.number="hue" type="range" min="0" max="360" step="1" />
            <output>{{ state.charcoal.hues ? 'per step' : `${hue}°` }}</output>
          </label>
          <label class="pg-knob">
            <span>Chroma</span>
            <input
              v-model.number="state.charcoal.chroma"
              type="range"
              min="0"
              max="4"
              step="0.05"
            />
            <output>×{{ state.charcoal.chroma.toFixed(2) }}</output>
          </label>
          <Button variant="ghost" size="sm" @click="zinc"
            ><RotateCcw :size="13" />Zinc curve</Button
          >
        </div>
      </div>

      <h3 class="pg-h3">Brand and status</h3>
      <div class="pg-hues">
        <label v-for="h in hueList" :key="h.id" class="pg-hue">
          <input
            type="color"
            :value="state.hues[h.id]"
            :aria-label="h.id"
            @input="setHue(h.id, ($event.target as HTMLInputElement).value)"
          />
          <span class="pg-hue-name"
            ><code>{{ h.id }}</code
            ><small>{{ h.use }}</small></span
          >
          <Input
            :model-value="state.hues[h.id]"
            size="sm"
            mono
            class="pg-hex"
            @update:model-value="setHue(h.id, $event)"
          />
        </label>
      </div>
    </section>

    <!-- Semantic tokens -->
    <section id="pg-tokens" class="pg-block">
      <h2 class="ds-h2">Semantic tokens</h2>
      <p class="pg-note">
        One row per token. Pick a primitive, or another token at an opacity (hover and selected are
        accent at 40% and 60%, #22752). Credit, bypass and success are one value for both modes.
      </p>
      <div class="pg-scroll">
        <table class="pg-table pg-map">
          <thead>
            <tr>
              <th>Token</th>
              <th>Dark</th>
              <th>Light</th>
            </tr>
          </thead>
          <tbody v-for="g in groups" :key="g">
            <tr class="pg-group">
              <td colspan="3">{{ g }}</td>
            </tr>
            <tr v-for="t in TOKENS.filter((x) => x.group === g)" :key="t.id">
              <td>
                <code>{{ t.rule ?? t.id }}</code>
                <small>{{ t.use }}</small>
              </td>
              <td v-for="m in MODES" :key="m">
                <div v-if="t.shared && m === 'light'" class="pg-same">Same as dark</div>
                <template v-else>
                  <div class="pg-val">
                    <i class="pg-sw" :style="{ background: swatch(m, t.id) }" />
                    <Select
                      :model-value="code(state.map[m][t.id])"
                      :options="valueOptions"
                      size="sm"
                      class="pg-pick"
                      @update:model-value="setCode(m, t.id, $event)"
                    />
                    <Input
                      v-if="'hex' in (state.map[m][t.id] ?? {})"
                      :model-value="(state.map[m][t.id] as { hex: string }).hex"
                      size="sm"
                      mono
                      class="pg-hex"
                      @update:model-value="setHex(m, t.id, $event)"
                    />
                    <NumberField
                      v-else
                      :model-value="pctOf(m, t.id)"
                      :min="0"
                      :max="100"
                      :step="5"
                      unit="%"
                      :aria-label="`${t.id} opacity, ${m}`"
                      class="pg-pct"
                      @update:model-value="setPct(m, t.id, $event)"
                    />
                  </div>
                  <p class="pg-val-out">
                    <code>{{ shownValue(m, t.id) }}</code>
                    <span v-if="compare" class="pg-main"
                      ><i
                        class="pg-sw is-sm"
                        :style="{ background: swatch(m, t.id, mainResolved) }"
                      />main {{ describe(MAIN.map[m][t.id]) }}</span
                    >
                  </p>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Specimens -->
    <section id="pg-live" class="pg-block">
      <h2 class="ds-h2">Every product, live</h2>
      <div class="pg-screen">
        <MarSeg v-model="screen" :options="SCREENS" label="Screen" />
        <span>{{ SCREEN_NOTES[screen] }}</span>
      </div>
      <div class="ds-themes is-both">
        <div v-for="m in MODES" :key="m" class="ds-theme">
          <span class="ds-theme-label">{{ m === 'dark' ? 'Dark' : 'Light' }}</span>
          <div :class="['pg-screen-box', `is-${screen}`]">
            <iframe
              ref="frames"
              :data-theme="m"
              :src="src(m)"
              :title="`Theme playground specimens, ${m}`"
              class="ds-theme-frame"
              :style="{
                height: `${heights[m] ?? 1600}px`,
                filter: screen === 'none' ? undefined : `url(#pg-screen-${screen})`
              }"
            />
          </div>
        </div>
      </div>
    </section>

    <!-- Contrast -->
    <section id="pg-contrast" class="pg-block">
      <h2 class="ds-h2">Contrast</h2>
      <p class="pg-note">
        WCAG 2 ratio and APCA Lc for each pair, as painted (translucent tokens over what they sit
        on). Bars: {{ barText('text') }}; {{ barText('label') }}; {{ barText('ui') }};
        {{ barText('edge') }}.
      </p>
      <div class="pg-bar is-plain">
        <span v-for="f in fails" :key="f.m" :class="['pg-count', f.n ? 'is-fail' : 'is-pass']"
          >{{ f.m === 'dark' ? 'Dark' : 'Light' }}: {{ f.n }} failing</span
        >
        <label class="pg-toggle"><Switch v-model="failingOnly" />Only failing</label>
      </div>
      <div class="pg-scroll">
        <table class="pg-table pg-contrast">
          <thead>
            <tr>
              <th>Pair</th>
              <th>Bar</th>
              <th>Dark · ratio · Lc</th>
              <th>Light · ratio · Lc</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.id">
              <td>
                <span class="pg-pair-group">{{ r.group }}</span>
                {{ r.label }}
              </td>
              <td>
                <small>{{ BARS[r.kind].label }}</small>
              </td>
              <td v-for="m in MODES" :key="m">
                <div :class="['pg-score', results[m][r.id]!.pass ? 'is-pass' : 'is-fail']">
                  <span
                    class="pg-sample"
                    :style="{
                      background: cssOf(results[m][r.id]!.bg),
                      color: cssOf(results[m][r.id]!.fg)
                    }"
                    >Aa</span
                  >
                  <code :class="results[m][r.id]!.wcagPass === false && 'is-off'">{{
                    fmt(results[m][r.id]!).ratio
                  }}</code>
                  <code :class="!results[m][r.id]!.lcPass && 'is-off'">{{
                    fmt(results[m][r.id]!).lc
                  }}</code>
                  <component :is="results[m][r.id]!.pass ? Check : X" :size="14" />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Legacy names -->
    <section id="pg-legacy" class="pg-block">
      <h2 class="ds-h2">Legacy names</h2>
      <p class="pg-note">
        The names Desktop and the prototype use today, and what each now means. The specimens above
        use this table: change a row and the prototype’s own components follow.
      </p>
      <div v-for="g in ALIAS_GROUPS" :key="g.id" class="pg-scroll">
        <table class="pg-table pg-alias">
          <thead>
            <tr>
              <th>
                {{ g.label }} <small>{{ g.source }}</small>
              </th>
              <th>Means</th>
              <th>Dark</th>
              <th>Light</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="n in g.names" :key="n.name">
              <td>
                <code>{{ varName(g.id, n.name) }}</code>
                <small
                  >{{ n.uses ? `${n.uses} uses` : '' }}{{ n.uses && n.note ? ' · ' : ''
                  }}{{ n.note }}</small
                >
              </td>
              <td>
                <code v-if="g.fixed">{{ aliasTo(aliasKey(g.id, n.name)) }}</code>
                <div v-else class="pg-val">
                  <Select
                    :model-value="aliasTo(aliasKey(g.id, n.name))"
                    :options="aliasOptions"
                    size="sm"
                    class="pg-pick"
                    @update:model-value="setAlias(aliasKey(g.id, n.name), $event)"
                  />
                  <NumberField
                    v-if="aliasTo(aliasKey(g.id, n.name)) !== 'keep'"
                    :model-value="aliasPct(aliasKey(g.id, n.name))"
                    :min="0"
                    :max="100"
                    :step="5"
                    unit="%"
                    :aria-label="`${n.name} opacity`"
                    class="pg-pct"
                    @update:model-value="setAliasPct(aliasKey(g.id, n.name), $event)"
                  />
                </div>
              </td>
              <td v-for="m in MODES" :key="m">
                <i
                  v-if="aliasSwatch(m, aliasKey(g.id, n.name))"
                  class="pg-sw"
                  :style="{ background: aliasSwatch(m, aliasKey(g.id, n.name)) }"
                />
                <small v-else>as is</small>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Export -->
    <section id="pg-export" class="pg-block">
      <h2 class="ds-h2">Export</h2>
      <div class="pg-screen">
        <MarSeg v-model="out" :options="OUTS" label="File" />
      </div>
      <div class="ds-play-code">
        <div class="ds-play-code-head">
          <span>{{ OUT_NOTES[out] }}</span>
          <button type="button" @click="copy">
            <component :is="copied ? Check : Copy" :size="13" />Copy
          </button>
        </div>
        <pre><code>{{ text }}</code></pre>
      </div>
    </section>
  </div>
</template>

<style>
.pg {
  display: flex;
  flex-direction: column;
  gap: 40px;
  color: var(--color-base-foreground);
  font-size: 13px;
}
.pg-filters {
  position: absolute;
  width: 0;
  height: 0;
}
.pg code {
  font-family: var(--ds-mono);
  font-size: 12px;
}
.pg small {
  display: block;
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
.pg-note {
  max-width: 720px;
  margin: -6px 0 16px;
  color: var(--color-muted-foreground);
  line-height: 20px;
}
.pg-h3 {
  margin: 28px 0 12px;
  font-size: 13px;
  font-weight: 600;
}
.pg-bar {
  position: sticky;
  top: calc(-1 * var(--ds-pad-top));
  z-index: 5;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  margin-bottom: -16px;
  padding: 8px 12px;
  border-radius: 12px;
  background: var(--color-app-background);
  box-shadow: inset 0 0 0 1px var(--color-border-default);
  color: var(--color-muted-foreground);
}
.pg-bar.is-plain {
  position: static;
  margin: 0 0 12px;
  background: none;
  box-shadow: none;
  padding: 0;
}
.pg-jump {
  display: flex;
  gap: 2px;
  margin-left: auto;
}
.pg-jump a {
  padding: 3px 8px;
  border-radius: 7px;
  color: var(--color-muted-foreground);
}
.pg-jump a:hover {
  background: var(--color-secondary-background-hover);
  color: var(--color-base-foreground);
}
.pg-bar-count {
  font-variant-numeric: tabular-nums;
}
.pg-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

/* Charcoal */
.pg-scale {
  display: grid;
  grid-template-columns: repeat(11, minmax(0, 1fr));
  gap: 6px;
}
.pg-step {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.pg-chip {
  display: flex;
  width: 100%;
  height: 64px;
  flex-direction: column;
  justify-content: flex-end;
  padding: 6px;
  border-radius: 8px;
  box-shadow: inset 0 0 0 1px var(--color-border-default);
  font-size: 11px;
  line-height: 14px;
}
.pg-chip span {
  font-family: var(--ds-mono);
  font-size: 10.5px;
  opacity: 0.8;
}
.pg-l {
  height: 120px;
  writing-mode: vertical-lr;
  direction: rtl;
  accent-color: var(--color-base-foreground);
}
.pg-step output,
.pg-knob output {
  color: var(--color-subtle-foreground);
  font-family: var(--ds-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.pg-curve-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 24px;
  margin-top: 16px;
}
.pg-curve {
  width: 220px;
  height: 80px;
  border-radius: 8px;
  background: color-mix(in oklch, var(--color-base-foreground) 4%, transparent);
  box-shadow: inset 0 0 0 1px var(--color-border-default);
}
.pg-curve polyline {
  fill: none;
  stroke: var(--color-base-foreground);
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}
.pg-knobs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 24px;
}
.pg-knob {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--color-muted-foreground);
}
.pg-knob input {
  width: 160px;
  accent-color: var(--color-base-foreground);
}
.pg-knob output {
  width: 56px;
}

/* Hues */
.pg-hues {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 8px;
}
.pg-hue {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 10px;
  box-shadow: inset 0 0 0 1px var(--color-border-default);
}
.pg-hue input[type='color'] {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: none;
  cursor: pointer;
}
.pg-hue input[type='color']::-webkit-color-swatch-wrapper {
  padding: 0;
}
.pg-hue input[type='color']::-webkit-color-swatch {
  border: 0;
  border-radius: 6px;
  box-shadow: inset 0 0 0 1px var(--color-border-default);
}
.pg-hue-name {
  min-width: 0;
  flex: 1;
}
/* Past the prototype's reset of label widths (.proto-ui ×3). */
.pg.pg.pg .pg-hex {
  width: 96px;
  flex-shrink: 0;
}
.pg.pg.pg :is(.pg-hex, .pg-pct) input {
  width: 100%;
  min-width: 0;
}

/* Tables */
.pg-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  overflow: hidden;
  border-radius: 12px;
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  line-height: 20px;
}
.pg-scroll {
  overflow-x: auto;
  border-radius: 12px;
}
.pg-scroll + .pg-scroll {
  margin-top: 16px;
}
.pg-map,
.pg-alias {
  min-width: 760px;
}
.pg-contrast {
  min-width: 640px;
}
.pg-table th {
  padding: 10px 14px;
  background: color-mix(in oklch, var(--color-base-foreground) 4%, transparent);
  color: var(--color-subtle-foreground);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-align: left;
  text-transform: uppercase;
}
.pg-table th small {
  display: inline;
  margin-left: 6px;
  letter-spacing: 0;
  text-transform: none;
}
.pg-table td {
  padding: 8px 14px;
  border-top: 1px solid color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
  vertical-align: top;
}
.pg-group td {
  padding-top: 14px;
  color: var(--color-subtle-foreground);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.pg-map td:first-child {
  width: 26%;
}
.pg-val {
  display: flex;
  align-items: center;
  gap: 6px;
}
.pg.pg.pg .pg-pick {
  width: auto;
  min-width: 0;
  flex: 1;
}
.pg.pg.pg .pg-pct {
  width: 104px;
  flex-shrink: 0;
}
.pg-val-out {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 12px;
  margin-top: 4px;
  color: var(--color-muted-foreground);
}
.pg-main {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-subtle-foreground);
  font-size: 12px;
}
.pg-sw {
  display: inline-block;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border-radius: 6px;
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 16%, transparent);
}
.pg-sw.is-sm {
  width: 12px;
  height: 12px;
  border-radius: 3px;
}
.pg-same {
  padding-top: 4px;
  color: var(--color-subtle-foreground);
}

/* Specimens */
.pg-screen {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
  margin-bottom: 16px;
  color: var(--color-muted-foreground);
}
.pg-screen-box {
  position: relative;
  border-radius: 16px;
}
.pg-screen-box.is-glare::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: radial-gradient(
    120% 60% at 75% 8%,
    rgb(255 255 255 / 0.22),
    rgb(255 255 255 / 0.06) 45%,
    transparent 70%
  );
  pointer-events: none;
}

/* Contrast */
.pg-pair-group {
  margin-right: 6px;
  color: var(--color-subtle-foreground);
}
.pg-score {
  display: flex;
  align-items: center;
  gap: 10px;
  font-variant-numeric: tabular-nums;
}
.pg-score code {
  width: 40px;
  text-align: right;
}
.pg-score.is-pass svg {
  color: var(--color-status-running);
}
.pg-score.is-fail svg,
.pg-score code.is-off {
  color: var(--color-status-danger);
}
.pg-sample {
  display: inline-flex;
  width: 34px;
  height: 22px;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 12%, transparent);
  font-size: 12px;
  font-weight: 500;
}
.pg-count {
  font-variant-numeric: tabular-nums;
}
.pg-count.is-fail {
  color: var(--color-status-danger);
}
.pg-alias td:first-child {
  width: 38%;
}
@media (max-width: 900px) {
  .pg-scale {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
}
</style>
