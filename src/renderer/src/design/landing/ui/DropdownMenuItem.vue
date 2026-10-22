<script setup lang="ts">
import { DropdownMenuItem, type DropdownMenuItemProps, useForwardProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { cn } from './cn'
import { menuItem } from './menu.styles'

const { class: className, ...rest } = defineProps<
  DropdownMenuItemProps & { class?: HTMLAttributes['class'] }
>()
const emit = defineEmits<{ select: [e: Event] }>()
const forwarded = useForwardProps(rest)
</script>

<template>
  <DropdownMenuItem
    v-bind="forwarded"
    :class="cn(menuItem, className)"
    @select="emit('select', $event)"
  >
    <slot />
  </DropdownMenuItem>
</template>
