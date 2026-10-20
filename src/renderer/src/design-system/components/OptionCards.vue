<script setup lang="ts" generic="T extends string">
import { Check } from 'lucide-vue-next'
import { RadioGroupIndicator, RadioGroupItem, RadioGroupRoot } from 'reka-ui'
import type { Component, HTMLAttributes } from 'vue'
import Badge from './Badge.vue'
import { cn } from '../cn'

export interface OptionCard<V extends string = string> {
  value: V
  label: string
  description?: string
  /** Image shown at the start (e.g. a hardware vendor's logo). */
  image?: string
  /** Short tags beside the label, e.g. "Recommended". */
  tags?: { label: string; icon?: Component }[]
}

/** A single choice between a few rich options, as a column of cards (a
 *  radio group). Use `SegmentedControl` for short labels, `Select` for many. */
const {
  options,
  label,
  class: className
} = defineProps<{
  options: OptionCard<T>[]
  /** The group's accessible name. */
  label: string
  class?: HTMLAttributes['class']
}>()
const model = defineModel<T | null>({ default: null })
</script>

<template>
  <RadioGroupRoot v-model="model" :aria-label="label" :class="cn('flex flex-col gap-2', className)">
    <RadioGroupItem
      v-for="o in options"
      :key="o.value"
      :value="o.value"
      data-testid="option-card"
      class="flex w-full items-center gap-3 rounded-control border border-border-default bg-secondary-background px-3 py-2.5 text-left outline-none transition-colors duration-150 hover:bg-secondary-background-hover focus-visible:ring-2 focus-visible:ring-border-focus data-[state=checked]:border-border-focus data-[state=checked]:bg-secondary-background-hover"
    >
      <img
        v-if="o.image"
        :src="o.image"
        alt=""
        draggable="false"
        class="size-9 shrink-0 rounded-min object-contain"
      />
      <span class="flex min-w-0 flex-1 flex-col">
        <span class="flex min-w-0 items-center gap-2 text-ui font-medium text-base-foreground">
          <span class="truncate" data-testid="option-card-label">{{ o.label }}</span>
          <Badge v-for="tag in o.tags" :key="tag.label" class="shrink-0">
            <component :is="tag.icon" v-if="tag.icon" :size="11" />{{ tag.label }}
          </Badge>
        </span>
        <span v-if="o.description" class="truncate text-ui text-subtle-foreground">{{
          o.description
        }}</span>
      </span>
      <RadioGroupIndicator class="shrink-0 text-base-foreground"
        ><Check :size="15"
      /></RadioGroupIndicator>
    </RadioGroupItem>
  </RadioGroupRoot>
</template>
