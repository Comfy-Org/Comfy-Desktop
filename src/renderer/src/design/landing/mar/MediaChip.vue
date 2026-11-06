<script setup lang="ts">
import type { Component } from 'vue'

/** Chip on imagery (DS · Mar): fully rounded, dark grey at 60% over a
 *  background blur (--color-media-overlay in Mar's UI), 11px Medium in
 *  sentence case, no border. */
defineProps<{ icon?: Component }>()
</script>

<template>
  <span
    class="inline-flex h-5 items-center gap-1 rounded-full bg-media-overlay px-2 text-[11px] leading-none font-medium text-white/92 backdrop-blur-md"
  >
    <component :is="icon" v-if="icon" :size="10" aria-hidden="true" />
    <slot />
  </span>
</template>
