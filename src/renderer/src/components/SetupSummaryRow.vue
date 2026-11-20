<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{ label: string; icon: Component; noteFills?: boolean }>()
</script>

<template>
  <div
    class="grid h-4 items-center text-[13px]/4"
    :class="
      noteFills
        ? 'grid-cols-[148px_fit-content(50%)_minmax(0,1fr)]'
        : 'grid-cols-[148px_minmax(0,1fr)_auto]'
    "
  >
    <span class="flex items-center gap-2.5 text-text-muted">
      <component :is="icon" class="flex-none" :size="15" aria-hidden="true" />{{ label }}
    </span>
    <slot />
  </div>
</template>
