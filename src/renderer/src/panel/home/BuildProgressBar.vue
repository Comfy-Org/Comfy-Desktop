<script setup lang="ts">
const { percent, label } = defineProps<{ percent: number; label: string }>()
</script>

<template>
  <span
    class="absolute bottom-0 left-0 h-[3px] rounded-r-full bg-foreground transition-[width] duration-500 ease-out motion-reduce:transition-none"
    :style="{ width: `${percent}%` }"
    role="progressbar"
    :aria-label="label"
    :aria-valuenow="percent"
    aria-valuemin="0"
    aria-valuemax="100"
  />
</template>
