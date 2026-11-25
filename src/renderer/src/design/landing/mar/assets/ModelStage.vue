<script setup lang="ts">
import { computed } from 'vue'
import { modelView } from './assetViewer'

const APEX = { x: 200, y: 92 }
const BASE = {
  left: { x: 96, y: 268 },
  front: { x: 214, y: 318 },
  right: { x: 308, y: 262 },
  back: { x: 192, y: 226 }
}
const pt = (p: { x: number; y: number }): string => `${p.x},${p.y}`
const face = (...ps: { x: number; y: number }[]): string => ps.map(pt).join(' ')

const leftFace = face(APEX, BASE.left, BASE.front)
const rightFace = face(APEX, BASE.front, BASE.right)
const hiddenEdges = [
  [APEX, BASE.back],
  [BASE.left, BASE.back],
  [BASE.back, BASE.right]
] as const
const shownEdges = [
  [APEX, BASE.left],
  [APEX, BASE.front],
  [APEX, BASE.right],
  [BASE.left, BASE.front],
  [BASE.front, BASE.right]
] as const

const scale = computed(() =>
  modelView.camera === 'orthographic' ? 0.9 : 1 + (50 - modelView.fov) / 140
)
const light = computed(() => Math.min(2, Math.max(0, modelView.light)))
const fills = computed(() => {
  if (modelView.material === 'normal')
    return { left: 'rgb(118 132 236)', right: 'rgb(196 128 226)' }
  const l = light.value
  return {
    left: `hsl(32 10% ${Math.round(26 + 24 * l)}%)`,
    right: `hsl(32 8% ${Math.round(14 + 14 * l)}%)`
  }
})
const wire = computed(() => modelView.material === 'wireframe')
const lightBackground = computed(() => /^#(e|f|d|c|b|a|9|8)/i.test(modelView.background))
const gridLines = computed(() => {
  const persp = modelView.camera === 'perspective'
  return Array.from({ length: 9 }, (_, i) => {
    const t = i / 8
    const x1 = 20 + t * 360
    return { x1, y1: 400, x2: persp ? 200 + (x1 - 200) * 0.35 : x1, y2: 200 }
  })
})
const rows = [232, 262, 300, 348]
</script>

<template>
  <div
    class="ms"
    :class="lightBackground && 'is-light'"
    :style="{ background: modelView.background }"
    aria-hidden="true"
  >
    <svg viewBox="0 0 400 400" class="ms-svg">
      <g class="ms-grid">
        <line v-for="(g, i) in gridLines" :key="`v${i}`" v-bind="g" />
        <line v-for="y in rows" :key="`h${y}`" x1="0" :y1="y" x2="400" :y2="y" />
      </g>
      <g :style="{ transform: `scale(${scale})`, transformOrigin: '200px 270px' }">
        <ellipse cx="204" cy="300" rx="128" ry="26" class="ms-shadow" />
        <template v-if="wire">
          <line
            v-for="([a, b], i) in hiddenEdges"
            :key="`h${i}`"
            :x1="a.x"
            :y1="a.y"
            :x2="b.x"
            :y2="b.y"
            class="ms-edge is-hidden"
          />
          <line
            v-for="([a, b], i) in shownEdges"
            :key="`s${i}`"
            :x1="a.x"
            :y1="a.y"
            :x2="b.x"
            :y2="b.y"
            class="ms-edge"
          />
        </template>
        <template v-else>
          <polygon :points="leftFace" :fill="fills.left" />
          <polygon :points="rightFace" :fill="fills.right" />
        </template>
      </g>
    </svg>
  </div>
</template>

<style>
.ms {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.18s ease;
  --ms-ink: rgb(255 255 255 / 0.1);
  --ms-wire: rgb(255 255 255 / 0.85);
}
.ms.is-light {
  --ms-ink: rgb(0 0 0 / 0.1);
  --ms-wire: rgb(0 0 0 / 0.75);
}
.ms-svg {
  width: 82%;
  height: 82%;
}
.ms-grid line {
  stroke: var(--ms-ink);
  stroke-width: 1;
}
.ms-shadow {
  fill: rgb(0 0 0 / 0.28);
  filter: blur(6px);
}
.ms-edge {
  stroke: var(--ms-wire);
  stroke-width: 1.6;
  stroke-linecap: round;
}
.ms-edge.is-hidden {
  stroke-dasharray: 4 5;
  opacity: 0.45;
}
@media (prefers-reduced-motion: reduce) {
  .ms {
    transition: none;
  }
}
</style>
