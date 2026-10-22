<script setup lang="ts">
import { ChevronRight } from 'lucide-vue-next'
import { DropdownMenuSubTrigger } from 'reka-ui'
import { cn } from './cn'
import { menuItem } from './menu.styles'
</script>

<template>
  <DropdownMenuSubTrigger :class="cn(menuItem, 'data-[state=open]:bg-secondary-background')">
    <slot />
    <ChevronRight :size="13" class="ml-auto" />
  </DropdownMenuSubTrigger>
</template>
