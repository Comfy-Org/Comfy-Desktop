<script setup lang="ts">
/** A number with a label, optionally a trend line. */
const { label, value, hint } = defineProps<{ label: string; value: string; hint?: string }>()
</script>

<template>
  <div class="flex min-w-0 flex-col gap-1 px-5 py-4">
    <span class="text-ui text-subtle-foreground">{{ label }}</span>
    <div class="flex items-end justify-between gap-3">
      <span class="text-[22px] leading-7 font-semibold tracking-[-0.01em] tabular-nums">{{
        value
      }}</span>
      <slot />
    </div>
    <span v-if="hint" class="truncate text-ui text-subtle-foreground">{{ hint }}</span>
  </div>
</template>
