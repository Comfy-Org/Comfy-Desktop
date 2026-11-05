<script setup lang="ts">
import { useElementSize } from '@vueuse/core'
import { computed, ref } from 'vue'
import { look } from '../../look'
import { cover } from '../cover'
import WorkflowGradient from './WorkflowGradient.vue'

/**
 * A workflow's cover when there is no picture to show (workflows carry
 * none yet): a small graph on a tilted canvas, neutral, three inputs into
 * a node into its output. Drawn on a 280×175 stage that scales to cover
 * the card; each name leans it a little differently so a grid isn't cloned.
 */
const { name = '' } = defineProps<{ name?: string }>()

const LEANS = [-12, -9, -14, -10]
const OUTPUTS = [64, 70, 60, 66]
const seed = computed(() => [...name].reduce((n, c) => n + c.charCodeAt(0), 0) % 4)
const lean = computed(() => LEANS[seed.value]!)
const preview = computed(() => OUTPUTS[seed.value]!)
const outputHeight = computed(() => Math.ceil((50 + preview.value) / 10) * 10)

const root = ref<HTMLElement | null>(null)
const { width, height } = useElementSize(root)
const scale = computed(() => Math.max(width.value / 280, height.value / 175))

/** Three wires, parallel, into the node; one out of it. */
const WIRES = [
  'M28 50 C49 50 49 88 70 88',
  'M28 74 C49 74 49 100 70 100',
  'M28 98 C49 98 49 112 70 112',
  'M190 88 C210 88 194 72 214 72'
]
const INPUTS = [40, 64, 88]
const ROWS = [
  { y: 32, w: 22 },
  { y: 44, w: 30 },
  { y: 56, w: 18 }
]
const FIELDS = [
  { y: 62, l: 26, v: 14 },
  { y: 76, l: 34, v: 10 }
]
</script>

<template>
  <WorkflowGradient v-if="cover.id === 'gradient'" :name />
  <div
    v-else
    ref="root"
    class="wfc"
    :class="look.theme === 'light' ? 'is-light' : 'is-dark'"
    aria-hidden="true"
  >
    <div class="wfc-stage" :style="{ transform: `scale(${scale})` }">
      <div
        class="wfc-plane"
        :style="{
          transform: `perspective(620px) rotateX(34deg) rotateZ(${lean}deg) scale(1.16)`
        }"
      >
        <div class="wfc-dots" />
        <div class="wfc-group" />
        <svg class="wfc-wires" width="280" height="175" viewBox="0 0 280 175">
          <path v-for="d in WIRES" :key="d" :d />
        </svg>

        <div v-for="y in INPUTS" :key="y" class="wfc-node is-input" :style="{ top: `${y}px` }">
          <span class="wfc-head is-whole"
            ><i class="wfc-mark" /><i class="wfc-title" style="width: 44px"
          /></span>
          <i class="wfc-socket" style="left: 76.5px; top: 6.5px" />
        </div>

        <div class="wfc-node is-main">
          <span class="wfc-head"
            ><i class="wfc-mark" /><i class="wfc-title" style="width: 54px"
          /></span>
          <template v-for="r in ROWS" :key="r.y">
            <i class="wfc-socket" :style="{ left: '-3.5px', top: `${r.y - 3.5}px` }" />
            <i
              class="wfc-label"
              :style="{ left: '8.5px', top: `${r.y - 2}px`, width: `${r.w}px` }"
            />
          </template>
          <i class="wfc-socket" style="left: 116.5px; top: 28.5px" />
          <i class="wfc-label" style="left: 81.5px; top: 30px; width: 30px" />
          <span v-for="f in FIELDS" :key="f.y" class="wfc-field" :style="{ top: `${f.y}px` }">
            <i class="wfc-label" :style="{ left: '6px', top: '4px', width: `${f.l}px` }" />
            <i class="wfc-value" :style="{ right: '6px', top: '4px', width: `${f.v}px` }" />
          </span>
        </div>

        <div class="wfc-node is-output" :style="{ height: `${outputHeight}px` }">
          <span class="wfc-head"
            ><i class="wfc-mark" /><i class="wfc-title" style="width: 48px"
          /></span>
          <i class="wfc-socket" style="left: -3.5px; top: 28.5px" />
          <i class="wfc-label" style="left: 8.5px; top: 30px; width: 22px" />
          <span class="wfc-preview" :style="{ height: `${preview}px` }" />
        </div>
      </div>
      <div class="wfc-fade" />
      <div class="wfc-vignette" />
    </div>
  </div>
</template>

<style scoped>
.wfc {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--canvas);
}
.wfc.is-dark {
  --canvas: #151517;
  --canvas-60: rgb(21 21 23 / 0.6);
  --canvas-0: rgb(21 21 23 / 0);
  --dot: rgb(255 255 255 / 0.075);
  --node: #222225;
  --head: #2a2a2e;
  --edge: rgb(255 255 255 / 0.085);
  --pill: rgb(255 255 255 / 0.32);
  --pill2: rgb(255 255 255 / 0.13);
  --field: #19191c;
  --preview: #18181b;
  --wire: #8a8a92;
  --lift: 0 2px 0 rgb(0 0 0 / 0.5), 0 18px 22px -12px rgb(0 0 0 / 0.85);
  --group: rgb(168 168 176 / 0.07);
  --group-edge: rgb(168 168 176 / 0.32);
  --out: #a8a8b0;
  --out-edge: rgb(168 168 176 / 0.6);
  --out-halo: rgb(168 168 176 / 0.14);
  --out-head: #45454a;
  --vignette: rgb(0 0 0 / 0.3);
}
.wfc.is-light {
  --canvas: #f0f0f2;
  --canvas-60: rgb(240 240 242 / 0.6);
  --canvas-0: rgb(240 240 242 / 0);
  --dot: rgb(0 0 0 / 0.1);
  --node: #fff;
  --head: #f6f6f8;
  --edge: rgb(0 0 0 / 0.1);
  --pill: rgb(0 0 0 / 0.26);
  --pill2: rgb(0 0 0 / 0.1);
  --field: #f2f2f4;
  --preview: #ececef;
  --wire: #85858d;
  --lift: 0 2px 2px rgb(20 20 30 / 0.08), 0 18px 22px -12px rgb(20 20 30 / 0.3);
  --group: rgb(110 110 118 / 0.08);
  --group-edge: rgb(110 110 118 / 0.4);
  --out: #6e6e76;
  --out-edge: rgb(110 110 118 / 0.65);
  --out-halo: rgb(110 110 118 / 0.16);
  --out-head: #e3e3e6;
  --vignette: rgb(40 40 70 / 0.09);
}
.wfc-stage {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 280px;
  height: 175px;
  margin: -87.5px 0 0 -140px;
}
.wfc-plane {
  position: absolute;
  inset: 0;
  transform-origin: 45% 58%;
}
.wfc-dots {
  position: absolute;
  inset: -280px;
  background-image: radial-gradient(var(--dot) 0.9px, transparent 1.2px);
  background-position: 10px 10px;
  background-size: 20px 20px;
}
.wfc-group {
  position: absolute;
  top: 16px;
  left: 52px;
  width: 310px;
  height: 190px;
  border-radius: 6px;
  background: var(--group);
  box-shadow: inset 0 0 0 1px var(--group-edge);
}
.wfc-wires {
  position: absolute;
  top: 0;
  left: 0;
  overflow: visible;
  fill: none;
  stroke: var(--wire);
  stroke-linecap: round;
  stroke-width: 2;
}
.wfc-node {
  position: absolute;
  box-sizing: border-box;
  width: 120px;
  border-radius: 6px;
  background: var(--node);
  box-shadow:
    var(--lift),
    inset 0 0 0 1px var(--edge);
}
.wfc-node.is-input {
  left: -52px;
  width: 80px;
  height: 20px;
}
.wfc-node.is-main {
  top: 56px;
  left: 70px;
  height: 100px;
}
.wfc-node.is-output {
  top: 40px;
  left: 214px;
  box-shadow:
    var(--lift),
    0 0 0 3px var(--out-halo),
    inset 0 0 0 1px var(--out-edge);
}
.wfc-head {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: 20px;
  border-radius: 6px 6px 0 0;
  background: var(--head);
  box-shadow: inset 0 -1px 0 var(--edge);
}
.wfc-head.is-whole {
  border-radius: 6px;
  box-shadow: none;
}
.is-output .wfc-head {
  background: var(--out-head);
}
.wfc-mark {
  position: absolute;
  top: 7px;
  left: 8px;
  width: 6px;
  height: 6px;
  border-radius: 99px;
  background: var(--pill);
}
.is-output .wfc-mark {
  background: var(--out);
}
.wfc-title {
  position: absolute;
  top: 8px;
  left: 20px;
  height: 4.5px;
  border-radius: 99px;
  background: var(--pill);
}
.wfc-socket {
  position: absolute;
  width: 7px;
  height: 7px;
  border-radius: 99px;
  background: var(--wire);
  box-shadow: 0 0 0 2px var(--node);
}
.wfc-label,
.wfc-value {
  position: absolute;
  height: 3.5px;
  border-radius: 99px;
  background: var(--pill2);
}
.wfc-value {
  background: var(--pill);
}
.wfc-field {
  position: absolute;
  right: 8px;
  left: 8px;
  height: 11px;
  border-radius: 3px;
  background: var(--field);
}
.wfc-preview {
  position: absolute;
  top: 42px;
  right: 8px;
  left: 8px;
  border-radius: 4px;
  background: var(--preview);
  box-shadow: inset 0 0 0 1px var(--edge);
}
.wfc-fade,
.wfc-vignette {
  position: absolute;
  inset: 0;
}
.wfc-fade {
  background: linear-gradient(180deg, var(--canvas) 0%, var(--canvas-60) 22%, var(--canvas-0) 48%);
}
.wfc-vignette {
  background: radial-gradient(ellipse 78% 92% at 50% 62%, transparent 42%, var(--vignette) 100%);
}
</style>
