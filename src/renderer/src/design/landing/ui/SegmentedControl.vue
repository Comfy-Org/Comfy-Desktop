<script setup lang="ts" generic="T extends string">
import { ToggleGroupItem, ToggleGroupRoot } from 'reka-ui'
import type { Component, HTMLAttributes } from 'vue'
import { cn } from './cn'

export interface SegmentOption<V extends string = string> {
  value: V
  label?: string
  icon?: Component
  count?: number
  /** Required when the option is icon-only. */
  ariaLabel?: string
}

/** Single-choice toggle group. `contained` draws a track behind the options
 *  (used for primary scopes like All / Local / Cloud); `plain` is for quiet
 *  section switches. */
const {
  options,
  variant = 'plain',
  size = 'md',
  class: className
} = defineProps<{
  options: SegmentOption<T>[]
  variant?: 'plain' | 'contained'
  size?: 'sm' | 'md'
  class?: HTMLAttributes['class']
}>()
const model = defineModel<T>({ required: true })

function onUpdate(v: unknown): void {
  // A segmented control always has a selection.
  if (typeof v === 'string' && v) model.value = v as T
}
</script>

<template>
  <ToggleGroupRoot
    type="single"
    :model-value="model"
    :class="
      cn(
        'inline-flex items-center gap-0.5',
        variant === 'contained' &&
          'rounded-control border border-border-default bg-secondary-background p-0.5',
        className
      )
    "
    @update:model-value="onUpdate"
  >
    <ToggleGroupItem
      v-for="o in options"
      :key="o.value"
      :value="o.value"
      :aria-label="o.ariaLabel ?? o.label"
      :class="
        cn(
          'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap text-muted-foreground transition-colors duration-150 outline-none',
          'hover:text-base-foreground focus-visible:ring-2 focus-visible:ring-border-focus',
          'data-[state=on]:bg-secondary-background-hover data-[state=on]:text-base-foreground',
          variant === 'contained' ? 'rounded-control' : 'rounded-control',
          size === 'sm' ? 'h-6 px-2 text-ui' : 'h-7 px-2.5 text-ui',
          !o.label && (size === 'sm' ? 'w-6 px-0' : 'w-7 px-0')
        )
      "
    >
      <component :is="o.icon" v-if="o.icon" :size="13" />
      <span v-if="o.label">{{ o.label }}</span>
      <span v-if="o.count !== undefined" class="text-ui text-subtle-foreground tabular-nums">{{
        o.count
      }}</span>
    </ToggleGroupItem>
  </ToggleGroupRoot>
</template>
