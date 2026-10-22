<script setup lang="ts">
import type { Component, HTMLAttributes } from 'vue'
import Avatar from './Avatar.vue'
import { cn } from './cn'

/** Centered message for empty or gated views. `inline` lays it out as a
 *  single row (text left, action right) for use inside sections. */
const {
  icon,
  title,
  description,
  layout = 'stack',
  class: className
} = defineProps<{
  icon?: Component
  title?: string
  description?: string
  layout?: 'stack' | 'inline'
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <div
    :class="
      cn(
        'rounded-card border border-dashed border-border-strong',
        layout === 'stack'
          ? 'flex flex-col items-center gap-2 px-6 py-12 text-center'
          : 'flex items-center justify-between gap-4 py-3.5 pr-3.5 pl-4.5',
        className
      )
    "
  >
    <Avatar v-if="icon && layout === 'stack'" size="xl" class="mb-1.5"
      ><component :is="icon" :size="18"
    /></Avatar>
    <div :class="layout === 'stack' ? 'flex flex-col items-center gap-1' : 'min-w-0'">
      <p v-if="title" class="text-heading font-semibold">{{ title }}</p>
      <p v-if="description" class="max-w-md text-ui leading-relaxed text-muted-foreground">
        {{ description }}
      </p>
    </div>
    <div
      v-if="$slots.default"
      :class="layout === 'stack' ? 'mt-3 flex gap-2' : 'flex shrink-0 gap-2'"
    >
      <slot />
    </div>
  </div>
</template>
