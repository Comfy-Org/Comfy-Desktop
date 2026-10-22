<script setup lang="ts">
import { PopoverContent, PopoverPortal, type PopoverContentProps, useForwardProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { cn } from './cn'
import { floatingSurface } from './menu.styles'
import { PORTAL_TO } from './portal'

const {
  class: className,
  sideOffset = 6,
  ...rest
} = defineProps<PopoverContentProps & { class?: HTMLAttributes['class'] }>()
const forwarded = useForwardProps(rest)
</script>

<template>
  <PopoverPortal :to="PORTAL_TO" defer>
    <PopoverContent
      v-bind="forwarded"
      :side-offset="sideOffset"
      :class="cn(floatingSurface, className)"
    >
      <slot />
    </PopoverContent>
  </PopoverPortal>
</template>
