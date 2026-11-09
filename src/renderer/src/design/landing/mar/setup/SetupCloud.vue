<script setup lang="ts">
/**
 * A cloud build's machine, drawn in SetupLaptop's style: one soft cloud in
 * brushed metal, lit from inside in the build's hue. Sized by its
 * `.mss-laptop` box, like the laptop it stands in for.
 */
const { hue = 210 } = defineProps<{ hue?: number }>()
const CLOUD =
  'M48 82 H116 A17 17 0 0 0 118 48 A28 28 0 0 0 66 38 A20 20 0 0 0 44 50 A16 16 0 0 0 48 82 Z'
</script>

<template>
  <svg class="mss-laptop mss-cloud" viewBox="0 0 160 104" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id="mss-cl-face" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#9a9aa0" />
        <stop offset="0.55" stop-color="#55555b" />
        <stop offset="1" stop-color="#2a2a2e" />
      </linearGradient>
      <radialGradient id="mss-cl-glow" cx="0.45" cy="0.7" r="0.6">
        <stop offset="0" :stop-color="`oklch(0.75 0.15 ${hue})`" stop-opacity="0.55" />
        <stop offset="1" :stop-color="`oklch(0.75 0.15 ${hue})`" stop-opacity="0" />
      </radialGradient>
      <radialGradient id="mss-cl-shadow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#000" stop-opacity="0.55" />
        <stop offset="1" stop-color="#000" stop-opacity="0" />
      </radialGradient>
    </defs>
    <ellipse cx="82" cy="94" rx="46" ry="5" fill="url(#mss-cl-shadow)" />
    <path :d="CLOUD" fill="url(#mss-cl-face)" />
    <path :d="CLOUD" fill="url(#mss-cl-glow)" />
    <path :d="CLOUD" stroke="#fff" stroke-opacity="0.18" />
  </svg>
</template>
