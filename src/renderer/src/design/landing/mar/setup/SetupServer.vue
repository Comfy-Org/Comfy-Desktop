<script setup lang="ts">
/**
 * A cloud build's machine, drawn in SetupLaptop's style: a rack of three
 * GPU servers from the front, brushed metal, drive bays and a light strip
 * in the build's hue. `live` lights the status LEDs. Sized by its
 * `.mss-laptop` box, like the laptop it stands in for.
 */
const { hue = 210, live = false } = defineProps<{ hue?: number; live?: boolean }>()
const UNITS = [12, 36, 60]
</script>

<template>
  <svg class="mss-laptop mss-server" viewBox="0 0 160 104" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id="mss-sv-face" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#5c5c62" />
        <stop offset="0.5" stop-color="#3a3a3f" />
        <stop offset="1" stop-color="#232326" />
      </linearGradient>
      <linearGradient id="mss-sv-top" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#9a9aa0" />
        <stop offset="1" stop-color="#5c5c62" />
      </linearGradient>
      <linearGradient id="mss-sv-sheen" x1="0" y1="0" x2="1" y2="0.4">
        <stop offset="0" stop-color="#fff" stop-opacity="0.12" />
        <stop offset="0.5" stop-color="#fff" stop-opacity="0.02" />
        <stop offset="0.51" stop-color="#fff" stop-opacity="0" />
      </linearGradient>
      <radialGradient id="mss-sv-shadow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#000" stop-opacity="0.55" />
        <stop offset="1" stop-color="#000" stop-opacity="0" />
      </radialGradient>
    </defs>
    <ellipse cx="80" cy="96" rx="62" ry="6" fill="url(#mss-sv-shadow)" />
    <!-- The rack's top, catching the light. -->
    <path d="M34 8 h92 l-4 4 H38 Z" fill="url(#mss-sv-top)" />
    <g v-for="(y, n) in UNITS" :key="y">
      <rect x="34" :y="y" width="92" height="22" rx="2.5" fill="url(#mss-sv-face)" />
      <rect
        x="34.5"
        :y="y + 0.5"
        width="91"
        height="21"
        rx="2"
        stroke="#fff"
        stroke-opacity="0.1"
      />
      <!-- Drive bays. -->
      <rect
        v-for="b in 4"
        :key="b"
        :x="40 + (b - 1) * 13"
        :y="y + 5"
        width="10"
        height="12"
        rx="1.2"
        fill="#17171a"
        stroke="#fff"
        stroke-opacity="0.06"
      />
      <!-- Vents. -->
      <rect
        v-for="v in 5"
        :key="`v${v}`"
        x="94"
        :y="y + 4 + (v - 1) * 3"
        width="18"
        height="1.2"
        rx="0.6"
        fill="#0f0f11"
      />
      <!-- The build's light strip and the status LED. -->
      <rect
        x="116"
        :y="y + 5"
        width="2.4"
        height="12"
        rx="1.2"
        :fill="`oklch(0.72 0.15 ${hue})`"
        :opacity="0.55 + n * 0.15"
      />
      <circle cx="121.5" :cy="y + 11" r="1.6" :fill="live ? '#3ccf7a' : '#5a5a60'" />
    </g>
    <rect x="34" y="8" width="92" height="74" rx="3" fill="url(#mss-sv-sheen)" />
  </svg>
</template>
