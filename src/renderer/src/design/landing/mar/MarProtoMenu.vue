<script setup lang="ts">
import { SlidersHorizontal } from 'lucide-vue-next'
import { tuner } from './uiTuner'
</script>

<template>
  <span class="relative flex">
    <button
      type="button"
      aria-label="Prototype"
      title="Prototype (⌘.)"
      :aria-expanded="tuner.open"
      :class="['hover:text-base-foreground', tuner.open && 'text-base-foreground']"
      @click="tuner.open = !tuner.open"
    >
      <SlidersHorizontal :size="15" />
    </button>
  </span>
</template>
