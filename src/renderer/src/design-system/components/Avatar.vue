<script setup lang="ts">
import { cva } from 'cva'
import type { VariantProps } from 'cva'
import type { HTMLAttributes } from 'vue'
import { cn } from '../cn'

/** Rounded-square tile for icons: the icon heads of empty states and
 *  choice cards. */
const avatarVariants = cva({
  base: 'relative inline-flex shrink-0 items-center justify-center rounded-control bg-secondary-background font-semibold text-base-foreground shadow-highlight ring-1 ring-border-default ring-inset select-none',
  variants: {
    size: {
      md: 'size-7 text-ui',
      xl: 'size-10 text-heading'
    }
  },
  defaultVariants: { size: 'md' }
})

const { size, class: className } = defineProps<{
  size?: VariantProps<typeof avatarVariants>['size']
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <span :class="cn(avatarVariants({ size }), className)"><slot /></span>
</template>
