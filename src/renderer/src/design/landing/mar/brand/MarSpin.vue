<script setup lang="ts">
import type { Component } from 'vue'
import { brandMotif } from './brandMotif'
import MarTrio from './MarTrio.vue'

/** A loader: the place's own spinning icon, or the trio filling in turn
 *  while the brand motif is on (brandMotif.ts). `spin` is the class that
 *  turns the icon; the trio never takes it. */
const { icon, size, spin } = defineProps<{ icon: Component; size: number; spin?: string }>()
</script>

<template>
  <MarTrio v-if="brandMotif.id === 'trio'" load :u="Math.round(size * 0.45 * 10) / 10" />
  <component :is="icon" v-else :size :class="spin" />
</template>
