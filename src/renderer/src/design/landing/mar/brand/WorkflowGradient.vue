<script setup lang="ts">
import { computed } from 'vue'
import { look } from '../../look'
import { WIRE } from './imagery'

/**
 * A workflow's cover as its own gradient (UI Playground › Workflow cover,
 * DS › Brand imagery): one link colour, as every picture we make, in a soft
 * monochrome wash with the trio (brandMotif.ts) barely there across it, so
 * it reads as Comfy before you notice why. The name picks the colour, where
 * the light sits and where the slabs fall, so it always gets the same one.
 */
const { name = '' } = defineProps<{ name?: string }>()

/** The calm link colours: red and yellow would shout from a grid of covers. */
const HUES = [WIRE.model, WIRE.image, WIRE.mask, WIRE.conditioning, WIRE.latent]

const hash = computed(() => {
  let h = 2166136261
  for (const c of name) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return h >>> 0
})
/** A repeatable number from 0 to 1, one per use of the name. */
const pick = (n: number): number => {
  let h = Math.imul(hash.value + n * 2654435761, 2246822519)
  h = Math.imul(h ^ (h >>> 15), 3266489917)
  return ((h ^ (h >>> 13)) >>> 0) / 2 ** 32
}

const paint = computed(() => {
  const hue = HUES[Math.floor(pick(0) * HUES.length)]!
  const dark = look.theme !== 'light'
  const ground = dark ? '#0f0f12' : '#f6f6f8'
  const x = Math.round(15 + pick(1) * 70)
  const y = Math.round(pick(2) * 45)
  return {
    '--wfg-base': `color-mix(in oklch, ${hue} ${dark ? 10 : 14}%, ${ground})`,
    '--wfg-glow': `color-mix(in oklch, ${hue} ${dark ? 34 : 40}%, ${ground})`,
    '--wfg-slab': dark ? 'rgb(255 255 255 / 0.05)' : 'rgb(255 255 255 / 0.3)',
    '--wfg-x': `${x}%`,
    '--wfg-y': `${y}%`,
    '--wfg-trio': `${Math.round(-6 + pick(3) * 56)}%`
  }
})
</script>

<template>
  <div class="wfg" :style="paint" aria-hidden="true">
    <span class="wfg-trio"><i /><i /><i /></span>
  </div>
</template>

<style scoped>
.wfg {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background:
    radial-gradient(90% 110% at var(--wfg-x) var(--wfg-y), var(--wfg-glow), transparent 72%),
    var(--wfg-base);
}
/* The C mark's three slabs at 16°, far larger than the card and fading out
   as they fall: seen as light, not as a shape. */
.wfg-trio {
  position: absolute;
  top: -20%;
  bottom: -20%;
  left: var(--wfg-trio);
  display: flex;
  width: 62%;
  gap: 6%;
  mask-image: linear-gradient(to bottom, #000, transparent 88%);
  transform: skewX(-16deg);
}
.wfg-trio > i {
  flex: 1;
  border-radius: 14px;
  background: var(--wfg-slab);
}
.wfg-trio > i:nth-child(2) {
  opacity: 0.7;
}
.wfg-trio > i:nth-child(3) {
  opacity: 0.4;
}
</style>
