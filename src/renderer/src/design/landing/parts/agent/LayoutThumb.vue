<script setup lang="ts">
import { PenLine } from 'lucide-vue-next'
import { cn } from '../../ui/cn'
import type { LayoutId } from '../../agent'

/** Wireframe of an app layout. `src` fills the result area when given. */
const {
  layout,
  src,
  described = false,
  class: className
} = defineProps<{
  layout: LayoutId
  src?: string
  /** Custom layout built from a description (vs. the empty picker tile). */
  described?: boolean
  class?: string
}>()
const field = 'rounded-[3px] bg-white/10'
</script>

<template>
  <div
    :class="
      cn('relative aspect-[4/3] overflow-hidden rounded-control bg-black/30 p-[6%]', className)
    "
  >
    <!-- Form + result -->
    <div v-if="layout === 'form'" class="grid size-full grid-cols-[38%_1fr] gap-[5%]">
      <div class="flex flex-col gap-[8%]">
        <div :class="cn(field, 'h-[30%]')" />
        <div :class="cn(field, 'h-[10%]')" />
        <div :class="cn(field, 'h-[10%]')" />
        <div class="mt-auto h-[12%] rounded-[3px] bg-white/70" />
      </div>
      <div class="overflow-hidden rounded-[4px] bg-white/10">
        <img v-if="src" :src alt="" class="size-full object-cover" />
      </div>
    </div>

    <!-- Canvas -->
    <div v-else-if="layout === 'canvas'" class="flex size-full flex-col gap-[5%]">
      <div class="flex-1 overflow-hidden rounded-[4px] bg-white/10">
        <img v-if="src" :src alt="" class="size-full object-cover" />
      </div>
      <div class="flex h-[16%] items-center gap-[3%] rounded-full bg-white/10 px-[4%]">
        <span class="h-[40%] w-[14%] rounded-full bg-white/15" />
        <span class="h-[40%] w-[14%] rounded-full bg-white/15" />
        <span class="ml-auto aspect-square h-[70%] rounded-full bg-white/70" />
      </div>
    </div>

    <!-- Step by step -->
    <div v-else-if="layout === 'steps'" class="flex size-full flex-col items-center gap-[7%]">
      <div class="flex w-[40%] items-center gap-[8%]">
        <span class="h-[5px] flex-1 rounded-full bg-white/70" />
        <span class="h-[5px] flex-1 rounded-full bg-white/15" />
        <span class="h-[5px] flex-1 rounded-full bg-white/15" />
      </div>
      <div class="flex w-[62%] flex-1 flex-col gap-[8%] rounded-[4px] bg-white/10 p-[6%]">
        <div class="h-[10%] w-[60%] rounded-[2px] bg-white/25" />
        <div class="flex-1 overflow-hidden rounded-[3px] bg-white/10">
          <img v-if="src" :src alt="" class="size-full object-cover opacity-80" />
        </div>
        <div class="ml-auto h-[14%] w-[34%] rounded-[3px] bg-white/70" />
      </div>
    </div>

    <!-- Custom, built from the description -->
    <div v-else-if="described" class="flex size-full flex-col gap-[5%]">
      <div class="flex-1 overflow-hidden rounded-[4px] bg-white/10">
        <img v-if="src" :src alt="" class="size-full object-cover" />
      </div>
      <div class="grid h-[22%] grid-cols-3 gap-[4%]">
        <span class="rounded-[3px] bg-white/15" />
        <span class="rounded-[3px] bg-white/10" />
        <span class="rounded-[3px] bg-white/10" />
      </div>
      <div class="h-[11%] rounded-[3px] bg-white/70" />
    </div>

    <!-- Custom, not described yet -->
    <div
      v-else
      class="flex size-full flex-col items-center justify-center gap-2 rounded-[4px] border border-dashed border-white/20 text-subtle-foreground"
    >
      <PenLine :size="18" />
    </div>
  </div>
</template>
