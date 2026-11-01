<script setup lang="ts">
import { computed, useId, type Component } from 'vue'
import { Box, Layers, Maximize2, Spline, Atom, TextCursorInput, Waypoints } from 'lucide-vue-next'
import type { Model, ModelType } from './models'
import { providerLogo } from './providerLogos'

/** Models have no pictures: like comfy.org, the provider's mark on a neutral
 *  tile stands in for the frontend's preview_url; community files without a
 *  provider keep the type's glyph. In Select mode the check takes the tile's
 *  place, so the slot never holds two things. */
const {
  model,
  size = 36,
  checked = undefined
} = defineProps<{ model: Model; size?: number; checked?: boolean }>()
const ICON: Record<ModelType, Component> = {
  checkpoint: Box,
  diffusion: Atom,
  lora: Layers,
  vae: Waypoints,
  'text-encoder': TextCursorInput,
  upscaler: Maximize2,
  controlnet: Spline
}
const logo = computed(() => providerLogo(model.author))
const cuts = computed(() => logo.value?.paths.filter((p) => p.cut) ?? [])
const maskId = `mm-tile-${useId()}`
</script>

<template>
  <span
    class="mm-tile"
    :class="{ 'is-check': checked !== undefined, 'is-on': checked }"
    :style="{ width: `${size}px`, height: `${size}px` }"
    aria-hidden="true"
  >
    <span v-if="checked !== undefined" class="mm-tile-box" />
    <svg
      v-else-if="logo"
      :viewBox="logo.viewBox"
      :width="Math.round(size * 0.5)"
      :height="Math.round(size * 0.5)"
      class="mm-tile-logo"
    >
      <mask v-if="cuts.length" :id="maskId">
        <rect width="100%" height="100%" fill="white" />
        <path v-for="(p, i) in cuts" :key="i" :d="p.d" fill="black" />
      </mask>
      <g fill="currentColor" :mask="cuts.length ? `url(#${maskId})` : undefined">
        <path
          v-for="(p, i) in logo.paths.filter((x) => !x.cut)"
          :key="i"
          :d="p.d"
          :fill-rule="p.evenodd ? 'evenodd' : undefined"
        />
      </g>
    </svg>
    <component
      :is="ICON[model.type]"
      v-else
      :size="Math.round(size * 0.42)"
      :stroke-width="1.6"
      class="mm-tile-glyph"
    />
  </span>
</template>

<style scoped>
.mm-tile {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 28%;
  background: color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
  color: var(--color-base-foreground);
}
.mm-tile-glyph {
  color: var(--color-muted-foreground);
}
.mm-tile-logo {
  display: block;
}
/* Select mode: the tile turns into the checkbox's well. */
.mm-tile.is-check {
  background: transparent;
  box-shadow: none;
}
.mm-tile-box {
  width: 18px;
  height: 18px;
  border: 1.5px solid color-mix(in oklch, var(--color-base-foreground) 45%, transparent);
  border-radius: 5px;
  transition:
    background-color 120ms ease,
    border-color 120ms ease;
}
.mm-tile.is-on .mm-tile-box {
  border-color: var(--color-base-foreground);
  background: var(--color-base-foreground)
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M4 8.5l2.5 2.5L12 5.5' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")
    center / 13px no-repeat;
}
:root[data-ds-theme='light'] .mm-tile.is-on .mm-tile-box {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M4 8.5l2.5 2.5L12 5.5' fill='none' stroke='%23fff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
}
</style>
