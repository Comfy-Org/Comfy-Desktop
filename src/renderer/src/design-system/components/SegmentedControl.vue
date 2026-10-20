<script setup lang="ts" generic="T extends string">
import { ToggleGroupItem, ToggleGroupRoot } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { cn } from '../cn'

interface SegmentOption<V extends string> {
  value: V
  label: string
  count?: number
  /** A test hook for this option (`data-testid`). */
  testId?: string
}

/** Single-choice toggle group. `contained` draws a track behind the options
 *  (primary scopes like All / This computer / Cloud); `plain` is for quiet
 *  filter rows. */
const {
  options,
  variant = 'plain',
  disabled = false,
  class: className
} = defineProps<{
  options: SegmentOption<T>[]
  variant?: 'plain' | 'contained'
  disabled?: boolean
  class?: HTMLAttributes['class']
}>()
const model = defineModel<T>({ required: true })

function onUpdate(value: unknown): void {
  // A segmented control always has a selection.
  if (typeof value === 'string' && value) model.value = value as T
}
</script>

<template>
  <ToggleGroupRoot
    type="single"
    :model-value="model"
    :disabled
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
      :data-testid="o.testId"
      class="inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-control px-2.5 text-ui whitespace-nowrap text-muted-foreground outline-none transition-colors duration-150 hover:text-base-foreground focus-visible:ring-2 focus-visible:ring-border-focus data-disabled:pointer-events-none data-disabled:opacity-40 data-[state=on]:bg-secondary-background-hover data-[state=on]:text-base-foreground"
    >
      {{ o.label }}
      <span v-if="o.count !== undefined" class="text-subtle-foreground tabular-nums">{{
        o.count
      }}</span>
    </ToggleGroupItem>
  </ToggleGroupRoot>
</template>
