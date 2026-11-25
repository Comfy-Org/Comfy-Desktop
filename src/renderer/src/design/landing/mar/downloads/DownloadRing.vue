<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{ progress: number; size?: number; stroke?: number }>(), {
  size: 18,
  stroke: 2
})

const r = computed(() => (props.size - props.stroke) / 2)
const length = computed(() => 2 * Math.PI * r.value)
const offset = computed(() => length.value * (1 - Math.min(1, Math.max(0, props.progress))))
</script>

<template>
  <span
    class="relative inline-flex shrink-0 items-center justify-center"
    :style="{ width: `${size}px`, height: `${size}px` }"
    role="progressbar"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="Math.floor(progress * 100)"
  >
    <svg
      :width="size"
      :height="size"
      :viewBox="`0 0 ${size} ${size}`"
      class="absolute inset-0 -rotate-90"
      aria-hidden="true"
    >
      <circle
        :cx="size / 2"
        :cy="size / 2"
        :r="r"
        fill="none"
        stroke="currentColor"
        :stroke-width="stroke"
        class="opacity-20"
      />
      <circle
        :cx="size / 2"
        :cy="size / 2"
        :r="r"
        fill="none"
        stroke="currentColor"
        :stroke-width="stroke"
        stroke-linecap="round"
        :stroke-dasharray="length"
        :stroke-dashoffset="offset"
        class="transition-[stroke-dashoffset] duration-200 ease-linear motion-reduce:transition-none"
      />
    </svg>
    <slot />
  </span>
</template>
