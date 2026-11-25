<script setup lang="ts">
const { percent, label } = defineProps<{ percent: number | null; label: string }>()
</script>

<template>
  <span
    class="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-foreground/12"
    role="progressbar"
    :aria-label="label"
    :aria-valuenow="percent ?? undefined"
    aria-valuemin="0"
    aria-valuemax="100"
    :data-indeterminate="percent === null ? 'true' : undefined"
  >
    <span
      v-if="percent === null"
      class="absolute inset-y-0 left-0 w-1/5 bg-foreground animate-start-bar-slide motion-reduce:animate-none"
      data-testid="home-build-start-bar-segment"
    />
    <span
      v-else
      class="absolute inset-y-0 left-0 bg-foreground transition-[width] duration-500 ease-out motion-reduce:transition-none"
      :style="{ width: `${percent}%` }"
      data-testid="home-build-start-bar-fill"
    />
  </span>
</template>
