<script setup lang="ts" generic="T extends string">
import { Check, ChevronDown } from 'lucide-vue-next'
import {
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectViewport
} from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { cn } from './cn'
import { fieldVariants, type FieldVariants } from './field.variants'
import { floatingSurface, menuItem } from './menu.styles'
import { PORTAL_TO } from './portal'

export interface SelectOption<V extends string = string> {
  value: V
  label: string
  /** Secondary value shown right-aligned in the list (e.g. a token's value). */
  hint?: string
  /** CSS color for a small swatch before the label. */
  swatch?: string
}

/** Option-list select. `label` renders a muted prefix inside the trigger
 *  ("Sort  Newest first") so filter bars need no separate labels. */
const {
  options,
  label,
  size,
  variant = 'field',
  class: className
} = defineProps<{
  options: SelectOption<T>[]
  label?: string
  size?: FieldVariants['size']
  /** `ghost`: borderless, for inline values in lists and settings rows. */
  variant?: 'field' | 'ghost'
  class?: HTMLAttributes['class']
}>()
const model = defineModel<T>({ required: true })
</script>

<template>
  <SelectRoot v-model="model">
    <SelectTrigger
      :aria-label="label"
      :class="
        cn(
          fieldVariants({ size }),
          'cursor-pointer gap-1.5 pr-2 outline-none focus-visible:border-border-focus focus-visible:ring-2 focus-visible:ring-border-focus/30 data-[state=open]:border-border-strong',
          variant === 'ghost' &&
            'w-auto border-transparent bg-transparent text-muted-foreground hover:border-transparent hover:bg-secondary-background hover:text-base-foreground focus-within:ring-0 data-[state=open]:border-transparent data-[state=open]:bg-secondary-background',
          className
        )
      "
    >
      <span v-if="label" class="text-subtle-foreground">{{ label }}</span>
      <SelectValue class="truncate" />
      <ChevronDown :size="13" class="ml-auto shrink-0 text-subtle-foreground" />
    </SelectTrigger>
    <SelectPortal :to="PORTAL_TO" defer>
      <SelectContent
        position="popper"
        :side-offset="6"
        align="start"
        :class="
          cn(
            floatingSurface,
            'flex max-h-[min(320px,var(--reka-select-content-available-height))] min-w-(--reka-select-trigger-width) flex-col'
          )
        "
      >
        <SelectViewport>
          <SelectItem
            v-for="o in options"
            :key="o.value"
            :value="o.value"
            :class="cn(menuItem, 'pr-2')"
          >
            <span
              v-if="o.swatch"
              class="size-4 shrink-0 rounded-min border border-border-strong"
              :style="{ background: o.swatch }"
            />
            <SelectItemText>{{ o.label }}</SelectItemText>
            <span
              v-if="o.hint"
              class="ml-auto max-w-40 truncate pl-4 font-mono text-ui text-subtle-foreground"
              >{{ o.hint }}</span
            >
            <span :class="cn('flex w-4 shrink-0 justify-end', !o.hint && 'ml-auto')">
              <SelectItemIndicator class="text-muted-foreground"
                ><Check :size="13"
              /></SelectItemIndicator>
            </span>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>
