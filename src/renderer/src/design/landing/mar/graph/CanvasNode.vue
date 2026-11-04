<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Download,
  LayoutGrid,
  LoaderCircle,
  Minus,
  Play,
  Plus,
  SlidersHorizontal,
  Upload
} from 'lucide-vue-next'
import MarSpin from '../brand/MarSpin.vue'
import { NODE_ICONS } from './nodeIcons'
import {
  SOCKETS,
  canvasNodeHeight,
  hasCycler,
  hasFileRow,
  hasResult,
  hasSettings,
  mediaOf,
  settingsOpen,
  nodeWidth,
  slotsHeight,
  type CanvasGeometry,
  type Control,
  type SNode,
  type SocketType
} from './canvasData'

/**
 * One node, in ComfyUI's Vue node anatomy (renderer/extensions/vueNodes):
 * a title bar with the collapse chevron and its badges; then the body,
 * its typed slots at the top (inputs left, outputs right, their dots on
 * the node's edges), its widget rows (a label, then the control), and its
 * content (the text, or the result). States follow the product: selected
 * and executing draw an outline around it, executing also runs a progress
 * bar along the title's edge, an error rings it and opens a footer,
 * bypassed tints it, muted fades it, collapsed folds it to its title.
 * Output first, as Willie Falloon's Node Banana node: what a node made is
 * its body, earlier results a step away under it, and its widgets fold
 * into one row below that, open until the first result lands.
 * Widgets are live: the graph owns the values, the node only reports edits.
 */
const { node, g, selected, wiring, locked } = defineProps<{
  node: SNode
  g: CanvasGeometry
  selected: boolean
  /** A link being drawn: its type, and the side it started from. */
  wiring?: { type: SocketType; side: 'in' | 'out'; node: string }
  /** In a locked group: skipped by runs. */
  locked?: boolean
}>()
const emit = defineEmits<{
  set: [key: string, value: string | number]
  text: [value: string]
  resume: []
  action: [key: string]
  pick: [index: number]
  view: []
}>()

const ICONS = NODE_ICONS
const media = computed(() => mediaOf(node))
const height = computed(() => canvasNodeHeight(node, g))
const slots = computed(() => slotsHeight(node, g))

const running = computed(() => node.state === 'running')
/** The progress bar, for the nodes that take a while. */
const showProgress = computed(() => running.value && (node.steps ?? 0) > 1)
/** A picture or a clip: its run shows on the preview, not the title. */
const framed = computed(() => media.value === 'image' || media.value === 'video')
const settings = computed(() => hasSettings(node))
/** What folds, and the actions (Save) that stay out under it. */
const fields = computed(() => node.controls.filter((c) => c.kind !== 'button'))
const actions = computed(() => node.controls.filter((c) => c.kind === 'button'))
const isOpen = computed(() => settingsOpen(node))
const made = computed(() => hasResult(node))
/** The folded settings read as the model, then its values. */
const summary = computed(() => {
  const values = fields.value.map((c) => (c.kind === 'slider' ? c.value.toFixed(2) : c.value))
  return { title: values[0] ?? '', values: values.slice(1, 3) }
})
/** The result on show: the latest, or an earlier run. */
const latest = computed(() => !node.history.length || node.pick === node.history.length - 1)
/** At most seven dots, around the one on show. */
const dots = computed(() => {
  const n = node.history.length
  const start = Math.min(Math.max(0, node.pick - 3), Math.max(0, n - 7))
  return Array.from({ length: Math.min(7, n) }, (_, i) => start + i)
})
const progress = computed(() => (node.step ?? 0) / (node.steps ?? 1))
/** Text you write (a prompt, a template) or text a model wrote. */
const editable = computed(() => node.kind === 'prompt' || node.kind === 'promptConstructor')
const shown = computed(() => node.history[node.pick])
const cutout = computed(() => !!node.cutout)

/** ComfyUI names an output by its type; text travels as STRING. */
const typeName = (t: SocketType): string => (t === 'TEXT' ? 'STRING' : t)

/** A status badge in the title bar, where the node stands. */
const tag = computed(() => {
  if (locked) return 'Skipped'
  if (node.mode === 'bypass') return 'Bypassed'
  if (node.mode === 'mute') return 'Muted'
  if (node.state === 'queued') return 'Queued'
  if (node.state === 'error') return 'Error'
  if (showProgress.value) return `${node.step} / ${node.steps}`
  if (running.value) return 'Running'
  if (node.state === 'paused') return 'Paused'
  if (node.stale) return 'Outdated'
  if (node.state === 'done') return 'Done'
  return ''
})
const tagTone = computed(() => {
  if (node.state === 'error') return 'is-error'
  if (running.value || node.state === 'paused') return 'is-live'
  if (node.stale && !locked && !node.mode) return 'is-stale'
  return ''
})

// A combo's options open under it; a click elsewhere (which selects
// another node, or none) closes them.
const open = ref<string | null>(null)
watch(
  () => selected && isOpen.value,
  (on) => !on && (open.value = null)
)
function choose(c: Control, value: string): void {
  emit('set', c.key, value)
  open.value = null
}

// A number scrubs: drag across it, or step it with − and +.
const STEP = 0.05
const clamp = (v: number): number => Math.min(1, Math.max(0, Math.round(v * 20) / 20))
function scrub(c: Control, e: PointerEvent): void {
  if (e.type === 'pointermove' && !(e.buttons & 1)) return
  const el = e.currentTarget as HTMLElement
  if (e.type === 'pointerdown') el.setPointerCapture(e.pointerId)
  const r = el.getBoundingClientRect()
  emit('set', c.key, clamp((e.clientX - r.left) / r.width))
}

// Compare: the divider follows the pointer across the pictures.
const split = ref(0.5)
function divide(e: PointerEvent): void {
  if (e.type === 'pointermove' && !(e.buttons & 1)) return
  const el = e.currentTarget as HTMLElement
  if (e.type === 'pointerdown') el.setPointerCapture(e.pointerId)
  const r = el.getBoundingClientRect()
  split.value = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
}

/** The constructor's variables: its inputs, insertable as @name. */
const area = ref<HTMLTextAreaElement>()
function insertVar(name: string): void {
  const el = area.value
  const t = node.text ?? ''
  const at = el?.selectionStart ?? t.length
  emit('text', `${t.slice(0, at)}@${name}${t.slice(at)}`)
}

/** An audio clip's waveform, the same every time for the same node. */
const bars = computed(() =>
  Array.from({ length: 44 }, (_, i) => {
    const h = Math.abs(Math.sin(i * 0.9 + node.id.length) * Math.cos(i * 0.37))
    return 0.18 + h * 0.82
  })
)

/** A slot a link being drawn could end on, or one it can't. */
function socketFit(side: 'in' | 'out', type: SocketType): string {
  if (!wiring) return ''
  if (wiring.node === node.id || wiring.side === side) return 'is-off'
  return wiring.type === type ? 'is-fit' : 'is-off'
}
</script>

<template>
  <section
    class="sg-node"
    :class="[
      `is-${node.kind}`,
      selected && 'is-selected',
      running && 'is-running',
      node.state === 'error' && 'is-error',
      node.mode && `is-${node.mode}`,
      node.collapsed && 'is-collapsed',
      locked && 'is-locked',
      open !== null && 'is-menu'
    ]"
    :data-node="node.id"
    :style="{
      left: `${node.x}px`,
      top: `${node.y}px`,
      width: `${nodeWidth(node)}px`,
      height: `${height}px`
    }"
    :aria-label="node.title"
  >
    <span v-if="selected || running" class="sg-outline" aria-hidden="true" />

    <div class="sg-inner">
      <header class="sg-head" :data-node-head="node.id" :style="{ height: `${g.head}px` }">
        <button
          type="button"
          class="sg-collapse"
          :aria-label="node.collapsed ? 'Expand node' : 'Collapse node'"
          :aria-expanded="!node.collapsed"
          @click="emit('action', 'collapse')"
        >
          <ChevronDown :size="16" />
        </button>
        <span class="sg-title">{{ node.title }}</span>
        <span v-if="node.badge && !node.collapsed" class="sg-badge">{{ node.badge }}</span>
        <span v-if="tag" class="sg-badge is-state" :class="tagTone">
          <Check v-if="tag === 'Done'" :size="11" />{{ tag }}
        </span>
      </header>

      <!-- Executing: the bar runs along the title's lower edge. -->
      <span v-if="showProgress && !framed" class="sg-progress" aria-hidden="true">
        <i :style="{ width: `${progress * 100}%` }" />
      </span>

      <div v-if="!node.collapsed" class="sg-body" :style="{ rowGap: `${g.gap}px` }">
        <!-- Slots: inputs left, outputs right. Drag from a dot to wire it. -->
        <div v-if="slots" class="sg-slots" :style="{ height: `${slots}px` }">
          <div class="sg-col">
            <div
              v-for="(s, i) in node.ins"
              :key="`i${i}`"
              class="sg-slot is-in"
              :class="socketFit('in', s.type)"
              data-socket="in"
              :data-socket-node="node.id"
              :data-socket-index="i"
              :style="{ height: `${g.slot}px`, '--sg-socket': SOCKETS[s.type] }"
            >
              <i class="sg-dot" /><span class="sg-slot-label">{{ s.name }}</span>
            </div>
          </div>
          <div class="sg-col is-out">
            <div
              v-for="(s, i) in node.outs"
              :key="`o${i}`"
              class="sg-slot is-out"
              :class="socketFit('out', s.type)"
              data-socket="out"
              :data-socket-node="node.id"
              :data-socket-index="i"
              :style="{ height: `${g.slot}px`, '--sg-socket': SOCKETS[s.type] }"
            >
              <span class="sg-slot-label">{{ typeName(s.type) }}</span
              ><i class="sg-dot" />
            </div>
          </div>
        </div>

        <!-- An input's file, as a widget row over its preview. -->
        <div v-if="hasFileRow(node)" class="sg-widgets">
          <div class="sg-row" :style="{ height: `${g.control}px` }">
            <span class="sg-label">{{ node.kind }}</span>
            <span class="sg-w is-combo is-file">
              <span class="sg-w-value">{{ node.chip ?? 'Choose a file' }}</span>
              <Upload :size="12" class="sg-w-icon" />
            </span>
          </div>
        </div>

        <!-- Content: the text, or the result. -->
        <div
          v-if="node.body"
          class="sg-content"
          :class="`is-${media}`"
          :style="{ height: `${node.body}px` }"
        >
          <template v-if="media === 'text'">
            <textarea
              v-if="editable"
              ref="area"
              class="sg-text"
              :class="node.kind === 'promptConstructor' && 'has-foot'"
              :value="node.text"
              :aria-label="node.title"
              spellcheck="false"
              :placeholder="
                node.kind === 'prompt' ? 'Describe the image' : 'Type @ to insert a variable'
              "
              @pointerdown.stop
              @input="emit('text', ($event.target as HTMLTextAreaElement).value)"
            />
            <p v-else-if="node.text" class="sg-text is-result">{{ node.text }}</p>
            <p v-else class="sg-empty">
              <component :is="ICONS[node.kind]" :size="16" />Writes here when it runs
            </p>
            <span v-if="node.kind === 'prompt'" class="sg-count"
              >{{ node.text?.length ?? 0 }} chars</span
            >
            <span v-if="node.kind === 'promptConstructor'" class="sg-vars">
              <button
                v-for="s in node.ins"
                :key="s.name"
                type="button"
                class="sg-var"
                @click="insertVar(s.name)"
              >
                @{{ s.name }}
              </button>
            </span>
          </template>

          <template v-else-if="media === 'pause'">
            <template v-if="node.state === 'paused'">
              <span class="sg-note">Paused. Refine, then resume.</span>
              <button
                type="button"
                class="sg-w is-button is-primary sg-resume"
                @click="emit('resume')"
              >
                <Play :size="11" fill="currentColor" />Resume
              </button>
            </template>
            <span v-else class="sg-note">A run stops here until you resume it.</span>
          </template>

          <div v-else-if="media === 'audio'" class="sg-audio">
            <span class="sg-play"><Play :size="12" fill="currentColor" /></span>
            <span class="sg-wave" :class="running && 'is-working'">
              <i v-for="(b, i) in bars" :key="i" :style="{ height: `${b * 100}%` }" />
            </span>
            <span class="sg-audio-time">{{ node.text ?? '0:00' }}</span>
          </div>

          <div
            v-else-if="media === 'compare'"
            class="sg-frame sg-compare"
            @pointerdown="divide"
            @pointermove="divide"
          >
            <template v-if="node.pair">
              <img :src="node.pair[0]" alt="" draggable="false" class="sg-img" />
              <img
                :src="node.pair[1]"
                alt=""
                draggable="false"
                class="sg-img"
                :style="{ clipPath: `inset(0 0 0 ${split * 100}%)` }"
              />
              <span class="sg-divider" :style="{ left: `${split * 100}%` }"><i /></span>
              <span class="sg-chip">Before</span>
              <span class="sg-chip is-right">After</span>
            </template>
            <p v-else class="sg-empty"><Columns2 :size="16" />Connect two images</p>
          </div>

          <div v-else-if="media === 'gallery'" class="sg-gallery">
            <img
              v-for="(r, i) in [...node.history].reverse()"
              :key="i"
              :src="r.src"
              alt=""
              draggable="false"
              @dblclick="(emit('pick', node.history.length - 1 - i), emit('view'))"
            />
            <p v-if="!node.history.length" class="sg-empty">
              <LayoutGrid :size="16" />Every result that reaches it
            </p>
          </div>

          <div v-else class="sg-frame" :class="cutout && 'is-cutout'">
            <Transition name="sg-swap">
              <video
                v-if="media === 'video' && node.video"
                :key="node.video"
                :src="node.video"
                class="sg-img"
                autoplay
                muted
                loop
                playsinline
                @dblclick="emit('view')"
              />
              <img
                v-else-if="node.image"
                :key="node.image"
                :src="node.image"
                alt=""
                draggable="false"
                class="sg-img"
                :class="[
                  showProgress && 'is-working',
                  media === 'video' && !showProgress && 'is-motion',
                  cutout && 'is-cutout'
                ]"
                @dblclick="emit('view')"
              />
              <p v-else class="sg-empty" :class="showProgress && 'is-working'">
                <component :is="ICONS[node.kind]" :size="16" />{{
                  node.ins.length ? 'Run to generate' : 'Drop a file here'
                }}
              </p>
            </Transition>
            <span v-if="made && !running" class="sg-chip">{{
              latest ? 'Latest' : `Run ${shown?.run}`
            }}</span>
            <span v-else-if="node.chip && !hasFileRow(node) && !running" class="sg-chip">{{
              node.chip
            }}</span>
            <!-- Running: the progress sits on the preview it is making. -->
            <span v-if="running" class="sg-run" aria-live="polite">
              <span class="sg-run-label"
                ><MarSpin :icon="LoaderCircle" :size="12" spin="sg-spin" />{{
                  node.verb ?? 'Running'
                }}<template v-if="showProgress">
                  · {{ Math.round(progress * 100) }}%</template
                ></span
              >
              <i v-if="showProgress" class="sg-run-bar" :style="{ width: `${progress * 100}%` }" />
            </span>
          </div>
        </div>

        <!-- Earlier results: step back through them, under the preview. -->
        <div
          v-if="hasCycler(node)"
          class="sg-cycler"
          :class="running && 'is-off'"
          :style="{ height: `${g.control}px` }"
        >
          <button
            type="button"
            aria-label="Earlier result"
            :disabled="node.pick === 0 || running"
            @click="emit('pick', node.pick - 1)"
          >
            <ChevronLeft :size="12" />
          </button>
          <span class="sg-cycler-dots" aria-hidden="true">
            <i v-for="i in dots" :key="i" :class="i === node.pick && 'is-on'" />
          </span>
          <span class="sg-cycler-count">{{ node.pick + 1 }} / {{ node.history.length }}</span>
          <button
            type="button"
            aria-label="Later result"
            :disabled="node.pick === node.history.length - 1 || running"
            @click="emit('pick', node.pick + 1)"
          >
            <ChevronRight :size="12" />
          </button>
        </div>

        <!-- Settings: one row (the model, its values) that opens its widgets. -->
        <div v-if="settings" class="sg-settings" :class="isOpen && 'is-open'">
          <button
            type="button"
            class="sg-sum"
            :style="{ height: `${g.control}px` }"
            :aria-expanded="isOpen"
            :aria-controls="`sg-settings-${node.id}`"
            :aria-label="`Settings: ${[summary.title, ...summary.values].join(', ')}`"
            @click="emit('action', 'settings')"
          >
            <SlidersHorizontal :size="12" class="sg-w-icon" />
            <span class="sg-sum-title">{{ summary.title }}</span>
            <span class="sg-sum-values">{{ summary.values.join(' · ') }}</span>
            <ChevronDown :size="12" class="sg-w-icon sg-sum-chev" />
          </button>
          <div class="sg-panel">
            <div
              :id="`sg-settings-${node.id}`"
              class="sg-widgets"
              :style="{ rowGap: `${g.gap}px`, paddingTop: `${g.gap}px` }"
              :inert="!isOpen"
              :aria-hidden="!isOpen"
            >
              <div
                v-for="c in fields"
                :key="c.key"
                class="sg-row"
                :style="{ height: `${g.control}px` }"
              >
                <span class="sg-label">{{ c.kind === 'model' ? 'model' : c.name }}</span>

                <button
                  v-if="c.kind === 'model' || c.kind === 'combo'"
                  type="button"
                  class="sg-w is-combo"
                  :class="open === c.key && 'is-open'"
                  :aria-expanded="open === c.key"
                  @click="open = open === c.key ? null : c.key"
                >
                  <span class="sg-w-value">{{ c.value }}</span>
                  <ChevronDown :size="12" class="sg-w-icon" />
                </button>

                <span
                  v-else-if="c.kind === 'seg'"
                  class="sg-w is-seg"
                  role="radiogroup"
                  :aria-label="c.name"
                >
                  <button
                    v-for="o in c.options"
                    :key="o"
                    type="button"
                    role="radio"
                    :aria-checked="o === c.value"
                    :class="o === c.value && 'is-on'"
                    @click="emit('set', c.key, o)"
                  >
                    {{ o }}
                  </button>
                </span>

                <span v-else-if="c.kind === 'slider'" class="sg-w is-number">
                  <span class="sg-fill" :style="{ width: `${c.value * 100}%` }" />
                  <button
                    type="button"
                    class="sg-step"
                    :aria-label="`Decrease ${c.name}`"
                    :disabled="c.value <= 0"
                    @click="emit('set', c.key, clamp(c.value - STEP))"
                  >
                    <Minus :size="12" />
                  </button>
                  <span
                    class="sg-scrub"
                    role="slider"
                    :aria-label="c.name"
                    :aria-valuenow="c.value"
                    aria-valuemin="0"
                    aria-valuemax="1"
                    tabindex="0"
                    @pointerdown="scrub(c, $event)"
                    @pointermove="scrub(c, $event)"
                    @keydown.left.prevent="emit('set', c.key, clamp(c.value - STEP))"
                    @keydown.right.prevent="emit('set', c.key, clamp(c.value + STEP))"
                    >{{ c.value.toFixed(2) }}</span
                  >
                  <button
                    type="button"
                    class="sg-step"
                    :aria-label="`Increase ${c.name}`"
                    :disabled="c.value >= 1"
                    @click="emit('set', c.key, clamp(c.value + STEP))"
                  >
                    <Plus :size="12" />
                  </button>
                </span>

                <!-- The open combo's options, under it. -->
                <div
                  v-if="open === c.key && (c.kind === 'combo' || c.kind === 'model')"
                  class="sg-menu"
                  role="listbox"
                >
                  <template v-if="c.kind === 'model'">
                    <button
                      v-for="o in c.options"
                      :key="o.value"
                      type="button"
                      role="option"
                      :aria-selected="o.value === c.value"
                      class="sg-menu-item"
                      @click="choose(c, o.value)"
                    >
                      <span>{{ o.value }}</span
                      ><span class="sg-menu-note">{{ o.provider }}</span>
                      <Check v-if="o.value === c.value" :size="12" />
                    </button>
                  </template>
                  <template v-else>
                    <button
                      v-for="o in c.options"
                      :key="o"
                      type="button"
                      role="option"
                      :aria-selected="o === c.value"
                      class="sg-menu-item"
                      @click="choose(c, o)"
                    >
                      <span>{{ o }}</span
                      ><Check v-if="o === c.value" :size="12" />
                    </button>
                  </template>
                </div>
              </div>
            </div>
          </div>
          <div
            v-for="c in actions"
            :key="c.key"
            class="sg-action"
            :style="{ height: `${g.control}px`, marginTop: `${g.gap}px` }"
          >
            <button type="button" class="sg-w is-button" @click="emit('action', c.key)">
              <Download :size="12" />{{ c.label }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- An error opens a footer tab under the node, as ComfyUI's does. -->
    <footer v-if="node.state === 'error' && !node.collapsed" class="sg-footer" role="alert">
      {{ node.error }}
    </footer>

    <!-- Collapsed: its slots gather on the title bar's ends. -->
    <template v-if="node.collapsed">
      <span
        v-if="node.ins.length"
        class="sg-slot is-in is-gathered"
        data-socket="in"
        :data-socket-node="node.id"
        data-socket-index="0"
        :style="{ '--sg-socket': SOCKETS[node.ins[0]!.type] }"
        ><i class="sg-dot is-multi"
      /></span>
      <span
        v-if="node.outs.length"
        class="sg-slot is-out is-gathered"
        data-socket="out"
        :data-socket-node="node.id"
        data-socket-index="0"
        :style="{ '--sg-socket': SOCKETS[node.outs[0]!.type] }"
        ><i class="sg-dot is-multi"
      /></span>
    </template>
  </section>
</template>

<style>
/* Colours: Glass reads the Void palette; Current uses ComfyUI's node
   tokens (design-system style.css). Corners follow UI Playground ›
   Corners: the node takes the control radius, as ComfyUI's rounded-xl;
   widgets, badges and pictures the tab item radius, as its rounded-md. */
.sg-node {
  --n-head: color-mix(in oklch, var(--color-base-foreground) 9%, var(--mg-canvas));
  --n-body: color-mix(in oklch, var(--color-base-foreground) 6%, var(--mg-canvas));
  --n-widget: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
  --n-widget-hover: color-mix(in oklch, var(--color-base-foreground) 12%, transparent);
  --n-widget-on: color-mix(in oklch, var(--color-base-foreground) 18%, transparent);
  --n-text: var(--mg-text);
  --n-slot-text: var(--mg-muted);
  --n-icon: var(--mg-muted);
  --n-outline: var(--color-base-foreground);
  --n-exec: #0b8ce9;
  --n-error: #c03a3a;
  --n-bypass: #6a246a;
  --n-dot-line: rgb(0 0 0 / 0.25);
  --n-shadow: drop-shadow(0 6px 14px rgb(0 0 0 / 0.4));
  --n-r: var(--radius-control, 12px);
  --n-r-in: var(--mar-tab-item-radius, 7px);
  position: absolute;
  display: flex;
  flex-direction: column;
  color: var(--n-text);
  font-size: 12px;
  line-height: 16px;
  filter: var(--n-shadow);
  /* Settings opening and closing, and a new result's row, grow it. */
  transition: height 0.16s ease-out;
}
:root[data-ds-theme='light'] .sg-node {
  --n-head: oklch(0.93 0.002 285);
  --n-body: oklch(0.985 0.001 285);
  --n-widget: oklch(0 0 0 / 0.05);
  --n-widget-hover: oklch(0 0 0 / 0.08);
  --n-widget-on: oklch(0 0 0 / 0.12);
  --n-dot-line: rgb(0 0 0 / 0.08);
  --n-shadow: drop-shadow(0 4px 10px rgb(0 0 0 / 0.12));
}
.is-current .sg-node {
  --n-head: #202121;
  --n-body: #262729;
  --n-widget: #313235;
  --n-widget-hover: #3c3d41;
  --n-widget-on: #4a4b50;
  --n-text: #fff;
  --n-slot-text: #a0a0a0;
  --n-icon: #8a8a8a;
  --n-outline: #fff;
  --n-error: #962a2a;
  font-family: Inter, Arial, sans-serif;
}
:root[data-ds-theme='light'] .is-current .sg-node {
  --n-head: #e9e9e9;
  --n-body: #fff;
  --n-widget: #e9e9e9;
  --n-widget-hover: #d9d9d9;
  --n-widget-on: #c5c5c5;
  --n-text: #171718;
  --n-slot-text: #444;
  --n-icon: #444;
  --n-outline: #000;
}
.sg-node.is-menu {
  z-index: 3;
}
/* An open combo may reach past the node's foot. */
.sg-node.is-menu .sg-inner {
  overflow: visible;
}

/* Selected and executing: a 3px outline just outside the node. */
.sg-outline {
  position: absolute;
  inset: -3px;
  z-index: 0;
  border: 3px solid var(--n-outline);
  border-radius: calc(var(--n-r) + 3px);
  pointer-events: none;
}
.sg-node.is-running:not(.is-selected) .sg-outline {
  border-color: var(--n-exec);
}
.sg-inner {
  position: relative;
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--n-r);
  background: var(--n-head);
}
.sg-node.is-error .sg-inner {
  box-shadow: 0 0 0 4px var(--n-error);
}
/* Bypassed: tinted magenta; muted: faded. Neither runs as itself. */
.sg-node.is-bypass .sg-inner::after,
.sg-node.is-mute .sg-inner::after {
  position: absolute;
  inset: 0;
  z-index: 2;
  border-radius: inherit;
  content: '';
  pointer-events: none;
}
.sg-node.is-bypass .sg-inner::after {
  background: color-mix(in srgb, var(--n-bypass) 60%, transparent);
}
.sg-node.is-mute .sg-inner {
  opacity: 0.5;
}
.sg-node.is-locked .sg-inner {
  opacity: 0.55;
}

/* ── Title bar. ── */
.sg-head {
  display: flex;
  flex: none;
  align-items: center;
  gap: 4px;
  padding: 0 8px 0 4px;
  color: var(--n-text);
  cursor: grab;
}
:root .proto-ui.proto-ui.proto-ui .sg-collapse {
  display: inline-flex;
  width: 24px;
  height: 24px;
  flex: none;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: var(--n-r-in);
  background: transparent;
  color: var(--n-icon);
}
:root .proto-ui.proto-ui.proto-ui .sg-collapse:hover {
  color: var(--n-text);
}
.sg-collapse svg {
  transition: rotate 0.15s ease;
}
.sg-node.is-collapsed .sg-collapse svg {
  rotate: -90deg;
}
.sg-title {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  font-size: 12px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.sg-badge {
  display: inline-flex;
  height: 18px;
  flex: none;
  align-items: center;
  gap: 3px;
  padding: 0 6px;
  border-radius: var(--n-r-in);
  background: var(--n-widget);
  color: var(--n-slot-text);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.sg-badge.is-live {
  background: color-mix(in srgb, var(--n-exec) 22%, transparent);
  color: var(--n-text);
}
.sg-badge.is-stale {
  background: color-mix(in srgb, #e0a030 22%, transparent);
  color: var(--n-text);
}
.sg-badge.is-error {
  background: var(--n-error);
  color: #fff;
}
.sg-progress {
  position: absolute;
  top: calc(32px - 4px);
  right: 0;
  left: 0;
  z-index: 1;
  height: 8px;
  pointer-events: none;
}
.sg-progress i {
  display: block;
  height: 100%;
  border-radius: 0 999px 999px 0;
  background: var(--n-exec);
  transition: width 0.2s linear;
}

/* ── Body. ── */
.sg-body {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  padding: 4px 0 12px;
  border-radius: 0 0 var(--n-r) var(--n-r);
  background: var(--n-body);
}

/* Slots: the dot sits on the node's edge; its name beside it. */
.sg-slots {
  display: flex;
  flex: none;
  justify-content: space-between;
  gap: 8px;
}
.sg-col {
  display: flex;
  min-width: 0;
  flex-direction: column;
}
.sg-col.is-out {
  align-items: flex-end;
}
.sg-slot {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  color: var(--n-slot-text);
  cursor: crosshair;
}
.sg-slot.is-in {
  padding-right: 8px;
}
.sg-slot.is-out {
  padding-left: 8px;
}
.sg-slot-label {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.sg-dot {
  width: 8px;
  height: 8px;
  flex: none;
  border: 1px solid var(--n-dot-line);
  border-radius: 999px;
  background: var(--sg-socket);
  transition: scale 0.15s ease;
}
.sg-slot.is-in .sg-dot {
  margin-left: -4px;
}
.sg-slot.is-out .sg-dot {
  margin-right: -4px;
}
.sg-slot:hover .sg-dot,
.sg-slot.is-fit .sg-dot {
  scale: 1.25;
}
.sg-slot.is-fit .sg-dot {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--sg-socket) 35%, transparent);
}
.sg-slot.is-off {
  opacity: 0.35;
}
/* Collapsed: one dot per side, on the title bar. */
.sg-slot.is-gathered {
  position: absolute;
  top: 50%;
  z-index: 3;
  padding: 0;
  translate: 0 -50%;
}
.sg-slot.is-gathered.is-in {
  left: 0;
}
.sg-slot.is-gathered.is-out {
  right: 0;
}
.sg-dot.is-multi {
  width: 8px;
  height: 20px;
}

/* Widgets: label, then the control, as ComfyUI's widget grid. */
.sg-widgets {
  display: flex;
  flex: none;
  flex-direction: column;
  padding: 0 12px;
}
.sg-row {
  position: relative;
  display: grid;
  grid-template-columns: minmax(56px, 36%) minmax(0, 1fr);
  align-items: stretch;
  gap: 8px;
}
.sg-row.is-wide {
  grid-template-columns: minmax(0, 1fr);
}
.sg-label {
  overflow: hidden;
  align-self: center;
  color: var(--n-slot-text);
  white-space: nowrap;
  text-overflow: ellipsis;
}
:root .proto-ui.proto-ui.proto-ui .sg-w {
  position: relative;
  display: flex;
  min-width: 0;
  height: 100%;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  overflow: hidden;
  border-radius: var(--n-r-in);
  background: var(--n-widget);
  color: var(--n-text);
  font: inherit;
  font-size: 12px;
  text-align: left;
}
:root .proto-ui.proto-ui.proto-ui button.sg-w:hover,
:root .proto-ui.proto-ui.proto-ui .sg-w.is-open {
  background: var(--n-widget-hover);
}
.sg-w-value {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.sg-w-icon {
  flex: none;
  color: var(--n-icon);
}
:root .proto-ui.proto-ui.proto-ui .sg-w.is-seg {
  gap: 2px;
  padding: 2px;
}
:root .proto-ui.proto-ui.proto-ui .sg-w.is-seg button {
  height: 100%;
  min-width: 0;
  flex: 1;
  padding: 0;
  border-radius: calc(var(--n-r-in) - 2px);
  background: transparent;
  color: var(--n-slot-text);
  font: inherit;
  font-size: 11px;
}
:root .proto-ui.proto-ui.proto-ui .sg-w.is-seg button.is-on {
  background: var(--n-widget-on);
  color: var(--n-text);
}
/* A number: − value +, the value's share of its range as a fill. */
:root .proto-ui.proto-ui.proto-ui .sg-w.is-number {
  padding: 0;
}
.sg-fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: color-mix(in srgb, var(--n-exec) 16%, transparent);
  pointer-events: none;
}
:root .proto-ui.proto-ui.proto-ui .sg-step {
  position: relative;
  display: inline-flex;
  height: 100%;
  aspect-ratio: 1;
  flex: none;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 0;
  background: transparent;
  color: var(--n-icon);
}
:root .proto-ui.proto-ui.proto-ui .sg-step:hover:not(:disabled) {
  background: var(--n-widget-hover);
}
:root .proto-ui.proto-ui.proto-ui .sg-step:disabled {
  opacity: 0.3;
}
.sg-scrub {
  position: relative;
  min-width: 0;
  flex: 1;
  outline: none;
  cursor: ew-resize;
  font-variant-numeric: tabular-nums;
  text-align: center;
  touch-action: none;
}
:root .proto-ui.proto-ui.proto-ui .sg-w.is-button {
  justify-content: center;
  gap: 6px;
}
:root .proto-ui.proto-ui.proto-ui .sg-w.is-button.is-primary {
  height: 24px;
  flex: none;
  background: var(--n-exec);
  color: #fff;
}
.sg-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 4;
  display: flex;
  min-width: 64%;
  flex-direction: column;
  padding: 4px;
  border-radius: var(--mar-tab-radius, 10px);
  background: var(--n-head);
  box-shadow:
    0 0 0 1px var(--n-widget),
    0 10px 28px rgb(0 0 0 / 0.35);
  animation: sg-menu 0.12s ease-out;
}
@keyframes sg-menu {
  from {
    opacity: 0;
    translate: 0 -3px;
  }
}
:root .proto-ui.proto-ui.proto-ui .sg-menu-item {
  display: flex;
  height: 26px;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  border-radius: var(--n-r-in);
  background: transparent;
  color: var(--n-text);
  font: inherit;
  font-size: 12px;
  text-align: left;
}
.sg-menu-item > span:first-child {
  flex: 1;
}
:root .proto-ui.proto-ui.proto-ui .sg-menu-item:hover {
  background: var(--n-widget-hover);
}
.sg-menu-note {
  color: var(--n-slot-text);
  font-size: 11px;
}

/* ── Content. ── */
.sg-content {
  position: relative;
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 8px;
  padding: 0 12px;
}
.sg-content.is-pause {
  justify-content: center;
}
.sg-note {
  color: var(--n-slot-text);
  font-size: 11.5px;
  line-height: 15px;
}
:root .proto-ui.proto-ui.proto-ui .sg-text {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 8px 8px 22px;
  overflow: auto;
  border: 0;
  border-radius: var(--n-r-in);
  outline: none;
  background: var(--n-widget);
  box-shadow: none;
  color: var(--n-text);
  font: inherit;
  font-size: 12px;
  line-height: 17px;
  resize: none;
  user-select: text;
}
:root .proto-ui.proto-ui.proto-ui .sg-text:focus {
  box-shadow: inset 0 0 0 1px var(--n-widget-on);
}
.sg-text.has-foot {
  padding-bottom: 34px;
}
.sg-text.is-result {
  white-space: pre-wrap;
}
.sg-text::placeholder {
  color: var(--n-slot-text);
}
.sg-count {
  position: absolute;
  right: 20px;
  bottom: 6px;
  color: var(--n-slot-text);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}
.sg-vars {
  position: absolute;
  right: 20px;
  bottom: 6px;
  left: 20px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
:root .proto-ui.proto-ui.proto-ui .sg-var {
  height: 20px;
  padding: 0 6px;
  border-radius: var(--n-r-in);
  background: var(--n-widget-on);
  color: var(--n-text);
  font: inherit;
  font-size: 11px;
}
.sg-frame {
  position: relative;
  height: 100%;
  overflow: hidden;
  border-radius: var(--n-r-in);
  background: var(--n-widget);
}
.sg-frame.is-cutout {
  background:
    repeating-conic-gradient(var(--n-widget-on) 0 25%, transparent 0 50%) 0 0 / 16px 16px,
    var(--n-widget);
}
.sg-empty {
  display: flex;
  height: 100%;
  margin: 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--n-slot-text);
  font-size: 12px;
  text-align: center;
}
.sg-empty.is-working {
  animation: sg-breathe 1.6s ease-in-out infinite;
}
@keyframes sg-breathe {
  50% {
    opacity: 0.45;
  }
}
.sg-img {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition:
    filter 0.4s ease,
    transform 0.4s ease;
}
.sg-img.is-motion {
  animation: sg-motion 10s ease-in-out infinite alternate;
}
@keyframes sg-motion {
  to {
    transform: scale(1.12) translate(-3%, -2%);
  }
}
/* A cut-out: the subject over a checkerboard. */
.sg-img.is-cutout {
  mask: radial-gradient(ellipse 46% 58% at 50% 46%, #000 62%, transparent 64%);
}
/* Executing: the preview stays soft until it lands. */
.sg-img.is-working {
  filter: blur(6px) saturate(0.8) brightness(0.8);
  transform: scale(1.06);
}
.sg-swap-enter-active,
.sg-swap-leave-active {
  transition: opacity 0.45s ease;
}
.sg-swap-enter-from,
.sg-swap-leave-to {
  opacity: 0;
}
.sg-chip {
  position: absolute;
  top: 8px;
  left: 8px;
  padding: 2px 6px;
  border-radius: var(--n-r-in);
  background: rgb(0 0 0 / 0.55);
  color: #fff;
  font-size: 11px;
  line-height: 14px;
  pointer-events: none;
}
.sg-chip.is-right {
  right: 8px;
  left: auto;
}
.sg-audio {
  display: flex;
  height: 100%;
  align-items: center;
  gap: 10px;
  padding: 0 10px;
  border-radius: var(--n-r-in);
  background: var(--n-widget);
}
.sg-play {
  display: inline-flex;
  width: 26px;
  height: 26px;
  flex: none;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: var(--n-text);
  color: var(--n-body);
}
.sg-wave {
  display: flex;
  height: 36px;
  flex: 1;
  align-items: center;
  gap: 2px;
}
.sg-wave i {
  width: 2px;
  flex: 1;
  border-radius: 999px;
  background: var(--n-slot-text);
}
.sg-wave.is-working i {
  animation: sg-breathe 1.2s ease-in-out infinite;
}
.sg-audio-time {
  color: var(--n-slot-text);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.sg-compare {
  cursor: ew-resize;
  touch-action: none;
}
.sg-divider {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: #fff;
  translate: -1px 0;
  pointer-events: none;
}
.sg-divider i {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: #fff;
  translate: -50% -50%;
}
.sg-gallery {
  display: grid;
  height: 100%;
  grid-template-columns: repeat(3, 1fr);
  grid-auto-rows: calc((100% - 8px) / 3);
  gap: 4px;
  overflow: auto;
}
.sg-gallery img {
  width: 100%;
  height: 100%;
  border-radius: var(--n-r-in);
  object-fit: cover;
}
.sg-gallery .sg-empty {
  grid-column: 1 / -1;
  grid-row: 1 / 4;
}

/* Running: what it does and how far, on the preview it is making. */
.sg-run {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.sg-run-label {
  display: inline-flex;
  height: 24px;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border-radius: var(--n-r-in);
  background: rgb(0 0 0 / 0.55);
  color: #fff;
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  backdrop-filter: blur(8px);
}
.sg-spin {
  animation: sg-spin 0.9s linear infinite;
}
@keyframes sg-spin {
  to {
    rotate: 360deg;
  }
}
.sg-run-bar {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 4px;
  background: var(--n-exec);
  transition: width 0.2s linear;
}

/* Earlier results: ‹ dots n / N ›, under the preview. */
.sg-cycler {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--n-slot-text);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.sg-cycler.is-off {
  opacity: 0.4;
}
:root .proto-ui.proto-ui.proto-ui .sg-cycler button {
  display: inline-flex;
  width: 22px;
  height: 22px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: var(--n-r-in);
  background: transparent;
  color: var(--n-icon);
}
:root .proto-ui.proto-ui.proto-ui .sg-cycler button:hover:not(:disabled) {
  background: var(--n-widget-hover);
  color: var(--n-text);
}
:root .proto-ui.proto-ui.proto-ui .sg-cycler button:disabled {
  opacity: 0.35;
}
.sg-cycler-dots {
  display: flex;
  align-items: center;
  gap: 3px;
}
.sg-cycler-dots i {
  width: 4px;
  height: 4px;
  border-radius: 999px;
  background: var(--n-widget-on);
}
.sg-cycler-dots i.is-on {
  width: 5px;
  height: 5px;
  background: var(--n-text);
}
.sg-cycler-count {
  min-width: 32px;
  text-align: center;
}

/* Settings: a summary row that opens the widgets under it. */
.sg-settings {
  display: flex;
  flex: none;
  flex-direction: column;
  padding: 0 12px;
}
:root .proto-ui.proto-ui.proto-ui .sg-sum {
  display: grid;
  min-width: 0;
  flex: none;
  grid-template-columns: 12px minmax(0, auto) minmax(0, 1fr) 12px;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  border-radius: var(--n-r-in);
  background: var(--n-widget);
  color: var(--n-text);
  font: inherit;
  font-size: 12px;
  text-align: left;
}
:root .proto-ui.proto-ui.proto-ui .sg-sum:hover {
  background: var(--n-widget-hover);
}
:root .proto-ui.proto-ui.proto-ui .sg-sum:focus-visible {
  outline: 2px solid var(--n-exec);
  outline-offset: 1px;
}
.sg-sum-title,
.sg-sum-values {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.sg-sum-values {
  color: var(--n-slot-text);
  text-align: right;
}
.sg-sum-chev {
  transition: rotate 0.16s ease;
}
.sg-settings.is-open .sg-sum-chev {
  rotate: 180deg;
}
.sg-action {
  display: flex;
  flex: none;
}
.sg-action .sg-w {
  flex: 1;
}
.sg-panel {
  display: grid;
  grid-template-rows: 0fr;
  overflow: hidden;
  transition: grid-template-rows 0.16s ease-out;
}
.sg-settings.is-open .sg-panel {
  grid-template-rows: 1fr;
  overflow: visible;
}
.sg-panel > .sg-widgets {
  min-height: 0;
  padding: 0;
}

/* An error's footer tab, tucked under the node. */
.sg-footer {
  position: absolute;
  top: calc(100% - var(--n-r));
  right: 0;
  left: 0;
  z-index: -1;
  padding: calc(var(--n-r) + 6px) 12px 6px;
  border-radius: 0 0 var(--n-r) var(--n-r);
  background: var(--n-error);
  color: #fff;
  font-size: 11.5px;
  line-height: 15px;
}

@media (prefers-reduced-motion: reduce) {
  .sg-node,
  .sg-panel,
  .sg-sum-chev,
  .sg-run-bar,
  .sg-img,
  .sg-progress i,
  .sg-dot,
  .sg-collapse svg,
  .sg-swap-enter-active,
  .sg-swap-leave-active {
    transition: none;
  }
  .sg-img.is-motion,
  .sg-img.is-working,
  .sg-empty.is-working,
  .sg-wave.is-working i,
  .sg-spin,
  .sg-menu {
    animation: none;
  }
}
</style>
