<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, ChevronDown, Download, Wand2 } from 'lucide-vue-next'
import { onClickOutside } from '@vueuse/core'
import MarSeg from '../pages/MarSeg.vue'
import { toast } from '../../useProto'
import {
  AUTO_EXPOSURE,
  EXR_CHANNELS,
  EXR_GAMUTS,
  MODEL_BACKGROUNDS,
  exrView,
  modelView,
  type Camera,
  type ExportFormat,
  type ExrChannel,
  type Material,
  type ViewerKind
} from './assetViewer'

const { kind, name } = defineProps<{ kind: ViewerKind; name: string }>()

const MATERIALS: { value: Material; label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: 'normal', label: 'Normal' },
  { value: 'wireframe', label: 'Wireframe' }
]
const CAMERAS: { value: Camera; label: string }[] = [
  { value: 'perspective', label: 'Perspective' },
  { value: 'orthographic', label: 'Orthographic' }
]
const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: 'glb', label: 'GLB' },
  { value: 'obj', label: 'OBJ' },
  { value: 'stl', label: 'STL' }
]
const BG_NAMES: Record<string, string> = {
  '#1c1c1f': 'Charcoal',
  '#3a3a40': 'Graphite',
  '#8a8f98': 'Mid grey',
  '#e8e6e1': 'Paper',
  '#22303a': 'Slate'
}

const channel = computed<ExrChannel>({
  get: () => exrView.channel,
  set: (v) => (exrView.channel = v)
})
const camera = computed<Camera>({
  get: () => modelView.camera,
  set: (v) => (modelView.camera = v)
})
const material = computed<Material>({
  get: () => modelView.material,
  set: (v) => (modelView.material = v)
})
const format = computed<ExportFormat>({
  get: () => modelView.format,
  set: (v) => (modelView.format = v)
})
function exportModel(): void {
  toast(`Exported ${name.replace(/\.[^.]+$/, '')}.${modelView.format}`)
}

const ev = computed(
  () => `${exrView.exposure >= 0 ? '+' : '−'}${Math.abs(exrView.exposure).toFixed(1)} EV`
)
const exposureAt = computed(() => `${((exrView.exposure + 5) / 10) * 100}%`)
const fovAt = computed(() => `${((modelView.fov - 20) / 70) * 100}%`)
const lightAt = computed(() => `${(modelView.light / 2) * 100}%`)

const gamutMenu = ref(false)
const gamutBox = ref<HTMLElement>()
onClickOutside(gamutBox, () => (gamutMenu.value = false))
function pickGamut(g: (typeof EXR_GAMUTS)[number]): void {
  exrView.gamut = g
  gamutMenu.value = false
}

const TOGGLES = [
  { key: 'dither', label: 'Dither' },
  { key: 'clip', label: 'Clip warnings' },
  { key: 'alpha', label: 'Show transparency' }
] as const

const seedOf = (s: string): number => [...s].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7)
const BINS = 64
function curve(peak: number, spread: number, lift: number): number[] {
  return Array.from({ length: BINS }, (_, i) => {
    const x = i / (BINS - 1)
    const main = Math.exp(-((x - peak) ** 2) / (2 * spread ** 2))
    const tail = 0.35 * Math.exp(-((x - lift) ** 2) / (2 * 0.05 ** 2))
    return main + tail
  })
}
function areaPath(values: number[]): string {
  const max = Math.max(...values)
  const pts = values.map(
    (v, i) => `${((i / (BINS - 1)) * 200).toFixed(1)},${(60 - (v / max) * 54).toFixed(1)}`
  )
  return `M0,60 L${pts.join(' L')} L200,60 Z`
}
const histogram = computed(() => {
  const h = seedOf(name)
  const at = (n: number): number => (((h + n * 2654435761) >>> 0) % 1000) / 1000
  const shift = exrView.exposure * 0.06
  return [
    { id: 'r', d: areaPath(curve(0.42 + at(1) * 0.2 + shift, 0.16, 0.86)) },
    { id: 'g', d: areaPath(curve(0.38 + at(2) * 0.2 + shift, 0.15, 0.82)) },
    { id: 'b', d: areaPath(curve(0.3 + at(3) * 0.2 + shift, 0.18, 0.9)) }
  ].filter((c) => exrView.channel === 'rgb' || exrView.channel === c.id)
})
</script>

<template>
  <div class="mav" :aria-label="kind === 'exr' ? 'EXR viewer' : '3D viewer'">
    <template v-if="kind === 'exr'">
      <section class="mad-sec">
        <div class="mav-head">
          <h3 class="mad-label">Exposure</h3>
          <button
            type="button"
            class="mav-head-btn"
            title="Auto exposure"
            @click="exrView.exposure = AUTO_EXPOSURE"
          >
            <Wand2 :size="15" />Auto exposure
          </button>
        </div>
        <div class="mav-slide">
          <input
            v-model.number="exrView.exposure"
            class="mav-range"
            type="range"
            min="-5"
            max="5"
            step="0.1"
            aria-label="Exposure"
            :style="{ '--mav-at': exposureAt }"
          />
          <span class="mav-value">{{ ev }}</span>
        </div>
      </section>

      <section class="mad-sec">
        <h3 class="mad-label">Display</h3>
        <div class="mav-row">
          <span class="mav-key">Channel</span>
          <MarSeg v-model="channel" :options="EXR_CHANNELS" label="Channel" />
        </div>
        <div class="mav-row">
          <span class="mav-key">Source gamut</span>
          <div ref="gamutBox" class="mad-pick">
            <button
              type="button"
              class="mad-select"
              aria-haspopup="menu"
              :aria-expanded="gamutMenu"
              @click="gamutMenu = !gamutMenu"
            >
              <span>{{ exrView.gamut }}</span
              ><ChevronDown :size="13" />
            </button>
            <div v-if="gamutMenu" class="mad-menu is-down" role="menu">
              <button
                v-for="g in EXR_GAMUTS"
                :key="g"
                type="button"
                role="menuitemradio"
                :aria-checked="exrView.gamut === g"
                @click="pickGamut(g)"
              >
                {{ g }}<Check v-if="exrView.gamut === g" :size="14" class="mad-menu-check" />
              </button>
            </div>
          </div>
        </div>
        <label v-for="t in TOGGLES" :key="t.key" class="mav-check">
          <input v-model="exrView[t.key]" type="checkbox" />
          <i class="mav-box" aria-hidden="true"><Check :size="11" /></i>
          <span>{{ t.label }}</span>
        </label>
      </section>

      <section class="mad-sec">
        <h3 class="mad-label">Histogram</h3>
        <svg
          class="mav-histo"
          viewBox="0 0 200 60"
          preserveAspectRatio="none"
          role="img"
          :aria-label="`Histogram, ${exrView.channel.toUpperCase()}`"
        >
          <path v-for="c in histogram" :key="c.id" :d="c.d" :class="`is-${c.id}`" />
        </svg>
        <div class="mav-histo-scale"><span>0</span><span>1.0</span><span>Over</span></div>
      </section>
    </template>

    <template v-else>
      <section class="mad-sec">
        <h3 class="mad-label">Background</h3>
        <div class="mav-swatches" role="radiogroup" aria-label="Background color" data-no-pill>
          <button
            v-for="c in MODEL_BACKGROUNDS"
            :key="c"
            type="button"
            role="radio"
            class="mav-swatch"
            :aria-checked="modelView.background === c"
            :aria-label="BG_NAMES[c]"
            :title="BG_NAMES[c]"
            :style="{ background: c }"
            @click="modelView.background = c"
          />
        </div>
      </section>

      <section class="mad-sec">
        <h3 class="mad-label">Material</h3>
        <MarSeg v-model="material" :options="MATERIALS" label="Material" class="mav-full" />
      </section>

      <section class="mad-sec">
        <h3 class="mad-label">Camera</h3>
        <MarSeg v-model="camera" :options="CAMERAS" label="Camera" class="mav-full" />
        <div class="mav-row is-stack" :class="modelView.camera === 'orthographic' && 'is-off'">
          <span class="mav-key">Field of view</span>
          <div class="mav-slide">
            <input
              v-model.number="modelView.fov"
              class="mav-range"
              type="range"
              min="20"
              max="90"
              step="1"
              aria-label="Field of view"
              :disabled="modelView.camera === 'orthographic'"
              :style="{ '--mav-at': fovAt }"
            />
            <span class="mav-value">{{ modelView.fov }}°</span>
          </div>
        </div>
      </section>

      <section class="mad-sec">
        <h3 class="mad-label">Light</h3>
        <div class="mav-row is-stack">
          <span class="mav-key">Intensity</span>
          <div class="mav-slide">
            <input
              v-model.number="modelView.light"
              class="mav-range"
              type="range"
              min="0"
              max="2"
              step="0.1"
              aria-label="Light intensity"
              :style="{ '--mav-at': lightAt }"
            />
            <span class="mav-value">{{ modelView.light.toFixed(1) }}×</span>
          </div>
        </div>
      </section>

      <section class="mad-sec">
        <h3 class="mad-label">Export</h3>
        <div class="mav-row">
          <MarSeg v-model="format" :options="FORMATS" label="Export format" />
          <button type="button" class="mad-btn mav-export" @click="exportModel">
            <Download :size="14" /><span>Export {{ modelView.format.toUpperCase() }}</span>
          </button>
        </div>
      </section>
    </template>
  </div>
</template>

<style>
.mav {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mav-row {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
}
.mav-row.is-stack {
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
}
.mav-row.is-off {
  opacity: 0.4;
}
.mav-slide {
  display: flex;
  align-items: center;
  gap: 12px;
}
.mav-key {
  color: var(--color-muted-foreground);
}
.mav-value {
  min-width: 52px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
:root .proto-ui.proto-ui.proto-ui .mav-range {
  height: 16px;
  min-width: 0;
  flex: 1;
  margin: 0;
  appearance: none;
  background: transparent;
  cursor: pointer;
}
:root .proto-ui.proto-ui.proto-ui .mav-range:focus,
:root .proto-ui.proto-ui.proto-ui .mav-range:focus-visible {
  outline: none;
  box-shadow: none;
}
:root .proto-ui.proto-ui.proto-ui .mav-range:disabled {
  cursor: default;
}
.mav-range::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 999px;
  background: linear-gradient(
    to right,
    var(--color-base-foreground) var(--mav-at),
    color-mix(in oklch, var(--color-base-foreground) 14%, transparent) var(--mav-at)
  );
}
.mav-range::-webkit-slider-thumb {
  width: 14px;
  height: 14px;
  margin-top: -5px;
  border-radius: 999px;
  appearance: none;
  background: var(--color-base-foreground);
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.4);
}
.mav-range:focus-visible::-webkit-slider-thumb {
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-base-foreground) 30%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mav .mad-btn {
  flex: none;
  height: 32px;
  border-radius: 8px;
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mav .mad-btn:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 11%, transparent);
}
.mav-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
:root .proto-ui.proto-ui.proto-ui .mav-head-btn {
  display: inline-flex;
  height: 24px;
  align-items: center;
  gap: 6px;
  margin: -4px -8px -4px 0;
  padding: 0 8px;
  border-radius: 8px;
  background: transparent;
  color: var(--color-muted-foreground);
  font-size: 12px;
}
:root .proto-ui.proto-ui.proto-ui .mav-head-btn:hover {
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
  color: var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mav-check {
  position: relative;
  display: flex;
  height: 24px;
  align-items: center;
  gap: 10px;
  color: var(--color-base-foreground);
  font-size: 12px;
  cursor: pointer;
}
.mav-check input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.mav-box {
  display: inline-flex;
  width: 16px;
  height: 16px;
  flex: none;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  background: color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
  color: transparent;
}
.mav-check input:checked + .mav-box {
  background: var(--color-base-foreground);
  color: var(--color-content-background);
}
.mav-check input:focus-visible + .mav-box {
  box-shadow: 0 0 0 2px color-mix(in oklch, var(--color-base-foreground) 40%, transparent);
}
.mav-histo {
  width: 100%;
  height: 64px;
  border-radius: 8px;
  background: color-mix(in oklch, var(--color-base-foreground) 5%, transparent);
}
.mav-histo path {
  mix-blend-mode: screen;
  opacity: 0.7;
}
.mav-histo .is-r {
  fill: oklch(0.65 0.2 25);
}
.mav-histo .is-g {
  fill: oklch(0.72 0.18 145);
}
.mav-histo .is-b {
  fill: oklch(0.62 0.17 255);
}
.mav-histo-scale {
  display: flex;
  justify-content: space-between;
  margin-top: -4px;
  color: var(--color-muted-foreground);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.mav-swatches {
  display: flex;
  gap: 8px;
}
:root .proto-ui.proto-ui.proto-ui .mav-swatch {
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 8px;
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 12%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mav-swatch[aria-checked='true'] {
  box-shadow:
    0 0 0 2px var(--color-content-background),
    0 0 0 4px var(--color-base-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mav-full {
  display: flex;
}
:root .proto-ui.proto-ui.proto-ui .mav-full .mar-pseg-btn {
  flex: 1;
}
</style>
