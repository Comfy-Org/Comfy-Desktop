<script setup lang="ts">
import { DropdownMenuContent, DropdownMenuPortal, useForwardProps } from 'reka-ui'
import type { DropdownMenuContentProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { cn } from '../cn'
import { floatingSurface } from '../menu.styles'
import { PORTAL_TO } from '../portal'

const {
  class: className,
  sideOffset = 6,
  ...rest
} = defineProps<DropdownMenuContentProps & { class?: HTMLAttributes['class'] }>()
const forwarded = useForwardProps(rest)
</script>

<template>
  <DropdownMenuPortal :to="PORTAL_TO" defer>
    <DropdownMenuContent
      v-bind="forwarded"
      :side-offset="sideOffset"
      :class="cn(floatingSurface, 'min-w-56', className)"
    >
      <slot />
    </DropdownMenuContent>
  </DropdownMenuPortal>
</template>
