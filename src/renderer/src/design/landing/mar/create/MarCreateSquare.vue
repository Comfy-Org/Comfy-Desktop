<script setup lang="ts">
import { Plus } from 'lucide-vue-next'
import Tooltip from '../../ui/Tooltip.vue'
import { createScreen, openCreate } from './createScreen'
</script>

<template>
  <div class="mcq">
    <Tooltip content="Create" side="right">
      <button
        type="button"
        class="mcq-btn"
        aria-label="Create"
        :aria-pressed="createScreen.open"
        @click="openCreate"
      >
        <Plus :size="20" :stroke-width="2.25" />
      </button>
    </Tooltip>
  </div>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .mcq {
  display: flex;
  flex-shrink: 0;
  margin: -4px 0 16px;
  padding-left: 6px;
}
:root[data-mar-rail] .proto-ui.proto-ui.proto-ui .mcq {
  justify-content: center;
  padding-left: 0;
}
:root .proto-ui.proto-ui.proto-ui .mcq-btn {
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  border-radius: 10px;
  background: var(--color-inverted-background);
  color: var(--color-inverted-foreground);
  transition:
    background-color 150ms ease,
    scale 150ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mcq-btn:hover {
  background: var(--color-inverted-background-hover);
}
:root .proto-ui.proto-ui.proto-ui .mcq-btn:active {
  scale: 0.96;
}
:root .proto-ui.proto-ui.proto-ui .mcq-btn:focus-visible {
  outline: 2px solid var(--color-base-foreground);
  outline-offset: 2px;
}
</style>
