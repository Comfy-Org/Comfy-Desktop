<script setup lang="ts">
import { Check } from 'lucide-vue-next'
import { DropdownMenuCheckboxItem, DropdownMenuItemIndicator } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { cn } from './cn'
import { menuItem } from './menu.styles'

const { class: className } = defineProps<{ class?: HTMLAttributes['class'] }>()
const model = defineModel<boolean>({ default: false })
</script>

<template>
  <DropdownMenuCheckboxItem
    v-model="model"
    :class="cn(menuItem, 'pl-8', className)"
    @select="(e: Event) => e.preventDefault()"
  >
    <span class="absolute left-2.5 inline-flex size-3.5 items-center justify-center">
      <DropdownMenuItemIndicator
        ><Check :size="13" class="text-base-foreground"
      /></DropdownMenuItemIndicator>
    </span>
    <slot />
  </DropdownMenuCheckboxItem>
</template>
