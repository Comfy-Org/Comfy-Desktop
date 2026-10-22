<script setup lang="ts">
/** Horizontally scrolling row that snaps to items. `columns` is how many
 *  items fit the width (fractions peek the next one). */
const { columns = 4.4, min = 220 } = defineProps<{ columns?: number; min?: number }>()
</script>

<template>
  <div
    class="grid snap-x snap-mandatory auto-cols-(--col) grid-flow-col gap-3.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&>*]:snap-start"
    :style="{
      '--col': `minmax(${min}px, calc((100% - ${(Math.ceil(columns) - 1) * 14}px) / ${columns}))`
    }"
  >
    <slot />
  </div>
</template>
