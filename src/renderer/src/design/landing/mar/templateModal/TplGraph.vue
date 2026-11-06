<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Maximize, Minus, Plus } from 'lucide-vue-next'
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

/** The template's graph, fitted to the stage. Drag to pan; the zoom
 *  controls step around the fitted size. */
const { spec } = defineProps<{ spec: GraphSpec }>()

const box = ref<HTMLElement>()
const size = ref({ w: 800, h: 450 })
const zoom = ref(1)
const pan = ref({ x: 0, y: 0 })
let ro: ResizeObserver | undefined
onMounted(() => {
  ro = new ResizeObserver(([e]) => {
    size.value = { w: e!.contentRect.width, h: e!.contentRect.height }
  })
  if (box.value) ro.observe(box.value)
})
onBeforeUnmount(() => ro?.disconnect())

const fit = computed(() =>
  Math.min((size.value.w - 28) / spec.width, (size.value.h - 64) / spec.height)
)
const scale = computed(() => fit.value * zoom.value)
const transform = computed(() => {
  const x = (size.value.w - spec.width * scale.value) / 2 + pan.value.x
  const y = (size.value.h - spec.height * scale.value) / 2 + pan.value.y
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
  zoom.value = Math.min(2, Math.max(0.6, +(zoom.value + d).toFixed(2)))
}
function reset(): void {
  zoom.value = 1
  pan.value = { x: 0, y: 0 }
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

    <div class="mar-tpl-zoom" role="group" aria-label="Zoom">
      <button type="button" aria-label="Zoom out" @click="step(-0.1)">
        <Minus :size="14" />
      </button>
      <span>{{ Math.round(zoom * 100) }}%</span>
      <button type="button" aria-label="Zoom in" @click="step(0.1)">
        <Plus :size="14" />
      </button>
      <button type="button" aria-label="Fit" @click="reset"><Maximize :size="13" /></button>
    </div>
  </div>
</template>
