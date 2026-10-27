<script setup lang="ts">
import { PenLine } from 'lucide-vue-next'
import { cn } from '../../ui/cn'
import type { LayoutChoice } from '../../appFlow'

/** Wireframe of an app layout: where the inputs sit, where the result
 *  goes, and where Run is. */
const { layout, class: className } = defineProps<{ layout: LayoutChoice; class?: string }>()
const field = 'rounded-[2px] bg-white/12'
const result = 'rounded-[3px] bg-white/[0.07] ring-1 ring-white/10 ring-inset'
</script>

<template>
  <div
    :class="
      cn('relative aspect-[16/10] overflow-hidden rounded-control bg-black/30 p-[7%]', className)
    "
  >
    <!-- Panel left or right, result beside it -->
    <div
      v-if="layout === 'left' || layout === 'right'"
      :class="
        cn(
          'grid size-full gap-[6%]',
          layout === 'left' ? 'grid-cols-[34%_1fr]' : 'grid-cols-[1fr_34%]'
        )
      "
    >
      <div :class="cn('flex flex-col gap-[9%]', layout === 'right' && 'order-2')">
        <div :class="cn(field, 'h-[30%]')" />
        <div :class="cn(field, 'h-[9%]')" />
        <div :class="cn(field, 'h-[9%]')" />
        <div class="mt-auto h-[12%] rounded-[2px] bg-white/70" />
      </div>
      <div :class="result" />
    </div>

    <!-- Result in the center, a chunky prompt bar below -->
    <div v-else-if="layout === 'bottom'" class="flex size-full flex-col items-center gap-[7%]">
      <div :class="cn(result, 'w-[62%] flex-1')" />
      <div
        class="flex h-[26%] w-[78%] flex-col justify-between rounded-[4px] bg-white/[0.06] p-[3%] ring-1 ring-white/12 ring-inset"
      >
        <div :class="cn(field, 'h-[22%] w-[55%] bg-white/18')" />
        <div class="flex items-center gap-[4%]">
          <div :class="cn(field, 'aspect-square h-[150%]')" />
          <div :class="cn(field, 'h-[90%] w-[18%]')" />
          <div :class="cn(field, 'h-[90%] w-[12%]')" />
          <div class="ml-auto aspect-square h-[170%] rounded-full bg-white/70" />
        </div>
      </div>
    </div>

    <!-- Custom: describe it -->
    <div
      v-else
      class="flex size-full items-center justify-center rounded-[3px] border border-dashed border-white/15 text-subtle-foreground"
    >
      <PenLine :size="16" />
    </div>
  </div>
</template>
