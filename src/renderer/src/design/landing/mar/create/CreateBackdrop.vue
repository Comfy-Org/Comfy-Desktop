<script setup lang="ts">
const NODES = [
  { x: 70, y: 70, w: 150, h: 64 },
  { x: 90, y: 200, w: 130, h: 52 },
  { x: 330, y: 120, w: 170, h: 96 },
  { x: 1000, y: 60, w: 150, h: 88 },
  { x: 1180, y: 190, w: 140, h: 56 },
  { x: 1300, y: 70, w: 120, h: 50 }
]
const WIRES = [
  'M220 102 C275 102 275 150 330 150',
  'M220 226 C275 226 275 186 330 186',
  'M500 168 C620 168 600 40 760 30',
  'M1150 104 C1165 104 1165 218 1180 218',
  'M1150 92 C1220 92 1230 95 1300 95',
  'M880 260 C940 260 940 104 1000 104'
]
</script>

<template>
  <div class="mcb" aria-hidden="true">
    <div class="mcb-dots" />
    <svg class="mcb-graph" viewBox="0 0 1440 320" preserveAspectRatio="xMidYMin slice">
      <g class="mcb-wires">
        <path v-for="d in WIRES" :key="d" :d />
      </g>
      <g class="mcb-pulses">
        <path
          v-for="(d, i) in WIRES"
          :key="d"
          :d
          pathLength="100"
          :style="{ animationDelay: `${i * -1.3}s` }"
        />
      </g>
      <g v-for="n in NODES" :key="`${n.x}-${n.y}`" class="mcb-node">
        <rect :x="n.x" :y="n.y" :width="n.w" :height="n.h" rx="10" />
        <rect :x="n.x + 12" :y="n.y + 12" :width="n.w * 0.45" height="6" rx="3" class="mcb-line" />
        <rect
          :x="n.x + 12"
          :y="n.y + 26"
          :width="n.w * 0.7"
          height="5"
          rx="2.5"
          class="mcb-line is-faint"
        />
      </g>
    </svg>
  </div>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .mcb {
  position: absolute;
  inset: 0 0 auto;
  z-index: 0;
  height: 440px;
  overflow: hidden;
  pointer-events: none;
  background: radial-gradient(
    ellipse 55% 85% at 50% -15%,
    color-mix(in oklch, var(--color-base-foreground) 13%, transparent),
    transparent 70%
  );
  mask-image: linear-gradient(to bottom, black 45%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mcb-dots {
  position: absolute;
  inset: 0;
  background-image: radial-gradient(
    color-mix(in oklch, var(--color-base-foreground) 14%, transparent) 1px,
    transparent 1.4px
  );
  background-size: 22px 22px;
  mask-image: radial-gradient(ellipse 70% 90% at 50% 0%, black, transparent 75%);
}
:root .proto-ui.proto-ui.proto-ui .mcb-graph {
  position: absolute;
  inset: 24px 0 0;
  width: 100%;
  height: 320px;
  mask-image: linear-gradient(to right, black, transparent 30%, transparent 70%, black);
}
:root .proto-ui.proto-ui.proto-ui .mcb-wires path,
:root .proto-ui.proto-ui.proto-ui .mcb-pulses path {
  fill: none;
  stroke-width: 1.5;
  stroke-linecap: round;
}
:root .proto-ui.proto-ui.proto-ui .mcb-wires path {
  stroke: color-mix(in oklch, var(--color-base-foreground) 12%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mcb-pulses path {
  stroke: color-mix(in oklch, var(--color-base-foreground) 55%, transparent);
  stroke-dasharray: 6 94;
  animation: mcb-flow 5.2s linear infinite;
}
:root .proto-ui.proto-ui.proto-ui .mcb-node rect:first-child {
  fill: color-mix(in oklch, var(--color-base-foreground) 4%, transparent);
  stroke: color-mix(in oklch, var(--color-base-foreground) 9%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mcb-line {
  fill: color-mix(in oklch, var(--color-base-foreground) 14%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mcb-line.is-faint {
  fill: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
}
@keyframes mcb-flow {
  from {
    stroke-dashoffset: 100;
  }
  to {
    stroke-dashoffset: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  :root .proto-ui.proto-ui.proto-ui .mcb-pulses path {
    animation: none;
    stroke-dashoffset: 40;
  }
}
</style>
