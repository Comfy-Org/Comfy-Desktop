<script setup lang="ts">
import type { Component, HTMLAttributes } from 'vue'
import Avatar from './Avatar.vue'
import { cn } from '../cn'

/** Centered message for empty or gated views, with its actions below. */
const {
  icon,
  title,
  description,
  class: className
} = defineProps<{
  icon?: Component
  title?: string
  description?: string
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <div
    :class="
      cn(
        'flex flex-col items-center gap-2 rounded-card border border-dashed border-border-strong px-6 py-12 text-center',
        className
      )
    "
  >
    <Avatar v-if="icon" size="xl" class="mb-1.5"><component :is="icon" :size="18" /></Avatar>
    <div class="flex flex-col items-center gap-1">
      <p v-if="title" class="text-heading font-semibold">{{ title }}</p>
      <p v-if="description" class="max-w-md text-ui leading-relaxed text-muted-foreground">
        {{ description }}
      </p>
    </div>
    <div v-if="$slots.default" class="mt-3 flex gap-2"><slot /></div>
  </div>
</template>
