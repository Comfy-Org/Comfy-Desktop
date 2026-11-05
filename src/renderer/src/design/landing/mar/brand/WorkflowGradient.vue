<script setup lang="ts">
import { computed, useId } from 'vue'

/**
 * A workflow's cover as its own gradient (UI Playground › Workflow cover):
 * soft colour clouds that fill the image's space, so each workflow is told
 * apart at a glance. The name picks the colours and where they sit, so it
 * always gets the same one.
 */
const { name = '' } = defineProps<{ name?: string }>()

// Base, then the colours that drift over it.
const PALETTES = [
  ['#0b7fe8', '#7fd4ff', '#e8f8ff', '#0a4fd0'],
  ['#0d2547', '#2f6fc4', '#12335f', '#5b9be0'],
  ['#c9b8f0', '#f0391e', '#5a35a8', '#ffffff'],
  ['#0f5a4a', '#37d29a', '#d8ffe9', '#0a3d52'],
  ['#ff7a18', '#ffd25e', '#ff3d6e', '#fff2d6'],
  ['#3b1a78', '#b14dff', '#ff7ad9', '#1b0f4a'],
  ['#f2c6d8', '#ff5f8f', '#ffffff', '#b43bd0'],
  ['#14213d', '#fca311', '#e5533d', '#0f2a57']
]

const hash = computed(() => {
  let h = 2166136261
  for (const c of name) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return h >>> 0
})
/** A repeatable number from 0 to 1, one per use of the name. */
const pick = (n: number): number =>
  (Math.imul(hash.value ^ (n * 2654435761), 2246822519) >>> 8) / 2 ** 24

const palette = computed(() => PALETTES[hash.value % PALETTES.length]!)
const background = computed(() => {
  const [base, ...clouds] = palette.value
  const layers = clouds.map((color, i) => {
    const x = Math.round(pick(i * 3 + 1) * 100)
    const y = Math.round(pick(i * 3 + 2) * 100)
    const size = Math.round(38 + pick(i * 3 + 3) * 34)
    return `radial-gradient(circle at ${x}% ${y}%, ${color} 0%, transparent ${size}%)`
  })
  return [...layers, `linear-gradient(${base}, ${base})`].join(', ')
})
const seed = computed(() => hash.value % 97)
const warp = useId()
</script>

<template>
  <div class="wfg" aria-hidden="true">
    <svg class="wfg-defs" width="0" height="0">
      <filter :id="warp" x="-20%" y="-20%" width="140%" height="140%">
        <feTurbulence type="fractalNoise" baseFrequency="0.007" numOctaves="2" :seed />
        <feDisplacementMap in="SourceGraphic" scale="90" />
        <feGaussianBlur stdDeviation="7" />
      </filter>
    </svg>
    <div class="wfg-paint" :style="{ background, filter: `url(#${warp})` }" />
  </div>
</template>

<style scoped>
.wfg {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.wfg-defs {
  position: absolute;
}
.wfg-paint {
  position: absolute;
  inset: -18%;
}
</style>
