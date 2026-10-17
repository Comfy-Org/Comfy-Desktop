<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import Card from './Card.vue'
import { cn } from '../cn'

/** Media-led card: a 16:9 preview that shows the whole image, letterboxed on
 *  the darkest surface (card 12 /p4 → media 8), a corner slot for a chip, and
 *  a body below. */
const {
  src,
  selected = false,
  class: className
} = defineProps<{
  src?: string
  selected?: boolean
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <Card
    variant="elevated"
    padding="xs"
    interactive
    role="button"
    tabindex="0"
    :class="cn('flex flex-col', selected && 'ring-2 ring-base-foreground/80', className)"
  >
    <div class="relative aspect-video overflow-hidden rounded-control bg-content-background">
      <slot name="media">
        <img v-if="src" :src alt="" loading="lazy" class="size-full object-contain" />
      </slot>
      <div v-if="$slots['bottom-right']" class="absolute right-2 bottom-2 flex gap-1">
        <slot name="bottom-right" />
      </div>
    </div>
    <div v-if="$slots.default" class="flex flex-1 flex-col px-2 pt-2.5 pb-2"><slot /></div>
  </Card>
</template>
