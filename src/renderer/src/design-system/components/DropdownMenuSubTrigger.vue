<script setup lang="ts">
import { ChevronRight } from 'lucide-vue-next'
import { DropdownMenuSubTrigger } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { cn } from '../cn'
import { menuItem } from '../menu.styles'

/** `chevron: false` when the item draws its own affordance (e.g. a swap icon). */
const { chevron = true, class: className } = defineProps<{
  chevron?: boolean
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <DropdownMenuSubTrigger
    :class="cn(menuItem, 'data-[state=open]:bg-secondary-background', className)"
  >
    <slot />
    <ChevronRight v-if="chevron" :size="13" class="ml-auto" />
  </DropdownMenuSubTrigger>
</template>
