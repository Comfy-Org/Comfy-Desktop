<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  HEADER,
  ROW,
  SLOT_COLOR,
  WIDGET,
  nodeHeight,
  slotPos,
  type GNode,
  type GraphSpec
} from './graphSpec'

/** The template's graph, fitted to the stage like a picture in the asset
 *  view. Drag to pan; the modal's ZoomControl (assets/ZoomControl.vue)
 *  scales it: `zoom` is a percentage of the fitted size (100 = fit), and
 *  `fit` reports the fitted scale so the control reads in real size. */
const { spec, pad = { t: 0, r: 0, b: 0, l: 0 } } = defineProps<{
  spec: GraphSpec
  /** Room the stage's controls take: the graph fits and centres inside
   *  it, but zoomed in it runs under them to the stage's edges. */
  pad?: { t: number; r: number; b: number; l: number }
}>()
const zoomPct = defineModel<number>('zoom', { default: 100 })
const fitOut = defineModel<number>('fit', { default: 1 })

const box = ref<HTMLElement>()
const size = ref({ w: 800, h: 450 })
const zoom = computed(() => zoomPct.value / 100)
const pan = ref({ x: 0, y: 0 })
let ro: ResizeObserver | undefined
onMounted(() => {
  ro = new ResizeObserver(([e]) => {
    size.value = { w: e!.contentRect.width, h: e!.contentRect.height }
  })
  if (box.value) ro.observe(box.value)
})
onBeforeUnmount(() => ro?.disconnect())

// A little air around it, like the picture's own margin.
const room = computed(() => ({
  w: size.value.w - pad.l - pad.r,
  h: size.value.h - pad.t - pad.b
}))
const fit = computed(() =>
  Math.min((room.value.w - 32) / spec.width, (room.value.h - 32) / spec.height, 1.6)
)
watch(fit, (f) => (fitOut.value = f), { immediate: true })
// Back to fit (D, Zoom to fit) recentres it too.
watch(zoomPct, (z) => z === 100 && (pan.value = { x: 0, y: 0 }))
const scale = computed(() => fit.value * zoom.value)
const transform = computed(() => {
  const x = pad.l + (room.value.w - spec.width * scale.value) / 2 + pan.value.x
  const y = pad.t + (room.value.h - spec.height * scale.value) / 2 + pan.value.y
  return `translate(${x}px, ${y}px) scale(${scale.value})`
})

const byId = computed(() => Object.fromEntries(spec.nodes.map((n) => [n.id, n])))
const wires = computed(() =>
  spec.links.map((l) => {
    const [x1, y1] = slotPos(byId.value[l.from[0]] as GNode, 'out', l.from[1])
    const [x2, y2] = slotPos(byId.value[l.to[0]] as GNode, 'in', l.to[1])
    const dx = Math.max(40, (x2 - x1) * 0.5)
    return {
      d: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`,
      color: SLOT_COLOR[l.type]
    }
  })
)

function step(d: number): void {
  zoomPct.value = Math.min(800, Math.max(10, zoomPct.value * (1 + d)))
}

let drag: { x: number; y: number; px: number; py: number } | undefined
function down(e: PointerEvent): void {
  if ((e.target as HTMLElement).closest('button')) return
  drag = { x: e.clientX, y: e.clientY, px: pan.value.x, py: pan.value.y }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}
function move(e: PointerEvent): void {
  if (!drag) return
  pan.value = { x: drag.px + e.clientX - drag.x, y: drag.py + e.clientY - drag.y }
}
function up(): void {
  drag = undefined
}
function wheel(e: WheelEvent): void {
  if (!e.ctrlKey && !e.metaKey) return
  e.preventDefault()
  step(e.deltaY < 0 ? 0.1 : -0.1)
}
</script>

<template>
  <div
    ref="box"
    class="mar-tpl-graph"
    @pointerdown="down"
    @pointermove="move"
    @pointerup="up"
    @pointercancel="up"
    @wheel="wheel"
  >
    <div
      class="mar-tpl-graph-world"
      :style="{ width: `${spec.width}px`, height: `${spec.height}px`, transform }"
    >
      <svg class="mar-tpl-graph-wires" :viewBox="`0 0 ${spec.width} ${spec.height}`">
        <path
          v-for="(w, i) in wires"
          :key="i"
          :d="w.d"
          :stroke="w.color"
          fill="none"
          stroke-width="2"
          stroke-linecap="round"
        />
      </svg>
      <div
        v-for="n in spec.nodes"
        :key="n.id"
        class="mar-tpl-node"
        :data-role="n.role"
        :style="{
          left: `${n.x}px`,
          top: `${n.y}px`,
          width: `${n.w}px`,
          height: `${nodeHeight(n)}px`
        }"
      >
        <div class="mar-tpl-node-head" :style="{ height: `${HEADER}px` }">
          <span class="mar-tpl-node-dot" />{{ n.title }}
        </div>
        <div
          v-for="r in Math.max(n.ins.length, n.outs.length)"
          :key="r"
          class="mar-tpl-node-row"
          :style="{ height: `${ROW}px` }"
        >
          <span v-if="n.ins[r - 1]" class="mar-tpl-slot">
            <i :style="{ background: SLOT_COLOR[n.ins[r - 1]![1]] }" />{{ n.ins[r - 1]![0] }}
          </span>
          <span v-else />
          <span v-if="n.outs[r - 1]" class="mar-tpl-slot is-out">
            {{ n.outs[r - 1]![0] }}<i :style="{ background: SLOT_COLOR[n.outs[r - 1]![1]] }" />
          </span>
        </div>
        <div v-if="n.widgets.length" class="mar-tpl-node-widgets">
          <div
            v-for="[k, v] in n.widgets"
            :key="k"
            class="mar-tpl-widget"
            :style="{ height: `${WIDGET}px` }"
          >
            <span>{{ k }}</span
            ><b>{{ v }}</b>
          </div>
        </div>
        <p v-if="n.text" class="mar-tpl-node-text">{{ n.text }}</p>
        <img
          v-if="n.image"
          :src="n.image"
          alt=""
          class="mar-tpl-node-img"
          :style="{ height: `${n.imageH ?? 120}px` }"
          draggable="false"
        />
      </div>
    </div>
  </div>
</template>
