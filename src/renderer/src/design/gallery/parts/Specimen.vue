<script setup lang="ts">
import { cn } from '../../landing/ui/cn'

/**
 * One option of a component, in an equal cell of a VariantGroup: the
 * sample centred on top, its value as the caption. `fill` stretches the
 * sample to the cell width; `bleed` drops the padding (samples on imagery);
 * `span` widens the cell.
 */
const {
  label,
  fill = false,
  bleed = false,
  span
} = defineProps<{
  label?: string
  fill?: boolean
  bleed?: boolean
  span?: 2 | 'full'
}>()
</script>

<template>
  <figure
    :class="
      cn(
        'flex min-w-0 flex-col overflow-hidden rounded-control border border-border-default',
        span === 2 && 'col-span-2',
        span === 'full' && 'col-span-full'
      )
    "
  >
    <div
      :class="
        cn(
          'relative flex min-h-20 flex-1 items-center justify-center',
          !bleed && 'p-4',
          fill && '[&>*]:w-full'
        )
      "
    >
      <slot />
    </div>
    <figcaption
      v-if="label"
      class="truncate border-t border-border-default px-3 py-1.5 font-mono text-ui text-muted-foreground"
    >
      {{ label }}
    </figcaption>
  </figure>
</template>
