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
import { cn } from '../cn'
import { fieldClass } from './field.variants'
import { floatingSurface, menuItem } from '../menu.styles'
import { PORTAL_TO } from '../portal'

interface SelectOption<V extends string> {
  value: V
  label: string
  /** A second line under the label, in the list only. */
  description?: string
}

/** Option-list select. `label` renders a muted prefix inside the trigger
 *  ("Sort  Last edited") so filter bars need no separate labels; a select
 *  under its own field label takes `ariaLabel` instead. Without either, the
 *  selected option names the trigger. */
const {
  options,
  label,
  ariaLabel,
  placeholder,
  disabled = false,
  class: className
} = defineProps<{
  options: SelectOption<T>[]
  label?: string
  ariaLabel?: string
  /** Shown while nothing is selected (or while the options load). */
  placeholder?: string
  disabled?: boolean
  class?: HTMLAttributes['class']
}>()
const model = defineModel<T>({ required: true })
</script>

<template>
  <SelectRoot v-model="model" :disabled>
    <SelectTrigger
      :aria-label="ariaLabel ?? label"
      :class="
        cn(
          fieldClass,
          'cursor-pointer gap-1.5 pr-2 outline-none data-disabled:pointer-events-none data-disabled:opacity-40 focus-visible:border-border-focus focus-visible:ring-2 focus-visible:ring-border-focus/30 data-[state=open]:border-border-strong',
          className
        )
      "
    >
      <span v-if="label" class="text-subtle-foreground">{{ label }}</span>
      <SelectValue class="truncate data-placeholder:text-subtle-foreground" :placeholder />
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
            'flex max-h-[min(--spacing(80),var(--reka-select-content-available-height))] min-w-(--reka-select-trigger-width) flex-col'
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
            <span class="flex min-w-0 flex-col">
              <SelectItemText>{{ o.label }}</SelectItemText>
              <span v-if="o.description" class="text-subtle-foreground">{{ o.description }}</span>
            </span>
            <SelectItemIndicator class="ml-auto text-muted-foreground"
              ><Check :size="13"
            /></SelectItemIndicator>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>
