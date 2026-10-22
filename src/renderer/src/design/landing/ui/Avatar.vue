<script setup lang="ts">
import { cva, type VariantProps } from 'cva'
import type { HTMLAttributes } from 'vue'
import { cn } from './cn'

/** Rounded-square tile for monograms and icons: instance glyphs, workspace
 *  avatars, the icon heads of empty states and choice cards. */
const avatarVariants = cva({
  base: 'relative inline-flex shrink-0 items-center justify-center rounded-[28%] font-semibold select-none',
  variants: {
    size: {
      xs: 'size-4 text-[8px]',
      sm: 'size-5 text-[9px]',
      md: 'size-7 text-ui',
      lg: 'size-9 text-ui',
      xl: 'size-10 text-heading'
    },
    tone: {
      default:
        'bg-secondary-background text-base-foreground shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06),inset_0_1px_0_rgb(255_255_255/0.06)]',
      solid: 'bg-[#3a3a3d] text-base-foreground'
    }
  },
  defaultVariants: { size: 'md', tone: 'default' }
})

const { class: className } = defineProps<{
  size?: VariantProps<typeof avatarVariants>['size']
  tone?: VariantProps<typeof avatarVariants>['tone']
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <span :class="cn(avatarVariants({ size, tone }), className)"><slot /></span>
</template>
