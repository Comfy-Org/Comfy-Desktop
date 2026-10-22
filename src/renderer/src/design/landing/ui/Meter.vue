<script setup lang="ts">
import { computed } from 'vue'
import { cn } from './cn'

/** Thin usage bar. Turns `status-danger` once value passes max. */
const {
  value,
  max,
  class: className
} = defineProps<{ value: number; max: number; class?: string }>()
const over = computed(() => value > max)
const pct = computed(() => Math.min(100, Math.round((value / Math.max(1, max)) * 100)))
</script>

<template>
  <div
    role="meter"
    :aria-valuenow="value"
    :aria-valuemin="0"
    :aria-valuemax="max"
    :class="cn('h-1 w-full overflow-hidden rounded-full bg-secondary-background-hover', className)"
  >
    <div
      :class="cn('h-full rounded-full', over ? 'bg-status-danger' : 'bg-base-foreground/85')"
      :style="{ width: `${pct}%` }"
    />
  </div>
</template>
