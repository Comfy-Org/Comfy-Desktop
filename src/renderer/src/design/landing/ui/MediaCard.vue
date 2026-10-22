<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import Card from './Card.vue'
import { cn } from './cn'

/** Image-led card: media on top (card 12 /p4 → media 8), corner slots for
 *  chips, body below. Used by templates, tutorials and the asset gallery. */
const {
  src,
  ratio = '16/10',
  selected = false,
  class: className
} = defineProps<{
  src?: string
  ratio?: string
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
    :class="cn('group flex flex-col', selected && 'ring-2 ring-base-foreground/80', className)"
  >
    <div
      class="relative overflow-hidden rounded-control bg-card-background-hover"
      :style="{ aspectRatio: ratio }"
    >
      <slot name="media">
        <img
          v-if="src"
          :src
          alt=""
          loading="lazy"
          class="size-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
        />
      </slot>
      <div v-if="$slots['top-left']" class="absolute top-2 left-2 flex gap-1">
        <slot name="top-left" />
      </div>
      <div v-if="$slots['top-right']" class="absolute top-2 right-2 flex gap-1">
        <slot name="top-right" />
      </div>
      <div v-if="$slots['bottom-right']" class="absolute right-2 bottom-2 flex gap-1">
        <slot name="bottom-right" />
      </div>
    </div>
    <div v-if="$slots.default" class="flex flex-1 flex-col px-2 pt-2.5 pb-2"><slot /></div>
  </Card>
</template>
