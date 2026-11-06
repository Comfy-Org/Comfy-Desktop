<script setup lang="ts">
import { Search, X } from 'lucide-vue-next'

/** The search field in Mar's toolbars: radius 10, clears with its ×. */
const { placeholder } = defineProps<{ placeholder: string }>()
const model = defineModel<string>({ required: true })
</script>

<template>
  <label class="mar-pfind">
    <Search :size="14" />
    <input
      v-model="model"
      type="search"
      :placeholder
      :aria-label="placeholder"
      @keydown.esc="model = ''"
    />
    <button
      v-if="model"
      type="button"
      class="mar-pfind-x"
      aria-label="Clear search"
      @click="model = ''"
    >
      <X :size="13" />
    </button>
  </label>
</template>

<style>
:root .proto-ui.proto-ui.proto-ui .mar-pfind {
  display: flex;
  width: 220px;
  height: 32px;
  align-items: center;
  gap: 8px;
  padding: 0 8px 0 10px;
  border-radius: var(--mar-tab-radius, 10px);
  background-color: color-mix(
    in oklch,
    color-mix(in oklch, var(--color-base-foreground) 9%, var(--color-card-background)) 82%,
    transparent
  );
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 7%, transparent);
  color: var(--color-subtle-foreground);
  transition: box-shadow 140ms ease;
}
:root .proto-ui.proto-ui.proto-ui .mar-pfind:focus-within {
  box-shadow: inset 0 0 0 1px var(--color-border-focus);
}
:root .proto-ui.proto-ui.proto-ui .mar-pfind input {
  min-width: 0;
  height: 100%;
  flex: 1;
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
  color: var(--color-base-foreground);
  font-size: 13px;
  outline: none;
}
:root .proto-ui.proto-ui.proto-ui .mar-pfind input::-webkit-search-cancel-button {
  display: none;
}
:root .proto-ui.proto-ui.proto-ui .mar-pfind-x {
  display: inline-flex;
  width: 20px;
  height: 20px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 6px;
  color: var(--color-subtle-foreground);
}
</style>
