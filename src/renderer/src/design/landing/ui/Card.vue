<script setup lang="ts">
import { Primitive, type PrimitiveProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { cn } from './cn'
import { cardVariants, type CardVariants } from './card.variants'

interface Props extends PrimitiveProps {
  variant?: CardVariants['variant']
  padding?: CardVariants['padding']
  interactive?: boolean
  class?: HTMLAttributes['class']
}
const { as = 'div', class: className, interactive = false } = defineProps<Props>()
</script>

<template>
  <Primitive :as :as-child :class="cn(cardVariants({ variant, padding, interactive }), className)">
    <slot />
  </Primitive>
</template>
