<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{ label: string; icon: Component }>()
</script>

<template>
  <div class="grid h-4 grid-cols-[148px_minmax(0,1fr)_auto] items-center text-[13px]/4">
    <span class="flex items-center gap-2.5 text-text-muted">
      <component :is="icon" class="flex-none" :size="15" aria-hidden="true" />{{ label }}
    </span>
    <slot />
  </div>
</template>
