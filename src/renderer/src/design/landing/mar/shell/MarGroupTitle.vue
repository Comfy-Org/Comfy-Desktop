<script setup lang="ts">
import { ArrowRight } from 'lucide-vue-next'

/** A sidebar group's title that opens its overview (Mar's proposal): it
 *  replaces the "All spaces / All projects" row. The arrow wakes on hover. */
defineProps<{ title: string; active?: boolean }>()
defineEmits<{ click: [] }>()
</script>

<template>
  <button
    type="button"
    class="mar-group-title"
    :aria-current="active ? 'page' : undefined"
    @click="$emit('click')"
  >
    <span>{{ title }}</span>
    <ArrowRight :size="12" :stroke-width="2.25" class="mar-group-arrow" aria-hidden="true" />
  </button>
</template>

<style>
/* Global: goes past the prototype's button reset. */
:root .proto-ui.proto-ui.proto-ui .mar-group-title {
  display: inline-flex;
  width: auto;
  height: 22px;
  align-items: center;
  gap: 5px;
  margin-left: -6px;
  padding: 0 6px;
  border-radius: 6px;
  color: var(--color-subtle-foreground);
  font-size: var(--text-ui, 13px);
  font-weight: 500;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  transition: color 150ms ease;
}
.mar-group-arrow {
  opacity: 0.35;
  transform: translateX(-2px);
  transition:
    opacity 150ms ease,
    transform 200ms cubic-bezier(0.16, 1, 0.3, 1);
}
:root .proto-ui.proto-ui.proto-ui .mar-group-title:hover,
:root .proto-ui.proto-ui.proto-ui .mar-group-title:focus-visible,
:root .proto-ui.proto-ui.proto-ui .mar-group-title[aria-current='page'] {
  color: var(--color-base-foreground);
}
.mar-group-title:hover .mar-group-arrow,
.mar-group-title:focus-visible .mar-group-arrow,
.mar-group-title[aria-current='page'] .mar-group-arrow {
  opacity: 1;
  transform: translateX(0);
}
@media (prefers-reduced-motion: reduce) {
  .mar-group-arrow {
    transition: opacity 150ms ease;
  }
}
</style>
