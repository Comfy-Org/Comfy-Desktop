<script setup lang="ts">
/** UI Playground: one tweak, its label beside its control (over it with
 *  `stack`, for wide controls). It comes and goes by its height, so the
 *  rows under it slide instead of jumping. */
const {
  show = true,
  label,
  stack
} = defineProps<{ show?: boolean; label?: string; stack?: boolean }>()
</script>

<template>
  <Transition name="tw">
    <div v-if="show" class="tw-row">
      <div v-if="label && !stack" class="tw-in flex items-center gap-3">
        <span class="w-18 shrink-0 text-ui leading-tight text-subtle-foreground">{{ label }}</span>
        <div class="flex min-w-0 flex-1 flex-col gap-1.5"><slot /></div>
      </div>
      <div v-else class="tw-in flex flex-col gap-1.5">
        <span v-if="label" class="truncate text-ui text-subtle-foreground">{{ label }}</span>
        <slot />
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* Grid rows 0fr ⇄ 1fr animate the height; clipped only while it moves,
   so focus rings show. */
.tw-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: 1fr;
}
.tw-in {
  min-width: 0;
  min-height: 0;
  padding-top: 10px;
}
.tw-enter-active,
.tw-leave-active {
  transition:
    grid-template-rows 200ms cubic-bezier(0.2, 0, 0, 1),
    opacity 160ms ease;
}
.tw-enter-active > .tw-in,
.tw-leave-active > .tw-in {
  overflow: hidden;
}
.tw-enter-from,
.tw-leave-to {
  grid-template-rows: 0fr;
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .tw-enter-active,
  .tw-leave-active {
    transition: none;
  }
}
</style>
