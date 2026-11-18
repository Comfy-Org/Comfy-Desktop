<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{ label: string; icon: Component }>()
</script>

<template>
  <div
    class="config-summary-row grid min-h-12 grid-cols-[132px_minmax(0,1fr)] items-center gap-4 rounded-[10px] px-4 py-2"
  >
    <dt class="flex items-center gap-2.5 text-[13px] text-text-muted">
      <component :is="icon" :size="15" aria-hidden="true" />{{ label }}
    </dt>
    <dd class="m-0 flex min-w-0 items-center gap-4">
      <slot />
    </dd>
  </div>
</template>
