<script setup lang="ts">
/**
 * One axis of a component (variant, size, state…): a titled grid of equal
 * cells, so every option sits in the same frame and lines up. `prop` names
 * the prop the cells vary, e.g. `variant`.
 */
const {
  title,
  prop,
  note,
  cell = 'sm'
} = defineProps<{
  title: string
  prop?: string
  note?: string
  /** Minimum cell width: sm 8rem, md 12rem, lg 16rem. */
  cell?: 'sm' | 'md' | 'lg'
}>()
const COLS = {
  sm: 'grid-cols-[repeat(auto-fill,minmax(8rem,1fr))]',
  md: 'grid-cols-[repeat(auto-fill,minmax(12rem,1fr))]',
  lg: 'grid-cols-[repeat(auto-fill,minmax(16rem,1fr))]'
}
</script>

<template>
  <section class="flex flex-col gap-3">
    <header class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <h3 class="text-ui font-medium">{{ title }}</h3>
      <code
        v-if="prop"
        class="rounded-min bg-secondary-background px-1.5 font-mono text-ui text-muted-foreground"
        >{{ prop }}</code
      >
      <p v-if="note" class="text-ui text-subtle-foreground">{{ note }}</p>
    </header>
    <div :class="['grid gap-3', COLS[cell]]"><slot /></div>
  </section>
</template>
