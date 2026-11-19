<script setup lang="ts">
import { GRAIN, LATENT_GRADE, type Grade } from './imagery'

/**
 * A picture through a Comfy grade (brand/imagery.ts): grey first, then its
 * shadows mapped to the grade's shadow and its light to the grade's light,
 * with the shared film grain on top. Any subject comes out in the same
 * look. `blur` softens it into colour for backgrounds. A parent can swap
 * one end for the page (--grade-shadow-on / --grade-light-on), so the
 * picture sits in the page instead of on it.
 */
const {
  src,
  grade = LATENT_GRADE,
  blur = 0,
  grain = 0.1
} = defineProps<{ src: string; grade?: Grade; blur?: number; grain?: number }>()
</script>

<template>
  <div
    class="mar-graded"
    :style="{
      '--grade-shadow': grade.shadow,
      '--grade-light': grade.light,
      '--grade-blur': `${blur}px`,
      '--grade-grain': grain,
      '--grade-grain-img': GRAIN
    }"
    aria-hidden="true"
  >
    <img :src="src" alt="" :class="{ 'is-blurred': blur > 0 }" />
    <span class="mar-graded-shadow" />
    <span class="mar-graded-grain" />
  </div>
</template>

<style scoped>
.mar-graded {
  position: relative;
  overflow: hidden;
  isolation: isolate;
  background: var(--grade-light-on, var(--grade-light));
}
/* Multiply over the light colour: white stays the light, black goes black. */
.mar-graded img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: grayscale(1) contrast(1.12);
  mix-blend-mode: multiply;
}
.mar-graded img.is-blurred {
  filter: grayscale(1) contrast(1.12) blur(var(--grade-blur));
  transform: scale(1.25);
}
/* Lighten with the shadow colour: black lifts to it, the light stays. */
.mar-graded-shadow,
.mar-graded-grain {
  position: absolute;
  inset: 0;
}
.mar-graded-shadow {
  background: var(--grade-shadow-on, var(--grade-shadow));
  mix-blend-mode: lighten;
}
.mar-graded-grain {
  background-image: var(--grade-grain-img);
  mix-blend-mode: overlay;
  opacity: var(--grade-grain);
}
</style>
