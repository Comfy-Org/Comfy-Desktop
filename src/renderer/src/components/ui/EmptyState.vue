<script setup lang="ts">
import type { Component } from 'vue'

const { icon, title, text } = defineProps<{
  icon: Component
  title: string
  text: string
}>()
</script>

<template>
  <div class="empty-state flex flex-col items-center gap-3 text-center">
    <span
      class="empty-state-badge grid size-8 place-items-center rounded-full bg-[color-mix(in_oklch,var(--color-foreground)_12%,var(--color-content-background))] text-foreground"
      aria-hidden="true"
    >
      <component :is="icon" :size="14" :stroke-width="2.25" />
    </span>
    <div class="flex flex-col gap-1">
      <h2 class="m-0 text-sm font-medium text-foreground">{{ title }}</h2>
      <p class="m-0 max-w-80 text-ui text-pretty text-muted-foreground">{{ text }}</p>
    </div>
    <slot />
  </div>
</template>
