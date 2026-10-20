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
}

/** Option-list select. `label` renders a muted prefix inside the trigger
 *  ("Sort  Last edited") so filter bars need no separate labels; without it,
 *  the selected option names the trigger. */
const {
  options,
  label,
  class: className
} = defineProps<{
  options: SelectOption<T>[]
  label?: string
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
          fieldClass,
          'cursor-pointer gap-1.5 pr-2 outline-none focus-visible:border-border-focus focus-visible:ring-2 focus-visible:ring-border-focus/30 data-[state=open]:border-border-strong',
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
            <SelectItemText>{{ o.label }}</SelectItemText>
            <SelectItemIndicator class="ml-auto text-muted-foreground"
              ><Check :size="13"
            /></SelectItemIndicator>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>
