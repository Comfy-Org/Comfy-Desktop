<script setup lang="ts">
import { Primitive, type PrimitiveProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { cn } from './cn'
import { buttonVariants, type ButtonVariants } from './button.variants'

interface Props extends PrimitiveProps {
  variant?: ButtonVariants['variant']
  size?: ButtonVariants['size']
  block?: boolean
  disabled?: boolean
  class?: HTMLAttributes['class']
}

const { as = 'button', class: className, block = false, disabled = false } = defineProps<Props>()
</script>

<template>
  <Primitive
    :as
    :as-child
    :type="as === 'button' && !asChild ? 'button' : undefined"
    :disabled
    :class="cn(buttonVariants({ variant, size, block }), className)"
  >
    <slot />
  </Primitive>
</template>
