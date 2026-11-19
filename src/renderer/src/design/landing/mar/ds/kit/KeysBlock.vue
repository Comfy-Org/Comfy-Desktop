<script setup lang="ts">
import { useMode } from './mode'

/** A demo's keys: collapsed under the demo on the overview, open in Details. */
const open = useMode().mode === 'details'
</script>

<template>
  <dl v-if="open" class="ds-ia-keys"><slot /></dl>
  <details v-else class="ds-ia-keys-fold">
    <summary>Keys</summary>
    <dl class="ds-ia-keys"><slot /></dl>
  </details>
</template>

<style>
.ds-ia-keys-fold summary {
  color: var(--color-muted-foreground);
  font-size: 12px;
  cursor: pointer;
}
.ds-ia-keys-fold[open] summary {
  margin-bottom: 6px;
}
/* Details: the keys alone. */
.ds-frame-page.is-details .ds-ia :is(.ds-cells, .ds-ia-lib, .ds-more) {
  display: none;
}
</style>
