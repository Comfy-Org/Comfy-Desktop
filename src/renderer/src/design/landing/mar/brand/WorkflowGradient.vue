<script setup lang="ts">
import { computed } from 'vue'
import { look } from '../../look'
import { GRAIN } from './imagery'

/**
 * A workflow's cover as its own gradient (UI Playground › Workflow cover,
 * DS › Brand imagery): three soft clouds of colour, heavily blurred. The name
 * picks the hues and where the clouds sit, so every workflow has its own and
 * keeps it. Lightness and chroma are fixed in oklch, so a grid of different
 * colours still reads at one level of light and none stands out.
 */
const { name = '' } = defineProps<{ name?: string }>()

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

/** Lightness of the ground and the three clouds, and their chroma. */
const LIGHT = {
  dark: { ground: 0.3, clouds: [0.5, 0.44, 0.38], chroma: 0.085 },
  light: { ground: 0.93, clouds: [0.86, 0.88, 0.9], chroma: 0.065 }
}

const paint = computed(() => {
  const { ground, clouds, chroma } = LIGHT[look.theme === 'light' ? 'light' : 'dark']
  const hue = pick(0) * 360
  const turn = (pick(1) < 0.5 ? -1 : 1) * (50 + pick(2) * 50)
  const cloud = (i: number) => {
    const x = Math.round(10 + pick(3 + i * 2) * 80)
    const y = Math.round(10 + pick(4 + i * 2) * 80)
    const color = `oklch(${clouds[i]} ${chroma} ${Math.round(hue + turn * i)})`
    return `radial-gradient(60% 75% at ${x}% ${y}%, ${color}, transparent)`
  }
  return {
    background: `${[0, 1, 2].map(cloud).join(', ')}, oklch(${ground} ${chroma * 0.6} ${Math.round(hue + turn)})`
  }
})
</script>

<template>
  <div class="wfg" :style="{ '--wfg-grain': GRAIN }" aria-hidden="true">
    <span class="wfg-paint" :style="paint" />
  </div>
</template>

<style scoped>
.wfg {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.wfg-paint {
  position: absolute;
  inset: -20%;
  filter: blur(22px);
}
/* The shared grain keeps the blur from banding. */
.wfg::after {
  position: absolute;
  inset: 0;
  background-image: var(--wfg-grain);
  content: '';
  mix-blend-mode: overlay;
  opacity: 0.1;
}
</style>
