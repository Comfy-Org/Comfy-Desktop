<script setup lang="ts">
import { WIRE } from '../brand/imagery'

/**
 * Wires (Home background): a ComfyUI graph traced in light along the top of
 * the page. Nodes are outlines cropped by the edges, never whole; the wires
 * keep ComfyUI's link colours and stay in the band above the greeting. One
 * slow pulse runs along the LATENT wire; none under reduced motion.
 */
const NODES = [
  { x: -60, y: 40, w: 230, h: 170 },
  { x: 210, y: -40, w: 190, h: 100 },
  { x: 800, y: -40, w: 200, h: 120 },
  { x: 1080, y: 110, w: 200, h: 160 }
]
const LINKS = [
  { d: 'M170 80 C190 80 190 20 210 20', c: WIRE.model },
  { d: 'M170 110 C196 110 184 40 210 40', c: WIRE.clip },
  { d: 'M400 25 C560 25 520 92 620 92 S700 30 800 30', c: WIRE.latent, pulse: true },
  { d: 'M1000 45 C1044 45 1036 150 1080 150', c: WIRE.image }
]
// Sockets: each link's ends, plus one left open (VAE, waiting for a wire).
const SOCKETS = [
  { x: 170, y: 80, c: WIRE.model },
  { x: 210, y: 20, c: WIRE.model },
  { x: 170, y: 110, c: WIRE.clip },
  { x: 210, y: 40, c: WIRE.clip },
  { x: 170, y: 140, c: WIRE.vae },
  { x: 400, y: 25, c: WIRE.latent },
  { x: 800, y: 30, c: WIRE.latent },
  { x: 1000, y: 45, c: WIRE.image },
  { x: 1080, y: 150, c: WIRE.image }
]
</script>

<template>
  <svg
    class="mar-wires"
    viewBox="0 0 1200 560"
    preserveAspectRatio="xMidYMin slice"
    aria-hidden="true"
  >
    <g transform="translate(0 24)">
      <g class="mar-wires-nodes">
        <g v-for="(n, i) in NODES" :key="i" :transform="`translate(${n.x} ${n.y})`">
          <rect :width="n.w" :height="n.h" rx="10" />
          <line x1="0" y1="26" :x2="n.w" y2="26" />
        </g>
      </g>
      <g class="mar-wires-links">
        <path v-for="l in LINKS" :key="l.d" :d="l.d" :stroke="l.c" />
      </g>
      <path
        v-for="l in LINKS.filter((k) => k.pulse)"
        :key="`p${l.d}`"
        class="mar-wires-pulse"
        :d="l.d"
        :stroke="l.c"
        :style="{ color: l.c }"
        pathLength="1000"
      />
      <g class="mar-wires-sockets">
        <circle v-for="(s, i) in SOCKETS" :key="i" :cx="s.x" :cy="s.y" r="4.5" :fill="s.c" />
      </g>
    </g>
  </svg>
</template>

<style scoped>
.mar-wires {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.mar-wires-nodes rect {
  fill: color-mix(in oklch, var(--color-base-foreground) 2.5%, transparent);
  stroke: color-mix(in oklch, var(--color-base-foreground) 13%, transparent);
  stroke-width: 1;
}
.mar-wires-nodes line {
  stroke: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
}
.mar-wires-links path {
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  opacity: 0.42;
}
.mar-wires-sockets {
  opacity: 0.6;
}
/* A short bright stretch travelling down the wire, like data moving. */
.mar-wires-pulse {
  fill: none;
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-dasharray: 70 1100;
  opacity: 0.9;
  filter: drop-shadow(0 0 6px currentColor);
  animation: mar-wire-pulse 7s cubic-bezier(0.45, 0, 0.55, 1) infinite;
}
@keyframes mar-wire-pulse {
  from {
    stroke-dashoffset: 70;
  }
  60%,
  to {
    stroke-dashoffset: -1000;
  }
}
@media (prefers-reduced-motion: reduce) {
  .mar-wires-pulse {
    display: none;
  }
}
/* Light mode: the same graph, inked a little darker so it still reads. */
:root[data-ds-theme='light'] .mar-wires-links,
:root[data-ds-theme='light'] .mar-wires-sockets {
  filter: saturate(1.1) brightness(0.78);
}
:root[data-ds-theme='light'] .mar-wires-links path {
  opacity: 0.55;
}
:root[data-ds-theme='light'] .mar-wires-nodes rect {
  fill: color-mix(in oklch, var(--color-base-foreground) 1.5%, transparent);
  stroke: color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
}
</style>
