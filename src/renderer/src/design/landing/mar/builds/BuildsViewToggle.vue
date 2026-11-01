<script setup lang="ts">
import { LayoutGrid, Rows3 } from 'lucide-vue-next'
import { buildsView } from './buildsView'

/** Cards or Compact, next to the Builds filters (Mar's proposal). */
</script>

<template>
  <div class="mar-bv" role="radiogroup" aria-label="View">
    <button
      type="button"
      role="radio"
      :aria-checked="buildsView.id === 'cards'"
      aria-label="Cards"
      title="Cards"
      class="mar-bv-btn"
      @click="buildsView.id = 'cards'"
    >
      <LayoutGrid :size="14" />
    </button>
    <button
      type="button"
      role="radio"
      :aria-checked="buildsView.id === 'compact'"
      aria-label="Compact"
      title="Compact"
      class="mar-bv-btn"
      @click="buildsView.id = 'compact'"
    >
      <Rows3 :size="14" />
    </button>
  </div>
</template>

<style>
.mar-bv {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border-radius: var(--mar-tab-radius);
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
}
:root .proto-ui.proto-ui.proto-ui .mar-bv-btn {
  display: inline-flex;
  width: 30px;
  height: 28px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: var(--mar-tab-item-radius);
  color: var(--color-muted-foreground);
}
:root .proto-ui.proto-ui.proto-ui .mar-bv-btn[aria-checked='true'] {
  background: color-mix(in oklch, var(--color-base-foreground) 11%, transparent);
  color: var(--color-base-foreground);
}
</style>
