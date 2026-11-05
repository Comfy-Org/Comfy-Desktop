<script setup lang="ts">
import type { Component } from 'vue'

/**
 * The brand motif (brandMotif.ts): three slabs at the C mark's 16°, in
 * card tones. `slot` (empty states): two filled slabs and an outlined
 * third that holds the place's icon; it opens a touch when its host
 * (.mar-trio-host) is hovered. `load`: the slabs fill in turn, in place
 * of a spinner. `u` is the slab width in px; the trio is 3.6u by 1.5u.
 */
const {
  u = 32,
  icon,
  iconSize = 14,
  load = false
} = defineProps<{
  u?: number
  icon?: Component
  iconSize?: number
  load?: boolean
}>()
</script>

<template>
  <span
    class="mar-trio"
    :class="load ? 'is-load' : 'is-slot'"
    :style="{ '--u': `${u}px` }"
    :role="load ? 'progressbar' : undefined"
    :aria-label="load ? 'Loading' : undefined"
    :aria-hidden="load ? undefined : 'true'"
  >
    <i /><i /><i
      ><component :is="icon" v-if="icon && !load" :size="iconSize" :stroke-width="1.6"
    /></i>
  </span>
</template>

<style>
.mar-trio {
  --mt-1: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
  --mt-2: color-mix(in oklch, var(--color-base-foreground) 11%, transparent);
  --mt-edge: color-mix(in oklch, var(--color-base-foreground) 26%, transparent);
  --mt-sh: rgb(0 0 0 / 0.35);
  --mt-slot: rgb(255 255 255 / 0.05);
  position: relative;
  display: inline-block;
  width: calc(var(--u) * 3.6);
  height: calc(var(--u) * 1.5);
  flex: none;
  vertical-align: middle;
}
:root[data-ds-theme='light'] .mar-trio {
  --mt-sh: rgb(0 0 0 / 0.08);
  --mt-slot: rgb(255 255 255 / 0.6);
}
.mar-trio > i {
  position: absolute;
  width: var(--u);
  height: calc(var(--u) * 1.1);
  border-radius: calc(var(--u) * 0.24);
  background: var(--c);
  transform: skewX(-16deg);
  transition:
    transform 320ms cubic-bezier(0.16, 1, 0.3, 1),
    box-shadow 200ms ease,
    background-color 200ms ease;
}
.mar-trio > i:nth-child(1) {
  --c: var(--mt-1);
  top: calc(var(--u) * 0.4);
  left: calc(var(--u) * 0.2);
}
.mar-trio > i:nth-child(2) {
  --c: var(--mt-2);
  top: calc(var(--u) * 0.2);
  left: calc(var(--u) * 1.32);
}
.mar-trio > i:nth-child(3) {
  top: 0;
  left: calc(var(--u) * 2.44);
  display: grid;
  place-items: center;
}
.mar-trio > i > svg {
  color: var(--color-muted-foreground);
  transform: skewX(16deg);
  transition: color 200ms ease;
}

/* Slot, Live finish: the filled two sit on a soft shadow, the third is
   an open slot. */
.mar-trio.is-slot > i:nth-child(-n + 2) {
  background: linear-gradient(180deg, color-mix(in oklab, var(--c), white 5%), var(--c));
  box-shadow: 0 1px 2px var(--mt-sh);
}
.mar-trio.is-slot > i:nth-child(3) {
  background: linear-gradient(180deg, var(--mt-slot), transparent 70%);
  box-shadow: inset 0 0 0 1.25px var(--mt-edge);
}
@media (hover: hover) and (pointer: fine) {
  .mar-trio-host:hover .mar-trio.is-slot > i:nth-child(1) {
    transform: skewX(-16deg) translate(3px, -1px);
  }
  .mar-trio-host:hover .mar-trio.is-slot > i:nth-child(2) {
    transform: skewX(-16deg) translate(2px, -1px);
  }
  .mar-trio-host:hover .mar-trio.is-slot > i:nth-child(3) {
    background:
      linear-gradient(180deg, var(--mt-slot), transparent 70%),
      color-mix(in oklab, var(--color-base-foreground) 5%, transparent);
    box-shadow: inset 0 0 0 1.25px var(--color-base-foreground);
  }
  .mar-trio-host:hover .mar-trio.is-slot > i > svg {
    color: var(--color-base-foreground);
  }
}

/* Load: the slabs fill in turn. */
@keyframes mar-trio-fill {
  0%,
  100% {
    background-color: var(--mt-2);
  }
  40% {
    background-color: var(--color-muted-foreground);
  }
}
.mar-trio.is-load > i {
  --c: var(--mt-2);
  animation: mar-trio-fill 1.5s cubic-bezier(0.645, 0.045, 0.355, 1) infinite;
}
.mar-trio.is-load > i:nth-child(2) {
  animation-delay: 0.18s;
}
.mar-trio.is-load > i:nth-child(3) {
  animation-delay: 0.36s;
}
@media (prefers-reduced-motion: reduce) {
  .mar-trio > i {
    transition: none;
  }
  .mar-trio.is-load > i {
    animation-duration: 3s;
  }
}
</style>
