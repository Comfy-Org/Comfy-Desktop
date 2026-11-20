<script setup lang="ts">
import type { Component } from 'vue'
import { SUMMARY_GRID_CLASS } from '../lib/setupSummary'

defineProps<{ label: string; icon: Component }>()
</script>

<template>
  <div class="h-4 text-[13px]/4" :class="SUMMARY_GRID_CLASS">
    <span class="flex items-center gap-2.5 text-text-muted">
      <component :is="icon" class="flex-none" :size="15" aria-hidden="true" />{{ label }}
    </span>
    <slot />
  </div>
</template>
