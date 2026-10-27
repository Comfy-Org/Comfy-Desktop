<script setup lang="ts">
import { Loader2 } from 'lucide-vue-next'
import { cn } from '../../ui/cn'
import type { AppLayout } from '../../appFlow'

/** While the agent makes the first version: the app's shape, in quiet
 *  placeholder blocks with a soft sweep, laid out like the picked layout. */
const { layout } = defineProps<{ layout: AppLayout }>()
const block = 'skeleton rounded-control bg-secondary-background'
</script>

<template>
  <div class="flex flex-col px-6 py-4" aria-busy="true" aria-label="Loading the preview">
    <div class="flex items-center gap-2.5 py-0.5">
      <span :class="cn(block, 'size-5 rounded-min')" />
      <span :class="cn(block, 'h-3 w-16')" />
    </div>
    <span :class="cn(block, 'mt-6 h-6 w-56')" />
    <span :class="cn(block, 'mt-3 h-3 w-80')" />
    <span :class="cn(block, 'mt-4 h-3 w-36')" />

    <!-- Inputs and result, in the layout's arrangement -->
    <div
      v-if="layout !== 'bottom'"
      :class="
        cn(
          'mt-8 grid gap-6',
          layout === 'left'
            ? 'grid-cols-[minmax(0,240px)_minmax(0,1fr)]'
            : 'grid-cols-[minmax(0,1fr)_minmax(0,240px)]'
        )
      "
    >
      <div :class="cn('flex flex-col gap-5', layout === 'right' && 'order-2')">
        <span :class="cn(block, 'aspect-[4/3] w-full rounded-card')" />
        <span :class="cn(block, 'h-8 w-full')" />
        <span :class="cn(block, 'h-8 w-full')" />
        <span :class="cn(block, 'mt-2 h-9 w-full')" />
      </div>
      <span :class="cn(block, 'aspect-[4/3] w-full rounded-card')" />
    </div>
    <div v-else class="mt-8 flex flex-col items-center gap-6">
      <span :class="cn(block, 'aspect-[4/3] w-full max-w-2xl rounded-card')" />
      <span :class="cn(block, 'h-24 w-full max-w-3xl rounded-panel')" />
    </div>

    <p class="mt-6 flex items-center gap-2 text-ui text-subtle-foreground">
      <Loader2 :size="13" class="animate-spin" />Building the preview…
    </p>
  </div>
</template>

<style scoped>
/* A soft light passes over the placeholders (decorative: off for reduced
   motion). */
.skeleton {
  display: block;
  background-image: linear-gradient(
    100deg,
    transparent 30%,
    oklch(1 0 0 / 0.05) 50%,
    transparent 70%
  );
  background-size: 300% 100%;
  animation: sweep 1.4s cubic-bezier(0.645, 0.045, 0.355, 1) infinite;
}
@keyframes sweep {
  from {
    background-position: 100% 0;
  }
  to {
    background-position: 0 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .skeleton {
    animation: none;
  }
}
</style>
