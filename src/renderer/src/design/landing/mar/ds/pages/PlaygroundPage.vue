<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Check, Copy, Link } from 'lucide-vue-next'
import { importLine, SPECS, usage, filled, type Value } from '../play'

/**
 * Playground: pick a component, change its props, see it live (in a frame
 * of its own, kit/PlayFrame.vue) in either theme, with the Corners and Look
 * knobs, on the page or on a picture; copy its usage. Everything is in the
 * URL hash (#/playground?c=…), so a link shares the exact state.
 */
interface State {
  c: string
  p: Record<string, Value>
  theme: 'dark' | 'light'
  corners: 'soft' | 'default'
  look: 'current' | 'grain'
  bg: 'page' | 'image'
}
function readState(): State {
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '')
  const p = ((): Record<string, Value> => {
    try {
      return JSON.parse(q.get('p') ?? '{}')
    } catch {
      return {}
    }
  })()
  return {
    c: SPECS.some((s) => s.id === q.get('c')) ? q.get('c')! : SPECS[0]!.id,
    p,
    theme: q.get('theme') === 'light' ? 'light' : 'dark',
    corners: q.get('corners') === 'default' ? 'default' : 'soft',
    look: q.get('look') === 'grain' ? 'grain' : 'current',
    bg: q.get('bg') === 'image' ? 'image' : 'page'
  }
}
const state = ref<State>(readState())
const spec = computed(() => SPECS.find((s) => s.id === state.value.c)!)
const values = computed(() => filled(spec.value, state.value.p))

// The hash follows the state (replaceState: no history entry per keystroke).
watch(
  state,
  (s) => {
    const q = new URLSearchParams({
      c: s.c,
      theme: s.theme,
      corners: s.corners,
      look: s.look,
      bg: s.bg
    })
    if (Object.keys(s.p).length) q.set('p', JSON.stringify(s.p))
    history.replaceState(null, '', `#/playground?${q}`)
  },
  { deep: true }
)
const onHash = (): void => {
  if (location.hash.startsWith('#/playground')) state.value = readState()
}
onMounted(() => window.addEventListener('hashchange', onHash))
onBeforeUnmount(() => window.removeEventListener('hashchange', onHash))

function pick(id: string): void {
  state.value = { ...state.value, c: id, p: {} }
}
function set(name: string, value: Value): void {
  state.value = { ...state.value, p: { ...state.value.p, [name]: value } }
}

const query = ref('')
const listed = computed(() =>
  SPECS.filter((s) => `${s.name} ${s.from}`.toLowerCase().includes(query.value.toLowerCase()))
)

// Theme, corners and look are set before the app boots: they rebuild the
// frame. Props and background reach the running frame as a message.
const frameSrc = computed(() => {
  const s = state.value
  const seed = {
    'comfy.design.uiTuning.v4': { radius: s.corners },
    'comfy.design.mar.look': s.look
  }
  const q = new URLSearchParams({
    frame: 'play',
    theme: s.theme,
    proposal: 'mariana',
    seed: JSON.stringify(seed),
    c: s.c,
    p: JSON.stringify(s.p),
    bg: s.bg
  })
  return `?${q}`
})
const frameKey = computed(() => `${state.value.theme}-${state.value.corners}-${state.value.look}`)
const frame = ref<HTMLIFrameElement>()
watch(
  () => [state.value.c, state.value.p, state.value.bg] as const,
  ([c, p, bg]) =>
    frame.value?.contentWindow?.postMessage({ type: 'mar-ds:play', c, p: { ...p }, bg }, '*'),
  { deep: true }
)

const code = computed(() => `${importLine(spec.value)}\n\n${usage(spec.value, state.value.p)}`)
const copied = ref('')
async function copy(what: 'code' | 'link'): Promise<void> {
  await navigator.clipboard.writeText(what === 'code' ? code.value : location.href)
  copied.value = what
  setTimeout(() => (copied.value = ''), 1400)
}

const KNOBS = [
  { key: 'theme', label: 'Theme', options: ['dark', 'light'] },
  { key: 'corners', label: 'Corners', options: ['soft', 'default'] },
  { key: 'look', label: 'Look', options: ['current', 'grain'] },
  { key: 'bg', label: 'On', options: ['page', 'image'] }
] as const
const knob = (k: (typeof KNOBS)[number]['key'], v: string): void => {
  state.value = { ...state.value, [k]: v }
}
</script>

<template>
  <div class="ds-play">
    <aside class="ds-play-list">
      <input
        v-model="query"
        type="search"
        placeholder="Find a component"
        aria-label="Find a component"
      />
      <button
        v-for="s in listed"
        :key="s.id"
        type="button"
        :aria-current="s.id === state.c || undefined"
        @click="pick(s.id)"
      >
        {{ s.name }}
      </button>
      <p v-if="!listed.length" class="ds-play-none">Nothing matches.</p>
    </aside>

    <section class="ds-play-main">
      <div class="ds-play-knobs">
        <div
          v-for="k in KNOBS"
          :key="k.key"
          class="ds-play-seg"
          role="radiogroup"
          :aria-label="k.label"
        >
          <span>{{ k.label }}</span>
          <button
            v-for="o in k.options"
            :key="o"
            type="button"
            role="radio"
            :aria-checked="state[k.key] === o"
            @click="knob(k.key, o)"
          >
            {{ o }}
          </button>
        </div>
      </div>
      <iframe
        ref="frame"
        :key="frameKey"
        :src="frameSrc"
        :title="`${spec.name}, live`"
        class="ds-play-frame-el"
      />
      <p class="ds-play-note">
        {{ spec.note }} <code>{{ spec.from }}</code>
      </p>
      <div class="ds-play-code">
        <div class="ds-play-code-head">
          <span>Usage</span>
          <button type="button" @click="copy('code')">
            <component :is="copied === 'code' ? Check : Copy" :size="13" />Copy usage
          </button>
          <button type="button" @click="copy('link')">
            <component :is="copied === 'link' ? Check : Link" :size="13" />Copy link
          </button>
        </div>
        <pre><code>{{ code }}</code></pre>
      </div>
    </section>

    <aside class="ds-play-props">
      <p class="ds-play-props-title">Props</p>
      <p v-if="!spec.controls.length" class="ds-play-none">No props.</p>
      <label v-for="c in spec.controls" :key="c.name" :class="c.kind === 'bool' && 'is-bool'">
        <span>{{ c.name }}</span>
        <input
          v-if="c.kind === 'text'"
          type="text"
          :value="values[c.name] as string"
          @input="set(c.name, ($event.target as HTMLInputElement).value)"
        />
        <select
          v-else-if="c.kind === 'select'"
          :value="values[c.name] as string"
          @change="set(c.name, ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="o in c.options" :key="o" :value="o">{{ o || '(none)' }}</option>
        </select>
        <input
          v-else
          type="checkbox"
          :checked="values[c.name] as boolean"
          @change="set(c.name, ($event.target as HTMLInputElement).checked)"
        />
      </label>
    </aside>
  </div>
</template>

<style>
.ds-play {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr) 240px;
  gap: 16px;
  color: #c8c8cd;
  font-size: 12.5px;
}
.ds-play-list,
.ds-play-props {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ds-play-list input,
.ds-play-props input[type='text'],
.ds-play-props select {
  width: 100%;
  height: 30px;
  padding: 0 10px;
  border-radius: 8px;
  background: rgb(255 255 255 / 0.06);
  color: #ececee;
  outline: none;
}
.ds-play-list input {
  margin-bottom: 8px;
}
.ds-play-list button {
  padding: 6px 10px;
  border-radius: 8px;
  text-align: left;
}
.ds-play-list button:hover {
  background: rgb(255 255 255 / 0.05);
}
.ds-play-list button[aria-current] {
  background: rgb(255 255 255 / 0.09);
  color: #ececee;
}
.ds-play-none {
  padding: 6px 10px;
  color: #6e6e76;
}
.ds-play-main {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 12px;
}
.ds-play-knobs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
}
.ds-play-seg {
  display: flex;
  align-items: center;
  gap: 2px;
}
.ds-play-seg > span {
  margin-right: 6px;
  color: #6e6e76;
}
.ds-play-seg button {
  padding: 3px 9px;
  border-radius: 7px;
  text-transform: capitalize;
}
.ds-play-seg button[aria-checked='true'] {
  background: rgb(255 255 255 / 0.1);
  color: #ececee;
}
.ds-play-frame-el {
  width: 100%;
  height: 460px;
  border: 0;
  border-radius: 14px;
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.06);
}
.ds-play-note code,
.ds-play-note code {
  color: #6e6e76;
}
.ds-play-props-title {
  margin-bottom: 6px;
  color: #ececee;
  font-weight: 600;
}
.ds-play-props label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
}
.ds-play-props label > span {
  color: #8a8a92;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 11px;
}
.ds-play-props label.is-bool {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}
</style>
