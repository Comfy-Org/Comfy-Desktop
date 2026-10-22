<script setup lang="ts">
import { computed } from 'vue'

/** Tiny monochrome trend line (no axes). */
const {
  values,
  width = 88,
  height = 24
} = defineProps<{ values: number[]; width?: number; height?: number }>()
const path = computed(() => {
  const max = Math.max(1, ...values)
  const step = width / Math.max(1, values.length - 1)
  return values
    .map(
      (v, i) =>
        `${i ? 'L' : 'M'}${(i * step).toFixed(1)} ${(height - 2 - (v / max) * (height - 4)).toFixed(1)}`
    )
    .join(' ')
})
</script>

<template>
  <svg
    :width
    :height
    :viewBox="`0 0 ${width} ${height}`"
    class="shrink-0 overflow-visible text-muted-foreground"
    aria-hidden="true"
  >
    <path
      :d="path"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linejoin="round"
      stroke-linecap="round"
    />
  </svg>
</template>
